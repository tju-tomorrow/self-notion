//! 版本点（D-0043）：AI 写入前 / 文档关闭 / 每 10 分钟。
//!
//! **只用快照，不用编辑器的撤销栈** —— 后者的栈在内存里，关掉文档就没了。
//! 一份快照两处复用：撤销条 + 版本历史面板。快照 = 那一刻的 doc JSON（D-0131）。
//!
//! **历史只增不改** —— 「恢复到这里」是再记一个新版本，不是删掉后来的版本。
//! 所以任何一步都能再退回去。

use super::{db_err, not_found, now_ms};
use crate::commands::ApiResult;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// 每篇保留最近 200 个（D-0043）。够翻很久的账，又不至于无限增长。
const KEEP: i64 = 200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionMeta {
    pub id: i64,
    pub at: i64,
    pub origin: String,
    pub group_id: Option<String>,
    pub label: Option<String>,
}

/// 打一个版本点。
///
/// `content` = 该时刻的**完整** doc JSON。不给就用库里那一份（`doc`）。
pub fn checkpoint(
    conn: &Connection,
    doc_id: &str,
    content: Option<&str>,
    origin: &str,
    group_id: Option<&str>,
    label: Option<&str>,
) -> ApiResult<i64> {
    let content: String = match content {
        Some(c) => c.to_string(),
        None => conn
            .query_row("SELECT content FROM doc WHERE doc_id = ?1", [doc_id], |r| r.get(0))
            .optional()
            .map_err(db_err)?
            .unwrap_or_default(),
    };

    // ★ 没内容就不记（返回 0）。库里没有 = 这篇从没落过库，或者真的是空的 ——
    //   两种情况记下来都只会给用户一个「一键清空」的恢复点。宁可少一条版本，
    //   也不要一条点下去就会把文档抹掉的。
    if content.is_empty() {
        return Ok(0);
    }

    conn.execute(
        "INSERT INTO doc_version(doc_id, content, at, origin, group_id, label)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
        params![doc_id, content, now_ms(), origin, group_id, label],
    )
    .map_err(db_err)?;
    let id = conn.last_insert_rowid();

    conn.execute(
        "DELETE FROM doc_version
         WHERE doc_id = ?1 AND id NOT IN
           (SELECT id FROM doc_version WHERE doc_id = ?1 ORDER BY at DESC, id DESC LIMIT ?2)",
        params![doc_id, KEEP],
    )
    .map_err(db_err)?;

    Ok(id)
}

/// 只有元数据，**不回正文**（一份 doc JSON 动辄几十 KB × 200 个不该一次塞进 webview）。
///
/// ponytail: 版本预览靠「还原往返」——`restore` 是无损的（先记现在，再装回目标），
/// 看一眼再还原回来即可。哪天真要原地预览（比如并排 diff），再加 `version:get`。
pub fn list(conn: &Connection, doc_id: &str, limit: i64) -> ApiResult<Vec<VersionMeta>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, at, origin, group_id, label FROM doc_version
             WHERE doc_id = ?1 ORDER BY at DESC, id DESC LIMIT ?2",
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map(params![doc_id, limit], |r| {
            Ok(VersionMeta {
                id: r.get(0)?,
                at: r.get(1)?,
                origin: r.get(2)?,
                group_id: r.get(3)?,
                label: r.get(4)?,
            })
        })
        .map_err(db_err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_err);
    rows
}

/// 恢复到这里。
///
/// 两步，顺序有讲究：先把「现在」记一个新版本（所以**恢复本身也能再撤回去**），
/// 再把目标那份 doc JSON 覆盖回 `doc`。多窗口靠 `doc:apply` 那条广播收敛（architecture 第七节）。
pub fn restore(conn: &Connection, doc_id: &str, version_id: i64) -> ApiResult<()> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;

    let target: String = tx
        .query_row(
            "SELECT content FROM doc_version WHERE id = ?1 AND doc_id = ?2",
            params![version_id, doc_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(db_err)?
        .ok_or_else(|| not_found("version"))?;

    checkpoint(&tx, doc_id, None, "user", None, Some("restore"))?;

    tx.execute(
        "INSERT INTO doc(doc_id, content) VALUES(?1, ?2)
         ON CONFLICT(doc_id) DO UPDATE SET content = excluded.content",
        params![doc_id, target],
    )
    .map_err(db_err)?;

    tx.commit().map_err(db_err)
}
