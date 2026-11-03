//! 本地语音输入的命令面（D-0190）。
//!
//! 三件事：模型在不在 / 下不下；开一次录音；停一次录音。
//! 转写和采集在 `audio.rs`，模型装载在 `asr.rs` —— 这里只管会话生命周期和事件。

mod asr;
mod audio;

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use cpal::traits::StreamTrait;

use crate::commands::{ApiError, ApiResult};
use crate::log;

const MODEL_FILE: &str = "ggml-large-v3-turbo.bin";
const MODEL_URLS: [&str; 2] = [
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
];

struct Session {
    id: String,
    stop: std::sync::Arc<AtomicBool>,
    cancel: std::sync::Arc<AtomicBool>,
    stream: cpal::Stream,
    #[allow(dead_code)]
    thread: JoinHandle<()>,
}

/// 按**窗口**分开：多开窗口时各自录各自的，一个窗口开麦不该掐掉另一个。
fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    static S: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Default)]
struct Download {
    active: bool,
    received: u64,
    total: u64,
    error: String,
}

fn download() -> &'static Mutex<Download> {
    static D: OnceLock<Mutex<Download>> = OnceLock::new();
    D.get_or_init(|| Mutex::new(Download::default()))
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn parse<T: serde::de::DeserializeOwned>(args: Value) -> ApiResult<T> {
    serde_json::from_value(args).map_err(|e| ApiError::new("bad_args", e.to_string()))
}

fn model_path(app: &AppHandle) -> ApiResult<PathBuf> {
    if let Ok(path) = std::env::var("SELF_NOTION_WHISPER_MODEL") {
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| ApiError::new("voice", e.to_string()))?;
    Ok(dir.join("models").join(MODEL_FILE))
}

fn model_bytes(path: &PathBuf) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

/* ─────────────────────────── 模型 ─────────────────────────── */

/// `voice:status` —— 模型在不在、下载到哪了。
pub fn status(app: Option<&AppHandle>, _args: Value) -> ApiResult<Value> {
    let app = app.ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
    let path = model_path(app)?;
    let bytes = model_bytes(&path);
    let d = lock(download());
    Ok(json!({
        "ready": bytes > 1_000_000,
        "bytes": bytes,
        "path": path.display().to_string(),
        "downloading": d.active,
        "received": d.received,
        "total": d.total,
        "error": d.error,
        "model": MODEL_FILE,
    }))
}

/// `voice:download` —— 后台拉模型，进度走 `voice:progress`。
pub fn download_model(app: Option<&AppHandle>, _args: Value) -> ApiResult<Value> {
    let app = app
        .ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?
        .clone();
    let path = model_path(&app)?;

    {
        let mut d = lock(download());
        if d.active {
            return Ok(json!({ "started": false }));
        }
        d.active = true;
        d.received = 0;
        d.total = 0;
        d.error.clear();
    }

    std::thread::spawn(move || {
        let result = fetch(&app, &path);
        let mut d = lock(download());
        d.active = false;
        match result {
            Ok(()) => {
                d.received = model_bytes(&path);
                d.total = d.received;
                drop(d);
                // 模型是全进程共用的，谁下的都得通知到所有窗口。
                let _ = app.emit("voice:model-ready", json!({}));
            }
            Err(message) => {
                d.error = message.clone();
                drop(d);
                log::record("voice", &message);
                let _ = app.emit("voice:model-error", json!({ "message": message }));
            }
        }
    });

    Ok(json!({ "started": true }))
}

