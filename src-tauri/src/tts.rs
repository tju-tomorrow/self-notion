//! 免费的 Edge 在线音色。换 SiliconFlow / 阿里只换这一层。
//!
//! 合成在常驻的 edge-tts 里，并且不占主线程：同步命令卡在主线程上会把正在播的声音冻住。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::mpsc;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{ApiError, ApiResult, Bytes};
use crate::log;

#[derive(Deserialize)]
struct In {
    text: String,
    voice: String,
    rate: f64,
    /// 只把这句写进缓存，不把音频送回来。打开文档时先备好头两句。
    #[serde(default)]
    stash: bool,
}

const SLOTS_N: usize = 2;
static TICKET: AtomicU64 = AtomicU64::new(1);
static NEXT: AtomicUsize = AtomicUsize::new(0);
static SLOTS: [Mutex<Option<Worker>>; SLOTS_N] = [Mutex::new(None), Mutex::new(None)];

pub fn speak(app: &AppHandle, args: Value) -> ApiResult<Value> {
    let input: In = serde_json::from_value(args).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
    let text = clean(&input.text);
    if text.is_empty() {
        return Err(ApiError::new("read", "没有字"));
    }
    if text.chars().count() > 800 {
        return Err(ApiError::new("read", "这一句太长"));
    }
    if !voice_ok(&input.voice) {
        return Err(ApiError::new("read", "不认识这个音色"));
    }
    if !input.rate.is_finite() {
        return Err(ApiError::new("read", "语速不对"));
    }
    let rate = rate_attr(input.rate);
    let key = cache_key(&input.voice, &rate, &text);
    let path = cache_path(app, &key)?;
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 128 {
            if input.stash {
                return Ok(json!({ "stashed": true }));
            }
            let hit = std::fs::read(&path).map_err(|e| ApiError::new("read", e.to_string()))?;
            return Ok(json!({ "audio": Bytes(hit) }));
        }
    }
    let ticket = TICKET.fetch_add(1, Ordering::Relaxed);
    let app = app.clone();
    let voice = input.voice;
    let stash = input.stash;
    // 同步命令在主线程上，合成放后台，不把正在播的声音冻住。
    std::thread::spawn(move || {
        let outcome = run_job(&path, &text, &voice, &rate, ticket);
        if stash {
            return;
        }
        emit_audio(&app, ticket, outcome);
    });
    if stash {
        Ok(json!({ "stashed": true }))
    } else {
        Ok(json!({ "ticket": ticket }))
    }
}

pub fn warm() -> ApiResult<Value> {
    std::thread::spawn(|| {
        for idx in 0..SLOTS_N {
            let mut slot = SLOTS[idx].lock().unwrap_or_else(|err| err.into_inner());
            if slot.is_some() {
                continue;
            }
            let Ok(worker) = Worker::spawn() else {
                return;
            };
            *slot = Some(worker);
            if slot.as_mut().unwrap().request(&json!({ "ping": true })).is_err() {
                *slot = None;
                return;
            }
        }
    });
    Ok(Value::Null)
}

fn clean(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        let code = ch as u32;
        if (0..=8).contains(&code) || (11..=12).contains(&code) || (14..=31).contains(&code) {
            out.push(' ');
        } else {
            out.push(ch);
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn voice_ok(voice: &str) -> bool {
    let bytes = voice.as_bytes();
    if !(8..80).contains(&bytes.len()) || !voice.ends_with("Neural") {
        return false;
    }
    let mut parts = voice.split('-');
    let Some(lang) = parts.next() else { return false };
    let Some(region) = parts.next() else { return false };
    let rest: Vec<&str> = parts.collect();
    if rest.is_empty() {
        return false;
    }
    lang.bytes().all(|b| b.is_ascii_lowercase())
        && (2..12).contains(&lang.len())
        && region.bytes().all(|b| b.is_ascii_uppercase())
        && (2..8).contains(&region.len())
        && rest.iter().all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_alphanumeric()))
}

fn rate_attr(rate: f64) -> String {
    let pct = ((rate - 1.0) * 100.0).round() as i32;
    format!("{:+}%", pct.clamp(-50, 100))
}

