//! `notes_learn`（D-0193）。读离线直查；写熟悉度只落请求，桌面端执行。
//! 打开次数 / 时长 / 深度不给 Agent 改。

use crate::commands::{ApiError, ApiResult};
use crate::mcp::nav;
use crate::mcp::write;
use crate::store::{docs, learn, Db};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct Args {
    pub target: Option<String>,
    pub unfamiliar: Option<bool>,
    /// 1–4 打档，0 清除。不传 = 只读。
    pub familiarity: Option<i64>,
}

pub fn call(db: &Db, args: &Args) -> ApiResult<String> {
    if let Some(level) = args.familiarity {
        return set_fam(db, args, level);
    }
    if args.unfamiliar == Some(true) {
        return list_unfamiliar(db);
    }
    match args.target.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(q) => one(db, q),
        None => list_touched(db),
    }
}

fn set_fam(db: &Db, args: &Args, level: i64) -> ApiResult<String> {
    if !(0..=4).contains(&level) {
        return Err(learn::bad_level(level));
    }
    let q = args
        .target
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::new("bad_args", "改熟悉度需要 target"))?;
    let id = nav::resolve_id(db, q)?;
    let familiarity = if level == 0 { Value::Null } else { json!(level) };
    write::enqueue("familiarity", json!({ "id": id, "level": familiarity }))?;
    one(db, &id)
}

fn one(db: &Db, q: &str) -> ApiResult<String> {
    let id = if q.len() == 32 && q.chars().all(|c| c.is_ascii_hexdigit()) {
        q.to_string()
    } else {
        nav::resolve_id(db, q)?
    };
    let meta = db.with(|c| docs::get(c, &id))?;
    let row = db.with(|c| learn::get(c, &id))?;
    Ok(learn::format_row(&meta.title, &row))
}

fn list_unfamiliar(db: &Db) -> ApiResult<String> {
    let rows = db.with(learn::list)?;
    let rows: Vec<_> = rows.into_iter().filter(|r| r.familiarity == Some(1)).collect();
    if rows.is_empty() {
        return Ok("没有标成「不熟」的笔记。熟悉度在正文标题下面打，或 notes_learn(target, familiarity=1)。\n".into());
    }
    Ok(render("不熟", &rows, db))
}

fn list_touched(db: &Db) -> ApiResult<String> {
    let rows = db.with(learn::list)?;
    let rows: Vec<_> = rows
        .into_iter()
        .filter(|r| r.opens > 0 || r.familiarity.is_some())
        .collect();
    if rows.is_empty() {
        return Ok("还没有学习数据。打开一篇笔记就会开始记。\n".into());
    }
    Ok(render("有记录", &rows, db))
}

fn render(label: &str, rows: &[learn::LearnRow], db: &Db) -> String {
    let shown = rows.len().min(40);
    let mut out = format!("{label} · {shown} 篇\n\n");
    for row in rows.iter().take(shown) {
        let title = db
            .with(|c| docs::get(c, &row.doc_id))
            .map(|m| m.title)
            .unwrap_or_else(|_| row.doc_id.clone());
        out.push_str(&learn::format_row(&title, row));
        out.push('\n');
    }
    if rows.len() > shown {
        out.push_str(&format!("还有 {} 篇没列。用 target 指定一篇。\n", rows.len() - shown));
    }
    out
}
