//! 知识库工具面（D-0187）：**一份目录，两处运输**。
//!
//! 消费者两个，定义只有一份：
//! - MCP 进程（`mcp/mod.rs` 的 `tools()` 引用 `catalog()`，`call_tool` 落到 `call()`）
//! - 内置 agent（`kb:tools` 命令回 `catalog_writable()`，`plugins/kb` 逐条包成 `ToolSpec`，
//!   `run` 里调 `kb:call` 回到同一个 `call()`）
//!
//! 所以这 11 条工具**不会漂移**。老的 vfs_* / doc_* 两条路是分开的（D-0084 之后
//! 「一个定义两处导出」那句就作废了），本轮不动它们。
//!
//! ★ MCP 那条**必须保持只读**：写工具只出现在 `catalog_writable()` 里。



use crate::commands::{ApiError, ApiResult};
use crate::kb::{curator, embed, graph};
use crate::store::{db_err, docs, kb as store_kb, Db};
use crate::vfs;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// 只读工具：MCP 和内置 agent 都有。
pub fn catalog() -> Value {
    json!([
        {
            "name": "kb_search",
            "description": "全文检索笔记（比 vfs_grep 好：带排序、能按标签/主题/时间过滤）。先看 /index.md 定方向，再用这个精确找。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "要找的词" },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "只留带这些标签的（任一命中）" },
                    "topic": { "type": "string", "description": "只留这个主题下的（前缀匹配，如 \"技术\" 含 \"技术/数据库\"）" },
                    "after": { "type": "number", "description": "只要这个时间（毫秒时间戳）之后更新的" },
                    "limit": { "type": "number", "description": "最多几条，默认 20" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "kb_index",
            "description": "全库地图：篇数、主题树、标签统计、最近改动，每篇带一句话摘要。**进来第一站**。",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "kb_tags",
            "description": "标签词表 + 每条的篇数。词表是受控的 —— 自动打标签只在这张表里选。",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "kb_topics",
            "description": "主题树 + 每个主题下的篇数。主题是 AI 归的类，不是文档树的层级。",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "kb_entity",
            "description": "一个实体的详情 + 提到它的所有笔记。实体名用 /entity/ 里见过的写法。",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string", "description": "实体名" } },
                "required": ["name"]
            }
        },
        {
            "name": "kb_related",
            "description": "跟这篇相关的笔记（显式链接 + 推断关联 + 语义近邻，混排）。比翻反链更宽。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "文档 id（先 kb_search 或 doc_list 拿）" },
                    "limit": { "type": "number", "description": "最多几条，默认 15" }
                },
                "required": ["id"]
            }
        },
        {
            "name": "kb_graph",
            "description": "从一篇笔记出发的知识图谱子图。用来回答「这一片都牵扯到什么」。要找实体用 kb_entity。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "seed": { "type": "string", "description": "文档 id" },
                    "depth": { "type": "number", "description": "走几跳，默认 1，最多 3" },
                    "limit": { "type": "number", "description": "节点上限，默认 60" }
                },
                "required": ["seed"]
            }
        },
        {
            "name": "kb_semantic",
            "description": "语义检索：找「意思像但用词不同」的笔记。grep 找不到时用它。没配 embedding 时这条会明确报错，不是静默返回空。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "一句话" },
                    "limit": { "type": "number", "description": "最多几条，默认 10" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "kb_proposals",
            "description": "待你确认的整理建议（打标签 / 归类 / 建关联）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "state": { "type": "string", "enum": ["pending", "accepted", "rejected"], "description": "默认 pending" },
                    "limit": { "type": "number", "description": "最多几条，默认 50" }
                }
            }
        }
    ])
}

/// 只读 + 写：**只有内置 agent 拿得到**（MCP 走 `catalog()`，保持只读边界）。
pub fn catalog_writable() -> Value {
    let mut v = catalog();
    let arr = v.as_array_mut().expect("catalog 是数组");
    arr.push(json!({
        "name": "kb_accept",
        "description": "采纳一条整理建议。只在用户让你这么做时用 —— 这是改他的库。",
        "inputSchema": {
            "type": "object",
            "properties": { "id": { "type": "number", "description": "建议 id（kb_proposals 给的）" } },
            "required": ["id"]
        }
    }));
    arr.push(json!({
        "name": "kb_reject",
        "description": "拒绝一条整理建议。",
        "inputSchema": {
            "type": "object",
            "properties": { "id": { "type": "number", "description": "建议 id" } },
            "required": ["id"]
        }
    }));
    v
}

