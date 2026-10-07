//! 链接图谱（D-0085）。表形状见 `schema.sql`；**抽取点在投影产出点**（`editor.ts` 的
//! `{title, md}` 同一处），随 `doc:apply` 送上来，这里只负责落库和查。
//!
//! ★ **替换式重建**：一篇的出链先删后插，和 md 投影**同一个事务**（`docs::apply` 里调）。
//! 增量维护一张图 = 到处漏：块删了、@被撤了、改指向了，三处都得记得改。
//! 全量替换一篇 = 一条 DELETE + 几条 INSERT OR REPLACE。
//!
//! ★ **不算网页链接 / 书签链接** —— 那些是正文字符，不是文档之间的边。
//! 判断"是不是文档之间的边"的标准就一条：**另一端在 `documents` 里**。

use super::{db_err, now_ms};
use crate::commands::ApiResult;
use rusqlite::{params, Connection};

/// 一条边。`kind` = `'mention'`（@提及）| `'subpage'`（子页面）。
pub struct Link {
    pub to_id: String,
    pub kind: String,
}

/// 查询返回的一行：边的**另一端** + 它的标题（列表要给人看，不是给人看 id）。
pub struct Edge {
    pub doc_id: String,
    pub title: String,
    pub kind: String,
}

/// 重建一篇的出链。`links` 空数组 = 这篇现在没有出链 —— **不是"别动"**。
///
/// 自链（@自己）直接丢：反链面板里出现自己那一行没有意义，而它会在 `/links/from/`
/// 和 `/links/to/` 两处各出现一次，等于把噪音变成两份。
pub fn replace(conn: &Connection, from_id: &str, links: &[Link]) -> ApiResult<()> {
    conn.execute("DELETE FROM doc_link WHERE from_id = ?1", [from_id])
        .map_err(db_err)?;
    if links.is_empty() {
        return Ok(());
    }
    // PK 是三列，所以同一篇里 @同一篇两次只留一条 —— 不用先 SELECT 再判断。
    let mut st = conn
        .prepare(
            "INSERT OR REPLACE INTO doc_link(from_id, to_id, kind, at) VALUES(?1, ?2, ?3, ?4)",
        )
        .map_err(db_err)?;
    for l in links {
        if l.to_id == from_id {
            continue;
        }
        st.execute(params![from_id, l.to_id, l.kind, now_ms()])
            .map_err(db_err)?;
    }
    Ok(())
}

/// 出链：**我指向谁**。给 `/links/from/<doc>.md` 用。
pub fn out_links(conn: &Connection, id: &str) -> ApiResult<Vec<Edge>> {
    edges(
        conn,
        "SELECT d.id, d.title, l.kind FROM doc_link l JOIN documents d ON d.id = l.to_id
         WHERE l.from_id = ?1 AND d.deleted_at IS NULL
         ORDER BY d.title, d.id",
        id,
    )
}

/// 反链：**谁指向我**。给 `/links/to/<doc>.md` 用 —— 这是这套目录里最值钱的一条路
/// （docs/vfs.md：找上下文最快的路）。
pub fn in_links(conn: &Connection, id: &str) -> ApiResult<Vec<Edge>> {
    edges(
        conn,
        "SELECT d.id, d.title, l.kind FROM doc_link l JOIN documents d ON d.id = l.from_id
         WHERE l.to_id = ?1 AND d.deleted_at IS NULL
         ORDER BY d.title, d.id",
        id,
    )
}

/// 两个方向的 SQL 只差一个列名，包一层免得抄两遍 row mapper。
fn edges(conn: &Connection, sql: &str, id: &str) -> ApiResult<Vec<Edge>> {
    let mut st = conn.prepare(sql).map_err(db_err)?;
    let rows = st
        .query_map([id], |r| {
            Ok(Edge { doc_id: r.get(0)?, title: r.get(1)?, kind: r.get(2)? })
        })
        .map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}
