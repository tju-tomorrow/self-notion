//! 外部 agent 的写请求队列：MCP 落请求，桌面端用编辑器解析器执行，再写回结果。

use super::{db_err, now_ms};
use crate::commands::{ApiError, ApiResult};
use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub id: String,
    pub action: String,
    pub args: String,
}

pub fn pending(conn: &Connection, limit: i64) -> ApiResult<Vec<Pending>> {
    let mut st = conn
        .prepare(
            "SELECT id, action, args FROM agent_request
             WHERE state = 'pending' ORDER BY at LIMIT ?1",
        )
        .map_err(db_err)?;
    let rows = st
        .query_map([limit], |r| {
            Ok(Pending { id: r.get(0)?, action: r.get(1)?, args: r.get(2)? })
        })
        .map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

pub fn finish(conn: &Connection, id: &str, ok: bool, result: &str, error: &str) -> ApiResult<()> {
    let n = conn
        .execute(
            "UPDATE agent_request SET state = ?2, result = ?3, error = ?4, done_at = ?5
             WHERE id = ?1 AND state = 'pending'",
            params![id, if ok { "done" } else { "failed" }, result, error, now_ms()],
        )
        .map_err(db_err)?;
    if n == 0 {
        return Err(ApiError::new("not_found", format!("请求不存在或已处理：{id}")));
    }
    Ok(())
}