/// 分派。MCP 的 `call_tool` 和 `kb:call` 命令**都走这里** —— 实现只有一份。
/// 返回一行 JSON 文本（MCP 的 content 和前端 tool 结果都吃这个）。
pub fn call(db: &Db, name: &str, args: &Value) -> ApiResult<String> {
    // MCP 走 open_readonly、不跑 schema.sql —— app 没开过时新表根本不在（docs/kb.md §7）。
    if !db.with(kb_tables_ready)? {
        return Err(ApiError::new(
            "kb",
            "知识库的表还没建出来 —— 先在桌面端打开一次 app（新表在启动时创建），MCP 只读，建不了表",
        ));
    }
    match name {
        "kb_search" => kb_search(db, args),
        // 正文本身，不套 JSON —— 跟 MCP 的 vfs_read 一个口径，模型要的是地图的样子
        "kb_index" => vfs::read(db, "/index.md", None, None),
        "kb_tags" => kb_tags(db),
        "kb_topics" => kb_topics(db),
        "kb_entity" => kb_entity(db, args),
        "kb_related" => kb_related(db, args),
        "kb_graph" => kb_graph(db, args),
        "kb_semantic" => kb_semantic(db, args),
        "kb_proposals" => kb_proposals(db, args),
        "kb_accept" => kb_accept(db, args),
        "kb_reject" => kb_reject(db, args),
        other => Err(ApiError::new("bad_args", format!("不认识的工具：{other}"))),
    }
}

/// 写工具名。**MCP 那条必须把它们挡在门外**（走 `call_readonly`）。
///
/// ★ 为什么不能只靠「`catalog()` 里没列」：清单是给客户端**看**的，而分派是按名字走的 ——
///   客户端完全可以自己编一个 `kb_accept` 发过来，照样进实现（实测过：返回的是
///   「没有这条建议：1」，说明它真跑到了实现里）。今天靠 MCP 库的 `query_only` 兜住了，
///   但那是**弱边界**，正是 D-0084 否掉的那种。只读边界要是结构性的：没有实现，才没有开关。
const WRITE_TOOLS: &[&str] = &["kb_accept", "kb_reject"];

/// MCP 走的入口：写工具一律拒。
pub fn call_readonly(db: &Db, name: &str, args: &Value) -> ApiResult<String> {
    if WRITE_TOOLS.contains(&name) {
        return Err(ApiError::new("bad_args", format!("MCP 是只读的：{name} 不在这儿")));
    }
    call(db, name, args)
}

/* ─────────────────────────── 各条工具 ─────────────────────────── */

/// 过滤发生在 Rust 侧，SQL 的 LIMIT 得留余量 —— 先多取一池。
const SEARCH_POOL: usize = 200;

fn kb_search(db: &Db, args: &Value) -> ApiResult<String> {
    let a: SearchArgs = parse(args)?;
    let limit = a.limit.unwrap_or(20);
    let want: Option<HashSet<&str>> = a
        .tags
        .as_ref()
        .filter(|t| !t.is_empty())
        .map(|t| t.iter().map(String::as_str).collect());
    let filtering = want.is_some() || a.topic.is_some() || a.after.is_some();
    db.with(|c| {
        let pool = if filtering { SEARCH_POOL } else { limit };
        let hits = docs::search(c, &a.query, pool as i64, false)?;
        let allowed: Option<HashSet<String>> = match &a.topic {
            Some(t) => Some(store_kb::docs_by_topic(c, t)?.into_iter().collect()),
            None => None,
        };
        let mut out = Vec::new();
        for h in hits {
            if a.after.is_some_and(|ts| h.updated_at <= ts) {
                continue;
            }
            if allowed.as_ref().is_some_and(|s| !s.contains(&h.id)) {
                continue;
            }
            if let Some(want) = &want {
                let tags = docs::get(c, &h.id).map(|m| m.tags).unwrap_or_default();
                if !tags.iter().any(|t| want.contains(t.as_str())) {
                    continue;
                }
            }
            out.push(h);
            if out.len() >= limit {
                break;
            }
        }
        json_text(&out)
    })
}

fn kb_tags(db: &Db) -> ApiResult<String> {
    db.with(|c| {
        let counts = tag_counts(c)?;
        let mut out = Vec::new();
        for t in store_kb::tag_list(c)? {
            let n = counts.get(&t.name).copied().unwrap_or(0);
            let mut v = serde_json::to_value(&t).map_err(enc)?;
            v["count"] = json!(n);
            out.push(v);
        }
        json_text(&out)
    })
}

