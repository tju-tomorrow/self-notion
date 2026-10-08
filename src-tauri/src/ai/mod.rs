//! 内置 AI 的第一个消费者：给一篇笔记出「一句话 + 一段话」总结。
//!
//! 形状是 D-0042 定的 —— **BYO endpoint**（baseUrl / model / key）。
//! `baseUrl` 是**完整地址**：用户自己填到 `/chat/completions` 为止，**我们不拼任何东西**
//! （拼一次就等于只认一种写法，网关地址千奇百怪，猜不如不猜）。三条照办：
//!   1. **key 只活在 Rust**（`meta` 表），`ai:status` 只回「配没配」，永不回传 webview；
//!   2. **联网只发生在 Rust**，插件不声明 `net`；
//!   3. HTTP 走 `backup::http::send`（全仓库唯一的出口），所以这里**不新增任何依赖**。
//!
//! ponytail: 只做一次非流式问答，不做 tools / 流式 / 多轮 —— 总结用不上。
//! 真接 agent 循环时按 `docs/ai.md` 那一套补（工具面、强制前置快照）。
//! **`chat` 就是那一套**（D-0087），落在同目录的 `chat.rs` 里。

mod chat;
pub use chat::chat;

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::backup::http;
use crate::commands::{ApiError, ApiResult};
use crate::store::{self, Db};

const K_BASE_URL: &str = "ai.baseUrl";
const K_MODEL: &str = "ai.model";
const K_API_KEY: &str = "ai.apiKey";

/// 喂给模型的正文上限。两万字塞进去也就一万多 token，够；再长就砍尾
/// —— 开头那段最能代表这篇在讲什么。
const MAX_TEXT: usize = 12000;

/// 输出格式写死成三行。**切不出来也不能空手而归**（见 `split`）。
const PROMPT: &str = "你是笔记助手。读下面这篇笔记，只回三行，别的什么都不要写：\n\
LINE: 一句话说清这篇在讲什么（不超过 30 字）\n\
PARA: 一段话总结这篇的核心思想（2 到 4 句，60 到 150 字）\n\
ENT: 这篇涉及到的实体，逗号分隔，最多 8 个（人名 / 项目 / 作品 / 概念 / 工具 / 组织都算），没有就写 -\n\
就用笔记里的原文叫法，不要翻译、不要解释、不要编。";

/// 三项配置。key 只在 Rust，见文件头。
pub(crate) struct Config {
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) api_key: String,
}

/// opencode 的 zen/go 网关额外要两个头才肯干活（实测）：
///   · `User-Agent` —— 它前面的 Cloudflare 会掐掉「不像客户端」的请求（实测：python-urllib → 403 code 1010）；
///   · `x-opencode-session` —— 它拿这个做路由 / 缓存，缺了直接 `400 MissingSessionID`。
/// 别的网关不认识这两个头，所以**只对这一个 host 加**（同 cc-agents 的 `withOpenCodeGoInit`）。
pub(crate) fn gateway_headers(base_url: &str) -> Vec<(String, String)> {
    if !base_url.contains("opencode.ai/zen/go") {
        return Vec::new();
    }
    vec![
        ("User-Agent".to_string(), format!("self-notion/{}", env!("CARGO_PKG_VERSION"))),
        ("x-opencode-session".to_string(), "self-notion".to_string()),
    ]
}

pub(crate) fn load_config(conn: &Connection) -> ApiResult<Config> {
    let get = |k: &str| store::settings_get(conn, k).map(|o| o.unwrap_or_default());
    Ok(Config { base_url: get(K_BASE_URL)?, model: get(K_MODEL)?, api_key: get(K_API_KEY)? })
}

/* ─────────────────────────── 命令入口 ─────────────────────────── */

/// `ai:configure` —— 存 baseUrl / model / key。只写传进来的字段（缺省 = 不动），
/// key 传空串是**明确要清掉**。
pub fn configure(db: &Db, args: Value) -> ApiResult<Value> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct A {
        base_url: Option<String>,
        model: Option<String>,
        api_key: Option<String>,
    }
    let a: A = parse(args)?;

    db.with(|c| {
        if let Some(u) = &a.base_url {
            // 尾巴上的 `/` 留着就是 `…/chat/completions/` —— 那会 404，去掉。
            let u = u.trim().trim_end_matches('/');
            if !(u.is_empty() || u.starts_with("http://") || u.starts_with("https://")) {
                return Err(ApiError::new("bad_args", "baseUrl 要写成 http(s)://…"));
            }
            store::settings_set(c, K_BASE_URL, u)?;
        }
        if let Some(m) = &a.model {
            store::settings_set(c, K_MODEL, m.trim())?;
        }
        if let Some(k) = &a.api_key {
            store::settings_set(c, K_API_KEY, k)?;
        }
        Ok(())
    })?;

    status(db, Value::Null)
}

