//! 笔记里的 blob 引用 → MCP 内容块。图片走 image，文本附件走 text，其余只报元数据。

use crate::commands::{ApiError, ApiResult};
use crate::store::{blob, Db};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};

const PREFIX: &str = "self-notion://blob/";
const MAX_IMAGE_BYTES: usize = 2_500_000;
const MAX_TOTAL_BYTES: usize = 8_000_000;
const MAX_IMAGES: usize = 8;
const MAX_BLOB_IMAGE_BYTES: usize = 3_500_000;
const MAX_TEXT_CHARS: usize = 200_000;
const IMAGE_MIMES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

#[derive(Deserialize)]
pub struct FetchArgs {
    pub id: String,
}

/// 把正文里的 `![](self-notion://blob/<id>)` 换成标记，图片按出现顺序附在文字后面。
pub fn expand(db: &Db, text: String) -> (String, Vec<Value>) {
    let mut out = String::with_capacity(text.len());
    let mut blocks = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut total = 0usize;
    let mut rest = text.as_str();

    while let Some(i) = rest.find(PREFIX) {
        out.push_str(&rest[..i]);
        let after = &rest[i + PREFIX.len()..];
        let n = after.find(|c: char| !c.is_ascii_hexdigit()).unwrap_or(after.len());
        if n == 0 {
            out.push_str(PREFIX);
            rest = after;
            continue;
        }
        let id = &after[..n];
        rest = &after[n..];

        // 连 markdown 外壳一起换掉，别让模型再去猜协议串。
        if out.ends_with("](") {
            if let Some(at) = out.rfind('[') {
                out.truncate(if out[..at].ends_with('!') { at - 1 } else { at });
            }
            if let Some(t) = rest.strip_prefix(')') {
                rest = t;
            }
        }

        let found = match db.with(|c| blob::get(c, id)) {
            Ok(v) => v,
            Err(e) => {
                crate::log::record("mcp", &format!("读附件 {id} 失败：{e}"));
                None
            }
        };
        let Some((mime, bytes)) = found else {
            out.push_str(&format!("[附件缺失 {id}]"));
            continue;
        };

        if IMAGE_MIMES.contains(&mime.as_str()) {
            if let Some(k) = seen.iter().position(|s| s == id) {
                out.push_str(&format!("[图片 {}]", k + 1));
            } else if bytes.len() > MAX_IMAGE_BYTES {
                out.push_str(&format!(
                    "[图片过大 {} {}；用 notes_blob(\"{id}\") 单取]",
                    mime,
                    size(bytes.len())
                ));
            } else if seen.len() >= MAX_IMAGES || total + bytes.len() > MAX_TOTAL_BYTES {
                out.push_str(&format!("[图片超出单次上限；用 notes_blob(\"{id}\") 单取]"));
            } else {
                total += bytes.len();
                seen.push(id.to_string());
                out.push_str(&format!("[图片 {}]", seen.len()));
                blocks.push(image_block(&mime, &bytes));
            }
        } else {
            out.push_str(&format!("[附件 {} {}；id={id}]", mime, size(bytes.len())));
        }
    }
    out.push_str(rest);
    (out, blocks)
}

/// `notes_blob`：图片回 image，文本回正文，其他只回元数据。
pub fn fetch(db: &Db, raw: &str) -> ApiResult<(String, Vec<Value>)> {
    let id = raw.trim().strip_prefix(PREFIX).unwrap_or(raw.trim());
    let (mime, bytes) = db
        .with(|c| blob::get(c, id))?
        .ok_or_else(|| ApiError::new("not_found", format!("没有这个附件：{id}")))?;
    let meta = format!("id: {id}\nmime: {mime}\nsize: {}\n", size(bytes.len()));

    if IMAGE_MIMES.contains(&mime.as_str()) {
        if bytes.len() <= MAX_BLOB_IMAGE_BYTES {
            return Ok((meta, vec![image_block(&mime, &bytes)]));
        }
        return Ok((
            format!("{meta}（图片过大，未内联；在桌面端查看）"),
            Vec::new(),
        ));
    }
    if mime.starts_with("text/") || mime == "application/json" {
        let all = String::from_utf8_lossy(&bytes);
        let truncated = all.chars().count() > MAX_TEXT_CHARS;
        let text: String = all.chars().take(MAX_TEXT_CHARS).collect();
        let tail = if truncated { "\n[truncated]" } else { "" };
        return Ok((format!("{meta}\n{text}{tail}"), Vec::new()));
    }
    Ok((format!("{meta}（二进制附件，模型读不了；在桌面端点开下载）"), Vec::new()))
}

fn image_block(mime: &str, bytes: &[u8]) -> Value {
    json!({"type": "image", "data": B64.encode(bytes), "mimeType": mime})
}

fn size(n: usize) -> String {
    if n >= 1_048_576 {
        format!("{:.1}MB", n as f64 / 1_048_576.0)
    } else if n >= 1024 {
        format!("{:.0}KB", n as f64 / 1024.0)
    } else {
        format!("{n}B")
    }
}
