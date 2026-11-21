//! 有范围的预检索（D-0200 / D-0202，契约见 `docs/ai-rag.md`）。
//!
//! 输入一个 `/tree` 下的目录或单篇，输出**少量**带编号的片段：
//! FTS / 摘要召回候选 → 词项（IDF + 停用词）给文档打分 → 分块 → top-k → 预算。
//!
//! ★ 默认零网络：只有 `kb.ragRerank = true` 且配了 embedding 模型才做一次向量重排；
//!   失败只写 `errors.log` 并降级，检索本身不失败。
//! ★ 只读 `doc_text`，不解析 PM JSON —— 分块和引用都在 Markdown 投影上做。
//! ★ 一次调用一条 RPC：不逐篇往返。

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::commands::ApiResult;
use crate::kb::embed;
use crate::store::{db_err, docs, settings_get, Db};
use crate::vfs;

/// 进细分的文档上限。
const DOC_POOL: usize = 24;
/// FTS / 摘要召回候选的上限。
const CANDIDATES: usize = 96;
/// 没有词项时按最近改动取几篇。
const FALLBACK_DOCS: usize = 12;
/// 最多给模型几段。
const MAX_CHUNKS: usize = 8;
/// 同一篇最多几段。
const PER_DOC: usize = 3;
/// 保证覆盖：有货时至少来自这么多篇。
const MIN_DOCS: usize = 4;
/// 覆盖也要门槛：低于最高分这个比例的块不算「有货」。
const MIN_DOC_SHARE: f64 = 0.30;
/// 单段给模型看的字数 —— 也是切块的硬上限，块尾不再丢。
const CHUNK_CHARS: usize = 360;
/// 切长段时的重叠字数。
const CHUNK_OVERLAP: usize = 40;
/// 注入上下文的总成本上限（正文 + 标题 + 路径 + 章节，≈ 1.2k tokens）。
const MAX_CHARS: usize = 3600;
/// 每个片段元数据的估算开销。
const CHUNK_META_CHARS: usize = 12;
/// 查询词项上限 —— 长问题/长引用不该用数量压过区分度。
const MAX_TERMS: usize = 14;
const TITLE_BOOST: f64 = 4.0;
const SUMMARY_BOOST: f64 = 2.0;
const HEADING_BOOST: f64 = 3.0;
const FOCUS_BOOST: f64 = 1.6;
const SEM_SHARE: f64 = 0.45;
/// 切块缓存的篇数上限。
const CACHE_DOCS: usize = 256;
/// 向量重排开关（默认关，`true` 才联网）。
const K_RERANK: &str = "kb.ragRerank";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchArgs {
    pub scope: ScopeArg,
    pub query: String,
    /// 用户划线所在文档 —— 给了就在 scope 内加权。
    #[serde(default)]
    pub focus_id: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind")]
pub enum ScopeArg {
    #[serde(rename = "dir")]
    Dir {
        path: String,
        #[serde(default)]
        title: String,
    },
    #[serde(rename = "doc")]
    Doc {
        id: String,
        #[serde(default)]
        path: String,
        #[serde(default)]
        title: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub n: usize,
    pub doc_id: String,
    pub title: String,
    pub path: String,
    pub heading: Option<String>,
    pub text: String,
    pub anchor: String,
    pub score: f64,
    pub reason: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsedDoc {
    pub id: String,
    pub title: String,
    pub path: String,
    pub chunks: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocRank {
    pub id: String,
    pub title: String,
    pub score: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    pub scope: Value,
    pub query: String,
    pub terms: Vec<String>,
    pub semantic: bool,
    pub docs_total: usize,
    pub docs_scanned: usize,
    pub docs_hit: usize,
    pub docs_skipped: usize,
    pub chunks_scored: usize,
    pub chars: usize,
    pub took_ms: u64,
    pub chunks: Vec<Chunk>,
    pub used_docs: Vec<UsedDoc>,
    pub doc_scores: Vec<DocRank>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empty: Option<&'static str>,
}

/// 一篇候选的元数据 + 按需载入的正文。
struct Meta {
    id: String,
    title: String,
    title_l: String,
    updated_at: i64,
    md_at: i64,
    has_text: bool,
    summary_l: String,
    md: String,
    body_l: String,
    path: String,
}

#[derive(Clone)]
struct ChunkText {
    heading: Option<String>,
    text: String,
    plain_l: String,
    code_heavy: bool,
}

#[derive(Clone)]
struct Scored {
    doc_id: String,
    title: String,
    path: String,
    heading: Option<String>,
    text: String,
    score: f64,
    reason: &'static str,
}

pub fn search(db: &Db, a: SearchArgs) -> ApiResult<Trace> {
    let started = Instant::now();
    let terms = rag_terms(&a.query);

    let (ids, scope) = match &a.scope {
        ScopeArg::Dir { path, title } => (
            vfs::ids_under(db, path)?,
            json!({ "kind": "dir", "path": path, "title": title }),
        ),
        ScopeArg::Doc { id, path, title } => (
            vec![id.clone()],
            json!({ "kind": "doc", "id": id, "path": path, "title": title }),
        ),
    };

    let docs_total = ids.len();
    let id_set: HashSet<String> = ids.iter().cloned().collect();
    let mut metas = db.with(|c| load_meta(c, &ids))?;
    let docs_skipped = metas.iter().filter(|m| !m.has_text).count();

    // 「这个目录讲了什么」这类问题不该拿 bigram 去瞎撞，直接出概览。
    if terms.is_empty() || wants_overview(&a.query) {
        return Ok(fallback(db, metas, scope, a.query, docs_total, docs_skipped, started));
    }

    /* ── 候选：FTS + 摘要/标题 + 可选的语义 ── */

    let mut wanted: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut sem: HashMap<String, f64> = HashMap::new();

    if !a.focus_id.is_empty() {
        push_id(&a.focus_id, &id_set, &mut wanted, &mut seen);
    }

    if let Some(hits) = semantic_scores(db, &a.query) {
        for (id, score) in hits {
            if id_set.contains(&id) {
                sem.insert(id.clone(), score);
                push_id(&id, &id_set, &mut wanted, &mut seen);
            }
        }
    }
    let semantic = !sem.is_empty();

    let lexical = db.with(|c| docs::match_ids_in(c, &terms, &ids, CANDIDATES))?;
    for id in &lexical {
        push_id(id, &id_set, &mut wanted, &mut seen);
    }

    for m in &metas {
        let hay = format!("{} {}", m.title_l, m.summary_l);
        if terms.iter().any(|t| hits(&hay, t) > 0) {
            push_id(&m.id, &id_set, &mut wanted, &mut seen);
        }
    }
    wanted.truncate(CANDIDATES);

    let wanted_set: HashSet<String> = wanted.iter().cloned().collect();
    db.with(|c| fill_md(c, &mut metas, &wanted))?;

    let cand_idx: Vec<usize> = (0..metas.len())
        .filter(|&i| wanted_set.contains(&metas[i].id) && !metas[i].md.is_empty())
        .collect();
    let docs_scanned = cand_idx.len();

    /* ── 词项权重：scope 候选内的 IDF ── */

    let weights: Vec<(String, f64)> = terms
        .iter()
        .map(|t| {
            let df = cand_idx
                .iter()
                .filter(|&&i| mentions(&metas[i], t))
                .count();
            (t.clone(), idf(cand_idx.len(), df))
        })
        .collect();

    /* ── 文档打分 ── */

    let mut docs_scored: Vec<(usize, f64)> = cand_idx
        .iter()
        .map(|&i| {
            let score = doc_score(&metas[i], &weights, &a.focus_id);
            (i, score)
        })
        .collect();

    if semantic {
        let max_lex = docs_scored.iter().map(|(_, s)| *s).fold(0.0, f64::max);
        let (lo, hi) = scope_range(&sem);
        for (i, score) in &mut docs_scored {
            if let Some(v) = sem.get(&metas[*i].id) {
                let n = if hi > lo { (v - lo) / (hi - lo) } else { 1.0 };
                *score += n * (max_lex * SEM_SHARE).max(1.0);
            }
        }
    }

    docs_scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    docs_scored.retain(|(_, s)| *s > 0.0);
    docs_scored.truncate(DOC_POOL);

    let pool_ids: Vec<String> = docs_scored.iter().map(|(i, _)| metas[*i].id.clone()).collect();
    let paths = vfs::paths_of(db, &pool_ids)?;
    for (i, _) in &docs_scored {
        if let Some(p) = paths.get(&metas[*i].id) {
            metas[*i].path = p.clone();
        }
    }
    docs_scored.retain(|(i, _)| !metas[*i].path.is_empty());
    let docs_hit = docs_scored.len();

    let doc_scores: Vec<DocRank> = docs_scored
        .iter()
        .take(8)
        .map(|(i, s)| DocRank {
            id: metas[*i].id.clone(),
            title: metas[*i].title.clone(),
            score: round2(*s),
        })
        .collect();

    /* ── 分块 + 块打分 ── */

    let mut scored: Vec<Scored> = Vec::new();
    for (i, doc_score) in &docs_scored {
        let d = &metas[*i];
        let chunks = chunks_cached(&d.id, d.md_at, &d.md);
        for c in chunks.iter() {
            let (score, reason) = chunk_score(c, d, *doc_score, &weights);
            if score <= 0.0 {
                continue;
            }
            scored.push(Scored {
                doc_id: d.id.clone(),
                title: d.title.clone(),
                path: d.path.clone(),
                heading: c.heading.clone(),
                text: c.text.clone(),
                score,
                reason,
            });
        }
    }
    let chunks_scored = scored.len();
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let picked = pick(scored);
    let (mut picked, chars) = trim(picked);
    picked.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    let chunks: Vec<Chunk> = picked
        .iter()
        .enumerate()
        .map(|(i, c)| Chunk {
            n: i + 1,
            doc_id: c.doc_id.clone(),
            title: c.title.clone(),
            path: c.path.clone(),
            heading: c.heading.clone(),
            text: c.text.clone(),
            anchor: anchor_of(&c.text),
            score: round2(c.score),
            reason: c.reason,
        })
        .collect();
    let used_docs = used_docs(&chunks);

    let empty = if docs_total == 0 {
        Some("no_docs")
    } else if metas.iter().all(|m| !m.has_text) {
        Some("no_projection")
    } else if chunks.is_empty() {
        Some("no_match")
    } else {
        None
    };

    Ok(Trace {
        scope,
        query: a.query,
        terms,
        semantic,
        docs_total,
        docs_scanned,
        docs_hit,
        docs_skipped,
        chunks_scored,
        chars,
        took_ms: started.elapsed().as_millis() as u64,
        chunks,
        used_docs,
        doc_scores,
        empty,
    })
}

/* ─────────────────────────── 无词项：概览 ─────────────────────────── */

fn fallback(
    db: &Db,
    mut metas: Vec<Meta>,
    scope: Value,
    query: String,
    docs_total: usize,
    docs_skipped: usize,
    started: Instant,
) -> Trace {
    let mut order: Vec<usize> = (0..metas.len()).filter(|&i| metas[i].has_text).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(metas[i].updated_at));
    order.truncate(FALLBACK_DOCS);

    let ids: Vec<String> = order.iter().map(|&i| metas[i].id.clone()).collect();
    let _ = db.with(|c| fill_md(c, &mut metas, &ids));
    if let Ok(paths) = vfs::paths_of(db, &ids) {
        for m in metas.iter_mut() {
            if let Some(p) = paths.get(&m.id) {
                m.path = p.clone();
            }
        }
    }

    let mut scored: Vec<Scored> = Vec::new();
    for &i in &order {
        let d = &metas[i];
        if d.path.is_empty() || d.md.is_empty() {
            continue;
        }
        let chunks = chunks_cached(&d.id, d.md_at, &d.md);
        let chosen = chunks
            .iter()
            .find(|c| c.heading.is_some() && c.text.chars().count() >= 40)
            .or_else(|| chunks.first());
        let Some(c) = chosen else { continue };
        scored.push(Scored {
            doc_id: d.id.clone(),
            title: d.title.clone(),
            path: d.path.clone(),
            heading: c.heading.clone(),
            text: c.text.clone(),
            score: 1.0,
            reason: "fallback",
        });
        if scored.len() >= MAX_CHUNKS {
            break;
        }
    }

    let chunks_scored = scored.len();
    let (mut picked, chars) = trim(scored);
    picked.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let chunks: Vec<Chunk> = picked
        .iter()
        .enumerate()
        .map(|(i, c)| Chunk {
            n: i + 1,
            doc_id: c.doc_id.clone(),
            title: c.title.clone(),
            path: c.path.clone(),
            heading: c.heading.clone(),
            text: c.text.clone(),
            anchor: anchor_of(&c.text),
            score: round2(c.score),
            reason: c.reason,
        })
        .collect();
    let used_docs = used_docs(&chunks);
    let doc_scores: Vec<DocRank> = order
        .iter()
        .take(8)
        .filter(|&&i| !metas[i].path.is_empty())
        .map(|&i| DocRank {
            id: metas[i].id.clone(),
            title: metas[i].title.clone(),
            score: 1.0,
        })
        .collect();

    let empty = if docs_total == 0 {
        Some("no_docs")
    } else if metas.iter().all(|m| !m.has_text) {
        Some("no_projection")
    } else if chunks.is_empty() {
        Some("no_match")
    } else {
        None
    };

    Trace {
        scope,
        query,
        terms: Vec::new(),
        semantic: false,
        docs_total,
        docs_scanned: order.len(),
        docs_hit: order.len(),
        docs_skipped,
        chunks_scored,
        chars,
        took_ms: started.elapsed().as_millis() as u64,
        chunks,
        used_docs,
        doc_scores,
        empty,
    }
}

/* ─────────────────────────── 载入 ─────────────────────────── */

fn push_id(id: &str, scope: &HashSet<String>, out: &mut Vec<String>, seen: &mut HashSet<String>) {
    if scope.contains(id) && seen.insert(id.to_string()) {
        out.push(id.to_string());
    }
}

fn load_meta(conn: &Connection, ids: &[String]) -> ApiResult<Vec<Meta>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut out: Vec<Meta> = Vec::new();
    for batch in ids.chunks(400) {
        let marks = marks(batch.len());
        let sql = format!(
            "SELECT d.id, d.title, d.updated_at,
                    COALESCE(s.line, ''), COALESCE(s.para, ''),
                    COALESCE(t.at, 0), (t.doc_id IS NOT NULL)
             FROM documents d
             LEFT JOIN doc_summary s ON s.doc_id = d.id
             LEFT JOIN doc_text t ON t.doc_id = d.id
             WHERE d.deleted_at IS NULL AND d.id IN ({marks})"
        );
        let mut stmt = conn.prepare(&sql).map_err(db_err)?;
        let rows = stmt
            .query_map(params_from_iter(batch.iter()), |r| {
                let title: String = r.get(1)?;
                let summary = format!(
                    "{} {}",
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?
                )
                .trim()
                .to_string();
                Ok(Meta {
                    title_l: title.to_lowercase(),
                    title,
                    id: r.get(0)?,
                    updated_at: r.get(2)?,
                    md_at: r.get(5)?,
                    has_text: r.get(6)?,
                    summary_l: summary.to_lowercase(),
                    md: String::new(),
                    body_l: String::new(),
                    path: String::new(),
                })
            })
            .map_err(db_err)?;
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
    }

    let order: HashMap<&str, usize> =
        ids.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    out.sort_by_key(|d| order.get(d.id.as_str()).copied().unwrap_or(usize::MAX));
    Ok(out)
}

fn fill_md(conn: &Connection, metas: &mut [Meta], ids: &[String]) -> ApiResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    for batch in ids.chunks(400) {
        let marks = marks(batch.len());
        let sql = format!("SELECT doc_id, md FROM doc_text WHERE doc_id IN ({marks})");
        let mut stmt = conn.prepare(&sql).map_err(db_err)?;
        let rows = stmt
            .query_map(params_from_iter(batch.iter()), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(db_err)?;
        for row in rows {
            let (id, md) = row.map_err(db_err)?;
            if let Some(m) = metas.iter_mut().find(|m| m.id == id) {
                m.body_l = md.to_lowercase();
                m.md = md;
            }
        }
    }
    Ok(())
}

fn marks(n: usize) -> String {
    std::iter::repeat_n("?", n).collect::<Vec<_>>().join(",")
}

/* ─────────────────────────── 打分 ─────────────────────────── */

fn doc_score(d: &Meta, weights: &[(String, f64)], focus_id: &str) -> f64 {
    let norm = 1.0 + (d.md.chars().count() as f64 / 1000.0).ln_1p();
    let mut score = 0.0;
    for (t, idf) in weights {
        let title = tf(hits(&d.title_l, t));
        let summary = tf(hits(&d.summary_l, t));
        let body = tf(hits(&d.body_l, t));
        score += idf * (TITLE_BOOST * title + SUMMARY_BOOST * summary + body / norm);
    }
    if !focus_id.is_empty() && focus_id == d.id.as_str() {
        score *= FOCUS_BOOST;
    }
    score
}

fn chunk_score(
    c: &ChunkText,
    d: &Meta,
    doc_score: f64,
    weights: &[(String, f64)],
) -> (f64, &'static str) {
    let head = c.heading.as_deref().unwrap_or("").to_lowercase();
    let mut local = 0.0;
    let mut heading_hits = 0usize;
    let mut body_hits = 0usize;
    for (t, idf) in weights {
        let h = hits(&head, t);
        let b = hits(&c.plain_l, t).min(5);
        heading_hits += h;
        body_hits += b;
        local += idf * (HEADING_BOOST * h as f64 + b as f64);
    }
    if c.code_heavy {
        local *= 0.5;
    }
    let score = local + doc_score * 0.2;
    let reason = if heading_hits > 0 {
        "heading"
    } else if body_hits > 0 {
        "body"
    } else if weights.iter().any(|(t, _)| hits(&d.title_l, t) > 0) {
        "title"
    } else if weights.iter().any(|(t, _)| hits(&d.summary_l, t) > 0) {
        "summary"
    } else {
        "doc"
    };
    (score, reason)
}

fn mentions(d: &Meta, term: &str) -> bool {
    hits(&d.title_l, term) > 0 || hits(&d.summary_l, term) > 0 || hits(&d.body_l, term) > 0
}

/// 英文按词边界计数（`ai` 不该命中 `said`）；中文按子串。
fn hits(text: &str, term: &str) -> usize {
    if term.is_empty() {
        return 0;
    }
    if !term.is_ascii() {
        return text.matches(term).count();
    }
    let mut n = 0usize;
    let mut from = 0usize;
    while let Some(rel) = text[from..].find(term) {
        let start = from + rel;
        let end = start + term.len();
        let left_ok = text[..start].chars().next_back().is_none_or(|c| !c.is_alphanumeric());
        let right_ok = text[end..].chars().next().is_none_or(|c| !c.is_alphanumeric());
        if left_ok && right_ok {
            n += 1;
        }
        from = end.max(start + 1);
    }
    n
}

fn tf(n: usize) -> f64 {
    n as f64 / (1.0 + 0.5 * n as f64)
}

fn idf(n_docs: usize, df: usize) -> f64 {
    (((n_docs + 1) as f64) / ((df + 1) as f64)).ln() + 1.0
}

fn scope_range(sem: &HashMap<String, f64>) -> (f64, f64) {
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for v in sem.values() {
        lo = lo.min(*v);
        hi = hi.max(*v);
    }
    if lo.is_infinite() {
        (0.0, 0.0)
    } else {
        (lo, hi)
    }
}

fn semantic_scores(db: &Db, query: &str) -> Option<HashMap<String, f64>> {
    let on = db
        .with(|c| settings_get(c, K_RERANK))
        .ok()
        .flatten()
        .as_deref()
        == Some("true");
    if !on {
        return None;
    }
    match embed::current_model(db) {
        Ok(Some(_)) => {}
        Ok(None) => return None,
        Err(e) => {
            crate::log::record("rag", &e.message);
            return None;
        }
    }
    match embed::search(db, query, CANDIDATES) {
        Ok(hits) => Some(hits.into_iter().map(|h| (h.owner_id, h.score)).collect()),
        Err(e) => {
            crate::log::record("rag", &format!("向量重排失败，改用词项：{}", e.message));
            None
        }
    }
}

/* ─────────────────────────── 词项 ─────────────────────────── */

fn rag_terms(q: &str) -> Vec<String> {
    docs::query_terms(q)
        .into_iter()
        .filter(|t| !is_stop(t))
        .take(MAX_TERMS)
        .collect()
}

const ZH_STOP: &[&str] = &[
    "怎么", "什么", "哪些", "哪个", "哪几", "如何", "为什", "么样", "这个", "那个", "这些",
    "那些", "这篇", "那篇", "这里", "那里", "里面", "目录", "一下", "一个", "我们", "你们",
    "他们", "她们", "它们", "我的", "你的", "他的", "她的", "它的", "就是", "还是", "以及",
    "或者", "而且", "因为", "所以", "但是", "不过", "如果", "已经", "只是", "这样", "那样",
    "多少", "几个", "有没", "没有", "可以", "能否", "是否", "请问", "帮我", "告诉", "说说",
    "看看", "介绍", "总结", "相关", "关于", "对于", "根据", "其中", "以上", "以下", "之后",
    "之前", "现在", "需要", "应该", "可能", "真的", "其实", "然后", "另外", "同时",
];

const EN_STOP: &[&str] = &[
    "the", "and", "for", "with", "what", "how", "why", "when", "where", "which", "who", "whom",
    "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "a", "an", "of",
    "to", "in", "on", "at", "it", "this", "that", "these", "those", "i", "you", "we", "they",
    "my", "your", "our", "about", "tell", "me", "please", "can", "could", "should", "would",
    "from", "by", "as", "or", "not", "no", "yes", "there", "their", "them", "its", "has",
    "have", "had", "will", "just", "any", "some", "more", "most", "than", "then", "into",
];

fn wants_overview(q: &str) -> bool {
    let lower = q.to_lowercase();
    // 只认「范围本身当主语」的问法：去掉触发词和虚词后几乎不剩内容。
    // 「这个目录里 RAG 相关的笔记」去掉后还剩 rag / 笔记，仍然走检索。
    const HINTS: &[&str] = &[
        "这个目录", "这目录", "这个文件夹", "这个范围", "这些笔记",
        "这里讲了", "这里都讲", "这里有什么", "里面讲了", "目录里讲",
        "这篇讲了", "这篇文章讲", "这篇主要", "这篇文章主要",
        "what is this folder", "what's in this folder", "whats in this folder",
        "what is in this folder", "overview of this folder",
        "summarize this folder", "summarize this directory",
    ];
    for h in HINTS {
        let Some(i) = lower.find(h) else { continue };
        let rest = format!("{}{}", &lower[..i], &lower[i + h.len()..]);
        if strip_fillers(&rest).chars().count() <= 2 {
            return true;
        }
    }
    false
}

fn strip_fillers(s: &str) -> String {
    let mut out = s.to_string();
    for f in [
        "主要", "大概", "简单", "帮我", "一下", "这个", "那个", "这些", "那些", "什么",
        "哪些", "怎么", "如何", "关于", "里面", "内容", "东西", "总结", "介绍", "说说",
        "看看", "讲", "说", "写", "都", "是", "的", "了", "吗", "呢", "吧", "有", "些",
        "里", "请", "啥", "about", "the", "this", "is", "in",
    ] {
        out = out.replace(f, "");
    }
    out.chars().filter(|c| c.is_alphanumeric()).collect()
}

fn is_stop(term: &str) -> bool {
    let mut cs = term.chars();
    let first = cs.next();
    if cs.next().is_none() {
        // 单字只留实词；孤立的「的/了/是」不参与打分。
        return first.is_some_and(|c| "的了是在和与也就都也很这那有个吗呢吧啊着过把被让给对从到会能要不没但而或及等之其上下中里我你他她它".contains(c));
    }
    ZH_STOP.contains(&term) || EN_STOP.contains(&term)
}

/* ─────────────────────────── 选择 ─────────────────────────── */

fn pick(scored: Vec<Scored>) -> Vec<Scored> {
    if scored.is_empty() {
        return scored;
    }
    let floor = scored[0].score * MIN_DOC_SHARE;
    let mut out = fill(&scored, floor);
    if out.len() < 3 && out.len() < scored.len() {
        out = fill(&scored, 0.0);
    }
    out
}

fn fill(scored: &[Scored], floor: f64) -> Vec<Scored> {
    let mut out: Vec<Scored> = Vec::new();
    let mut per_doc: HashMap<String, usize> = HashMap::new();
    let mut used: HashSet<usize> = HashSet::new();

    for (i, c) in scored.iter().enumerate() {
        if out.len() >= MIN_DOCS || out.len() >= MAX_CHUNKS {
            break;
        }
        if c.score < floor {
            break;
        }
        if per_doc.contains_key(&c.doc_id) {
            continue;
        }
        per_doc.insert(c.doc_id.clone(), 1);
        used.insert(i);
        out.push(c.clone());
    }

    for (i, c) in scored.iter().enumerate() {
        if out.len() >= MAX_CHUNKS {
            break;
        }
        if used.contains(&i) {
            continue;
        }
        if c.score < floor {
            break;
        }
        let n = per_doc.get(&c.doc_id).copied().unwrap_or(0);
        if n >= PER_DOC {
            continue;
        }
        if is_dup(&out, c) {
            continue;
        }
        per_doc.insert(c.doc_id.clone(), n + 1);
        out.push(c.clone());
    }
    out
}

fn is_dup(out: &[Scored], c: &Scored) -> bool {
    out.iter().any(|o| {
        if o.doc_id != c.doc_id {
            return false;
        }
        if o.text == c.text {
            return true;
        }
        if o.heading == c.heading && o.text.chars().take(48).eq(c.text.chars().take(48)) {
            return true;
        }
        let long = o.text.chars().count() > 60;
        long && (o.text.contains(&c.text) || c.text.contains(&o.text))
    })
}

fn cost(c: &Scored) -> usize {
    c.text.chars().count()
        + c.title.chars().count()
        + c.path.chars().count()
        + c.heading.as_deref().map_or(0, |h| h.chars().count())
        + CHUNK_META_CHARS
}

fn trim(mut picked: Vec<Scored>) -> (Vec<Scored>, usize) {
    let mut total: usize = picked.iter().map(cost).sum();
    while total > MAX_CHARS && picked.len() > 1 {
        let mut worst = 0usize;
        let mut density = f64::INFINITY;
        for (i, c) in picked.iter().enumerate() {
            let d = c.score / cost(c).max(1) as f64;
            if d < density {
                density = d;
                worst = i;
            }
        }
        total -= cost(&picked[worst]);
        picked.remove(worst);
    }
    (picked, total)
}

fn used_docs(chunks: &[Chunk]) -> Vec<UsedDoc> {
    let mut map: HashMap<&str, UsedDoc> = HashMap::new();
    for c in chunks {
        map.entry(c.doc_id.as_str())
            .and_modify(|d| d.chunks += 1)
            .or_insert_with(|| UsedDoc {
                id: c.doc_id.clone(),
                title: c.title.clone(),
                path: c.path.clone(),
                chunks: 1,
            });
    }
    let mut out: Vec<UsedDoc> = map.into_values().collect();
    out.sort_by(|a, b| b.chunks.cmp(&a.chunks).then_with(|| a.title.cmp(&b.title)));
    out
}

/* ─────────────────────────── 分块 ─────────────────────────── */

type ChunkCache = Mutex<HashMap<String, (i64, Arc<Vec<ChunkText>>)>>;

fn cache() -> &'static ChunkCache {
    static CACHE: OnceLock<ChunkCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn chunks_cached(id: &str, md_at: i64, md: &str) -> Arc<Vec<ChunkText>> {
    let mut map = cache().lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, chunks)) = map.get(id) {
        if *at == md_at {
            return chunks.clone();
        }
    }
    let chunks = Arc::new(chunks_of(md));
    if map.len() >= CACHE_DOCS {
        map.clear();
    }
    map.insert(id.to_string(), (md_at, chunks.clone()));
    chunks
}

