//! 图谱（D-0186）：实体归一 + 派生边 + 邻居查询。
//!
//! ★ **用户画的边在 `doc_link`，这儿不复制**。`graph_edge` 只装派生的
//!   （`related` 由策展人给、`co_occur` 由共享实体算）。查图时两张表 union。
//! ★ 填的是 `D-0075 续` 留的口子 —— 那边写着「实体只存不索引」。



use std::collections::HashMap;

use crate::commands::ApiResult;
use crate::store::kb::{
    doc_neighbors, edge_clear_origin, edge_put, entity_find, entity_mention_docs, graph_walk,
    normalize_name, Edge, Entity, Subgraph,
};
use crate::store::{db_err, links, now_ms, summary, Db};
use rusqlite::Connection;

/// 谁都能提一嘴、成不了节点的词（kb.md §7）。跟归一后的名字比，所以英文只收小写。
const STOPWORDS: &[&str] = &[
    "用户", "问题", "方法", "内容", "信息", "数据", "系统", "功能", "工具", "项目", "笔记", "文档",
    "页面", "时候", "地方", "东西", "事情", "结果", "原因", "情况", "方式", "过程", "时间", "工作",
    "需求", "目标", "计划", "设计", "代码", "文件", "文章", "版本", "记录", "步骤", "例子", "概念",
    "部分", "结构", "关系", "变化", "影响", "作用", "特点", "建议", "参考", "链接", "图片", "文本",
    "语言", "开发", "测试", "配置", "模型", "算法", "状态", "操作", "任务", "团队", "产品", "价值",
    "关键", "重要", "简单", "复杂", "基本", "主要", "相关", "不同", "以及", "如果", "因为", "所以",
    "但是", "而且", "可能", "需要", "应该", "可以", "一个", "一些", "什么", "怎么", "这个", "那个",
    "我们", "他们", "自己", "目前", "现在", "以后", "之前", "之后", "最近", "这里", "那里", "一直",
    "已经", "不是", "就是", "没有", "还有", "或者", "然后", "因此", "例如", "比如", "等等",
    "the", "and", "for", "with", "this", "that", "from", "are", "was", "were", "you", "your", "our",
    "not", "but", "all", "any", "can", "has", "have", "will", "would", "there", "their", "what",
    "when", "which", "who", "how", "why", "also", "into", "over", "more", "most", "some", "such",
    "than", "them", "then", "they", "been", "about", "after", "before", "because", "each", "other",
    "same", "only", "very", "just", "should",
];

/// 实体质量闸：太短或纯泛词的丢掉（kb.md §7）。
fn entity_ok(name: &str) -> bool {
    let n = normalize_name(name);
    n.chars().count() >= 2 && !STOPWORDS.contains(&n.as_str())
}

/// 实体详情 + 提到它的笔记（`/entity/<名>.md` 和 `kb_entity` 都用它）。
pub struct EntityDetail {
    pub entity: Entity,
    pub docs: Vec<String>,
}

/// 重算 `co_occur` 边：两篇共享 ≥ `min_shared` 个实体就有一条边，weight = 共享数。
/// **先清后建**（`edge_clear_origin("computed")`），跟 doc_link 的替换式重建同一个套路。
pub fn recompute_cooccur(conn: &Connection, min_shared: usize) -> ApiResult<usize> {
    edge_clear_origin(conn, "computed")?;

    // 按实体分组：一个实体被哪些文档提到。别两两比 —— 那是 O(n²)。
    let mut st = conn
        .prepare(
            "SELECT em.entity_id, em.doc_id, e.name
             FROM entity_mention em JOIN entity e ON e.id = em.entity_id",
        )
        .map_err(db_err)?;
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(db_err)?;

    let mut by_entity: HashMap<String, (String, Vec<String>)> = HashMap::new();
    for row in rows {
        let (eid, doc, name) = row.map_err(db_err)?;
        by_entity.entry(eid).or_insert_with(|| (name, Vec::new())).1.push(doc);
    }

    let mut counts: HashMap<(String, String), usize> = HashMap::new();
    for (name, docs) in by_entity.values() {
        if !entity_ok(name) {
            continue;
        }
        for i in 0..docs.len() {
            for j in (i + 1)..docs.len() {
                // 无向对，规范成 (小, 大)，同一对从两边数只落一条。
                let (a, b) = if docs[i] < docs[j] {
                    (docs[i].clone(), docs[j].clone())
                } else {
                    (docs[j].clone(), docs[i].clone())
                };
                *counts.entry((a, b)).or_insert(0) += 1;
            }
        }
    }

    let at = now_ms();
    let mut written = 0;
    for ((a, b), shared) in counts {
        if shared < min_shared {
            continue;
        }
        edge_put(
            conn,
            &Edge {
                src_kind: "doc".into(),
                src_id: a,
                dst_kind: "doc".into(),
                dst_id: b,
                kind: "co_occur".into(),
                weight: shared as f64,
                reason: format!("共享 {shared} 个实体"),
                origin: "computed".into(),
                at,
            },
        )?;
        written += 1;
    }
    Ok(written)
}

