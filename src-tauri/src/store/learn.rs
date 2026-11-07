//! 每篇的学习指标（D-0193）。行为计数只由编辑器累加；熟悉度单独打。
//! 行为分现算不落库 —— 公式改了不用洗旧行。

use super::{db_err, not_found, now_ms};
use crate::commands::{ApiError, ApiResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnRow {
    pub doc_id: String,
    pub opens: i64,
    pub read_ms: i64,
    pub depth: i64,
    pub familiarity: Option<i64>,
    pub score: i64,
}

/// 行为分 0–100。深度占一半；阅读 20 分钟、打开 5 次各自到顶。熟悉度不进来。
pub fn behavior_score(opens: i64, read_ms: i64, depth: i64) -> i64 {
    let depth_pts = depth.clamp(0, 100) as f64;
    let time_pts = (read_ms as f64 / 60_000.0 * 5.0).min(100.0);
    let open_pts = (opens as f64 * 20.0).min(100.0);
    (0.5 * depth_pts + 0.3 * time_pts + 0.2 * open_pts).round() as i64
}

pub fn list(conn: &Connection) -> ApiResult<Vec<LearnRow>> {
    let mut st = conn
        .prepare(
            "SELECT l.doc_id, l.opens, l.read_ms, l.depth, l.familiarity
             FROM doc_learn l
             JOIN documents d ON d.id = l.doc_id
             WHERE d.deleted_at IS NULL",
        )
        .map_err(db_err)?;
    let rows = st
        .query_map([], |r| Ok(row_of(r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

pub fn get(conn: &Connection, id: &str) -> ApiResult<LearnRow> {
    ensure_live(conn, id)?;
    let found = conn
        .query_row(
            "SELECT opens, read_ms, depth, familiarity FROM doc_learn WHERE doc_id = ?1",
            [id],
            |r| Ok(row_of(id.to_string(), r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(db_err)?;
    Ok(found.unwrap_or_else(|| row_of(id.to_string(), 0, 0, 0, None)))
}

/// 编辑器挂上这篇。打开 +1，并刷新「最近」（ProseMirror 以前不调 `doc:touch`）。
pub fn opened(conn: &Connection, id: &str) -> ApiResult<LearnRow> {
    ensure_live(conn, id)?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO doc_learn(doc_id, opens, read_ms, depth, at)
         VALUES(?1, 1, 0, 0, ?2)
         ON CONFLICT(doc_id) DO UPDATE SET opens = opens + 1, at = excluded.at",
        params![id, now],
    )
    .map_err(db_err)?;
    super::docs::touch(conn, id)?;
    get(conn, id)
}

/// `add_ms` 是这一拍可见的毫秒，单次封顶 1 分钟，避免休眠把时长一次加上去。
/// 深度只升不降。
pub fn progress(conn: &Connection, id: &str, add_ms: i64, depth: i64) -> ApiResult<LearnRow> {
    ensure_live(conn, id)?;
    let add = add_ms.clamp(0, 60_000);
    let depth = depth.clamp(0, 100);
    conn.execute(
        "INSERT INTO doc_learn(doc_id, opens, read_ms, depth, at)
         VALUES(?1, 0, ?2, ?3, ?4)
         ON CONFLICT(doc_id) DO UPDATE SET
           read_ms = read_ms + excluded.read_ms,
           depth = MAX(doc_learn.depth, excluded.depth),
           at = excluded.at",
        params![id, add, depth, now_ms()],
    )
    .map_err(db_err)?;
    get(conn, id)
}

/// `None` = 清掉档位。1–4 之外的数调用方自己挡住。
pub fn set_familiarity(conn: &Connection, id: &str, level: Option<i64>) -> ApiResult<LearnRow> {
    ensure_live(conn, id)?;
    conn.execute(
        "INSERT INTO doc_learn(doc_id, opens, read_ms, depth, familiarity, at)
         VALUES(?1, 0, 0, 0, ?2, ?3)
         ON CONFLICT(doc_id) DO UPDATE SET familiarity = excluded.familiarity, at = excluded.at",
        params![id, level, now_ms()],
    )
    .map_err(db_err)?;
    get(conn, id)
}

fn ensure_live(conn: &Connection, id: &str) -> ApiResult<()> {
    let ok: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM documents WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(db_err)?;
    if ok.is_none() {
        return Err(not_found("doc"));
    }
    Ok(())
}

fn row_of(doc_id: String, opens: i64, read_ms: i64, depth: i64, familiarity: Option<i64>) -> LearnRow {
    let score = behavior_score(opens, read_ms, depth);
    LearnRow { doc_id, opens, read_ms, depth, familiarity, score }
}

pub fn familiarity_label(level: Option<i64>) -> &'static str {
    match level {
        Some(1) => "不熟",
        Some(2) => "略懂",
        Some(3) => "熟悉",
        Some(4) => "很熟",
        _ => "未标",
    }
}

pub fn format_read(ms: i64) -> String {
    let mins = ms / 60_000;
    if mins < 1 {
        return format!("{}秒", ms / 1000);
    }
    if mins < 60 {
        return format!("{mins}分");
    }
    format!("{}时{}分", mins / 60, mins % 60)
}

/// 给 MCP 的一行。标题由调用方查。
pub fn format_row(title: &str, row: &LearnRow) -> String {
    format!(
        "{title}\n  id: {}\n  打开 {} · 阅读 {} · 读到 {}% · 效果 {} · 熟悉度 {}\n",
        row.doc_id,
        row.opens,
        format_read(row.read_ms),
        row.depth,
        row.score,
        familiarity_label(row.familiarity),
    )
}

pub fn bad_level(level: i64) -> ApiError {
    ApiError::new("bad_args", format!("熟悉度只能是 1–4，或 0 表示清除（收到 {level}）"))
}