/// Markdown → 段落块。每块带上最近的标题路径（`A / B`），单块不超过 `CHUNK_CHARS`。
fn chunks_of(md: &str) -> Vec<ChunkText> {
    let mut paras: Vec<(Option<String>, String)> = Vec::new();
    let mut trail: Vec<(usize, String)> = Vec::new();
    let mut buf: Vec<&str> = Vec::new();
    let mut fence = false;

    let flush = |buf: &mut Vec<&str>, trail: &[(usize, String)], out: &mut Vec<(Option<String>, String)>| {
        let text = buf.join("\n").trim().to_string();
        buf.clear();
        if !text.is_empty() {
            out.push((heading_of(trail), text));
        }
    };

    for line in md.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fence = !fence;
            buf.push(line);
            continue;
        }
        if fence {
            buf.push(line);
            continue;
        }
        if trimmed.is_empty() {
            flush(&mut buf, &trail, &mut paras);
            continue;
        }
        if let Some((level, title)) = heading_line(trimmed) {
            flush(&mut buf, &trail, &mut paras);
            while trail.last().is_some_and(|(l, _)| *l >= level) {
                trail.pop();
            }
            trail.push((level, title));
            continue;
        }
        buf.push(line);
    }
    flush(&mut buf, &trail, &mut paras);

    let mut out: Vec<ChunkText> = Vec::new();
    let mut cur: Option<(Option<String>, String)> = None;
    for (heading, text) in paras {
        let fits = cur.as_ref().is_some_and(|(h, t)| {
            *h == heading && t.chars().count() + 1 + text.chars().count() <= CHUNK_CHARS
        });
        if fits {
            let (_, t) = cur.as_mut().expect("cur 刚判过是 Some");
            t.push('\n');
            t.push_str(&text);
            continue;
        }
        if let Some(done) = cur.take() {
            push_pieces(&mut out, done);
        }
        if text.chars().count() <= CHUNK_CHARS {
            cur = Some((heading, text));
        } else {
            push_pieces(&mut out, (heading, text));
        }
    }
    if let Some(done) = cur {
        push_pieces(&mut out, done);
    }
    out
}