/// 一篇的相关笔记：`doc_link` 显式边 + `graph_edge` 派生边 + 语义近邻，混排后截断。
pub fn related(db: &Db, doc_id: &str, limit: usize) -> ApiResult<Vec<Edge>> {
    let at = now_ms();
    let take = limit.max(1).saturating_mul(4);
    let mut picked: HashMap<String, (u8, Edge)> = HashMap::new();

    // 1) 显式边：出链 + 反链都算相关（用户画的，最高优先）。
    let explicit = db.with(|conn| {
        let mut all = links::out_links(conn, doc_id)?;
        all.extend(links::in_links(conn, doc_id)?);
        Ok(all)
    })?;
    for e in explicit {
        if e.doc_id == doc_id {
            continue;
        }
        put_best(
            &mut picked,
            e.doc_id.clone(),
            3,
            Edge {
                src_kind: "doc".into(),
                src_id: doc_id.into(),
                dst_kind: "doc".into(),
                dst_id: e.doc_id,
                kind: e.kind,
                weight: 1.0,
                reason: String::new(),
                origin: "user".into(),
                at,
            },
        );
    }

    // 2) 派生边（related / co_occur）。
    let derived = db.with(|conn| doc_neighbors(conn, doc_id, take))?;
    for e in derived {
        let other = if e.src_id == doc_id { e.dst_id.clone() } else { e.src_id.clone() };
        if other == doc_id {
            continue;
        }
        put_best(
            &mut picked,
            other.clone(),
            2,
            Edge {
                src_kind: "doc".into(),
                src_id: doc_id.into(),
                dst_kind: "doc".into(),
                dst_id: other,
                kind: e.kind,
                weight: e.weight,
                reason: e.reason,
                origin: e.origin,
                at: e.at,
            },
        );
    }

    // 3) 语义近邻：拿这篇的总结当 query。没配 / 报错就降级，别把整个 related 拖挂。
    let query = db.with(|conn| summary::get(conn, doc_id).map(|o| o.map(|s| format!("{} {}", s.line, s.para))))?;
    if let Some(q) = query.filter(|q| !q.trim().is_empty()) {
        match crate::kb::embed::search(db, &q, take) {
            Ok(hits) => {
                for h in hits {
                    if h.owner_kind != "doc" || h.owner_id == doc_id {
                        continue;
                    }
                    put_best(
                        &mut picked,
                        h.owner_id.clone(),
                        1,
                        Edge {
                            src_kind: "doc".into(),
                            src_id: doc_id.into(),
                            dst_kind: "doc".into(),
                            dst_id: h.owner_id,
                            kind: "related".into(),
                            weight: h.score,
                            reason: "语义相近".into(),
                            origin: "computed".into(),
                            at,
                        },
                    );
                }
            }
            // 没配模型不是错，别每次都往 errors.log 里写一行（`kb` = 配置缺失那一档）。
            Err(err) if err.code != "kb" => {
                crate::log::record("kb", &format!("语义近邻降级：{}", err.message))
            }
            Err(_) => {}
        }
    }

    // 先按来源优先级、再按权重 —— 三路的 weight 不是一个量纲（显式边 1.0、
    // 共现边是共享实体数、语义是余弦），只按 weight 排会让共现把用户手画的链接压下去。
    let mut out: Vec<(u8, Edge)> = picked.into_values().collect();
    out.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then(b.1.weight.partial_cmp(&a.1.weight).unwrap_or(std::cmp::Ordering::Equal))
    });
    Ok(out.into_iter().take(limit).map(|(_, e)| e).collect())
}

/// 同一篇邻居多路命中时留谁：先看来源优先级，同级再看 weight。
fn put_best(picked: &mut HashMap<String, (u8, Edge)>, key: String, prio: u8, e: Edge) {
    let keep = match picked.get(&key) {
        Some((p, old)) => *p > prio || (*p == prio && old.weight >= e.weight),
        None => false,
    };
    if !keep {
        picked.insert(key, (prio, e));
    }
}

/// 从种子出发走 `depth` 跳的子图。给 `kb_graph` 工具和画布用。
pub fn subgraph(
    conn: &Connection,
    seeds: &[(String, String)],
    depth: u32,
    limit: usize,
) -> ApiResult<Subgraph> {
    graph_walk(conn, seeds, depth, limit)
}

pub fn entity_detail(conn: &Connection, name: &str) -> ApiResult<Option<EntityDetail>> {
    match entity_find(conn, name)? {
        None => Ok(None),
        Some(entity) => {
            let docs = entity_mention_docs(conn, &entity.id)?;
            Ok(Some(EntityDetail { entity, docs }))
        }
    }
}
