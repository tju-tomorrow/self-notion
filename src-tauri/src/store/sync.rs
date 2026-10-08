//! 同步块（P3-4 / D-0136）：节点只存一个 id，**内容在源里只有一份** ——
//! 「没有 CRDT 也能做到一致」的原因就是要保证一致的是一份、不是两份副本。
//!
//! ★ 源**不属于任何一篇文档**：改写源 = 所有引用它的节点同时看到新内容，不用广播。
//!   所以它不参与 `docs::remove` 那套 subtree 清理 —— 清库时单独 DROP（见 `store::reset`）。

use super::{db_err, new_id, not_found, now_ms};
use crate::commands::ApiResult;
use rusqlite::{params, Connection, OptionalExtension};

/// 建一个空源，回它的 id（节点拿这个 id 存进 JSON）。
pub fn new(conn: &Connection) -> ApiResult<String> {
    let id = new_id();
    conn.execute("INSERT INTO sync(id, content, at) VALUES(?1, '', ?2)", params![id, now_ms()])
        .map_err(db_err)?;
    Ok(id)
}

/// 读源里那一段块 JSON。`id` 不存在回 `not_found`（跟 `doc` 那条一个约定）。
pub fn get(conn: &Connection, id: &str) -> ApiResult<String> {
    conn.query_row("SELECT content FROM sync WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(db_err)?
        .ok_or_else(|| not_found("sync"))
}

/// 覆盖源内容 —— **覆盖式**（同 `doc:apply`）：一次一份，源里永远只有最新那一份。
pub fn put(conn: &Connection, id: &str, content: &str) -> ApiResult<()> {
    let n = conn
        .execute("UPDATE sync SET content = ?2, at = ?3 WHERE id = ?1", params![id, content, now_ms()])
        .map_err(db_err)?;
    if n == 0 {
        return Err(not_found("sync"));
    }
    Ok(())
}