fn push_pieces(out: &mut Vec<ChunkText>, (heading, text): (Option<String>, String)) {
    for piece in split_text(&text, CHUNK_CHARS, CHUNK_OVERLAP) {
        let plain = plain_text(&piece);
        out.push(ChunkText {
            heading: heading.clone(),
            code_heavy: is_code_heavy(&piece),
            plain_l: plain.to_lowercase(),
            text: piece,
        });
    }
}

/// 先按句子切，找不到边界才硬切；下一片带一点重叠。
fn split_text(text: &str, max: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max {
        return vec![text.trim().to_string()];
    }
    let mut out: Vec<String> = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let hard = (start + max).min(chars.len());
        if hard == chars.len() {
            out.push(chars[start..].iter().collect());
            break;
        }
        let floor = start + max * 2 / 3;
        let mut cut = hard;
        let mut i = hard;
        while i > floor {
            if is_boundary(chars[i - 1]) {
                cut = i;
                break;
            }
            i -= 1;
        }
        out.push(chars[start..cut].iter().collect());
        let next = cut.saturating_sub(overlap);
        start = if next <= start { cut } else { next };
    }
    out.into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn is_boundary(c: char) -> bool {
    matches!(c, '\n' | '。' | '！' | '？' | '；' | '.' | '!' | '?' | ';')
}

