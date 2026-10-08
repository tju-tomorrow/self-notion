//! bug 现场包（D-0126）：`<app data>/bugs/<at>-<kind>.json`。
//!
//! **为什么要有**：会出错的东西不一定抛 —— DOM 与模型脱钩、一次粘贴多插一份、输入法残留，
//! 这些都不抛，而 `errors.log` 只收「抛出来的错」，于是那类错一个都留不下，每查一次就得
//! 现造一个探针、再让人复现一遍。这个目录是「出错那一刻的现场」：前端打包，这里落盘，
//! 终端（`pnpm bugs`）和应用内那一页都读它。
//!
//! ★ 目录**跟着库走**（和 `errors.log` 同一条规矩，`store::default_db_path` 的兄弟目录）：
//!   `SELF_NOTION_DB` 指到测试库时，现场包也跟着去测试目录，不把测试的现场混进真 app 的。

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// 留几份。现场包是给人看的，不是归档 —— 超了就删最旧的。
const KEEP: usize = 200;

/// 落盘时顺手带上的 `errors.log` 尾巴行数。
const ERR_TAIL: usize = 30;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn dir() -> PathBuf {
    crate::store::default_db_path().with_file_name("bugs")
}

fn log_path() -> PathBuf {
    crate::store::default_db_path().with_file_name("errors.log")
}

/// 最后 n 行。读不到就是空串 —— 现场包里少一段尾巴不该让整份抓不下来。
fn tail_lines(path: &PathBuf, n: usize) -> String {
    let Ok(text) = fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// 文件名只允许这些字符 —— 判据从 `kind` 来（前端给的），不能让它变成路径。
fn slug(s: &str) -> String {
    let out: String = s
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(32)
        .collect();
    if out.is_empty() {
        "bug".to_string()
    } else {
        out.to_lowercase()
    }
}

fn prune(dir: &PathBuf) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut files: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    if files.len() <= KEEP {
        return;
    }
    // 名字以毫秒时间戳开头 → 按名字排就是按时间排。
    files.sort();
    for old in &files[..files.len() - KEEP] {
        let _ = fs::remove_file(old);
    }
}

/// `bug:write` —— 前端给的那一包原样收下，补上 `at` 和 errors.log 尾巴再落盘。
pub fn write(mut payload: Value) -> Result<Value, String> {
    let dir = dir();
    fs::create_dir_all(&dir).map_err(|e| format!("建目录 {}：{e}", dir.display()))?;

    let at = now_ms();
    let kind = payload
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("manual")
        .to_string();
    let obj = payload.as_object_mut().ok_or("现场包不是一个对象")?;
    obj.insert("at".into(), json!(at));
    obj.insert("errors".into(), json!(tail_lines(&log_path(), ERR_TAIL)));

    let name = format!("{at}-{}.json", slug(&kind));
    let text = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    fs::write(dir.join(&name), text).map_err(|e| format!("写 {}：{e}", name))?;
    prune(&dir);

    Ok(json!({ "name": name, "at": at }))
}

/// `bug:list` —— 只要「列表页要的那几个字段」，不把整份现场搬过桥。
pub fn list() -> Result<Value, String> {
    let dir = dir();
    let mut out: Vec<Value> = Vec::new();
    let Ok(rd) = fs::read_dir(&dir) else {
        return Ok(Value::Array(out));
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(entry.path()) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
        out.push(json!({
            "name": name,
            "at": v.get("at").cloned().unwrap_or(Value::Null),
            "kind": v.get("kind").cloned().unwrap_or(Value::Null),
            "title": v.get("title").cloned().unwrap_or(Value::Null),
            "detail": v.get("detail").cloned().unwrap_or(Value::Null),
            "doc": v.get("doc").cloned().unwrap_or(Value::Null),
        }));
    }
    out.sort_by_key(|v| -v.get("at").and_then(Value::as_i64).unwrap_or(0));
    Ok(Value::Array(out))
}

/// `bug:read` —— 整份现场。名字只认**纯文件名**：这一个入口之外没有别的读盘入口，堵在这儿。
pub fn read(args: Value) -> Result<Value, String> {
    let name = args.get("name").and_then(Value::as_str).ok_or("缺 name")?;
    let ok = !name.is_empty()
        && name.ends_with(".json")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if !ok {
        return Err("文件名不合法".into());
    }
    let text = fs::read_to_string(dir().join(name)).map_err(|e| format!("读 {name}：{e}"))?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}
