//! MCP 的检索面：`notes_find` / `notes_map` / `notes_related`（D-0191）。

use crate::commands::{ApiError, ApiResult};
use crate::mcp::nav::Nav;
use crate::store::{db_err, docs, links, Db};
use crate::vfs;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

const FIND_LIMIT: usize = 8;
const MAP_LIMIT: usize = 20;
const RELATED_LIMIT: usize = 8;

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct FindArgs {
    pub query: String,
    pub limit: Option<usize>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct MapArgs {
    pub scope: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct RelatedArgs {
    pub id: Option<String>,
    pub limit: Option<usize>,
}

pub fn find(db: &Db, args: &FindArgs) -> ApiResult<String> {
    let q = args.query.trim();
    if q.is_empty() {
        return Err(ApiError::new("bad_args", "query 不能为空"));
    }
    let limit = args.limit.unwrap_or(FIND_LIMIT).clamp(1, 20);
    let pool = limit.saturating_mul(8) as i64;

    let mut hits = db.with(|c| docs::search_any(c, q, pool, false))?;
    if hits.is_empty() {
        hits = db.with(|c| docs::search(c, q, pool, false))?;
    }
    let terms = docs::query_terms(q);
    if hits.is_empty() {
        hits = title_hits(db, q, &terms, pool as usize)?;
    }
    if hits.is_empty() {
        return Ok(format!(
            "没找到「{q}」。可以 notes_cd() 看目录，或换个中/英文关键词。"
        ));
    }

    let parents: HashSet<String> = db.with(|c| {
        Ok(docs::list(c, false)?
            .into_iter()
            .filter_map(|m| m.parent_id)
            .collect())
    })?;
    let ql = q.to_lowercase();
    let mut ranked: Vec<(f64, docs::Hit)> = hits
        .into_iter()
        .map(|h| {
            let title = h.title.to_lowercase();
            let body = strip_marks(&h.body).to_lowercase();
            let mut score = 0.0;
            if title == ql {
                score += 6.0;
            } else if title.contains(&ql) {
                score += 4.0;
            }
            for t in &terms {
                if title.contains(t) {
                    score += 2.0;
                }
                if body.contains(t) {
                    score += 0.5;
                }
            }
            if parents.contains(&h.id) {
                score -= 2.0;
            }
            (score, h)
        })
        .collect();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| b.1.updated_at.cmp(&a.1.updated_at)));
    ranked.truncate(limit);

    let ids: Vec<String> = ranked.iter().map(|(_, h)| h.id.clone()).collect();
    let paths = vfs::paths_of(db, &ids)?;
    let gists: HashMap<String, String> = db
        .with(|c| docs::summary(c, &ids))?
        .into_iter()
        .map(|s| (s.id, s.body))
        .collect();

    let mut out = format!("找到 {} 篇：\n", ranked.len());
    for (i, (_, h)) in ranked.iter().enumerate() {
        out.push_str(&format!(
            "{}. 《{}》 [{}] {}\n",
            i + 1,
            h.title,
            short_id(&h.id),
            vfs::ymd_str(h.updated_at)
        ));
        if let Some(p) = paths.get(&h.id) {
            if p.chars().count() <= 100 {
                out.push_str(&format!("   {p}\n"));
            }
        }
        let gist = gists.get(&h.id).map(|s| clean_text(s, 80)).unwrap_or_default();
        if !gist.is_empty() {
            out.push_str(&format!("   {gist}\n"));
        }
        let snip = clean_text(&h.body, 120);
        if !snip.is_empty() && snip != gist {
            out.push_str(&format!("   …{snip}\n"));
        }
    }
    Ok(clip(out, 1800))
}