fn plain_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let s = line.trim();
        if s.starts_with("```") || s.starts_with("~~~") {
            continue;
        }
        let s = strip_images(s);
        let s = strip_links(&s);
        let s = s.replace("**", "").replace("__", "").replace('`', "");
        let s = s.trim_start_matches(|c: char| {
            matches!(c, '#' | '>' | '-' | '*' | '+' | '|' | ' ')
        });
        let digits = s.chars().take_while(|c| c.is_ascii_digit()).count();
        let s = if digits > 0 {
            let rest = &s[digits..];
            rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") ")).unwrap_or(rest)
        } else {
            s
        };
        if !s.is_empty() {
            out.push_str(s);
            out.push('\n');
        }
    }
    out
}

fn is_code_heavy(text: &str) -> bool {
    let mut fence = false;
    let mut code = 0usize;
    let mut all = 0usize;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = !fence;
            continue;
        }
        let n = t.chars().filter(|c| !c.is_whitespace()).count();
        all += n;
        if fence {
            code += n;
        }
    }
    all > 0 && code * 2 > all
}

fn heading_line(line: &str) -> Option<(usize, String)> {
    let level = line.chars().take_while(|c| *c == '#').count();
    if !(1..=6).contains(&level) {
        return None;
    }
    let rest = line[level..].trim_start();
    if rest.is_empty() {
        None
    } else {
        Some((level, rest.to_string()))
    }
}

