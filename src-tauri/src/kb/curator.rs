//! 策展人（D-0181 / D-0182）：后台自动整理 —— 打标签、归类、找关联。
//!
//! ★ **拉模式，不是事件驱动**：一个后台线程每 `TICK` 秒醒一次，问「哪些笔记的正文
//!   hash 跟上次跑的对不上」（`store::kb::run_stale`），每 tick 最多跑 `BATCH` 篇。
//!   这样天然 debounce、天然限流、重启不丢、不用给 `doc:apply` 挂事件。
//! ★ **置信度分流不用 LLM 自报的数**（D-0185）：判据是规则 —— 命中已有词表且正文出现
//!   ≥2 次就直接落库，新造的进建议收件箱。
//! ★ 这条**修订了 D-0042 §11**「AI 不自动后台跑」。授权：用户 2026-10-20。



use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::ai;
use crate::backup::http;
use crate::commands::{ApiError, ApiResult};
use crate::kb::embed;
use crate::store::kb::{self, NewProposal, Tag};
use crate::store::{self, Db};

/// 两次扫描之间隔多久。
pub const TICK_SECS: u64 = 30;
/// 每 tick 最多整理几篇 —— 别把用户的 endpoint 打爆。
pub const BATCH: usize = 3;

/// 总开关（`meta.kb.curator`）。读不到 = 开（D-0181：用户要「自动」）。
const K_ENABLED: &str = "kb.curator";

/// 喂给模型的正文上限。开头那段最能代表这篇在讲什么，超了砍尾。
const MAX_TEXT: usize = 12000;
/// FTS 找几个候选邻居喂给模型。
const NEIGHBORS: usize = 8;
/// 词表塞进 prompt 的上限 —— 太多会把 prompt 撑爆，也稀释了「优先复用」的引导。
const VOCAB_CAP: usize = 80;
/// 合并建议的标签上限：O(n²) 在几千个标签上会卡，先截断。
const MERGE_CAP: usize = 400;
/// 一次最多提几条合并建议。
const MERGE_PAIRS_MAX: usize = 200;

/// 输出格式写死成 JSON。**切不出来也不能空手而归**（见 `extract_json` 的容错）。
const PROMPT: &str = "你是笔记整理助手。读下面这篇笔记，只回**一个 JSON 对象**，别的什么都不要写：\n\
{\n\
  \"tags\": [\"标签1\", \"标签2\"],\n\
  \"topics\": [\"技术/数据库/SQLite\"],\n\
  \"links\": [{\"toId\": \"候选邻居的 id\", \"relation\": \"为什么相关\"}],\n\
  \"entities\": [{\"name\": \"名字\", \"kind\": \"concept\"}]\n\
}\n\
规则：\n\
- tags：3 到 8 个主题标签。**优先从「现有标签」里选**（原样照抄名字）；确实没有合适的才造新标签。\n\
- topics：0 到 3 个分类路径，用斜杠分层（如 技术/数据库/SQLite）。\n\
- links：toId **只能**从「候选邻居」里挑，不许自己编 id；没有就给空数组。\n\
- entities：最多 8 个，kind 只能是 person / org / place / work / event / concept。\n\
只回 JSON，不要解释、不要 markdown 代码块。";

/* ─────────────────────────── 调度（D-0182） ─────────────────────────── */

/// 起后台线程。**app 启动时调一次**；没配 AI endpoint 时线程空转不干活。
pub fn spawn(db: Arc<Db>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(TICK_SECS));
        if !enabled(&db) || !configured(&db) {
            continue;
        }
        // 一篇一篇跑，出错只记日志、下一 tick 再来（run_one 自己会 run_put 记 hash，
        // 所以同一篇不会因为一次失败被无限重试）。
        if let Err(e) = run_all(&db, BATCH) {
            crate::log::record("kb", &format!("策展轮次出错：{}", e.message));
        }
    });
}

/// 总开关。读不到 / 空 = 开；只有明确的关闭写法才算关。
fn enabled(db: &Db) -> bool {
    match db.with(|c| store::settings_get(c, K_ENABLED)) {
        Ok(Some(v)) => !matches!(v.trim().to_ascii_lowercase().as_str(), "0" | "false" | "off" | "no"),
        _ => true,
    }
}

/// 没配 endpoint 就整轮跳过，不报错、不重试（D-0181）。
fn configured(db: &Db) -> bool {
    db.with(ai::load_config).map(|c| !c.base_url.is_empty() && !c.model.is_empty()).unwrap_or(false)
}

