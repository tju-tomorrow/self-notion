//! 图片 / 附件（D-0027）。
//!
//! **id = 内容 sha256** → 同一张图两次 `put` 天然得到同一个 id，去重不用额外代码。
//! 字节永不出库：渲染走 `self-notion://blob/<id>` 协议按需读，不进 JS 堆。

use super::{db_err, not_found, now_ms};
use crate::commands::ApiResult;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobMeta {
    pub id: String,
    pub mime: String,
    pub size: i64,
    /// 库里已经有这份内容 —— 前端想知道「这次是不是白传了」
    pub dedup: bool,
}

pub fn put(conn: &Connection, bytes: &[u8], mime: &str) -> ApiResult<BlobMeta> {
    let id = format!("{:x}", Sha256::digest(bytes));
    let dup = exists(conn, &id)?;
    if !dup {
        conn.execute(
            "INSERT INTO blob(id, mime, bytes, size, at) VALUES(?1, ?2, ?3, ?4, ?5)",
            params![id, mime, bytes, bytes.len() as i64, now_ms()],
        )
        .map_err(db_err)?;
    }
    Ok(BlobMeta { id, mime: mime.to_string(), size: bytes.len() as i64, dedup: dup })
}

/// 只回 URL，不回字节。
pub fn url(conn: &Connection, id: &str) -> ApiResult<String> {
    if !exists(conn, id)? {
        return Err(not_found("blob"));
    }
    Ok(format!("self-notion://blob/{id}"))
}

/// 字节 + mime。**唯一**取字节的出口 —— `self-notion://` 协议处理器走这里。
///
/// 它不在 `dispatch` 的命名空间里（没有 `blob:get` 命令）：字节永不过 IPC，
/// 渲染一律 `<img src="self-notion://blob/<id>">` 由 webview 自己拉（D-0027）。
/// 所以这是个**给 lib.rs 用的** pub 函数，不是给前端的命令。
///
/// 找不到回 `None` 而不是错误：调用方是 HTTP 协议处理器，它的"错"是 404，
/// 不是 `ApiError`。真出库错（锁中毒 / 库损坏）才回 `Err` → 那边回 500。
pub fn get(conn: &Connection, id: &str) -> ApiResult<Option<(String, Vec<u8>)>> {
    conn.query_row("SELECT mime, bytes FROM blob WHERE id = ?1", [id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
    })
    .optional()
    .map_err(db_err)
}

fn exists(conn: &Connection, id: &str) -> ApiResult<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM blob WHERE id = ?1", [id], |_| Ok(()))
        .optional()
        .map_err(db_err)?
        .is_some())
}
