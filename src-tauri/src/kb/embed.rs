//! 语义层（D-0184）：BYO endpoint 的 `/embeddings` + 暴力余弦。
//!
//! ★ 只对 `doc_summary` 那一两句 + 标签/主题名做向量 —— 几千条暴力算是毫秒级，
//!   **不上向量库**。这是 D-0040「不建大索引」在语义这层的执行。
//! ★ 配置**只复用 `ai` 的 baseUrl / apiKey** —— **模型名是独立的一项**（`meta.kb.embedModel`）：
//!   对话模型和 embedding 模型是两个东西（`gpt-4o` 不能拿来 embed），共用一个必然错。



use rusqlite::Connection;
use serde_json::{json, Value};

use crate::ai;
use crate::backup::http;
use crate::commands::{ApiError, ApiResult};
use crate::store::kb::{self, VecHit};
use crate::store::{self, Db};

/// embedding 模型名。**用户自己填**（设置 → 知识库），不跟 `ai.model` 共用。
/// `vec` 表里每条也记着模型 —— 对不上就是要重算。
const K_EMBED_MODEL: &str = "kb.embedModel";

/// `limit == 0` 当「不设上限」。给 SQLite 的 `LIMIT` 一个安全的大数，别拿 `usize::MAX` 溢出去。
const NO_LIMIT: usize = 100_000;

/// 把一批文字变成向量。`model` 是 **embedding 模型**（不是对话模型）。
/// **不持库锁做 HTTP**（照 `ai::summarize` 的先例）。
pub fn embed_texts(db: &Db, model: &str, texts: &[String]) -> ApiResult<Vec<Vec<f32>>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    if model.trim().is_empty() {
        return Err(ApiError::new("kb", "还没配 embedding 模型 —— 设置 → 知识库里填一个"));
    }
    let cfg = db.with(ai::load_config)?;
    if cfg.base_url.is_empty() {
        return Err(ApiError::new("kb", "还没配 AI endpoint —— 设置 → AI 里填 baseUrl，语义检索才用得了"));
    }

    let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];
    // 本地网关（Ollama 那类）不要 key —— 没填就不带这个头。
    if !cfg.api_key.is_empty() {
        headers.push(("Authorization".to_string(), format!("Bearer {}", cfg.api_key)));
    }
    headers.extend(ai::gateway_headers(&cfg.base_url));

    let payload = json!({ "model": model, "input": texts });
    let resp = http::send(
        "POST",
        &embeddings_url(&cfg.base_url),
        &headers,
        Some(payload.to_string().into_bytes()),
    )
    .map_err(|e| {
        crate::log::record("kb", &format!("embeddings 发不出去：{e}"));
        ApiError::new("kb_http", e)
    })?;

    let raw = String::from_utf8_lossy(&resp.body).into_owned();
    if !(200..300).contains(&resp.status) {
        let msg = format!("HTTP {} — {}", resp.status, clip_msg(&raw));
        crate::log::record("kb", &format!("embeddings 回错：{msg}"));
        return Err(ApiError::new("kb_http", msg));
    }
    let vecs = pick_embeddings(&raw)?;
    if vecs.len() != texts.len() {
        let msg = format!("要 {} 条向量，回了 {} 条", texts.len(), vecs.len());
        crate::log::record("kb", &msg);
        return Err(ApiError::new("kb_shape", msg));
    }
    Ok(vecs)
}

/// 当前配的 embedding 模型名（`meta.kb.embedModel`）。没配就 None —— 语义层整体降级。
pub fn current_model(db: &Db) -> ApiResult<Option<String>> {
    let got = db.with(|c| store::settings_get(c, K_EMBED_MODEL))?;
    Ok(got.filter(|m| !m.trim().is_empty()))
}

/// 语义检索：query 向量化 → 对 `vec` 表里 `owner_kind='doc'` 的暴力 top-k。
pub fn search(db: &Db, q: &str, k: usize) -> ApiResult<Vec<VecHit>> {
    // 没配模型就明确报错，**不是**静默返回空（D-0184）。
    let model = current_model(db)?.ok_or_else(|| {
        ApiError::new("kb", "没配 embedding 模型 —— 语义检索用不了（先跑一轮 refresh 建向量）")
    })?;
    let q = q.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let mut vecs = embed_texts(db, &model, &[q.to_string()])?;
    let qv = vecs.pop().ok_or_else(|| ApiError::new("kb_shape", "embedding 没回向量"))?;
    db.with(|c| kb::vec_topk(c, "doc", &model, &qv, k))
}

/// 把某一类 owner 的向量补齐 / 刷新。返回本次算了多少条。
/// `owner_kind` = `doc`（用 `doc_summary.line + para`）| `tag` | `topic` | `entity`。
pub fn refresh(db: &Db, owner_kind: &str, limit: usize) -> ApiResult<usize> {
    let model = current_model(db)?.ok_or_else(|| {
        ApiError::new("kb", "还没配 embedding 模型 —— 设置 → 知识库里填一个")
    })?;

    let (items, drift) = db.with(|c| plan(c, owner_kind, &model, limit))?;
    // 换了模型 = 旧向量作废，全量重算（D-0184 的 model/dim 漂移）。
    if drift {
        db.with(kb::vec_clear)?;
    }

    let todo: Vec<&PlanItem> = items.iter().filter(|it| drift || it.recompute).collect();
    if todo.is_empty() {
        return Ok(0);
    }
    let texts: Vec<String> = todo.iter().map(|it| it.text.clone()).collect();
    let vecs = embed_texts(db, &model, &texts)?;

    db.with(|c| {
        for (it, v) in todo.iter().zip(vecs.iter()) {
            kb::vec_put(c, owner_kind, &it.id, &model, v, &it.hash)?;
        }
        Ok(())
    })?;
    Ok(todo.len())
}