/* ─────────────────────────── 跑一篇 / 跑一轮 ─────────────────────────── */

/// 一次整理的结果。`applied` 和 `proposals` **分开算** —— 收件箱头部要显示
/// 「直接给你打上了 N 个标签、另有 M 条等你确认」，混成一个数就看不出来了。
#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub ran: usize,
    pub applied: usize,
    pub proposals: usize,
}

impl Outcome {
    fn merge(&mut self, other: Outcome) {
        self.ran += other.ran;
        self.applied += other.applied;
        self.proposals += other.proposals;
    }
}

/// 手动跑一篇。
pub fn run_one(db: &Db, doc_id: &str) -> ApiResult<Outcome> {
    let md = db.with(|c| store::docs::text(c, doc_id))?;
    if md.trim().is_empty() {
        // 没正文可喂 —— 记空 hash，别让 run_stale 反复挑到它（它本来就跳空 md）。
        db.with(|c| kb::run_put(c, doc_id, "", "skip", "空正文"))?;
        return Ok(Outcome::default());
    }
    let hash = kb::content_hash(&md);

    let cfg = db.with(ai::load_config)?;
    if cfg.base_url.is_empty() || cfg.model.is_empty() {
        return Err(ApiError::new("ai_not_configured", "还没配 AI endpoint —— 策展人跑不了"));
    }

    match run_once(db, doc_id, &md, &cfg) {
        Ok((applied, proposals)) => {
            db.with(|c| {
                kb::run_put(c, doc_id, &hash, "ok", &format!("落库 {applied} · 建议 {proposals}"))
            })?;
            Ok(Outcome { ran: 1, applied, proposals })
        }
        Err(e) => {
            crate::log::record("kb", &format!("策展 {doc_id}：{}", e.message));
            // ★ 出错也要 run_put：记下当前 hash，这篇才不会被每 tick 重试。
            db.with(|c| kb::run_put(c, doc_id, &hash, "error", &e.message))?;
            Err(e)
        }
    }
}

/// 手动跑一轮（`kb:curate` 不带 docId 时走这条）。
pub fn run_all(db: &Db, limit: usize) -> ApiResult<Outcome> {
    // 词表自愈：导入的笔记 / 绕过 `set_tags` 的写入路径，标签可能还没进词表。
    if let Err(e) = db.with(kb::sync_vocab_from_docs) {
        crate::log::record("kb", &format!("同步标签词表失败：{}", e.message));
    }
    let ids = db.with(|c| kb::run_stale(c, limit))?;
    let mut out = Outcome::default();
    for id in ids {
        // run_one 内部已经把错误落 errors.log 并 run_put，这里不重复记。
        match run_one(db, &id) {
            Ok(o) => out.merge(o),
            Err(_) => out.ran += 1,
        }
    }
    Ok(out)
}

/// 单篇的活：组 prompt → HTTP（不持库锁）→ 解析 → 落库。返回 `(直接落库, 进收件箱)`。
fn run_once(db: &Db, doc_id: &str, md: &str, cfg: &ai::Config) -> ApiResult<(usize, usize)> {
    let ctx = db.with(|c| context(c, doc_id, md))?;
    let user = build_user(&ctx, md);
    let content = call_model(cfg, PROMPT, &user)?;
    let v = extract_json(&content)
        .ok_or_else(|| ApiError::new("kb_shape", format!("模型没回 JSON：{}", clip_msg(&content))))?;
    let s = parse_suggestion(&v);
    db.with(|c| apply(c, doc_id, md, &ctx, &s))
}

/// 组 prompt 要的三样：标题、现有标签词表、FTS 找出的候选邻居。
struct Ctx {
    title: String,
    vocab: Vec<Tag>,
    neighbors: Vec<(String, String)>,
}

fn context(conn: &Connection, doc_id: &str, md: &str) -> ApiResult<Ctx> {
    let title: String = conn
        .query_row("SELECT title FROM documents WHERE id = ?1", [doc_id], |r| r.get(0))
        .optional()
        .map_err(store::db_err)?
        .unwrap_or_default();
    let vocab = kb::tag_list(conn)?;
    // FTS 查询串用标题（没有就取正文开头）—— 标题最能代表这篇在讲什么。
    let q = if title.trim().is_empty() { md.chars().take(24).collect::<String>() } else { title.clone() };
    // OR 找，不是 AND —— 见 `search_any` 的注释（AND 会让候选永远是空的，links 整条路死掉）。
    let hits = store::docs::search_any(conn, &q, (NEIGHBORS + 4) as i64, false)?;
    let neighbors = hits
        .into_iter()
        .filter(|h| h.id != doc_id)
        .take(NEIGHBORS)
        .map(|h| (h.id, h.title))
        .collect();
    Ok(Ctx { title, vocab, neighbors })
}

