//! 有范围的预检索（D-0200，契约见 `docs/ai-rag.md`）。
//!
//! 输入一个 `/tree` 下的目录或单篇，输出**少量**带编号的片段：
//! 先按词打分挑文档，再切块挑段，最后按字符预算收口。
//!
//! ★ 不走向量：范围已经把候选缩到几十篇，词项（`docs::query_terms`）够用；
//!   失败就明确回 `empty`，不假装找到（`docs/vfs.md` 的同一条口径）。
//! ★ 只读 `doc_text`，不解析 PM JSON —— 分块和引用都在 Markdown 投影上做。
//! ★ 一次调用一条 RPC：不打 embedding、不逐篇往返。

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::commands::ApiResult;
use crate::store::docs;
use crate::store::{db_err, Db};
use crate::vfs;

/// 进分块的文档上限。再多的候选也不看 —— 预算和注意力都有限。
const DOC_POOL: usize = 24;
/// 没有词项时（「这目录讲了什么」）按最近改动取几篇。
const FALLBACK_DOCS: usize = 12;
/// 最多给模型几段。
const MAX_CHUNKS: usize = 8;
/// 同一篇最多几段 —— 防止目录里只有一篇长文时把它整篇灌进去。
const PER_DOC: usize = 3;
/// 保证覆盖：有货时至少来自这么多篇。
const MIN_DOCS: usize = 4;
/// 单段给模型看的字数。
const CHUNK_CHARS: usize = 360;
/// 注入上下文的总字数上限（≈ 1.2k tokens）。
const MAX_CHARS: usize = 3600;
/// 合并小段的阈值 / 单段切分上限（按字符）。
const MERGE_AT: usize = 200;
const SPLIT_AT: usize = 700;

#[derive(Deserialize)]
pub struct SearchArgs {
    pub scope: ScopeArg,
    pub query: String,
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
pub struct Trace {
    pub scope: Value,
    pub query: String,
    pub docs_total: usize,
    pub docs_scanned: usize,
    pub docs_hit: usize,
    pub docs_skipped: usize,
    pub chunks_scored: usize,
    pub chars: usize,
    pub took_ms: u64,
    pub chunks: Vec<Chunk>,
    pub used_docs: Vec<UsedDoc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empty: Option<&'static str>,
}

/// 一篇候选的落库正文 + 摘要。
struct Loaded {
    id: String,
    title: String,
    updated_at: i64,
    md: String,
    summary: String,
}

pub fn search(db: &Db, a: SearchArgs) -> ApiResult<Trace> {
    let started = Instant::now();
    let terms = docs::query_terms(&a.query);

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
    let loaded = db.with(|c| load(c, &ids))?;
    let docs_skipped = loaded.iter().filter(|d| d.md.trim().is_empty()).count();
    let docs_scanned = loaded.len();

    let ids_all: Vec<String> = loaded.iter().map(|d| d.id.clone()).collect();
    let paths = vfs::paths_of(db, &ids_all)?;

    // 候选：有词项按分数，没词项按最近改动。
    let pool: Vec<(&Loaded, f64)> = if terms.is_empty() {
        let mut by_time: Vec<&Loaded> = loaded.iter().collect();
        by_time.sort_by_key(|d| std::cmp::Reverse(d.updated_at));
        by_time.into_iter().take(FALLBACK_DOCS).map(|d| (d, 0.0)).collect()
    } else {
        let mut hit: Vec<(&Loaded, f64)> = loaded
            .iter()
            .filter_map(|d| {
                let score = doc_score(d, &terms);
                (score > 0.0).then_some((d, score))
            })
            .collect();
        hit.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        hit.truncate(DOC_POOL);
        hit
    };
    let docs_hit = pool.len();

    let mut scored: Vec<Scored> = Vec::new();
    for &(doc, doc_score) in &pool {
        let path = paths.get(&doc.id).cloned().unwrap_or_default();
        if path.is_empty() {
            continue;
        }
        for (text, heading) in chunks_of(&doc.md) {
            let (score, reason) = chunk_score(&text, heading.as_deref(), doc, doc_score, &terms);
            if score <= 0.0 {
                continue;
            }
            scored.push(Scored {
                doc_id: doc.id.clone(),
                title: doc.title.clone(),
                path: path.clone(),
                heading,
                text,
                score,
                reason,
            });
        }
    }
    let chunks_scored = scored.len();

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // 预算：从最低分开始砍，砍到装得下。
    let mut picked = pick(&scored, &terms);
    let mut chars: usize = picked.iter().map(|c| c.text.chars().count()).sum();
    while chars > MAX_CHARS && picked.len() > 1 {
        if let Some(last) = picked.pop() {
            chars -= last.text.chars().count();
        }
    }

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

    let empty = if docs_total == 0 || loaded.is_empty() {
        Some("no_docs")
    } else if chunks.is_empty() && docs_skipped == loaded.len() {
        Some("no_projection")
    } else if chunks.is_empty() && !terms.is_empty() {
        Some("no_match")
    } else {
        None
    };

    Ok(Trace {
        scope,
        query: a.query,
        docs_total,
        docs_scanned,
        docs_hit,
        docs_skipped,
        chunks_scored,
        chars: chunks.iter().map(|c| c.text.chars().count()).sum(),
        took_ms: started.elapsed().as_millis() as u64,
        chunks,
        used_docs,
        empty,
    })
}

/* ─────────────────────────── 载入 ─────────────────────────── */

/// 一批 id 的标题 / 正文 / 摘要。`IN` 按 400 个一批 —— SQLite 的参数上限。
fn load(conn: &Connection, ids: &[String]) -> ApiResult<Vec<Loaded>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut out: Vec<Loaded> = Vec::new();
    for batch in ids.chunks(400) {
        let marks = std::iter::repeat_n("?", batch.len()).collect::<Vec<_>>().join(",");
        let mut stmt = conn
            .prepare(&format!(
                "SELECT d.id, d.title, d.updated_at, COALESCE(t.md, '')
                 FROM documents d LEFT JOIN doc_text t ON t.doc_id = d.id
                 WHERE d.deleted_at IS NULL AND d.id IN ({marks})"
            ))
            .map_err(db_err)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(batch.iter()), |r| {
                Ok(Loaded {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    updated_at: r.get(2)?,
                    md: r.get(3)?,
                    summary: String::new(),
                })
            })
            .map_err(db_err)?;
        for row in rows {
            out.push(row.map_err(db_err)?);
        }
    }

    // 摘要单独一条查询：表可能还没建（MCP 只读旧库）—— 拿不到就当空。
    let mut summaries: HashMap<String, String> = HashMap::new();
    for batch in ids.chunks(400) {
        let marks = std::iter::repeat_n("?", batch.len()).collect::<Vec<_>>().join(",");
        let Ok(mut stmt) = conn.prepare(&format!(
            "SELECT doc_id, line, para FROM doc_summary WHERE doc_id IN ({marks})"
        )) else {
            break;
        };
        let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(batch.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        }) else {
            break;
        };
        for row in rows.flatten() {
            let (id, line, para) = row;
            summaries.insert(id, format!("{line} {para}"));
        }
    }
    for d in &mut out {
        if let Some(s) = summaries.get(&d.id) {
            d.summary = s.clone();
        }
    }

    // 保持调用方给的顺序（目录树顺序），别让 IN 的返回顺序把选择搞乱。
    let order: HashMap<&str, usize> =
        ids.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    out.sort_by_key(|d| order.get(d.id.as_str()).copied().unwrap_or(usize::MAX));
    Ok(out)
}