/* ─────────────────────────── 内部 ─────────────────────────── */

/// 一条待办的向量任务。
struct PlanItem {
    id: String,
    text: String,
    hash: String,
    /// 文本没变（且模型没换）就是 false —— 不重算，省一次 embedding。
    recompute: bool,
}

/// 收集这一类 owner 的文本，并跟已有的 `vec` 比：文本 hash 没变就不重算；
/// 任何一条的 `model` 跟当前配置对不上 = 用户换了模型 → `drift`，调用方全量重算。
fn plan(conn: &Connection, owner_kind: &str, model: &str, limit: usize) -> ApiResult<(Vec<PlanItem>, bool)> {
    let mut drift = false;
    let mut out = Vec::new();
    for (id, text) in collect_texts(conn, owner_kind, limit)? {
        let hash = kb::content_hash(&text);
        let existing = kb::vec_get(conn, owner_kind, &id)?;
        let recompute = match &existing {
            Some((m, _v, h)) if m == model => h != &hash,
            Some(_) => {
                drift = true;
                true
            }
            None => true,
        };
        out.push(PlanItem { id, text, hash, recompute });
    }
    Ok((out, drift))
}

/// 某一类 owner 的 `(id, 要向量化的文本)`。文本为空的不返回 —— 没语料可喂。
fn collect_texts(conn: &Connection, owner_kind: &str, limit: usize) -> ApiResult<Vec<(String, String)>> {
    let mut out: Vec<(String, String)> = match owner_kind {
        "doc" => {
            let mut stmt = conn
                .prepare("SELECT doc_id, line, para FROM doc_summary ORDER BY at DESC")
                .map_err(store::db_err)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
                })
                .map_err(store::db_err)?;
            let mut v = Vec::new();
            for row in rows {
                let (id, line, para) = row.map_err(store::db_err)?;
                let text = combine(&[&line, &para]);
                if !text.is_empty() {
                    v.push((id, text));
                }
            }
            v
        }
        "tag" => kb::tag_list(conn)?
            .into_iter()
            .map(|t| (t.name.clone(), combine(&[&t.name, &t.desc])))
            .collect(),
        "topic" => kb::topic_list(conn)?
            .into_iter()
            .map(|t| (t.name.clone(), combine(&[&t.name, &t.desc])))
            .collect(),
        "entity" => kb::entity_list(conn, cap(limit))?
            .into_iter()
            .map(|e| (e.id.clone(), combine(&[&e.name, &e.desc])))
            .collect(),
        other => return Err(ApiError::new("bad_args", format!("不认识的 owner_kind：{other}"))),
    };
    out.retain(|(_, t)| !t.is_empty());
    if limit > 0 && out.len() > limit {
        out.truncate(limit);
    }
    Ok(out)
}

/// 非空片段拼成一句话。空的不占位，别喂给模型一堆空格。
fn combine(parts: &[&str]) -> String {
    parts
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `limit == 0` → 一个安全的大数（给 `entity_list` 这种自带 `LIMIT` 的）。
fn cap(limit: usize) -> usize {
    if limit == 0 { NO_LIMIT } else { limit }
}

/// `baseUrl` → 同一个网关的 `/embeddings`：去掉尾巴的 `/chat/completions` 再拼
/// （照 `ai::models_url` 的剥尾巴思路）。
fn embeddings_url(base: &str) -> String {
    let b = base.trim_end_matches('/');
    format!("{}/embeddings", b.strip_suffix("/chat/completions").unwrap_or(b))
}

/// 从回包里取 `data[].embedding`。**按 `index` 排序** —— provider 不保证顺序。
fn pick_embeddings(raw: &str) -> ApiResult<Vec<Vec<f32>>> {
    let v: Value = serde_json::from_str(raw)
        .map_err(|e| ApiError::new("kb_shape", format!("回的不是 JSON：{e}")))?;
    // 有的网关把错误塞在 200 回包里。
    if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(Value::as_str) {
        return Err(ApiError::new("kb_http", msg.to_string()));
    }
    let arr = v
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::new("kb_shape", "回里没有 data 数组"))?;

    let mut indexed: Vec<(i64, Vec<f32>)> = Vec::with_capacity(arr.len());
    for (fallback, item) in arr.iter().enumerate() {
        let idx = item.get("index").and_then(Value::as_i64).unwrap_or(fallback as i64);
        let emb = item
            .get("embedding")
            .and_then(Value::as_array)
            // 也认 `data` 直接是数组的数组那种形状。
            .or_else(|| item.as_array())
            .ok_or_else(|| ApiError::new("kb_shape", "data 里没有 embedding 数组"))?;
        indexed.push((idx, emb.iter().map(|x| x.as_f64().unwrap_or(0.0) as f32).collect()));
    }
    indexed.sort_by_key(|(i, _)| *i);

    let out: Vec<Vec<f32>> = indexed.into_iter().map(|(_, v)| v).collect();
    if out.is_empty() {
        return Err(ApiError::new("kb_shape", "embedding 清单是空的"));
    }
    Ok(out)
}

/// 错误正文（可能是 HTML 错误页）摊进一句话里。多余的行会进 `errors.log`。
fn clip_msg(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(300).collect()
}