fn build_user(ctx: &Ctx, md: &str) -> String {
    let mut s = String::new();
    if !ctx.title.trim().is_empty() {
        s.push_str("标题：");
        s.push_str(ctx.title.trim());
        s.push_str("\n\n");
    }
    s.push_str("现有标签（优先复用）：\n");
    if ctx.vocab.is_empty() {
        s.push_str("（还没有）\n");
    } else {
        let names: Vec<&str> = ctx.vocab.iter().take(VOCAB_CAP).map(|t| t.name.as_str()).collect();
        s.push_str(&names.join("、"));
        s.push('\n');
    }
    s.push_str("\n候选邻居（links.toId 只能从这里选）：\n");
    if ctx.neighbors.is_empty() {
        s.push_str("（没有）\n");
    } else {
        for (id, t) in &ctx.neighbors {
            s.push_str(&format!("- {id}：{}\n", t.trim()));
        }
    }
    s.push_str("\n正文：\n");
    s.push_str(&clip(md));
    s
}

/// 发一次非流式问答（照 `ai::summarize` 的整套套路，但不持库锁）。
fn call_model(cfg: &ai::Config, system: &str, user: &str) -> ApiResult<String> {
    let payload = json!({
        "model": cfg.model,
        "stream": false,
        // 整理要稳：同一篇两遍的标签不该差太多。
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
    });

    let mut headers = vec![
        ("Authorization".to_string(), format!("Bearer {}", cfg.api_key)),
        ("Content-Type".to_string(), "application/json".to_string()),
    ];
    headers.extend(ai::gateway_headers(&cfg.base_url));
    let resp = http::send(
        "POST",
        cfg.base_url.trim_end_matches('/'),
        &headers,
        Some(payload.to_string().into_bytes()),
    )
    .map_err(|e| ApiError::new("kb_http", e))?;

    let raw = String::from_utf8_lossy(&resp.body).into_owned();
    if !(200..300).contains(&resp.status) {
        return Err(ApiError::new("kb_http", format!("HTTP {} — {}", resp.status, clip_msg(&raw))));
    }
    pick_content(&raw)
}

/* ─────────────────────────── 解析与落库 ─────────────────────────── */

#[derive(Default)]
struct Suggestion {
    tags: Vec<String>,
    topics: Vec<String>,
    links: Vec<Link>,
    entities: Vec<Ent>,
}

struct Link {
    to_id: String,
    relation: String,
}

struct Ent {
    name: String,
    kind: String,
}

/// 容错解析：剥 ``` 围栏、取第一个 `{` 到最后一个 `}`。
fn extract_json(raw: &str) -> Option<Value> {
    let cleaned = raw.replace("```json", " ").replace("```", " ");
    let start = cleaned.find('{')?;
    let end = cleaned.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str(&cleaned[start..=end]).ok()
}