/// `ai:status` —— 给设置页看的。**绝不回传 key**。
pub fn status(db: &Db, _args: Value) -> ApiResult<Value> {
    db.with(|c| {
        let cfg = load_config(c)?;
        Ok(json!({
            "configured": !cfg.base_url.is_empty() && !cfg.model.is_empty() && !cfg.api_key.is_empty(),
            "baseUrl": cfg.base_url,
            "model": cfg.model,
            "hasKey": !cfg.api_key.is_empty(),
            // 明文传输要提示（本地 Ollama 允许，`docs/ai.md` 第八节）。
            "insecure": cfg.base_url.starts_with("http://"),
        }))
    })
}

/// `ai:models` —— 给设置页那个下拉拉一份网关的模型清单。
///
/// ★ **拉不到不是错误**：回 `{ models: [], error: "…" }`，设置页拿内置那份兜底。
///   发不出去的真实原因仍落 `errors.log`（AGENTS.md「出错只有一个地方可看」）。
///
/// ★ 同 `ai:summarize`，**不走 `call`** —— 一次网络往返，攥着库锁会把整个应用卡住。
pub fn models(db: &Db, _args: Value) -> ApiResult<Value> {
    let cfg = db.with(load_config)?;
    if cfg.base_url.is_empty() {
        return Ok(degraded("还没填接口地址"));
    }

    let mut headers = vec![("Accept".to_string(), "application/json".to_string())];
    // 本地网关（Ollama 那类）不要 key —— 没填就不带这个头。
    if !cfg.api_key.is_empty() {
        headers.push(("Authorization".to_string(), format!("Bearer {}", cfg.api_key)));
    }
    headers.extend(gateway_headers(&cfg.base_url));

    let resp = match http::send("GET", &models_url(&cfg.base_url), &headers, None) {
        Ok(r) => r,
        Err(e) => return Ok(degraded(&clip_msg(&e))),
    };
    let raw = String::from_utf8_lossy(&resp.body).into_owned();
    if !(200..300).contains(&resp.status) {
        return Ok(degraded(&format!("HTTP {} {}", resp.status, clip_msg(&raw))));
    }
    match pick_models(&raw) {
        Ok(ids) => Ok(json!({ "models": ids, "error": "" })),
        Err(e) => Ok(degraded(&e)),
    }
}

/// 清单没拿到：记一行日志 + 回一个空清单和原因。**不是 API 错误** ——
/// 设置页要的是「改用内置那份」，不是弹一个错误框。
fn degraded(why: &str) -> Value {
    crate::log::record("ai", &format!("模型清单拉不到：{why}"));
    json!({ "models": [], "error": why })
}

