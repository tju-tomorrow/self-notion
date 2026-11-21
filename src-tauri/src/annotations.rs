//! 笔记里的标注（D-0202）：文字颜色 / 高亮、块颜色、评论和每条评论锚住的原文。
//!
//! `vfs:read` 读的是 `doc_text.md` 那份 Markdown 投影 —— 颜色和评论 mark 在投影时就丢了。
//! 所以这里直接解析 `doc` 表里的 PM doc JSON，再和 `comment` 表按 id 对上。
//!
//! 只读：不改一个字，也不建索引。

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::commands::ApiResult;
use crate::store::{comment, db_err, not_found};

/// 一次回给模型的量。正常笔记远到不了；到了也保住上下文。
const COLOR_LIMIT: usize = 300;
const BLOCK_LIMIT: usize = 100;
const COMMENT_LIMIT: usize = 200;

#[derive(Deserialize)]
pub struct Args {
    pub id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub block_id: String,
    pub text: String,
    /// `textColor` = 字色 · `highlight` = 底纹
    pub kind: &'static str,
    pub color: String,
    /// 色板里的中文名；认不出的色给「自定义」
    pub name: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockColor {
    pub block_id: String,
    pub text: String,
    pub color: String,
    pub bg: String,
    pub color_name: &'static str,
    pub bg_name: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentRef {
    pub id: String,
    /// `page` | `block` | `inline`
    pub anchor: String,
    pub block_id: Option<String>,
    /// 建评论时截的那 200 字
    pub quote: String,
    /// **正文里真正锚住的原文**（inline 取 mark，block 取整块）—— 拿不到才退回 quote
    pub text: String,
    pub body: String,
    pub resolved: bool,
    pub parent_id: Option<String>,
    pub created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocAnnotations {
    pub doc_id: String,
    pub title: String,
    pub colors_total: usize,
    pub block_colors_total: usize,
    pub comments_total: usize,
    pub colors: Vec<Span>,
    pub block_colors: Vec<BlockColor>,
    pub comments: Vec<CommentRef>,
}

pub fn list(conn: &Connection, doc_id: &str) -> ApiResult<DocAnnotations> {
    let title: String = conn
        .query_row("SELECT title FROM documents WHERE id = ?1", [doc_id], |r| r.get(0))
        .optional()
        .map_err(db_err)?
        .ok_or_else(|| not_found("document"))?;

    let content: Option<String> = conn
        .query_row("SELECT content FROM doc WHERE doc_id = ?1", [doc_id], |r| r.get(0))
        .optional()
        .map_err(db_err)?;

    let mut walk = Walk::default();
    if let Some(raw) = content {
        // 坏 JSON 当没有标注 —— 正文本体另有 `doc:open` 管，这里不该把它变成一次失败。
        if let Ok(doc) = serde_json::from_str::<Value>(&raw) {
            walk.visit(&doc, "");
        }
    }

    let rows = comment::list(conn, doc_id)?;
    let comments_total = rows.len();
    let comments = rows
        .into_iter()
        .take(COMMENT_LIMIT)
        .map(|c| {
            let text = clip(anchored_text(&walk, &c).unwrap_or_else(|| c.quote.clone()), 600);
            CommentRef {
                id: c.id,
                anchor: c.anchor,
                block_id: c.block_id,
                quote: c.quote,
                text,
                body: c.body,
                resolved: c.resolved,
                parent_id: c.parent_id,
                created_at: c.created_at,
            }
        })
        .collect();

    let colors_total = walk.colors.len();
    let block_colors_total = walk.block_colors.len();
    let block_colors = walk
        .block_colors
        .iter()
        .take(BLOCK_LIMIT)
        .map(|(id, color, bg)| BlockColor {
            block_id: id.clone(),
            text: walk.block_text.get(id).cloned().unwrap_or_default(),
            color: color.clone(),
            bg: bg.clone(),
            color_name: if color.is_empty() { "" } else { color_name("textColor", color) },
            bg_name: if bg.is_empty() { "" } else { color_name("highlight", bg) },
        })
        .collect();

    Ok(DocAnnotations {
        doc_id: doc_id.to_string(),
        title,
        colors_total,
        block_colors_total,
        comments_total,
        colors: walk.colors.into_iter().take(COLOR_LIMIT).collect(),
        block_colors,
        comments,
    })
}

fn clip(text: String, max: usize) -> String {
    if text.chars().count() <= max {
        return text;
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

/// 评论在正文里锚住的那段。block 评论没有 mark，整块正文就是它。
fn anchored_text(walk: &Walk, c: &comment::Comment) -> Option<String> {
    let block_id = c.block_id.as_deref()?;
    let text = match c.anchor.as_str() {
        "inline" => walk.comment_text.get(&(block_id.to_string(), c.id.clone()))?,
        "block" => walk.block_text.get(block_id)?,
        _ => return None,
    };
    (!text.is_empty()).then(|| text.clone())
}

#[derive(Default)]
struct Walk {
    pos: usize,
    colors: Vec<Span>,
    /// 同一 (块, 类型, 颜色) 上一次落在哪个 span、结束位置 —— 结束位置等于当前 pos 说明中间没断。
    /// 用索引而不是 `colors.last()`：同一条文字可能同时有字色和底纹，两种 span 会交替出现。
    last_end: HashMap<(String, String, String), (usize, usize)>,
    block_colors: Vec<(String, String, String)>,
    block_text: HashMap<String, String>,
    comment_text: HashMap<(String, String), String>,
}

impl Walk {
    fn visit(&mut self, node: &Value, block: &str) {
        let kind = node.get("type").and_then(Value::as_str).unwrap_or("");
        if kind == "blockContainer" {
            let attrs = node.get("attrs");
            let id = attrs
                .and_then(|a| a.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let color = attr(attrs, "color");
            let bg = attr(attrs, "bg");
            if !color.is_empty() || !bg.is_empty() {
                self.block_colors.push((id.to_string(), color, bg));
            }
            if let Some(children) = node.get("content").and_then(Value::as_array) {
                for child in children {
                    self.visit(child, id);
                }
            }
            return;
        }

        if kind == "text" {
            let text = node.get("text").and_then(Value::as_str).unwrap_or("");
            if !text.is_empty() {
                self.block_text.entry(block.to_string()).or_default().push_str(text);
                self.marks(node, block, text);
                self.pos += text.chars().count();
            }
            return;
        }

        if let Some(children) = node.get("content").and_then(Value::as_array) {
            for child in children {
                self.visit(child, block);
            }
        }
    }

    fn marks(&mut self, node: &Value, block: &str, text: &str) {
        let Some(marks) = node.get("marks").and_then(Value::as_array) else { return };
        for mark in marks {
            let kind = mark.get("type").and_then(Value::as_str).unwrap_or("");
            let attrs = mark.get("attrs");
            match kind {
                "comment" => {
                    for id in attr(attrs, "ids").split(',').filter(|id| !id.is_empty()) {
                        self.comment_text
                            .entry((block.to_string(), id.to_string()))
                            .or_default()
                            .push_str(text);
                    }
                }
                "textColor" => self.color_mark(block, text, "textColor", attrs),
                "highlight" => self.color_mark(block, text, "highlight", attrs),
                _ => {}
            }
        }
    }

    fn color_mark(&mut self, block: &str, text: &str, kind: &'static str, attrs: Option<&Value>) {
        let color = attr(attrs, "color");
        if !color.is_empty() {
            self.push_color(block, text, kind, &color);
        }
    }

    fn push_color(&mut self, block: &str, text: &str, kind: &'static str, color: &str) {
        let key = (block.to_string(), kind.to_string(), color.to_string());
        let end = self.pos + text.chars().count();
        if let Some((idx, at)) = self.last_end.get(&key).copied() {
            if at == self.pos {
                if let Some(span) = self.colors.get_mut(idx) {
                    span.text.push_str(text);
                    self.last_end.insert(key, (idx, end));
                    return;
                }
            }
        }
        self.colors.push(Span {
            block_id: block.to_string(),
            text: text.to_string(),
            kind,
            color: color.to_string(),
            name: color_name(kind, color),
        });
        let idx = self.colors.len() - 1;
        self.last_end.insert(key, (idx, end));
    }
}

fn attr(attrs: Option<&Value>, key: &str) -> String {
    attrs
        .and_then(|a| a.get(key))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// 按色相给个中文名 —— 色板不是唯一真相：导入 / 粘贴进来的笔记存的是 `rgb(...)`，
/// 甚至深浅色主题各一套，所以不能只比十六进制常量。
fn color_name(_kind: &str, color: &str) -> &'static str {
    let Some((r, g, b)) = rgb(color) else { return "自定义" };
    let (r, g, b) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let light = (max + min) / 2.0;
    let delta = max - min;
    let sat = if delta == 0.0 { 0.0 } else { delta / (1.0 - (2.0 * light - 1.0).abs()) };
    if sat < 0.10 {
        return if light > 0.92 {
            "白"
        } else if light < 0.12 {
            "黑"
        } else {
            "灰"
        };
    }
    let hue = if max == r {
        ((g - b) / delta).rem_euclid(6.0) * 60.0
    } else if max == g {
        ((b - r) / delta + 2.0) * 60.0
    } else {
        ((r - g) / delta + 4.0) * 60.0
    };
    match hue {
        h if !(15.0..345.0).contains(&h) => "红",
        h if h < 35.0 => "橙",
        h if h < 70.0 => "黄",
        h if h < 190.0 => "绿",
        h if h < 255.0 => "蓝",
        h if h < 320.0 => "紫",
        _ => "粉",
    }
}

/// `#rrggbb` / `#rgb` / `rgb(r, g, b)` / `rgba(r g b / a)`。
fn rgb(color: &str) -> Option<(u8, u8, u8)> {
    let s = color.trim().to_ascii_lowercase();
    if let Some(hex) = s.strip_prefix('#') {
        // 切片按字节走 —— 坏数据里混进多字节字符会让 `&hex[0..1]` 直接 panic。
        if !hex.is_ascii() {
            return None;
        }
        return match hex.len() {
            3 => Some((
                u8::from_str_radix(&hex[0..1].repeat(2), 16).ok()?,
                u8::from_str_radix(&hex[1..2].repeat(2), 16).ok()?,
                u8::from_str_radix(&hex[2..3].repeat(2), 16).ok()?,
            )),
            6 => Some((
                u8::from_str_radix(&hex[0..2], 16).ok()?,
                u8::from_str_radix(&hex[2..4], 16).ok()?,
                u8::from_str_radix(&hex[4..6], 16).ok()?,
            )),
            _ => None,
        };
    }
    let inner = s
        .strip_prefix("rgba(")
        .or_else(|| s.strip_prefix("rgb("))?
        .strip_suffix(')')?;
    // alpha 用 `/` 分隔（CSS4）或第 4 个逗号值 —— 都只取前三个。
    let head = inner.split('/').next().unwrap_or(inner);
    let parts: Vec<&str> = head
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() < 3 {
        return None;
    }
    Some((
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
    ))
}