/* ─────────────────────────── 打分 ─────────────────────────── */

fn doc_score(d: &Loaded, terms: &[String]) -> f64 {
    let title = d.title.to_lowercase();
    let body = d.md.to_lowercase();
    let summary = d.summary.to_lowercase();
    let mut score = 0.0;
    for t in terms {
        score += (title.matches(t).count() * 4) as f64;
        score += (summary.matches(t).count() * 2) as f64;
        score += body.matches(t).count() as f64;
    }
    score
}

struct Scored {
    doc_id: String,
    title: String,
    path: String,
    heading: Option<String>,
    text: String,
    score: f64,
    reason: &'static str,
}

fn chunk_score(
    text: &str,
    heading: Option<&str>,
    doc: &Loaded,
    doc_score: f64,
    terms: &[String],
) -> (f64, &'static str) {
    if terms.is_empty() {
        return (1.0, "fallback");
    }
    let head = heading.unwrap_or("").to_lowercase();
    let body = text.to_lowercase();
    let mut heading_hits = 0usize;
    let mut body_hits = 0usize;
    for t in terms {
        heading_hits += head.matches(t).count();
        body_hits += body.matches(t).count().min(5);
    }
    let score = (heading_hits * 3) as f64 + body_hits as f64 + doc_score * 0.2;
    let reason = if heading_hits > 0 {
        "heading"
    } else if body_hits > 0 {
        "body"
    } else if doc.title.to_lowercase().contains(terms.first().map(String::as_str).unwrap_or("")) {
        "title"
    } else if !doc.summary.is_empty() {
        "summary"
    } else {
        "body"
    };
    (score, reason)
}

