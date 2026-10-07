//! 评论（D-0067）：一张平表，回复 = `parent_id` 非空的行。锚点在正文里，肉在这儿。

use super::{db_err, new_id, not_found, now_ms};
use crate::commands::{ApiError, ApiResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// 字段顺序对齐 contract.ts 的 `Comment`。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub doc_id: String,
    pub parent_id: Option<String>,
    pub anchor: String,
    pub block_id: Option<String>,
    pub quote: String,
    pub body: String,
    pub resolved: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

const COLS: &str = "id, doc_id, parent_id, anchor, block_id, quote, body, resolved, created_at, \
                    updated_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Comment> {
    Ok(Comment {
        id: r.get(0)?,
        doc_id: r.get(1)?,
        parent_id: r.get(2)?,
        anchor: r.get(3)?,
        block_id: r.get(4)?,
        quote: r.get(5)?,
        body: r.get(6)?,
        resolved: r.get::<_, i64>(7)? != 0,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

fn get(conn: &Connection, id: &str) -> ApiResult<Comment> {
    conn.query_row(&format!("SELECT {COLS} FROM comment WHERE id = ?1"), [id], row)
        .optional()
        .map_err(db_err)?
        .ok_or_else(|| not_found("comment"))
}

/// 平表按 `created_at` 升序；层级由前端按 `parent_id` 自己组装。
pub fn list(conn: &Connection, doc_id: &str) -> ApiResult<Vec<Comment>> {
    let mut stmt = conn
        .prepare(&format!("SELECT {COLS} FROM comment WHERE doc_id = ?1 ORDER BY created_at"))
        .map_err(db_err)?;
    let rows = stmt
        .query_map([doc_id], row)
        .map_err(db_err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_err);
    rows
}

/// 三个值之外一律拒收 —— 写歪的锚点在正文里对不上，宁可不建。
fn check_anchor(anchor: &str) -> ApiResult<()> {
    matches!(anchor, "page" | "block" | "inline")
        .then_some(())
        .ok_or_else(|| ApiError::new("bad_args", format!("unknown anchor: {anchor}")))
}

pub fn create(
    conn: &Connection,
    doc_id: &str,
    parent_id: Option<&str>,
    anchor: &str,
    block_id: Option<&str>,
    quote: &str,
    body: &str,
) -> ApiResult<Comment> {
    check_anchor(anchor)?;
    // 回复必须挂在同一篇的评论下 —— 否则删父评论时连带删不到它
    if let Some(pid) = parent_id {
        if get(conn, pid)?.doc_id != doc_id {
            return Err(not_found("comment"));
        }
    }
    let id = new_id();
    let at = now_ms();
    conn.execute(
        "INSERT INTO comment(id, doc_id, parent_id, anchor, block_id, quote, body, resolved,
                             created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)",
        params![id, doc_id, parent_id, anchor, block_id, quote, body, at],
    )
    .map_err(db_err)?;
    get(conn, &id)
}

pub fn update_body(conn: &Connection, id: &str, body: &str) -> ApiResult<Comment> {
    conn.execute(
        "UPDATE comment SET body = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, body, now_ms()],
    )
    .map_err(db_err)?;
    get(conn, id)
}

pub fn set_resolved(conn: &Connection, id: &str, resolved: bool) -> ApiResult<Comment> {
    if get(conn, id)?.parent_id.is_some() {
        return Err(ApiError::new("bad_args", "reply cannot be resolved"));
    }
    conn.execute(
        "UPDATE comment SET resolved = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, resolved as i64, now_ms()],
    )
    .map_err(db_err)?;
    get(conn, id)
}

/// 连带删回复 —— 显式两条 DELETE，不靠外键级联。
pub fn remove(conn: &Connection, id: &str) -> ApiResult<()> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    tx.execute("DELETE FROM comment WHERE parent_id = ?1", [id]).map_err(db_err)?;
    tx.execute("DELETE FROM comment WHERE id = ?1", [id]).map_err(db_err)?;
    tx.commit().map_err(db_err)
}
