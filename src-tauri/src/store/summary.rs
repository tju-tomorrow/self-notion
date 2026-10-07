//! 每篇笔记的一句话 / 一段话总结 + 实体（D-0075）。**存盘**：进程重开、换前端、插件卸了都还在。
//!
//! ★ 别和 `docs::summary` 搞混：那个是首页那行 160 字副标题，从投影正文截出来的；
//! 这个是模型读完整篇之后写下来的，还带这篇里出现的实体。
//!
//! 正文和标题这里**只读不写** —— 生成总结不改文档一个字（所以它不牵涉版本历史 / 撤销，
//! 那是 D-0043 给「写」准备的）。

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use super::{db_err, now_ms};
use crate::commands::{ApiError, ApiResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub doc_id: String,
    pub line: String,
    pub para: String,
    /// 这篇里出现的实体（人名 / 项目 / 概念 / 工具）。模型抽的，没有本体化、没有归一。
    pub entities: Vec<String>,
    /// 生成时正文的字符数。跟现在的长度对不上 = 这篇改过了（见 `ai::summary`）。
    pub chars: i64,
    pub at: i64,
}

/// 读一篇的总结。没生成过就是 `None` —— 不是错误。
pub fn get(conn: &Connection, doc_id: &str) -> ApiResult<Option<Summary>> {
    conn.query_row(
        "SELECT doc_id, line, para, entities, chars, at FROM doc_summary WHERE doc_id = ?1",
        [doc_id],
        |r| {
            let raw: String = r.get(3)?;
            Ok(Summary {
                doc_id: r.get(0)?,
                line: r.get(1)?,
                para: r.get(2)?,
                // 手改坏了库也不能让整篇打不开：解不出就是没有实体。
                entities: serde_json::from_str(&raw).unwrap_or_default(),
                chars: r.get(4)?,
                at: r.get(5)?,
            })
        },
    )
    .optional()
    .map_err(db_err)
}

/// 写一篇的总结（同一篇覆盖旧的：总结是「这篇现在的样子」，不是历史）。
pub fn put(
    conn: &Connection,
    doc_id: &str,
    line: &str,
    para: &str,
    entities: &[String],
    chars: i64,
) -> ApiResult<Summary> {
    let at = now_ms();
    let json = serde_json::to_string(entities).map_err(|e| ApiError::new("encode", e.to_string()))?;
    conn.execute(
        "INSERT INTO doc_summary(doc_id, line, para, entities, chars, at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(doc_id) DO UPDATE SET
           line = excluded.line, para = excluded.para, entities = excluded.entities,
           chars = excluded.chars, at = excluded.at",
        params![doc_id, line, para, json, chars, at],
    )
    .map_err(db_err)?;
    Ok(Summary {
        doc_id: doc_id.to_string(),
        line: line.to_string(),
        para: para.to_string(),
        entities: entities.to_vec(),
        chars,
        at,
    })
}

/// 生成总结要的两样：这篇的名字 + 投影正文。`(标题, 正文)`。
///
/// 标题从 `documents` 取（不是 `doc_text.title`）—— 名字的唯一真相源是前者（D-0073）。
/// 正文没落过库就是空串，调用方据此报「这篇还没有正文」。
pub fn material(conn: &Connection, doc_id: &str) -> ApiResult<(String, String)> {
    let title = conn
        .query_row("SELECT title FROM documents WHERE id = ?1", [doc_id], |r| r.get(0))
        .optional()
        .map_err(db_err)?
        .unwrap_or_default();
    let md = conn
        .query_row("SELECT md FROM doc_text WHERE doc_id = ?1", [doc_id], |r| r.get(0))
        .optional()
        .map_err(db_err)?
        .unwrap_or_default();
    Ok((title, md))
}
