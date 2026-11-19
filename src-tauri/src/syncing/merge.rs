//! 块级三方合并（D-0196）。
//!
//! 正文没有 CRDT，但顶层 `blockContainer` 有稳定 `attrs.id`，所以「两边改的不是同一块」
//! 可以像 git 合并文件一样合起来。同一块两边都改 = 冲突，交给调用方保留两份。
//!
//! 只认一种形状：`doc.content[0].content` 是块数组。形状不认识就返回 `None`（= 冲突），
//! **不猜** —— 猜错会静默丢字。

use std::collections::{HashMap, HashSet};

use serde_json::Value;

/// `Some(合并后的整篇)` = 干净合并；`None` = 有冲突 / 形状不认识。
pub fn three_way(base: Option<&str>, server: &str, client: &str) -> Option<String> {
    if server == client {
        return Some(client.to_string());
    }
    let base = base?;
    if base == server {
        return Some(client.to_string());
    }
    if base == client {
        return Some(server.to_string());
    }

    let b = serde_json::from_str::<Value>(base).ok()?;
    let s = serde_json::from_str::<Value>(server).ok()?;
    let c = serde_json::from_str::<Value>(client).ok()?;

    let bb = keyed(&b)?;
    let sb = keyed(&s)?;
    let cb = keyed(&c)?;

    let bm: HashMap<&str, &Value> = bb.iter().map(|(id, v)| (id.as_str(), v)).collect();
    let sm: HashMap<&str, &Value> = sb.iter().map(|(id, v)| (id.as_str(), v)).collect();
    let cm: HashMap<&str, &Value> = cb.iter().map(|(id, v)| (id.as_str(), v)).collect();

    let mut out: Vec<Value> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();

    // 以 base 的顺序走：删除、单边修改、双边相同修改都能合。
    for (id, bv) in &bb {
        let sv = sm.get(id.as_str()).copied();
        let cv = cm.get(id.as_str()).copied();
        match (sv, cv) {
            (Some(sv), Some(cv)) => {
                if cv == bv {
                    out.push(sv.clone());
                } else if sv == bv || sv == cv {
                    out.push(cv.clone());
                } else {
                    return None;
                }
            }
            (Some(sv), None) => {
                // 手机删了、桌面改过 → 冲突；桌面没动 → 删。
                if sv != bv {
                    return None;
                }
            }
            (None, Some(cv)) => {
                if cv != bv {
                    return None;
                }
            }
            (None, None) => {}
        }
        seen.insert(id.as_str());
    }

    // 两边新加的块：手机在前，桌面追加。位置不完美，内容不丢。
    for (id, cv) in &cb {
        if !bm.contains_key(id.as_str()) {
            out.push(cv.clone());
            seen.insert(id.as_str());
        }
    }
    for (id, sv) in &sb {
        if !bm.contains_key(id.as_str()) && !seen.contains(id.as_str()) {
            out.push(sv.clone());
        }
    }

    let mut doc = c;
    let arr = doc
        .get_mut("content")?
        .as_array_mut()?
        .get_mut(0)?
        .get_mut("content")?
        .as_array_mut()?;
    *arr = out;
    serde_json::to_string(&doc).ok()
}

/// `doc.content[0].content` → [(blockId, block)]。缺 id 就认不出，直接冲突。
fn keyed(doc: &Value) -> Option<Vec<(String, Value)>> {
    let arr = doc.get("content")?.as_array()?.first()?.get("content")?.as_array()?;
    let mut out = Vec::with_capacity(arr.len());
    for blk in arr {
        let id = blk.get("attrs")?.get("id")?.as_str()?;
        if id.is_empty() {
            return None;
        }
        out.push((id.to_string(), blk.clone()));
    }
    Some(out)
}

/// 合并后的正文 → 一段纯文本投影。Rust 不解析 PM，但搜索 / 摘要只需要文字。
/// 和手机端 `projectMd` 做的事一样：块之间换行，标题带 `#`。
pub fn plain_md(content: &str) -> String {
    let Ok(v) = serde_json::from_str::<Value>(content) else {
        return String::new();
    };
    let mut out = String::new();
    walk(&v, &mut out);
    let mut lines: Vec<&str> = Vec::new();
    let mut blank = false;
    for line in out.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            if !blank && !lines.is_empty() {
                lines.push("");
            }
            blank = true;
        } else {
            lines.push(line);
            blank = false;
        }
    }
    lines.join("\n").trim().to_string()
}

fn walk(v: &Value, out: &mut String) {
    let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    if t == "text" {
        out.push_str(v.get("text").and_then(|x| x.as_str()).unwrap_or(""));
        return;
    }
    if t == "hardBreak" {
        out.push('\n');
        return;
    }
    if t == "heading" {
        let level = v
            .get("attrs")
            .and_then(|a| a.get("level"))
            .and_then(|l| l.as_u64())
            .unwrap_or(1)
            .clamp(1, 6);
        out.push_str(&"#".repeat(level as usize));
        out.push(' ');
    }
    if t == "listItem" {
        out.push_str("- ");
    }
    if t == "blockquote" {
        out.push_str("> ");
    }
    if let Some(arr) = v.get("content").and_then(|x| x.as_array()) {
        for child in arr {
            walk(child, out);
        }
    }
    if matches!(t, "paragraph" | "heading" | "codeBlock") {
        out.push('\n');
    }
}
