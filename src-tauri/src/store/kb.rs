//! 知识库的库表读写（D-0181…D-0189）。表定义在 `schema.sql` 末尾。
//!
//! 这个文件是**契约**：类型和签名先冻结，SQL 由 U1 填（docs/execution-plan.md 本轮）。
//! 调用方：`kb::embed` / `kb::graph` / `kb::curator` / `kb::tools`。
//!
//! ★ 这里只管**表**。检索（FTS5 / grep）走 `store::docs` 和 `vfs`，一个字都不改。



use super::{db_err, now_ms};
use crate::commands::{ApiError, ApiResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/* ─────────────────────────── 类型 ─────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    pub aliases: Vec<String>,
    pub desc: String,
    pub origin: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topic {
    pub name: String,
    pub desc: String,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProposal {
    pub doc_id: String,
    pub kind: String,
    pub payload: Value,
    pub confidence: f64,
    pub reason: String,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: i64,
    pub doc_id: String,
    pub kind: String,
    pub payload: Value,
    pub confidence: f64,
    pub reason: String,
    pub origin: String,
    pub state: String,
    pub at: i64,
    pub done_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub desc: String,
    pub at: i64,
}

/// 图上的一个节点。`label` 是给人看的（文档标题 / 实体名），`extra` 放度数之类。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub kind: String,
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub extra: Value,
}

/// 一条边。`src`/`dst` 是 `(kind, id)` —— 跟表的主键形状一致，不另造 id 空间。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub src_kind: String,
    pub src_id: String,
    pub dst_kind: String,
    pub dst_id: String,
    pub kind: String,
    pub weight: f64,
    pub reason: String,
    pub origin: String,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subgraph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

/// 一次语义检索的命中。`score` = **原始余弦**（-1..1，越大越像，**可以为负**，不 clamp）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VecHit {
    pub owner_kind: String,
    pub owner_id: String,
    pub score: f64,
}

/* ─────────────────────────── 标签词表 ─────────────────────────── */

pub fn tag_list(conn: &Connection) -> ApiResult<Vec<Tag>> {
    let mut st = conn
        .prepare("SELECT name, aliases, \"desc\", origin, created_at FROM tag ORDER BY name")
        .map_err(db_err)?;
    let rows = st
        .query_map([], |r| {
            let aliases: String = r.get(1)?;
            Ok(Tag {
                name: r.get(0)?,
                aliases: serde_json::from_str(&aliases).unwrap_or_default(),
                desc: r.get(2)?,
                origin: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

/// 有则更新 aliases/desc，没有则插入。`origin` 只在插入时用（已有的不降级）。
pub fn tag_upsert(
    conn: &Connection,
    name: &str,
    aliases: &[String],
    desc: &str,
    origin: &str,
) -> ApiResult<()> {
    let json = serde_json::to_string(aliases).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
    conn.execute(
        "INSERT INTO tag(name, aliases, \"desc\", origin, created_at) VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(name) DO UPDATE SET aliases = excluded.aliases, \"desc\" = excluded.\"desc\"",
        params![name, json, desc, origin, now_ms()],
    )
    .map_err(db_err)?;
    Ok(())
}

/// 把 `documents.tags` 里出现过的标签**补进词表**（`origin='user'`，已有的不动）。返回新增几个。
///
/// ★ 没有这一步，词表里就**只有策展人新造的**那些 —— 用户自己手打的标签一个都不在。
///   于是 D-0185 的「候选标签命中已有词表 → 直接落库」永远不命中（用户的旧标签全被当成新的），
///   `kb_tags` 也永远是空的（AI 拿不到「这库里有哪些标签」）。
///
/// ★ **不开事务**：它会被 `docs::set_tags` 在别人的事务里调到，嵌套开事务会报错。
///   每条都是幂等 INSERT，不需要事务。
pub fn sync_vocab_from_docs(conn: &Connection) -> ApiResult<usize> {
    let mut names: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    {
        let mut st = conn.prepare("SELECT tags FROM documents").map_err(db_err)?;
        let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(db_err)?;
        for row in rows {
            for t in serde_json::from_str::<Vec<String>>(&row.map_err(db_err)?).unwrap_or_default() {
                let t = t.trim();
                if !t.is_empty() {
                    names.insert(t.to_string());
                }
            }
        }
    }
    let mut added = 0usize;
    for name in &names {
        added += conn
            .execute(
                "INSERT INTO tag(name, aliases, \"desc\", origin, created_at)
                 VALUES(?1, '[]', '', 'user', ?2)
                 ON CONFLICT(name) DO NOTHING",
                params![name, now_ms()],
            )
            .map_err(db_err)?;
    }
    Ok(added)
}

/// 合并：`from` 全部并进 `into`（aliases 归并、documents.tags 跟着改），然后删掉 `from`。
pub fn tag_merge(conn: &Connection, from: &[String], into: &str) -> ApiResult<usize> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;

    // aliases 归并：into 自己的 + 每个 from 的名字和它的 aliases
    let mut aliases = tag_aliases(&tx, into)?.unwrap_or_default();
    for f in from {
        if f == into {
            continue;
        }
        if let Some(a) = tag_aliases(&tx, f)? {
            aliases.extend(a);
        }
        aliases.push(f.clone());
        tx.execute("DELETE FROM tag WHERE name = ?1", [f]).map_err(db_err)?;
    }
    let mut merged: Vec<String> = Vec::new();
    for a in aliases {
        if a.is_empty() || a == into || merged.contains(&a) {
            continue;
        }
        merged.push(a);
    }
    let json = serde_json::to_string(&merged).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
    tx.execute(
        "INSERT INTO tag(name, aliases, \"desc\", origin, created_at) VALUES(?1, ?2, '', 'user', ?3)
         ON CONFLICT(name) DO UPDATE SET aliases = excluded.aliases",
        params![into, json, now_ms()],
    )
    .map_err(db_err)?;

    // documents.tags 里指向 from 的名字跟着换 —— 不换就留下指向已删标签的名字
    let docs: Vec<(String, String)> = {
        let mut st = tx.prepare("SELECT id, tags FROM documents").map_err(db_err)?;
        let rows = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(db_err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(db_err)?;
        rows
    };
    let mut affected = 0usize;
    for (id, tags) in docs {
        let arr: Vec<String> = serde_json::from_str(&tags).unwrap_or_default();
        let mut out: Vec<String> = Vec::new();
        for t in &arr {
            let nt = if from.iter().any(|f| f == t) { into } else { t.as_str() };
            if !out.iter().any(|o| o == nt) {
                out.push(nt.to_string());
            }
        }
        if out != arr {
            let json = serde_json::to_string(&out).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
            tx.execute("UPDATE documents SET tags = ?2 WHERE id = ?1", params![id, json])
                .map_err(db_err)?;
            affected += 1;
        }
    }

    tx.commit().map_err(db_err)?;
    Ok(affected)
}

fn tag_aliases(conn: &Connection, name: &str) -> ApiResult<Option<Vec<String>>> {
    let raw: Option<String> = conn
        .query_row("SELECT aliases FROM tag WHERE name = ?1", [name], |r| r.get(0))
        .optional()
        .map_err(db_err)?;
    Ok(raw.map(|s| serde_json::from_str(&s).unwrap_or_default()))
}

/* ─────────────────────────── 主题 ─────────────────────────── */

pub fn topic_list(conn: &Connection) -> ApiResult<Vec<Topic>> {
    let mut st = conn
        .prepare("SELECT name, \"desc\", at FROM topic ORDER BY name")
        .map_err(db_err)?;
    let rows = st
        .query_map([], |r| Ok(Topic { name: r.get(0)?, desc: r.get(1)?, at: r.get(2)? }))
        .map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

pub fn topic_upsert(conn: &Connection, name: &str, desc: &str) -> ApiResult<()> {
    conn.execute(
        "INSERT INTO topic(name, \"desc\", at) VALUES(?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET \"desc\" = excluded.\"desc\", at = excluded.at",
        params![name, desc, now_ms()],
    )
    .map_err(db_err)?;
    Ok(())
}

/// **替换式**：这篇的主题先删后插（跟 doc_link 同一个套路）。
pub fn doc_topic_set(conn: &Connection, doc_id: &str, topics: &[(String, f64)]) -> ApiResult<()> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    tx.execute("DELETE FROM doc_topic WHERE doc_id = ?1", [doc_id]).map_err(db_err)?;
    let at = now_ms();
    {
        let mut st = tx
            .prepare("INSERT OR REPLACE INTO doc_topic(doc_id, topic, weight, at) VALUES(?1, ?2, ?3, ?4)")
            .map_err(db_err)?;
        for (topic, w) in topics {
            st.execute(params![doc_id, topic, w, at]).map_err(db_err)?;
        }
    }
    tx.commit().map_err(db_err)
}

pub fn doc_topic_of(conn: &Connection, doc_id: &str) -> ApiResult<Vec<(String, f64)>> {
    let mut st = conn
        .prepare("SELECT topic, weight FROM doc_topic WHERE doc_id = ?1 ORDER BY weight DESC, topic")
        .map_err(db_err)?;
    let rows = st
        .query_map([doc_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))
        .map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

/// 某个主题（含子主题）下的 doc_id。`topic` 是前缀，`技术` 能匹配 `技术/数据库/SQLite`。
pub fn docs_by_topic(conn: &Connection, topic: &str) -> ApiResult<Vec<String>> {
    let mut st = conn
        .prepare("SELECT DISTINCT doc_id FROM doc_topic WHERE topic = ?1 OR topic LIKE ?1 || '/%' ORDER BY doc_id")
        .map_err(db_err)?;
    let rows = st.query_map([topic], |r| r.get::<_, String>(0)).map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

/* ─────────────────────────── 策展人的幂等闸 ─────────────────────────── */

pub fn run_put(conn: &Connection, doc_id: &str, hash: &str, status: &str, note: &str) -> ApiResult<()> {
    conn.execute(
        "INSERT INTO curator_run(doc_id, hash, status, note, at) VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(doc_id) DO UPDATE SET
           hash = excluded.hash, status = excluded.status, note = excluded.note, at = excluded.at",
        params![doc_id, hash, status, note, now_ms()],
    )
    .map_err(db_err)?;
    Ok(())
}

/// 待跑的 doc_id：正文 md 的 hash 跟 `curator_run.hash` 对不上（或压根没跑过）的。
/// 没投影过正文的跳过 —— 没有语料可喂。按 updated_at 倒序，最多 `limit` 条。
pub fn run_stale(conn: &Connection, limit: usize) -> ApiResult<Vec<String>> {
    // hash 是 sha256，SQL 里算不出来 —— 取回 md 在 Rust 侧比对
    let mut st = conn
        .prepare(
            "SELECT d.id, t.md, r.hash FROM documents d
             JOIN doc_text t ON t.doc_id = d.id
             LEFT JOIN curator_run r ON r.doc_id = d.id
             WHERE d.deleted_at IS NULL AND t.md <> ''
             ORDER BY d.updated_at DESC",
        )
        .map_err(db_err)?;
    let rows = st
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?))
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for row in rows {
        let (id, md, hash) = row.map_err(db_err)?;
        if hash.as_deref() != Some(content_hash(&md).as_str()) {
            if out.len() >= limit {
                break;
            }
            out.push(id);
        }
    }
    Ok(out)
}

/* ─────────────────────────── 建议收件箱 ─────────────────────────── */

pub fn proposal_add(conn: &Connection, p: &NewProposal) -> ApiResult<i64> {
    let payload = serde_json::to_string(&p.payload).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
    conn.execute(
        "INSERT INTO proposal(doc_id, kind, payload, confidence, reason, origin, state, at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
        params![p.doc_id, p.kind, payload, p.confidence, p.reason, p.origin, now_ms()],
    )
    .map_err(db_err)?;
    Ok(conn.last_insert_rowid())
}

/// `state` 传 None = 全部。
pub fn proposal_list(conn: &Connection, state: Option<&str>, limit: usize) -> ApiResult<Vec<Proposal>> {
    let cols = "SELECT id, doc_id, kind, payload, confidence, reason, origin, state, at, done_at FROM proposal";
    let mut st = match state {
        Some(_) => conn
            .prepare(&format!("{cols} WHERE state = ?1 ORDER BY at DESC LIMIT ?2"))
            .map_err(db_err)?,
        None => conn.prepare(&format!("{cols} ORDER BY at DESC LIMIT ?1")).map_err(db_err)?,
    };
    let rows = match state {
        Some(s) => st
            .query_map(params![s, limit as i64], row_proposal)
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?,
        None => st
            .query_map(params![limit as i64], row_proposal)
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?,
    };
    Ok(rows)
}

fn row_proposal(r: &rusqlite::Row) -> rusqlite::Result<Proposal> {
    let payload: String = r.get(3)?;
    Ok(Proposal {
        id: r.get(0)?,
        doc_id: r.get(1)?,
        kind: r.get(2)?,
        payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
        confidence: r.get(4)?,
        reason: r.get(5)?,
        origin: r.get(6)?,
        state: r.get(7)?,
        at: r.get(8)?,
        done_at: r.get(9)?,
    })
}

pub fn proposal_set_state(conn: &Connection, id: i64, state: &str) -> ApiResult<()> {
    let done_at = if state == "pending" { None } else { Some(now_ms()) };
    conn.execute(
        "UPDATE proposal SET state = ?2, done_at = ?3 WHERE id = ?1",
        params![id, state, done_at],
    )
    .map_err(db_err)?;
    Ok(())
}

/// 去重用：同一篇 + 同 kind + 同 payload 摘要，且还在 pending 的，就别再提一遍。
pub fn proposal_pending_has(conn: &Connection, doc_id: &str, kind: &str, dedup_key: &str) -> ApiResult<bool> {
    let pattern = format!("%{}%", like_escape(dedup_key));
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM proposal
             WHERE doc_id = ?1 AND kind = ?2 AND state = 'pending' AND payload LIKE ?3 ESCAPE '\\'",
            params![doc_id, kind, pattern],
            |r| r.get(0),
        )
        .map_err(db_err)?;
    Ok(n > 0)
}

fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/* ─────────────────────────── 实体 ─────────────────────────── */

/// 归一后 upsert，返回 entity id。`name` 是显示名，`normalize()` 的结果决定 id。
pub fn entity_upsert(conn: &Connection, name: &str, kind: &str, desc: &str) -> ApiResult<String> {
    let id = entity_id(name);
    // 空值不覆盖已有的 —— 后一次提及常常不带 kind/desc，别把先前的洗掉
    conn.execute(
        "INSERT INTO entity(id, name, kind, \"desc\", at) VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
           kind = CASE WHEN excluded.kind <> '' THEN excluded.kind ELSE entity.kind END,
           \"desc\" = CASE WHEN excluded.\"desc\" <> '' THEN excluded.\"desc\" ELSE entity.\"desc\" END",
        params![id, name, kind, desc, now_ms()],
    )
    .map_err(db_err)?;
    Ok(id)
}

/// 按显示名或归一名的 hash 找。
pub fn entity_find(conn: &Connection, name: &str) -> ApiResult<Option<Entity>> {
    conn.query_row(
        "SELECT id, name, kind, \"desc\", at FROM entity WHERE id = ?1 OR name = ?2 LIMIT 1",
        params![entity_id(name), name],
        row_entity,
    )
    .optional()
    .map_err(db_err)
}

fn row_entity(r: &rusqlite::Row) -> rusqlite::Result<Entity> {
    Ok(Entity {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        desc: r.get(3)?,
        at: r.get(4)?,
    })
}

pub fn entity_list(conn: &Connection, limit: usize) -> ApiResult<Vec<Entity>> {
    let mut st = conn
        .prepare("SELECT id, name, kind, \"desc\", at FROM entity ORDER BY at DESC LIMIT ?1")
        .map_err(db_err)?;
    let rows = st.query_map([limit as i64], row_entity).map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

/// **替换式**：这篇提到的实体先删后插。
pub fn entity_mention_set(conn: &Connection, doc_id: &str, ids: &[String]) -> ApiResult<()> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    tx.execute("DELETE FROM entity_mention WHERE doc_id = ?1", [doc_id]).map_err(db_err)?;
    let at = now_ms();
    {
        let mut st = tx
            .prepare("INSERT OR REPLACE INTO entity_mention(entity_id, doc_id, at) VALUES(?1, ?2, ?3)")
            .map_err(db_err)?;
        for id in ids {
            st.execute(params![id, doc_id, at]).map_err(db_err)?;
        }
    }
    tx.commit().map_err(db_err)
}

pub fn entity_mention_docs(conn: &Connection, entity_id: &str) -> ApiResult<Vec<String>> {
    let mut st = conn
        .prepare("SELECT doc_id FROM entity_mention WHERE entity_id = ?1 ORDER BY at DESC")
        .map_err(db_err)?;
    let rows = st.query_map([entity_id], |r| r.get::<_, String>(0)).map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

pub fn entity_mention_ids(conn: &Connection, doc_id: &str) -> ApiResult<Vec<String>> {
    let mut st = conn
        .prepare("SELECT entity_id FROM entity_mention WHERE doc_id = ?1")
        .map_err(db_err)?;
    let rows = st.query_map([doc_id], |r| r.get::<_, String>(0)).map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

/* ─────────────────────────── 派生边 ─────────────────────────── */

pub fn edge_put(conn: &Connection, e: &Edge) -> ApiResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO graph_edge
           (src_kind, src_id, dst_kind, dst_id, kind, weight, reason, origin, at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![e.src_kind, e.src_id, e.dst_kind, e.dst_id, e.kind, e.weight, e.reason, e.origin, e.at],
    )
    .map_err(db_err)?;
    Ok(())
}

/// 重算前先清空某一类（`origin` = 'computed' / 'llm'）—— 用户画的边在 doc_link，不归这儿管。
pub fn edge_clear_origin(conn: &Connection, origin: &str) -> ApiResult<()> {
    conn.execute("DELETE FROM graph_edge WHERE origin = ?1", [origin]).map_err(db_err)?;
    Ok(())
}

/// 从 `(kind, id)` 出发走 `depth` 跳，union 上 `doc_link` 的显式边。返回子图。
pub fn graph_walk(
    conn: &Connection,
    seeds: &[(String, String)],
    depth: u32,
    limit: usize,
) -> ApiResult<Subgraph> {
    use std::collections::{BTreeMap, HashSet};

    let mut visited: HashSet<(String, String)> = HashSet::new();
    let mut order: Vec<(String, String)> = Vec::new();
    let mut frontier: Vec<(String, String)> = Vec::new();
    for s in seeds {
        if visited.insert(s.clone()) {
            order.push(s.clone());
            frontier.push(s.clone());
        }
    }

    // 边用主键形状去重，两张表（graph_edge + doc_link）union 进来
    let mut emap: BTreeMap<(String, String, String, String, String), Edge> = BTreeMap::new();
    let mut d = depth;
    while d > 0 && !frontier.is_empty() {
        let mut next = Vec::new();
        for node in &frontier {
            for (ok, oid, e) in incident(conn, &node.0, &node.1)? {
                let key = (e.src_kind.clone(), e.src_id.clone(), e.dst_kind.clone(), e.dst_id.clone(), e.kind.clone());
                emap.entry(key).or_insert(e);
                let nbr = (ok, oid);
                if !visited.contains(&nbr) && order.len() < limit {
                    visited.insert(nbr.clone());
                    order.push(nbr.clone());
                    next.push(nbr);
                }
            }
        }
        frontier = next;
        d -= 1;
    }

    // 只留两端都在子图里的边
    let edges: Vec<Edge> = emap
        .into_values()
        .filter(|e| {
            visited.contains(&(e.src_kind.clone(), e.src_id.clone()))
                && visited.contains(&(e.dst_kind.clone(), e.dst_id.clone()))
        })
        .collect();

    let mut nodes = Vec::with_capacity(order.len());
    for (kind, id) in &order {
        let degree = edges
            .iter()
            .filter(|e| {
                (e.src_kind == *kind && e.src_id == *id) || (e.dst_kind == *kind && e.dst_id == *id)
            })
            .count();
        nodes.push(Node {
            kind: kind.clone(),
            id: id.clone(),
            label: node_label(conn, kind, id)?,
            extra: json!({ "degree": degree }),
        });
    }

    Ok(Subgraph { nodes, edges })
}

/// 一个节点的所有邻居边（`graph_edge` 两个方向 + doc 的 `doc_link` 两个方向）。
/// 返回 `(另一端的 kind, 另一端的 id, 边)`。
fn incident(conn: &Connection, kind: &str, id: &str) -> ApiResult<Vec<(String, String, Edge)>> {
    let mut out = Vec::new();
    {
        let mut st = conn
            .prepare(
                "SELECT src_kind, src_id, dst_kind, dst_id, kind, weight, reason, origin, at
                 FROM graph_edge
                 WHERE (src_kind = ?1 AND src_id = ?2) OR (dst_kind = ?1 AND dst_id = ?2)",
            )
            .map_err(db_err)?;
        let rows = st
            .query_map(params![kind, id], |r| {
                Ok(Edge {
                    src_kind: r.get(0)?,
                    src_id: r.get(1)?,
                    dst_kind: r.get(2)?,
                    dst_id: r.get(3)?,
                    kind: r.get(4)?,
                    weight: r.get(5)?,
                    reason: r.get(6)?,
                    origin: r.get(7)?,
                    at: r.get(8)?,
                })
            })
            .map_err(db_err)?;
        for row in rows {
            let e = row.map_err(db_err)?;
            let other = if e.src_kind == kind && e.src_id == id {
                (e.dst_kind.clone(), e.dst_id.clone())
            } else {
                (e.src_kind.clone(), e.src_id.clone())
            };
            out.push((other.0, other.1, e));
        }
    }
    if kind == "doc" {
        let mut st = conn
            .prepare("SELECT from_id, to_id, kind, at FROM doc_link WHERE from_id = ?1 OR to_id = ?1")
            .map_err(db_err)?;
        let rows = st
            .query_map([id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(db_err)?;
        for row in rows {
            let (from_id, to_id, k, at) = row.map_err(db_err)?;
            let other_id = if from_id == id { to_id.clone() } else { from_id.clone() };
            out.push((
                "doc".to_string(),
                other_id,
                Edge {
                    src_kind: "doc".to_string(),
                    src_id: from_id,
                    dst_kind: "doc".to_string(),
                    dst_id: to_id,
                    kind: k,
                    weight: 1.0,
                    reason: String::new(),
                    origin: "user".to_string(),
                    at,
                },
            ));
        }
    }
    Ok(out)
}

/// 节点的显示名：doc 取标题，其他 kind 取对应表的名字。
fn node_label(conn: &Connection, kind: &str, id: &str) -> ApiResult<String> {
    let sql = match kind {
        "doc" => "SELECT title FROM documents WHERE id = ?1",
        "entity" => "SELECT name FROM entity WHERE id = ?1",
        "topic" => "SELECT name FROM topic WHERE name = ?1",
        "tag" => "SELECT name FROM tag WHERE name = ?1",
        _ => return Ok(id.to_string()),
    };
    let label: Option<String> = conn.query_row(sql, [id], |r| r.get(0)).optional().map_err(db_err)?;
    Ok(label.unwrap_or_else(|| id.to_string()))
}

/// 一篇的邻居（用于 `/graph/neighbors/<doc>.md` 和 `kb_related`）。按 weight 倒序。
pub fn doc_neighbors(conn: &Connection, doc_id: &str, limit: usize) -> ApiResult<Vec<Edge>> {
    let mut edges: Vec<Edge> =
        incident(conn, "doc", doc_id)?.into_iter().map(|(_, _, e)| e).collect();
    edges.sort_by(|a, b| b.weight.partial_cmp(&a.weight).unwrap_or(std::cmp::Ordering::Equal));
    edges.truncate(limit);
    Ok(edges)
}

/* ─────────────────────────── 向量 ─────────────────────────── */

pub fn vec_put(
    conn: &Connection,
    owner_kind: &str,
    owner_id: &str,
    model: &str,
    vec: &[f32],
    hash: &str,
) -> ApiResult<()> {
    let blob = vec_to_blob(vec);
    conn.execute(
        "INSERT INTO vec(owner_kind, owner_id, model, dim, vec, hash, at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(owner_kind, owner_id) DO UPDATE SET
           model = excluded.model, dim = excluded.dim, vec = excluded.vec,
           hash = excluded.hash, at = excluded.at",
        params![owner_kind, owner_id, model, vec.len() as i64, blob, hash, now_ms()],
    )
    .map_err(db_err)?;
    Ok(())
}

/// 某类全部向量。`model` 对不上的**不返回** —— 调用方看到空就知道要重算。
pub fn vec_all(conn: &Connection, owner_kind: &str, model: &str) -> ApiResult<Vec<(String, Vec<f32>)>> {
    let mut st = conn
        .prepare("SELECT owner_id, vec FROM vec WHERE owner_kind = ?1 AND model = ?2")
        .map_err(db_err)?;
    let rows = st
        .query_map(params![owner_kind, model], |r| {
            let blob: Vec<u8> = r.get(1)?;
            Ok((r.get::<_, String>(0)?, blob_to_vec(&blob)))
        })
        .map_err(db_err)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
}

pub fn vec_get(
    conn: &Connection,
    owner_kind: &str,
    owner_id: &str,
) -> ApiResult<Option<(String, Vec<f32>, String)>> {
    conn.query_row(
        "SELECT model, vec, hash FROM vec WHERE owner_kind = ?1 AND owner_id = ?2",
        params![owner_kind, owner_id],
        |r| {
            let blob: Vec<u8> = r.get(1)?;
            Ok((r.get::<_, String>(0)?, blob_to_vec(&blob), r.get::<_, String>(2)?))
        },
    )
    .optional()
    .map_err(db_err)
}

pub fn vec_clear(conn: &Connection) -> ApiResult<()> {
    conn.execute("DELETE FROM vec", []).map_err(db_err)?;
    Ok(())
}

/// 暴力余弦 top-k。几千条 × 1024 维是毫秒级 —— 不值得引向量库（D-0184）。
pub fn vec_topk(
    conn: &Connection,
    owner_kind: &str,
    model: &str,
    q: &[f32],
    k: usize,
) -> ApiResult<Vec<VecHit>> {
    if k == 0 || q.is_empty() {
        return Ok(Vec::new());
    }
    let qn = norm(q);
    if qn == 0.0 {
        return Ok(Vec::new());
    }
    let mut hits: Vec<VecHit> = Vec::new();
    for (id, v) in vec_all(conn, owner_kind, model)? {
        if v.len() != q.len() {
            continue; // 维度对不上 = 换了模型，当没这条
        }
        let vn = norm(&v);
        if vn == 0.0 {
            continue;
        }
        let dot: f64 = q.iter().zip(&v).map(|(a, b)| (*a as f64) * (*b as f64)).sum();
        hits.push(VecHit { owner_kind: owner_kind.to_string(), owner_id: id, score: dot / (qn * vn) });
    }
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(k);
    Ok(hits)
}

fn norm(v: &[f32]) -> f64 {
    v.iter().map(|x| (*x as f64) * (*x as f64)).sum::<f64>().sqrt()
}

/* ─────────────────────────── 帮手 ─────────────────────────── */

/// f32 切片 ↔ BLOB（小端拼接）。向量表只在这儿跟字节打交道。
pub fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

pub fn blob_to_vec(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

/// 实体名的归一：去空白、全角转半角、小写。id = sha256(它的) 前 32 hex。
pub fn normalize_name(name: &str) -> String {
    name.trim()
        .chars()
        .map(|c| {
            // 全角 ASCII（U+FF01..U+FF5E）→ 半角
            if ('\u{ff01}'..='\u{ff5e}').contains(&c) {
                char::from_u32(c as u32 - 0xfee0).unwrap_or(c)
            } else if c == '\u{3000}' {
                ' '
            } else {
                c
            }
        })
        .collect::<String>()
        .to_lowercase()
}

pub fn entity_id(name: &str) -> String {
    use sha2::{Digest, Sha256};
    let hex = format!("{:x}", Sha256::digest(normalize_name(name).as_bytes()));
    hex[..32].to_string()
}

/// 正文 md 的 hash —— 策展人的幂等闸用。
pub fn content_hash(md: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(md.as_bytes()))
}