fn cache_key(voice: &str, rate: &str, text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(voice.as_bytes());
    hasher.update([0]);
    hasher.update(rate.as_bytes());
    hasher.update([0]);
    hasher.update(text.as_bytes());
    let dig = hasher.finalize();
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(dig.len() * 2);
    for b in dig {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

fn cache_path(app: &AppHandle, key: &str) -> ApiResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| ApiError::new("read", e.to_string()))?
        .join("read-cache");
    std::fs::create_dir_all(&dir).map_err(|e| ApiError::new("read", e.to_string()))?;
    Ok(dir.join(format!("{key}.mp3")))
}

fn flights() -> &'static Mutex<HashMap<String, Vec<mpsc::Sender<Result<(), String>>>>> {
    static FLIGHTS: OnceLock<Mutex<HashMap<String, Vec<mpsc::Sender<Result<(), String>>>>>> = OnceLock::new();
    FLIGHTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn read_hit(path: &Path) -> Option<Vec<u8>> {
    let audio = std::fs::read(path).ok()?;
    if audio.len() > 128 { Some(audio) } else { None }
}

/// 同一句已经在合成时跟上那一次。打开文档时备的那句，点下去不用再来一遍。
fn run_job(path: &Path, text: &str, voice: &str, rate: &str, ticket: u64) -> Result<Vec<u8>, String> {
    if let Some(hit) = read_hit(path) {
        return Ok(hit);
    }
    let key = path.to_string_lossy().into_owned();
    let joined = {
        let mut map = flights().lock().unwrap_or_else(|err| err.into_inner());
        if let Some(waiters) = map.get_mut(&key) {
            let (tx, rx) = mpsc::channel();
            waiters.push(tx);
            Some(rx)
        } else {
            map.insert(key.clone(), Vec::new());
            None
        }
    };
    if let Some(rx) = joined {
        return match rx.recv() {
            Ok(Ok(())) => read_hit(path).ok_or_else(|| "朗读没有出声".to_string()),
            Ok(Err(err)) => Err(err),
            Err(_) => Err("朗读没出来".into()),
        };
    }
    let mut guard = FlightGuard { key, status: None };
    let outcome = synth_file(path, text, voice, rate, ticket);
    guard.status = Some(match &outcome {
        Ok(_) => Ok(()),
        Err(err) => Err(err.clone()),
    });
    drop(guard);
    outcome
}

struct FlightGuard {
    key: String,
    status: Option<Result<(), String>>,
}

impl Drop for FlightGuard {
    fn drop(&mut self) {
        let status = self.status.take().unwrap_or_else(|| Err("朗读没出来".into()));
        let waiters = match flights().lock() {
            Ok(mut map) => map.remove(&self.key).unwrap_or_default(),
            Err(err) => err.into_inner().remove(&self.key).unwrap_or_default(),
        };
        for tx in waiters {
            let _ = tx.send(status.clone());
        }
    }
}