/// 先保证覆盖（每个不同文档各取最好的），再按分数补到 `MAX_CHUNKS`。
fn pick(scored: &[Scored], terms: &[String]) -> Vec<Scored> {
    let mut out: Vec<Scored> = Vec::new();
    let mut per_doc: HashMap<String, usize> = HashMap::new();
    let mut used: HashSet<(String, usize)> = HashSet::new();

    // 第一遍：不同文档各一段，至少 MIN_DOCS 篇。
    let want_docs = if terms.is_empty() { 0 } else { MIN_DOCS };
    for (i, c) in scored.iter().enumerate() {
        if out.len() >= MAX_CHUNKS || per_doc.len() >= want_docs {
            break;
        }
        if per_doc.contains_key(&c.doc_id) {
            continue;
        }
        per_doc.insert(c.doc_id.clone(), 1);
        used.insert((c.doc_id.clone(), i));
        out.push(clone_chunk(c));
    }

    // 第二遍：按分数补满，同一篇仍不超过 PER_DOC。
    for (i, c) in scored.iter().enumerate() {
        if out.len() >= MAX_CHUNKS {
            break;
        }
        if used.contains(&(c.doc_id.clone(), i)) {
            continue;
        }
        let n = per_doc.get(&c.doc_id).copied().unwrap_or(0);
        if n >= PER_DOC {
            continue;
        }
        per_doc.insert(c.doc_id.clone(), n + 1);
        out.push(clone_chunk(c));
    }

    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    out
}

fn clone_chunk(c: &Scored) -> Scored {
    Scored {
        doc_id: c.doc_id.clone(),
        title: c.title.clone(),
        path: c.path.clone(),
        heading: c.heading.clone(),
        text: c.text.clone(),
        score: c.score,
        reason: c.reason,
    }
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

/// Markdown → 段落块。每块带上最近的标题路径（`A / B`）。
fn chunks_of(md: &str) -> Vec<(String, Option<String>)> {
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

    // 合并小段，按标题边界；单段过长的切开。
    let mut out: Vec<(Option<String>, String)> = Vec::new();
    let mut cur: Option<(Option<String>, String)> = None;
    for (heading, text) in paras {
        let same = cur.as_ref().is_some_and(|(h, _)| *h == heading);
        let fits = cur
            .as_ref()
            .is_some_and(|(_, t)| t.chars().count() + 1 + text.chars().count() <= SPLIT_AT);
        if !same || !fits {
            if let Some(done) = cur.take() {
                out.push(done);
            }
            cur = Some((heading, text));
            continue;
        }
        let (_, t) = cur.as_mut().expect("cur 刚判过是 Some");
        t.push('\n');
        t.push_str(&text);
        if t.chars().count() >= MERGE_AT {
            // 够长了就收 —— 下一段另起，别把两节黏在一起。
            if let Some(done) = cur.take() {
                out.push(done);
            }
        }
    }
    if let Some(done) = cur {
        out.push(done);
    }

    out.into_iter()
        .flat_map(|(heading, text)| split_long(heading, text))
        .map(|(h, t)| (cap(&t, CHUNK_CHARS), h))
        .collect()
}

/// 单段超过 `SPLIT_AT` 就按字符切；标题只在第一片保留。
fn split_long(heading: Option<String>, text: String) -> Vec<(Option<String>, String)> {
    if text.chars().count() <= SPLIT_AT {
        return vec![(heading, text)];
    }
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut n = 0usize;
    for c in text.chars() {
        if n >= SPLIT_AT {
            out.push((
                if out.is_empty() { heading.clone() } else { None },
                std::mem::take(&mut cur),
            ));
            n = 0;
        }
        cur.push(c);
        n += 1;
    }
    if !cur.is_empty() {
        out.push((if out.is_empty() { heading } else { None }, cur));
    }
    out
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

/// 回原文定位的前缀：去掉行首记号、行内强调，压平空白，取前 32 字。
fn anchor_of(text: &str) -> String {
    let mut plain: Vec<String> = Vec::new();
    for line in text.lines() {
        let mut s = line.trim();
        // 围栏 / 分隔线在原文里不是一段可定位的字。
        if s.is_empty() || s.starts_with("```") || s.starts_with("~~~") || s.starts_with("![") {
            continue;
        }
        // 行首标记：标题 / 引用 / 列表 / 有序列表
        s = s.trim_start_matches('>').trim_start();
        s = s.trim_start_matches('#').trim_start();
        if let Some(rest) = s.strip_prefix("- ").or_else(|| s.strip_prefix("* ")).or_else(|| s.strip_prefix("+ ")) {
            s = rest;
        }
        let digits = s.chars().take_while(|c| c.is_ascii_digit()).count();
        if digits > 0 {
            let rest = &s[digits..];
            if let Some(rest) = rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") ")) {
                s = rest;
            }
        }
        let clean = strip_links(&s.replace("**", "").replace('`', ""));
        // 太短的行（`---` / 单个词）在原文里找不准 —— 往下取下一行。
        let useful = clean
            .chars()
            .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
            .count();
        if useful < 4 {
            continue;
        }
        plain.push(clean);
        if plain.iter().map(|p| p.chars().count()).sum::<usize>() >= 32 {
            break;
        }
    }
    plain.join(" ").split_whitespace().collect::<Vec<_>>().join(" ").chars().take(32).collect()
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

fn cap(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