fn heading_of(trail: &[(usize, String)]) -> Option<String> {
    if trail.is_empty() {
        return None;
    }
    Some(trail.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join(" / "))
}

/* ─────────────────────────── 杂项 ─────────────────────────── */

/// 回原文定位的前缀：取块内**第一条**有意义的行，去掉行首记号、行内强调，压平空白，≤ 32 字。
fn anchor_of(text: &str) -> String {
    for line in text.lines() {
        let mut s = line.trim();
        if s.is_empty() || s.starts_with("```") || s.starts_with("~~~") || s.starts_with("![") {
            continue;
        }
        s = s.trim_start_matches('>').trim_start();
        s = s.trim_start_matches('#').trim_start();
        if let Some(rest) = s
            .strip_prefix("- ")
            .or_else(|| s.strip_prefix("* "))
            .or_else(|| s.strip_prefix("+ "))
        {
            s = rest;
        }
        let digits = s.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits > 0 {
            let rest = &s[digits..];
            if let Some(rest) = rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") ")) {
                s = rest;
            }
        }
        let clean = strip_links(&strip_images(&s.replace("**", "").replace('`', "")));
        let useful = clean
            .chars()
            .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
            .count();
        if useful < 4 {
            continue;
        }
        return clean
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(32)
            .collect();
    }
    flatten_anchor(text)
}