/// `ai:summarize` —— 一篇笔记出「一句话 + 一段话 + 实体」，**顺手存盘**。
///
/// ★ **这条故意不走 `call`**：一次几秒级的模型往返，攥着库锁会把整个应用卡住。
/// 配置和正文读一次就撒手，HTTP 期间不持锁（同 `backup:now` 的理由）；写完再拿一次锁。
///
/// ★ 标题仍从库里读（`documents`，D-0073：名字的唯一真相源）；正文优先用前端递过来的
/// （用户眼前那篇活文档，D-0110），没给才用库里那份投影。
pub fn summarize(db: &Db, args: Value) -> ApiResult<Value> {
    #[derive(Deserialize)]
    struct A {
        id: String,
        /// 前端手里那篇**活文档**的正文（D-0110）。用户正看着这篇时它比库里的投影新 ——
        /// 刚敲的字还在编辑器里、没落库。给不上（没打开过）就是 null，那就回库读。
        text: Option<String>,
    }
    let a: A = parse(args)?;

    let cfg = db.with(load_config)?;
    if cfg.base_url.is_empty() || cfg.model.is_empty() || cfg.api_key.is_empty() {
        return Err(ApiError::new("ai_not_configured", "还没配 AI：设置 → AI"));
    }
    let (title, md) = db.with(|c| store::summary::material(c, &a.id))?;
    let md = a.text.filter(|t| !t.trim().is_empty()).unwrap_or(md);
    if md.trim().is_empty() {
        return Err(ApiError::new("ai_empty", "这篇还没有正文"));
    }

    // ★ 字数记的是**完整正文**的，不是裁给模型的那一段 —— 对不上就是这篇改过了。
    let chars = md.chars().count() as i64;
    let title = title.trim();
    let body = if title.is_empty() { clip(&md) } else { format!("标题：{title}\n\n{}", clip(&md)) };
    let payload = json!({
        "model": cfg.model,
        "stream": false,
        // 总结要稳不要飘：低温度下同一个模型两遍的差别就小。
        "temperature": 0.3,
        "messages": [
            { "role": "system", "content": PROMPT },
            { "role": "user", "content": body },
        ],
    });

    let mut headers = vec![
        ("Authorization".to_string(), format!("Bearer {}", cfg.api_key)),
        ("Content-Type".to_string(), "application/json".to_string()),
    ];
    headers.extend(gateway_headers(&cfg.base_url));
    let resp = http::send(
        "POST",
        target_url(&cfg.base_url),
        &headers,
        Some(payload.to_string().into_bytes()),
    )
    .map_err(|e| ApiError::new("ai_http", e))?;

    let raw = String::from_utf8_lossy(&resp.body).into_owned();
    if !(200..300).contains(&resp.status) {
        return Err(ApiError::new(
            "ai_http",
            format!("HTTP {} — {}", resp.status, clip_msg(&raw)),
        ));
    }

    let (line, para, entities) = split(&pick_content(&raw)?);
    // 存盘。同一篇覆盖旧的：总结是「这篇现在的样子」，不是历史（要看旧的是版本历史那套）。
    let row = db.with(|c| store::summary::put(c, &a.id, &line, &para, &entities, chars))?;
    with_stale(row, false)
}

/// `ai:summary` —— 读这篇存下来的总结。**从盘上读**，不是前端缓存。
///
/// 没生成过回 `null`（不是错误）。`stale` 是现算的：正文现在的字数跟生成时记的那个对不上，
/// 就把旧总结标成「这篇改过了」。
pub fn summary(db: &Db, args: Value) -> ApiResult<Value> {
    #[derive(Deserialize)]
    struct A {
        id: String,
    }
    let a: A = parse(args)?;
    db.with(|c| {
        let found = store::summary::get(c, &a.id)?;
        let Some(row) = found else {
            return Ok(Value::Null);
        };
        let (_, md) = store::summary::material(c, &a.id)?;
        let stale = md.chars().count() as i64 != row.chars;
        with_stale(row, stale)
    })
}

/// 行 + `stale`。多这一个字段是因为它**不是存下来的**（存下来就会过期）。
fn with_stale(row: store::summary::Summary, stale: bool) -> ApiResult<Value> {
    let mut v = serde_json::to_value(&row).map_err(|e| ApiError::new("encode", e.to_string()))?;
    v["stale"] = Value::Bool(stale);
    Ok(v)
}

/* ─────────────────────────── 纯函数 ─────────────────────────── */

/// `baseUrl` → 真正要打的地址。**原样用** —— 用户填的就是那条完整地址。
/// 只把尾巴上的 `/` 去掉：填成 `…/chat/completions/` 会 404，而这种手滑不值得让调用方排查。
fn target_url(base: &str) -> &str {
    base.trim_end_matches('/')
}

/// `baseUrl` → 同一个网关的 `/models`：去掉尾巴的 `/chat/completions` 再拼。
/// 拼地址在全仓库只有这一处 —— 列模型绕不开它，而且**只认这一种尾巴**，
/// 认不出来就把 `/models` 接在原样地址后面（有些网关的 baseUrl 直接是 `/v1`）。
fn models_url(base: &str) -> String {
    let b = base.trim_end_matches('/');
    format!("{}/models", b.strip_suffix("/chat/completions").unwrap_or(b))
}

/// 从回包里取模型 id 清单。OpenAI 兼容是 `{"data":[{"id":…}]}`，也有网关回 `{"models":[…]}`。
/// 元素直接是字符串（不是对象）也认。
fn pick_models(raw: &str) -> Result<Vec<String>, String> {
    let v: Value = serde_json::from_str(raw).map_err(|e| format!("回的不是 JSON：{e}"))?;
    if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(Value::as_str) {
        return Err(msg.to_string());
    }
    let arr = ["data", "models"]
        .iter()
        .find_map(|k| v.get(*k).and_then(Value::as_array))
        .ok_or("回里没有 data / models 数组")?;
    let ids: Vec<String> = arr
        .iter()
        .filter_map(|m| m.get("id").and_then(Value::as_str).or_else(|| m.as_str()))
        .map(str::to_string)
        .collect();
    if ids.is_empty() {
        return Err("清单是空的".to_string());
    }
    Ok(ids)
}

