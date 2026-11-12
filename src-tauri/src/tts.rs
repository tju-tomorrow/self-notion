//! 免费的 Edge 在线音色，先把划线读 / 全篇读跑起来。换 SiliconFlow / 阿里只换这一层。
//!
//! 合成交给本机已经装好的 `edge-tts`（Python）。同一句落在本机，再听不请求。

use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::commands::{ApiError, ApiResult, Bytes};
use crate::log;

#[derive(Deserialize)]
struct In {
    text: String,
    voice: String,
    rate: f64,
}

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
    if let Ok(hit) = std::fs::read(&path) {
        if hit.len() > 128 {
            return Ok(serde_json::json!({ "audio": Bytes(hit) }));
        }
    }
    match synth(&path, &text, &input.voice, &rate) {
        Ok(()) => {}
        Err(err) => {
            let _ = std::fs::remove_file(&path);
            log::record("read", &err);
            return Err(ApiError::new("read", err));
        }
    }
    let audio = std::fs::read(&path).map_err(|e| ApiError::new("read", e.to_string()))?;
    if audio.len() <= 128 {
        let _ = std::fs::remove_file(&path);
        let err = "朗读没有出声".to_string();
        log::record("read", &err);
        return Err(ApiError::new("read", err));
    }
    Ok(serde_json::json!({ "audio": Bytes(audio) }))
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

fn synth(path: &std::path::Path, text: &str, voice: &str, rate: &str) -> Result<(), String> {
    let python = python()?;
    let out = Command::new(&python)
        .arg("-m")
        .arg("edge_tts")
        .arg("--text")
        .arg(text)
        .arg("--voice")
        .arg(voice)
        .arg("--rate")
        .arg(rate)
        .arg("--write-media")
        .arg(path)
        .output()
        .map_err(|e| format!("没找到 {python}（{e}）。朗读用的是本机的 edge-tts"))?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let err = err.trim();
    let err = if err.chars().count() > 400 {
        err.chars().take(400).collect()
    } else {
        err.to_string()
    };
    if err.is_empty() {
        Err(format!("edge-tts 退出了 {}", out.status))
    } else {
        Err(err)
    }
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