fn title_hits(db: &Db, q: &str, terms: &[String], limit: usize) -> ApiResult<Vec<docs::Hit>> {
    let ql = q.to_lowercase();
    let mut out: Vec<docs::Hit> = db
        .with(|c| docs::list(c, false))?
        .into_iter()
        .filter_map(|m| {
            let t = m.title.to_lowercase();
            if t.contains(&ql) || terms.iter().any(|x| t.contains(x)) {
                Some(docs::Hit {
                    id: m.id,
                    title: m.title,
                    parent_id: m.parent_id,
                    updated_at: m.updated_at,
                    body: String::new(),
                })
            } else {
                None
            }
        })
        .collect();
    out.sort_by_key(|b| std::cmp::Reverse(b.updated_at));
    out.truncate(limit);
    Ok(out)
}

/* ─────────────────────────── 地图 ─────────────────────────── */

struct Row {
    id: String,
    title: String,
    head: String,
    updated_at: i64,
    projected: bool,
}

/// 规则词表。顺序就是根地图的顺序；命中数相同取靠前的。
const THEMES: &[(&str, &[&str])] = &[
    (
        "记忆/上下文",
        &["记忆", "上下文", "context", "memory", "压缩", "compaction", "淘汰", "遗忘", "召回"],
    ),
    (
        "RAG/检索",
        &["rag", "检索", "召回", "切块", "chunk", "向量", "embedding", "bm25", "重排", "rerank", "rrf", "知识库"],
    ),
    (
        "Agent/多智能体",
        &["agent", "智能体", "multi-agent", "multi agent", "planner", "react", "loop", "编排", "orchestrat", "工具调用", "tool call", "a2a", "沙箱", "sandbox"],
    ),
    (
        "Prompt/Skill/MCP",
        &["prompt", "提示词", "skill", "mcp", "工具", "function call", "指令", "模板", "system prompt"],
    ),
    (
        "模型/推理/训练",
        &["attention", "transformer", "kv cache", "推理", "训练", "微调", "lora", "moe", "量化", "token", "ttft", "tps", "sampling", "temperature", "top_p", "scaling", "pagedattention", "vllm"],
    ),
    (
        "部署/工程",
        &["部署", "并发", "限流", "docker", "k8s", "性能", "延迟", "缓存", "api", "网关", "服务", "redis", "sqlite", "数据库"],
    ),
    (
        "评测/观测",
        &["评测", "benchmark", "eval", "指标", "trace", "观测", "监控", "测试", "幻觉"],
    ),
    (
        "面试/项目",
        &["面试", "简历", "项目", "自我介绍", "为什么离开", "团队", "经历"],
    ),
    (
        "安全/产品",
        &["安全", "权限", "审计", "产品", "用户", "合规"],
    ),
];

const OTHER: usize = THEMES.len();

pub fn map(db: &Db, args: &MapArgs) -> ApiResult<String> {
    let rows = load_rows(db)?;
    match args.scope.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(root_map(&rows)),
        Some(scope) => drill(db, &rows, scope, args.limit.unwrap_or(MAP_LIMIT).clamp(1, 40)),
    }
}

fn load_rows(db: &Db) -> ApiResult<Vec<Row>> {
    db.with(|c| {
        let mut stmt = c
            .prepare(
                "SELECT d.id, d.title, COALESCE(substr(t.md, 1, 600), ''), d.updated_at,
                        t.md IS NOT NULL
                 FROM documents d LEFT JOIN doc_text t ON t.doc_id = d.id
                 WHERE d.deleted_at IS NULL
                 ORDER BY d.updated_at DESC",
            )
            .map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Row {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    head: r.get(2)?,
                    updated_at: r.get(3)?,
                    projected: r.get(4)?,
                })
            })
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?;
        Ok(rows)
    })
}

fn classify(title: &str, head: &str) -> usize {
    let t = title.to_lowercase();
    let h = head.to_lowercase();
    let mut best = (0usize, OTHER);
    for (i, (_, keys)) in THEMES.iter().enumerate() {
        let mut score = 0usize;
        for k in keys.iter().copied() {
            score += t.matches(k).count() * 3 + h.matches(k).count();
        }
        if score > best.0 {
            best = (score, i);
        }
    }
    best.1
}