/// 从回包里取 `choices[0].message.content`。
fn pick_content(raw: &str) -> ApiResult<String> {
    let v: Value = serde_json::from_str(raw)
        .map_err(|e| ApiError::new("ai_shape", format!("回的不是 JSON：{e}")))?;
    // 有的网关把错误塞在 200 回包里。
    if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(Value::as_str) {
        return Err(ApiError::new("ai_http", msg.to_string()));
    }
    v.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| ApiError::new("ai_shape", "回里没有 choices[0].message.content"))
}

/// 按约定切三段。模型不听话（加了 `**`、换了行内写法、压根不按格式）也不能空手而归：
/// 一段话切不出来就把整个回包压成一行当一段话，一句话再从它里面截；实体那栏没有就没有。
fn split(content: &str) -> (String, String, Vec<String>) {
    let (mut line, mut para) = (String::new(), String::new());
    let mut entities: Vec<String> = Vec::new();
    let mut in_para = false;
    for raw in content.lines() {
        // 有的模型会给 `**LINE:**`、`- LINE:`。剥掉装饰再认前缀。
        let l = raw.trim().trim_start_matches(['*', '#', '-', ' ']).trim();
        if let Some(rest) = l.strip_prefix("LINE:") {
            line = rest.trim().to_string();
            in_para = false;
        } else if let Some(rest) = l.strip_prefix("PARA:") {
            para = rest.trim().to_string();
            in_para = true;
        } else if let Some(rest) = l.strip_prefix("ENT:").or_else(|| l.strip_prefix("ENTITIES:")) {
            // `ENTITIES:` 认是因为有的模型会把前缀写全；两个前缀不会互相误伤
            //（`"ENTITIES:"` 抽不出 `"ENT:"` —— 第四个字符一个是 `I` 一个是 `:`）。
            entities = parse_entities(rest);
            in_para = false;
        } else if in_para && !l.is_empty() {
            // 一段话被折成好几行时接着往上拼，别丢半截。
            para.push(' ');
            para.push_str(l);
        }
    }

    if para.is_empty() {
        let flat = content.replace("LINE:", " ").replace("PARA:", " ").replace("ENT:", " ");
        para = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    }
    if line.is_empty() {
        line = first_sentence(&para);
    }
    (line, para, entities)
}

/// `A，B、C; D` → `["A", "B", "C", "D"]`。去重、去掉「无 / - / N/A」这些占位，最多 8 个。
fn parse_entities(raw: &str) -> Vec<String> {
    const NONE: [&str; 6] = ["-", "—", "无", "没有", "none", "n/a"];
    let mut out: Vec<String> = Vec::new();
    for part in raw.split([',', '，', '、', ';', '；', '|', '/']) {
        let e = part
            .trim()
            .trim_start_matches(['*', '#', '-', ' '])
            .trim()
            .trim_matches(['「', '」', '"', '\'', '`', '《', '》', '*'])
            .trim();
        if e.is_empty() || NONE.iter().any(|n| e.eq_ignore_ascii_case(n)) {
            continue;
        }
        if out.iter().any(|seen| seen.eq_ignore_ascii_case(e)) {
            continue;
        }
        out.push(e.to_string());
        if out.len() >= 8 {
            break;
        }
    }
    out
}

/// 一句话那栏的兜底：取到第一个句号为止，太长就硬截。
fn first_sentence(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars().take(48) {
        out.push(ch);
        if matches!(ch, '。' | '！' | '？' | '.' | '!' | '?') {
            break;
        }
    }
    out.trim().to_string()
}

fn clip(text: &str) -> String {
    if text.chars().count() <= MAX_TEXT {
        return text.to_string();
    }
    let head: String = text.chars().take(MAX_TEXT).collect();
    format!("{head}\n\n（后面还很长，已省略）")
}

/// 错误正文（可能是 HTML 错误页）摊进一句话里。多余的行会进 `errors.log` 与浮层。
fn clip_msg(raw: &str) -> String {
    let flat = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    flat.chars().take(300).collect()
}

fn parse<T: serde::de::DeserializeOwned>(args: Value) -> ApiResult<T> {
    serde_json::from_value(args).map_err(|e| ApiError::new("bad_args", e.to_string()))
}