fn flatten_anchor(text: &str) -> String {
    let mut plain: Vec<String> = Vec::new();
    for line in text.lines() {
        let s = line.trim();
        if s.is_empty() || s.starts_with("```") || s.starts_with("~~~") || s.starts_with("![") {
            continue;
        }
        let clean = strip_links(&strip_images(&s.replace("**", "").replace('`', "")));
        if clean.chars().filter(|c| !c.is_whitespace()).count() >= 4 {
            plain.push(clean);
        }
    }
    plain
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(32)
        .collect()
}

fn strip_images(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(open) = rest.find("![") {
        out.push_str(&rest[..open]);
        let tail = &rest[open..];
        if let Some(j) = tail.find("](").map(|j| j + 2) {
            if let Some(end) = tail[j..].find(')').map(|k| j + k + 1) {
                rest = &tail[end..];
                continue;
            }
        }
        out.push_str(tail);
        rest = "";
    }
    out.push_str(rest);
    out
}

/// `[文字](链接)` → `文字`。编辑器里只显示文字，锚点带着链接语法就永远对不上。
fn strip_links(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(open) = rest.find('[') {
        out.push_str(&rest[..open]);
        let tail = &rest[open..];
        if let Some(close) = tail.find(']') {
            let after = &tail[close + 1..];
            if after.starts_with('(') {
                if let Some(end) = after.find(')') {
                    out.push_str(&tail[1..close]);
                    rest = &after[end + 1..];
                    continue;
                }
            }
        }
        out.push_str(tail);
        rest = "";
    }
    out.push_str(rest);
    out
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