fn root_map(rows: &[Row]) -> String {
    let mut buckets: Vec<Vec<usize>> = vec![Vec::new(); THEMES.len() + 1];
    for (i, r) in rows.iter().enumerate() {
        buckets[classify(&r.title, &r.head)].push(i);
    }
    let last = rows.iter().map(|r| r.updated_at).max().unwrap_or(0);
    let mut s = format!("# 笔记库 {} 篇 · 最近更新 {}\n", rows.len(), vfs::ymd_str(last));
    for (i, (name, _)) in THEMES.iter().enumerate() {
        let n = buckets[i].len();
        if n == 0 {
            continue;
        }
        let samples: Vec<String> = buckets[i]
            .iter()
            .take(3)
            .map(|&j| clean_text(&rows[j].title, 36))
            .collect();
        s.push_str(&format!("- {name}（{n}） 例：{}\n", samples.join(" / ")));
    }
    let other = buckets[OTHER].len();
    if other > 0 {
        let samples: Vec<String> = buckets[OTHER]
            .iter()
            .take(3)
            .map(|&j| clean_text(&rows[j].title, 36))
            .collect();
        s.push_str(&format!("- 其他（{other}） 例：{}\n", samples.join(" / ")));
    }
    let unprojected = rows.iter().filter(|r| !r.projected).count();
    if unprojected > 0 {
        s.push_str(&format!("⚠️ {unprojected} 篇还没投影正文，grep/read 看不到\n"));
    }
    s.push_str("\n用 notes_map(\"主题\") 下钻；或 notes_find(\"…\")\n");
    clip(s, 1400)
}

fn drill(db: &Db, rows: &[Row], scope: &str, limit: usize) -> ApiResult<String> {
    let s_lower = scope.to_lowercase();
    let theme = if s_lower == "其他" {
        Some(OTHER)
    } else {
        THEMES.iter().position(|(n, _)| {
            n.to_lowercase() == s_lower || n.to_lowercase().contains(s_lower.as_str())
        })
    };

    let list: Vec<&Row> = if let Some(t) = theme {
        rows.iter().filter(|r| classify(&r.title, &r.head) == t).collect()
    } else {
        let dir = if scope.starts_with('/') {
            vfs::stat(db, scope)?.filter(|e| e.kind == "dir").map(|_| scope.to_string())
        } else {
            vfs::dirs(db)?
                .into_iter()
                .filter(|p| p == "/tree" || p.starts_with("/tree/"))
                .find(|p| p.ends_with(&format!("/{scope}")))
        };
        let Some(dir) = dir else {
            return Err(ApiError::new(
                "not_found",
                format!("没有这个主题/目录：{scope}；先 notes_map()"),
            ));
        };
        let ids: HashSet<String> = vfs::ids_in(db, &dir)?.into_iter().collect();
        rows.iter().filter(|r| ids.contains(&r.id)).collect()
    };

    if list.is_empty() {
        return Ok(format!("{scope} 下没有笔记。"));
    }
    let mut s = format!("# {scope} · {} 篇\n", list.len());
    for (i, r) in list.iter().take(limit).enumerate() {
        s.push_str(&format!(
            "{}. 《{}》 [{}] {}\n",
            i + 1,
            r.title,
            short_id(&r.id),
            vfs::ymd_str(r.updated_at)
        ));
        let gist = clean_text(&r.head, 100);
        if !gist.is_empty() {
            s.push_str(&format!("   {gist}\n"));
        }
    }
    if list.len() > limit {
        s.push_str(&format!("（还有 {} 篇；用 notes_find 缩小）\n", list.len() - limit));
    }
    Ok(clip(s, 1600))
}

/* ─────────────────────────── 关联 ─────────────────────────── */

struct Rel {
    id: String,
    title: String,
    why: String,
}