/// 每篇（未删除）文档 tags 里各标签的篇数 —— 现算，不建计数表。
fn tag_counts(c: &Connection) -> ApiResult<HashMap<String, usize>> {
    let mut st = c.prepare("SELECT tags FROM documents WHERE deleted_at IS NULL").map_err(db_err)?;
    let rows = st.query_map([], |r| r.get::<_, String>(0)).map_err(db_err)?;
    let mut m: HashMap<String, usize> = HashMap::new();
    for row in rows {
        let raw = row.map_err(db_err)?;
        for t in serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default() {
            *m.entry(t).or_insert(0) += 1;
        }
    }
    Ok(m)
}

fn kb_topics(db: &Db) -> ApiResult<String> {
    db.with(|c| {
        let mut out = Vec::new();
        for t in store_kb::topic_list(c)? {
            let n = store_kb::docs_by_topic(c, &t.name)?.len();
            let mut v = serde_json::to_value(&t).map_err(enc)?;
            v["count"] = json!(n);
            out.push(v);
        }
        json_text(&out)
    })
}

fn kb_entity(db: &Db, args: &Value) -> ApiResult<String> {
    let a: EntityArgs = parse(args)?;
    db.with(|c| {
        let d = graph::entity_detail(c, &a.name)?
            .ok_or_else(|| ApiError::new("not_found", format!("没有这个实体：{}", a.name)))?;
        json_text(&json!({ "entity": d.entity, "docs": d.docs }))
    })
}

fn kb_related(db: &Db, args: &Value) -> ApiResult<String> {
    let a: RelatedArgs = parse(args)?;
    json_text(&graph::related(db, &a.id, a.limit.unwrap_or(15))?)
}

fn kb_graph(db: &Db, args: &Value) -> ApiResult<String> {
    let a: GraphArgs = parse(args)?;
    let depth = a.depth.unwrap_or(1).clamp(1, 3);
    let limit = a.limit.unwrap_or(60);
    db.with(|c| {
        let g = graph::subgraph(c, &[("doc".to_string(), a.seed.clone())], depth, limit)?;
        json_text(&g)
    })
}

fn kb_semantic(db: &Db, args: &Value) -> ApiResult<String> {
    let a: SemanticArgs = parse(args)?;
    // 没配 embedding 模型时那条明确的错原样出去 —— 它本身就是给用户看的一句话（D-0184）
    json_text(&embed::search(db, &a.query, a.limit.unwrap_or(10))?)
}

fn kb_proposals(db: &Db, args: &Value) -> ApiResult<String> {
    let a: ProposalsArgs = parse(args)?;
    let state = a.state.as_deref().unwrap_or("pending");
    let limit = a.limit.unwrap_or(50);
    db.with(|c| json_text(&store_kb::proposal_list(c, Some(state), limit)?))
}

/// 采纳 = 真落库（见 `curator::accept`），再重算共现边（实体/边变了）。
fn kb_accept(db: &Db, args: &Value) -> ApiResult<String> {
    let a: IdArgs = parse(args)?;
    curator::accept(db, a.id)?;
    db.with(|c| graph::recompute_cooccur(c, crate::commands::COOCCUR_MIN_SHARED))?;
    Ok(json!({ "ok": true, "id": a.id, "state": "accepted" }).to_string())
}

fn kb_reject(db: &Db, args: &Value) -> ApiResult<String> {
    let a: IdArgs = parse(args)?;
    curator::reject(db, a.id)?;
    Ok(json!({ "ok": true, "id": a.id, "state": "rejected" }).to_string())
}

/// MCP 的只读句柄不跑 schema.sql：新表在 app 首次启动才建出来。挑一张代表表探一下。
fn kb_tables_ready(conn: &Connection) -> ApiResult<bool> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'proposal'",
            [],
            |r| r.get(0),
        )
        .map_err(db_err)?;
    Ok(n > 0)
}

fn parse<T: serde::de::DeserializeOwned>(args: &Value) -> ApiResult<T> {
    serde_json::from_value(args.clone()).map_err(|e| ApiError::new("bad_args", e.to_string()))
}

fn json_text<T: serde::Serialize>(v: &T) -> ApiResult<String> {
    serde_json::to_string(v).map_err(enc)
}

fn enc(e: serde_json::Error) -> ApiError {
    ApiError::new("encode", e.to_string())
}

/* ─────────────────────────── 入参 ─────────────────────────── */

#[derive(Deserialize)]
struct SearchArgs {
    query: String,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    topic: Option<String>,
    #[serde(default)]
    after: Option<i64>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct RelatedArgs {
    id: String,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct GraphArgs {
    seed: String,
    #[serde(default)]
    depth: Option<u32>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct SemanticArgs {
    query: String,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct ProposalsArgs {
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct EntityArgs {
    name: String,
}

#[derive(Deserialize)]
struct IdArgs {
    id: i64,
}