fn parse_suggestion(v: &Value) -> Suggestion {
    Suggestion {
        tags: str_list(v.get("tags")),
        topics: str_list(v.get("topics")),
        links: v
            .get("links")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|x| {
                        let to_id = x
                            .get("toId")
                            .or_else(|| x.get("to_id"))
                            .and_then(Value::as_str)?
                            .to_string();
                        let relation = x.get("relation").and_then(Value::as_str).unwrap_or("").to_string();
                        Some(Link { to_id, relation })
                    })
                    .collect()
            })
            .unwrap_or_default(),
        entities: v
            .get("entities")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|x| {
                        let name = x.get("name").and_then(Value::as_str)?.to_string();
                        let kind = x.get("kind").and_then(Value::as_str).unwrap_or("").to_string();
                        Some(Ent { name, kind })
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn str_list(v: Option<&Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let items: Vec<&str> = match v {
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect(),
        // 单个字符串也认（模型偶尔不按数组回）。
        Some(Value::String(s)) => vec![s.as_str()],
        _ => Vec::new(),
    };
    for s in items {
        let s = s.trim();
        if !s.is_empty() && !out.iter().any(|o| o == s) {
            out.push(s.to_string());
        }
    }
    out
}

/// 置信度分流（D-0185）—— 判据是**本地规则**，不是模型自报的数。
/// 返回 `(直接落库, 进收件箱)` —— 两个分开，别混成一个数。
fn apply(
    conn: &Connection,
    doc_id: &str,
    md: &str,
    ctx: &Ctx,
    s: &Suggestion,
) -> ApiResult<(usize, usize)> {
    let md_l = md.to_lowercase();
    let mut applied = 0usize;
    let mut proposals = 0usize;

    // 词表查找：小写名 / 别名 -> 规范名。
    let mut lookup: HashMap<String, String> = HashMap::new();
    for t in &ctx.vocab {
        lookup.entry(t.name.to_lowercase()).or_insert_with(|| t.name.clone());
        for a in &t.aliases {
            lookup.entry(a.to_lowercase()).or_insert_with(|| t.name.clone());
        }
    }

    let mut direct: Vec<String> = Vec::new();
    for cand in &s.tags {
        let cand = cand.trim();
        if cand.is_empty() {
            continue;
        }
        match lookup.get(&cand.to_lowercase()) {
            // 命中词表 **且** 正文出现 ≥2 次 → 直接落库（两条都在本地算）。
            Some(canon) => {
                let hit = count_in(&md_l, cand) >= 2 || count_in(&md_l, canon) >= 2;
                if hit && !direct.iter().any(|d| d == canon) {
                    direct.push(canon.clone());
                }
                // 已知标签但出现太少 —— 不值得打扰用户，丢。
            }
            // 新造的标签 → 收件箱。
            None => {
                if propose(conn, doc_id, "tag", json!({ "name": cand }), 0.5, "新标签", "llm")? {
                    proposals += 1;
                }
            }
        }
    }
    if !direct.is_empty() {
        let mut tags = store::docs::get(conn, doc_id)?.tags;
        let before = tags.len();
        for d in direct {
            if !tags.iter().any(|t| t == &d) {
                tags.push(d);
            }
        }
        if tags.len() != before {
            store::docs::set_tags(conn, doc_id, &tags)?;
            applied += tags.len() - before;
        }
    }

    for t in &s.topics {
        let t = t.trim();
        if t.is_empty() {
            continue;
        }
        if propose(conn, doc_id, "topic", json!({ "name": t }), 0.5, "AI 归的类", "llm")? {
            proposals += 1;
        }
    }

    for l in &s.links {
        // toId 只认候选邻居里的 —— 别让模型编 id。
        if l.to_id.is_empty() || l.to_id == doc_id || !ctx.neighbors.iter().any(|(id, _)| id == &l.to_id) {
            continue;
        }
        let payload = json!({ "toId": l.to_id, "relation": l.relation });
        if propose(conn, doc_id, "link", payload, 0.5, "AI 推断的关联", "llm")? {
            proposals += 1;
        }
    }

    for e in &s.entities {
        let name = e.name.trim();
        if name.is_empty() {
            continue;
        }
        let payload = json!({ "name": name, "kind": entity_kind(&e.kind) });
        if propose(conn, doc_id, "entity", payload, 0.5, "AI 提到的实体", "llm")? {
            proposals += 1;
        }
    }

    Ok((applied, proposals))
}

/// 写一条建议，pending 里已有的不重复提。返回是否真的新增。
fn propose(
    conn: &Connection,
    doc_id: &str,
    kind: &str,
    payload: Value,
    confidence: f64,
    reason: &str,
    origin: &str,
) -> ApiResult<bool> {
    let key = dedup_key(&payload);
    if key.is_empty() || kb::proposal_pending_has(conn, doc_id, kind, &key)? {
        return Ok(false);
    }
    kb::proposal_add(
        conn,
        &NewProposal {
            doc_id: doc_id.to_string(),
            kind: kind.to_string(),
            payload,
            confidence,
            reason: reason.to_string(),
            origin: origin.to_string(),
        },
    )?;
    Ok(true)
}

/// 去重键：payload 里那个能唯一标识这条建议的字段（名字 / toId）。
fn dedup_key(payload: &Value) -> String {
    payload
        .get("name")
        .or_else(|| payload.get("toId"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn entity_kind(k: &str) -> &'static str {
    match k.trim().to_ascii_lowercase().as_str() {
        "person" => "person",
        "org" => "org",
        "place" => "place",
        "work" => "work",
        "event" => "event",
        _ => "concept",
    }
}

/* ─────────────────────────── 词表合并（防标签爆炸） ─────────────────────────── */

/// 标签词表的**合并任务**：对所有 tag 名 + desc 做 embedding 聚类，
/// 距离 < 阈值的提出合并建议（kind='merge'）进收件箱。这是防标签爆炸的关键一环。
pub fn suggest_merges(db: &Db, threshold: f32) -> ApiResult<usize> {
    // 没配 embedding 模型就整层降级 —— 不是错误（D-0184）。
    let Some(model) = embed::current_model(db)? else {
        return Ok(0);
    };
    let tags = db.with(kb::tag_list)?;
    if tags.len() < 2 {
        return Ok(0);
    }
    let tags: Vec<Tag> = tags.into_iter().take(MERGE_CAP).collect();
    let texts: Vec<String> = tags.iter().map(|t| joined(&[&t.name, &t.desc])).collect();

    let vecs = match embed::embed_texts(db, &model, &texts) {
        Ok(v) => v,
        Err(e) => {
            // 没配 endpoint / 网关回错 —— 记一行，然后优雅降级（别把调用方拖挂）。
            crate::log::record("kb", &format!("合并建议：embedding 降级：{}", e.message));
            return Ok(0);
        }
    };
    if vecs.len() != tags.len() {
        return Ok(0);
    }

    let mut n = 0usize;
    'outer: for i in 0..tags.len() {
        for j in (i + 1)..tags.len() {
            let sim = cosine(&vecs[i], &vecs[j]);
            if sim <= threshold as f64 {
                continue;
            }
            // 短的当 into（更像伞形词）；一样长取字典序小的那个，保证确定性。
            let (into, from) = pick_direction(&tags[i].name, &tags[j].name);
            let added = db.with(|c| {
                if kb::proposal_pending_has(c, "", "merge", &from)? {
                    return Ok(false);
                }
                kb::proposal_add(
                    c,
                    &NewProposal {
                        doc_id: String::new(),
                        kind: "merge".into(),
                        payload: json!({ "from": [from.clone()], "into": into.clone() }),
                        confidence: sim,
                        reason: format!("语义相近（{sim:.2}）"),
                        origin: "rule".into(),
                    },
                )?;
                Ok(true)
            })?;
            if added {
                n += 1;
                if n >= MERGE_PAIRS_MAX {
                    break 'outer;
                }
            }
        }
    }
    Ok(n)
}

fn pick_direction(a: &str, b: &str) -> (String, String) {
    let (short, long) = if a.chars().count() <= b.chars().count() { (a, b) } else { (b, a) };
    (short.to_string(), long.to_string())
}

fn cosine(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() {
        return 0.0;
    }
    let (mut dot, mut na, mut nb) = (0f64, 0f64, 0f64);
    for (x, y) in a.iter().zip(b) {
        let (x, y) = (*x as f64, *y as f64);
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

/* ─────────────────────────── 采纳 / 拒绝 ─────────────────────────── */

/// `suggest_merges` 的默认相似度阈值 —— 标签向量的余弦超过它才提合并。
pub const MERGE_THRESHOLD: f32 = 0.85;

/// 采纳一条建议：**按 kind 把它变成真数据**，再置 `accepted`。
/// 以前只改 proposal 状态 —— 采纳之后库里什么都没变（断链）。
pub fn accept(db: &Db, id: i64) -> ApiResult<()> {
    db.with(|c| {
        let p = proposal_get(c, id)?
            .ok_or_else(|| ApiError::new("not_found", format!("没有这条建议：{id}")))?;
        let payload: Value = serde_json::from_str(&p.payload)
            .map_err(|e| ApiError::new("kb", format!("建议 {id} 的 payload 不是 JSON：{e}")))?;
        apply_proposal(c, &p.doc_id, &p.kind, &payload)?;
        kb::proposal_set_state(c, id, "accepted")
    })
}

/// 拒绝一条建议 —— 只改状态，什么都不落库（跟 accept 对称）。
pub fn reject(db: &Db, id: i64) -> ApiResult<()> {
    db.with(|c| kb::proposal_set_state(c, id, "rejected"))
}

/// 一条建议的原始形状。payload 保持字符串 —— 解析归调用方，好把「解析失败」报成错。
struct RawProposal {
    doc_id: String,
    kind: String,
    payload: String,
}

fn proposal_get(conn: &Connection, id: i64) -> ApiResult<Option<RawProposal>> {
    conn.query_row(
        "SELECT doc_id, kind, payload FROM proposal WHERE id = ?1",
        [id],
        |r| {
            Ok(RawProposal {
                doc_id: r.get(0)?,
                kind: r.get(1)?,
                payload: r.get(2)?,
            })
        },
    )
    .optional()
    .map_err(store::db_err)
}

/// 按 kind 落库。不认识的 kind / 缺字段一律报错，不静默通过。
fn apply_proposal(conn: &Connection, doc_id: &str, kind: &str, payload: &Value) -> ApiResult<()> {
    match kind {
        "tag" => {
            let name = str_field(payload, "name")?;
            kb::tag_upsert(conn, &name, &[], "", "llm")?;
            let mut tags = store::docs::get(conn, doc_id)?.tags;
            if !tags.iter().any(|t| t == &name) {
                tags.push(name);
                store::docs::set_tags(conn, doc_id, &tags)?;
            }
            Ok(())
        }
        "topic" => {
            let name = str_field(payload, "name")?;
            kb::topic_upsert(conn, &name, "")?;
            // doc_topic_set 是替换式 —— 读现有的再追加，别直接覆盖。
            let mut topics = kb::doc_topic_of(conn, doc_id)?;
            if !topics.iter().any(|(t, _)| t == &name) {
                topics.push((name, 1.0));
                kb::doc_topic_set(conn, doc_id, &topics)?;
            }
            Ok(())
        }
        "link" => {
            let to_id = str_field(payload, "toId")?;
            let relation = payload.get("relation").and_then(Value::as_str).unwrap_or("").to_string();
            kb::edge_put(
                conn,
                &kb::Edge {
                    src_kind: "doc".into(),
                    src_id: doc_id.into(),
                    dst_kind: "doc".into(),
                    dst_id: to_id,
                    kind: "related".into(),
                    weight: 1.0,
                    reason: relation,
                    origin: "llm".into(),
                    at: store::now_ms(),
                },
            )
        }
        "entity" => {
            let name = str_field(payload, "name")?;
            let kind = payload.get("kind").and_then(Value::as_str).unwrap_or("");
            let eid = kb::entity_upsert(conn, &name, kind, "")?;
            // entity_mention_set 也是替换式 —— 读现有的再追加。
            let mut ids = kb::entity_mention_ids(conn, doc_id)?;
            if !ids.iter().any(|i| i == &eid) {
                ids.push(eid);
                kb::entity_mention_set(conn, doc_id, &ids)?;
            }
            Ok(())
        }
        "merge" => {
            let from = payload
                .get("from")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect::<Vec<_>>())
                .unwrap_or_default();
            let into = str_field(payload, "into")?;
            kb::tag_merge(conn, &from, &into)?;
            Ok(())
        }
        other => Err(ApiError::new("kb", format!("不认识的建议 kind：{other}"))),
    }
}

/// 取 payload 里的非空字符串字段，缺了就报错（不静默拿空串往下走）。
fn str_field(payload: &Value, key: &str) -> ApiResult<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| ApiError::new("kb", format!("建议 payload 缺字段：{key}")))
}

/* ─────────────────────────── 帮手 ─────────────────────────── */

/// 小写正文里 `term` 出现几次 —— D-0185 的「≥2 次」就在这儿算。
fn count_in(md_l: &str, term: &str) -> usize {
    let t = term.trim().to_lowercase();
    if t.is_empty() {
        0
    } else {
        md_l.matches(&t).count()
    }
}

/// 非空片段拼一句，空的不占位。
fn joined(parts: &[&str]) -> String {
    parts.iter().map(|p| p.trim()).filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ")
}

fn pick_content(raw: &str) -> ApiResult<String> {
    let v: Value = serde_json::from_str(raw)
        .map_err(|e| ApiError::new("kb_shape", format!("回的不是 JSON：{e}")))?;
    // 有的网关把错误塞在 200 回包里。
    if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(Value::as_str) {
        return Err(ApiError::new("kb_http", msg.to_string()));
    }
    v.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| ApiError::new("kb_shape", "回里没有 choices[0].message.content"))
}

fn clip(text: &str) -> String {
    if text.chars().count() <= MAX_TEXT {
        return text.to_string();
    }
    let head: String = text.chars().take(MAX_TEXT).collect();
    format!("{head}\n\n（后面还很长，已省略）")
}

/// 错误正文（可能是 HTML 错误页）摊进一句话里。
fn clip_msg(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(300).collect()
}