fn fetch(app: &AppHandle, path: &PathBuf) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("建模型目录失败：{e}"))?;
    }
    let part = path.with_extension("part");
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("HTTP 客户端起不来：{e}"))?;

    let mut last = String::from("没有可用的下载地址");
    for url in MODEL_URLS {
        let mut response = match client.get(url).send() {
            Ok(resp) if resp.status().is_success() => resp,
            Ok(resp) => {
                last = format!("{url} → HTTP {}", resp.status());
                continue;
            }
            Err(e) => {
                last = format!("{url} → {e}");
                continue;
            }
        };

        let total = response.content_length().unwrap_or(0);
        {
            let mut d = lock(download());
            d.total = total;
        }
        let mut file = std::fs::File::create(&part).map_err(|e| format!("写模型失败：{e}"))?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut received = 0u64;
        let mut last_emit = Instant::now();

        loop {
            let n = match response.read(&mut buf) {
                Ok(n) => n,
                Err(e) => {
                    last = format!("{url} → 读到一半断了：{e}");
                    break;
                }
            };
            if n == 0 {
                file.sync_all().map_err(|e| format!("落盘失败：{e}"))?;
                drop(file);
                std::fs::rename(&part, path).map_err(|e| format!("换名失败：{e}"))?;
                return Ok(());
            }
            if let Err(e) = file.write_all(&buf[..n]) {
                last = format!("写模型失败：{e}");
                break;
            }
            received += n as u64;
            if last_emit.elapsed() >= Duration::from_millis(200) {
                last_emit = Instant::now();
                {
                    let mut d = lock(download());
                    d.received = received;
                }
                let _ = app.emit("voice:progress", json!({ "received": received, "total": total }));
            }
        }
    }

    let _ = std::fs::remove_file(&part);
    Err(format!("模型下载失败：{last}"))
}

/* ─────────────────────────── 录音 ─────────────────────────── */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartArgs {
    session_id: String,
    language: Option<String>,
}

/// `voice:start` —— 建采集流 + 起 worker。模型装载在 worker 里（1.6 GB，不能卡住 IPC）。
pub fn start(app: Option<&AppHandle>, win: Option<&str>, args: Value) -> ApiResult<Value> {
    let a: StartArgs = parse(args)?;
    let app = app
        .ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?
        .clone();
    let win = win.unwrap_or("main").to_string();
    let path = model_path(&app)?;
    if model_bytes(&path) <= 1_000_000 {
        return Err(ApiError::new("model_missing", "语音模型还没下载"));
    }

    stop_current(&win);
    let language = a.language.unwrap_or_else(|| "zh".to_string());
    let session_id = a.session_id;
    let capture = audio::spawn(app, win.clone(), session_id.clone(), path, language)
        .map_err(|e| ApiError::new("voice", e))?;
    lock(sessions()).insert(
        win,
        Session {
            id: session_id,
            stop: capture.stop,
            cancel: capture.cancel,
            stream: capture.stream,
            thread: capture.thread,
        },
    );
    Ok(json!({ "started": true }))
}

/// `voice:stop` —— 停止采集，worker 会说完最后一段再发 `voice:done`。
pub fn stop(win: Option<&str>, _args: Value) -> ApiResult<Value> {
    let win = win.unwrap_or("main");
    if let Some(s) = lock(sessions()).get(win) {
        s.stop.store(true, Ordering::Relaxed);
        // 先停采集：worker 还要跑最后一段转写，但麦克风不该继续录。
        let _ = s.stream.pause();
    }
    Ok(json!({ "stopping": true }))
}

/// `voice:cancel` —— 直接扔掉这次录音，不转写、不发 done。
pub fn cancel(win: Option<&str>, _args: Value) -> ApiResult<Value> {
    let win = win.unwrap_or("main");
    if let Some(s) = lock(sessions()).remove(win) {
        s.cancel.store(true, Ordering::Relaxed);
        s.stop.store(true, Ordering::Relaxed);
        drop(s.stream);
    }
    Ok(Value::Null)
}

/// worker 自己收尾时把会话摘掉 —— 窗口直接关掉、前端来不及 cancel 的那种情况，
/// 不摘就会留下一个已经暂停的采集流。
pub(super) fn finish(win: &str, id: &str) {
    let mut map = lock(sessions());
    if map.get(win).is_some_and(|s| s.id == id) {
        map.remove(win);
    }
}

fn stop_current(win: &str) {
    if let Some(old) = lock(sessions()).remove(win) {
        old.cancel.store(true, Ordering::Relaxed);
        old.stop.store(true, Ordering::Relaxed);
        drop(old.stream);
    }
}