fn synth_file(path: &Path, text: &str, voice: &str, rate: &str, ticket: u64) -> Result<Vec<u8>, String> {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("read");
    let tmp = path.with_file_name(format!("{stem}.{ticket}.part"));
    let result = (|| {
        synth(&tmp, text, voice, rate)?;
        let audio = std::fs::read(&tmp).map_err(|e| e.to_string())?;
        if audio.len() <= 128 {
            return Err("朗读没有出声".to_string());
        }
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
        Ok(audio)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn emit_audio(app: &AppHandle, ticket: u64, outcome: Result<Vec<u8>, String>) {
    let payload = match outcome {
        Ok(audio) => json!({ "ticket": ticket, "audio": Bytes(audio) }),
        Err(err) => {
            log::record("read", &err);
            json!({ "ticket": ticket, "err": err })
        }
    };
    if let Err(err) = app.emit("read:audio", payload) {
        log::record("read", &err.to_string());
    }
}

const WORKER_PY: &str = r#"
import json
import sys

import edge_tts

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            if req.get("ping"):
                sys.stdout.write('{"ok":true}\n')
                sys.stdout.flush()
                continue
            edge_tts.Communicate(req["text"], req["voice"], rate=req["rate"]).save_sync(req["path"])
            sys.stdout.write('{"ok":true}\n')
        except Exception as e:
            msg = " ".join(str(e).split())[:400]
            sys.stdout.write(json.dumps({"ok": False, "err": msg}, ensure_ascii=False) + "\n")
        sys.stdout.flush()

main()
"#;

struct Worker {
    child: Child,
    stdin: std::process::ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

impl Worker {
    fn spawn() -> Result<Self, String> {
        let python = python()?;
        let mut child = Command::new(&python)
            .arg("-u")
            .arg("-c")
            .arg(WORKER_PY)
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("没找到 {python}（{e}）。朗读用的是本机的 edge-tts"))?;
        let Some(stdin) = child.stdin.take() else {
            let _ = child.kill();
            return Err("朗读进程没有输入".into());
        };
        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill();
            return Err("朗读进程没有输出".into());
        };
        Ok(Self { child, stdin, stdout: BufReader::new(stdout) })
    }

    fn request(&mut self, payload: &Value) -> Result<(), Miss> {
        let mut line = serde_json::to_string(payload).map_err(|e| Miss::Dead(e.to_string()))?;
        line.push('\n');
        if let Err(err) = self.stdin.write_all(line.as_bytes()).and_then(|_| self.stdin.flush()) {
            return Err(Miss::Dead(format!("朗读进程断了：{err}")));
        }
        let mut resp = String::new();
        let n = self
            .stdout
            .read_line(&mut resp)
            .map_err(|e| Miss::Dead(format!("朗读进程断了：{e}")))?;
        if n == 0 {
            return Err(Miss::Dead("朗读进程退出了".into()));
        }
        let v: Value = match serde_json::from_str(resp.trim()) {
            Ok(v) => v,
            Err(_) => return Err(Miss::Dead("朗读进程回了听不懂的话".into())),
        };
        if v.get("ok").and_then(|x| x.as_bool()) == Some(true) {
            return Ok(());
        }
        let err = v.get("err").and_then(|x| x.as_str()).unwrap_or("朗读失败");
        let err = if err.chars().count() > 400 {
            err.chars().take(400).collect()
        } else {
            err.to_string()
        };
        Err(Miss::Remote(err))
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

enum Miss {
    /// 进程还在，这句没合成出来。
    Remote(String),
    /// 进程没了，换一只再试。
    Dead(String),
}

fn humanize(err: String) -> String {
    if err.contains("No audio was received") {
        return "这个音色现在没有出声".into();
    }
    err
}

fn synth(path: &Path, text: &str, voice: &str, rate: &str) -> Result<(), String> {
    let idx = NEXT.fetch_add(1, Ordering::Relaxed) % SLOTS_N;
    let mut slot = SLOTS[idx].lock().unwrap_or_else(|err| err.into_inner());
    let payload = json!({
        "text": text,
        "voice": voice,
        "rate": rate,
        "path": path.to_string_lossy(),
    });
    let mut last = "朗读进程断了".to_string();
    for attempt in 0..2 {
        if slot.is_none() {
            *slot = Some(Worker::spawn()?);
        }
        match slot.as_mut().unwrap().request(&payload) {
            Ok(()) => return Ok(()),
            Err(Miss::Remote(msg)) => return Err(humanize(msg)),
            Err(Miss::Dead(msg)) => {
                *slot = None;
                last = msg;
                if attempt == 1 {
                    return Err(last);
                }
            }
        }
    }
    Err(last)
}

/// 应用自己的 PATH 里 `python3` 经常是另一只，没装 edge-tts。找到能 `import edge_tts` 的那只再用。
fn python() -> Result<String, String> {
    static FOUND: OnceLock<String> = OnceLock::new();
    if let Some(hit) = FOUND.get() {
        return Ok(hit.clone());
    }
    let mut tried = Vec::new();
    for cand in candidates() {
        if tried.iter().any(|seen: &String| seen == &cand) {
            continue;
        }
        tried.push(cand.clone());
        if has_edge(&cand) {
            let _ = FOUND.set(cand.clone());
            return Ok(cand);
        }
    }
    Err(format!("这几只 Python 都没有 edge-tts：{}", tried.join("、")))
}

fn candidates() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(explicit) = std::env::var("SELF_NOTION_PYTHON") {
        if !explicit.is_empty() {
            out.push(explicit);
        }
    }
    for path in [
        "/opt/homebrew/bin/python3",
        "/opt/homebrew/bin/python3.13",
        "/usr/local/bin/python3",
        "/usr/bin/python3",
    ] {
        out.push(path.to_string());
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':').filter(|dir| !dir.is_empty()) {
            out.push(format!("{dir}/python3.13"));
            out.push(format!("{dir}/python3"));
        }
    }
    out
}

fn has_edge(python: &str) -> bool {
    Command::new(python)
        .arg("-c")
        .arg("import edge_tts")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}