pub fn related(db: &Db, nav: &Nav, args: &RelatedArgs) -> ApiResult<String> {
    let id = args
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| nav.active_doc.clone())
        .ok_or_else(|| ApiError::new("bad_args", "没有当前文章；先 notes_cd(id) 或传 id"))?;
    let meta = db.with(|c| docs::get(c, &id))?;
    let limit = args.limit.unwrap_or(RELATED_LIMIT).clamp(1, 20);

    let mut seen = HashSet::new();
    seen.insert(id.clone());
    let mut items: Vec<Rel> = Vec::new();

    let edges = db.with(|c| {
        let mut v = links::out_links(c, &id)?;
        v.extend(links::in_links(c, &id)?);
        Ok(v)
    })?;
    for e in edges {
        push(&mut items, &mut seen, e.doc_id, e.title, format!("{}链接", e.kind), limit);
    }

    // 策展人还没被采纳的 link 建议（303 篇有）——只读，不改库。
    let proposals = db
        .with(|c| {
            let mut st = c
                .prepare(
                    "SELECT payload FROM proposal
                     WHERE doc_id = ?1 AND kind = 'link' AND state = 'pending'
                     ORDER BY confidence DESC LIMIT 30",
                )
                .map_err(db_err)?;
            let rows = st
                .query_map([id.as_str()], |r| r.get::<_, String>(0))
                .map_err(db_err)?;
            rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
        })
        .unwrap_or_default();
    for p in proposals {
        let v: Value = serde_json::from_str(&p).unwrap_or(Value::Null);
        let Some(to) = v.get("toId").and_then(Value::as_str) else {
            continue;
        };
        let title = db.with(|c| docs::get(c, to)).map(|m| m.title).unwrap_or_default();
        if title.is_empty() {
            continue;
        }
        let why = v
            .get("relation")
            .and_then(Value::as_str)
            .unwrap_or("AI 推断")
            .to_string();
        push(&mut items, &mut seen, to.to_string(), title, why, limit);
    }

    if items.len() < limit {
        let parents: HashSet<String> = db.with(|c| {
            Ok(docs::list(c, false)?
                .into_iter()
                .filter_map(|m| m.parent_id)
                .collect())
        })?;
        for h in db.with(|c| docs::search_any(c, &meta.title, 20, false))? {
            if items.len() >= limit {
                break;
            }
            if parents.contains(&h.id) {
                continue;
            }
            push(&mut items, &mut seen, h.id, h.title, "标题相近".to_string(), limit);
        }
    }

    if items.is_empty() {
        return Ok(format!("《{}》暂无关联。可以用 notes_find 找相关主题。", meta.title));
    }
    let ids: Vec<String> = items.iter().map(|r| r.id.clone()).collect();
    let paths = vfs::paths_of(db, &ids)?;
    let mut s = format!("《{}》的关联（{} 条）：\n", meta.title, items.len());
    for (i, r) in items.iter().enumerate() {
        s.push_str(&format!(
            "{}. 《{}》 [{}] — {}\n",
            i + 1,
            r.title,
            short_id(&r.id),
            r.why
        ));
        if let Some(p) = paths.get(&r.id) {
            if p.chars().count() <= 100 {
                s.push_str(&format!("   {p}\n"));
            }
        }
    }
    Ok(clip(s, 1600))
}

fn push(
    items: &mut Vec<Rel>,
    seen: &mut HashSet<String>,
    id: String,
    title: String,
    why: String,
    limit: usize,
) {
    if items.len() >= limit || !seen.insert(id.clone()) {
        return;
    }
    items.push(Rel { id, title, why });
}

/* ─────────────────────────── 小工具 ─────────────────────────── */

fn strip_marks(s: &str) -> String {
    s.replace(['\u{2}', '\u{3}'], "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn clean_text(s: &str, max: usize) -> String {
    let t = strip_marks(s);
    let t = t.trim().trim_start_matches(|c: char| {
        c.is_whitespace() || c == '…' || c == '#' || c == '-' || c == '`'
    });
    let mut out: String = t.chars().take(max).collect();
    if t.chars().count() > max {
        out.push('…');
    }
    out
}

fn clip(s: String, max: usize) -> String {
    if s.chars().count() <= max {
        return s;
    }
    let mut out: String = s.chars().take(max).collect();
    out.push_str("\n[truncated]");
    out
}

fn short_id(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}
