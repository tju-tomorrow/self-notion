//! `web:search` —— 内置助手的联网搜索（D-0217）。
//!
//! 后端是 SearXNG（开源元搜索）：默认排几个公共实例，一个不通就换下一个；
//! 设置里填了地址就只打那一个。网络照旧只在 Rust（走 `backup::http`），插件不声明 `net`。
//!
//! ★ 公共实例常把 `format=json` 关掉（回 403 或 HTML 错误页），所以每个实例先试 JSON，
//!   不行再抓结果页的 `<article class="result">`。只回标题 + 链接 + 摘要，不抓正文。
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, EventTarget};

use crate::backup::http;
use crate::commands::{ApiError, ApiResult};
use crate::store::{self, Db};

const K_BASE: &str = "web.searchBase";
/// 搜索在**自己的线程**上跑：命令立刻返回，前端拿事件。
/// 同步做的话最多 3 个实例 × 6 秒会把整条 IPC 线占住（同 `ai:chat` 的理由）。
const EV_DONE: &str = "web:done";
const EV_ERROR: &str = "web:error";
/// `web_read` 自己的两条 —— 搜索和读网页可能同时在跑。
const EV_READ_DONE: &str = "web:read:done";
const EV_READ_ERROR: &str = "web:read:error";
const READ_DEFAULT: usize = 6_000;
const READ_MAX: usize = 12_000;
const DEFAULT_INSTANCES: &[&str] = &[
    "https://searx.be",
    "https://search.inetol.net",
    "https://baresearch.org",
];

/// 上次成功的实例 —— 公共实例互相之间快慢差很多，记住一个能少被试错。
static LAST_GOOD: Mutex<Option<String>> = Mutex::new(None);

/// 一轮最多等多久。每个实例自己 6 秒超时；这一层兜住「一个实例先 403 再慢慢回 HTML」。
const RACE_MS: u64 = 10_000;
const QUERY_MAX: usize = 400;

#[derive(Debug, Serialize)]
struct Hit {
    title: String,
    url: String,
    snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    published: Option<String>,
}

pub fn status(db: &Db) -> ApiResult<Value> {
    let base = db.with(|c| store::settings_get(c, K_BASE))?.unwrap_or_default();
    Ok(json!({ "base": base, "defaults": DEFAULT_INSTANCES }))
}

pub fn configure(db: &Db, args: Value) -> ApiResult<Value> {
    #[derive(Deserialize)]
    struct A {
        #[serde(default)]
        base: String,
    }
    let a: A = serde_json::from_value(args).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
    let base = if a.base.trim().is_empty() { String::new() } else { normalize(&a.base) };
    db.with(|c| store::settings_set(c, K_BASE, &base))?;
    Ok(json!({ "base": base }))
}

pub fn search(
    app: Option<&tauri::AppHandle>,
    db: &Db,
    args: Value,
    win: Option<&str>,
) -> ApiResult<Value> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct A {
        request_id: String,
        query: String,
        #[serde(default)]
        count: Option<usize>,
        #[serde(default)]
        freshness: Option<String>,
    }
    let a: A = serde_json::from_value(args).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
    let query: String = a.query.trim().chars().take(QUERY_MAX).collect();
    if query.is_empty() {
        return Err(ApiError::new("bad_args", "query 不能为空"));
    }
    let limit = a.count.unwrap_or(6).clamp(1, 10);
    let fresh = a.freshness.as_deref().and_then(|f| match f {
        "day" | "week" | "month" | "year" => Some(f.to_string()),
        _ => None,
    });
    let app = app.cloned().ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
    let win = win.unwrap_or("main").to_string();

    // 先把设置读出来，**HTTP 期间不持库锁**（同 ai:summarize）。
    let custom = db.with(|c| store::settings_get(c, K_BASE))?.unwrap_or_default();
    let custom = custom.trim().to_string();

    let request_id = a.request_id;
    std::thread::spawn(move || match run(&custom, &query, limit, fresh.as_deref()) {
        Ok((hits, engine)) => {
            let _ = app.emit_to(
                EventTarget::webview_window(win),
                EV_DONE,
                json!({ "requestId": request_id, "hits": hits, "engine": engine }),
            );
        }
        Err(message) => {
            let _ = app.emit_to(
                EventTarget::webview_window(win),
                EV_ERROR,
                json!({ "requestId": request_id, "message": message }),
            );
        }
    });

    Ok(json!({ "started": true }))
}

/// `web:read` —— 抓一个网页、去标签、截一段给模型。
///
/// 只读 http(s)，不读本机 / 内网（提示注入让模型去读 `127.0.0.1` 是常见套路）。
pub fn read(app: Option<&tauri::AppHandle>, args: Value, win: Option<&str>) -> ApiResult<Value> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct A {
        request_id: String,
        url: String,
        #[serde(default)]
        offset: Option<usize>,
        #[serde(default)]
        limit: Option<usize>,
    }
    let a: A = serde_json::from_value(args).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
    let url = check_url(&a.url).map_err(|e| ApiError::new("bad_url", e))?;
    let offset = a.offset.unwrap_or(0);
    let limit = a.limit.unwrap_or(READ_DEFAULT).clamp(500, READ_MAX);
    let app = app.cloned().ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
    let win = win.unwrap_or("main").to_string();

    let request_id = a.request_id;
    std::thread::spawn(move || match fetch_page(&url, offset, limit) {
        Ok(page) => {
            let _ = app.emit_to(
                EventTarget::webview_window(win),
                EV_READ_DONE,
                json!({
                    "requestId": request_id,
                    "url": page.url,
                    "title": page.title,
                    "text": page.text,
                    "total": page.total,
                    "offset": page.offset,
                }),
            );
        }
        Err(message) => {
            let _ = app.emit_to(
                EventTarget::webview_window(win),
                EV_READ_ERROR,
                json!({ "requestId": request_id, "message": message }),
            );
        }
    });

    Ok(json!({ "started": true }))
}

struct Page {
    url: String,
    title: String,
    text: String,
    total: usize,
    offset: usize,
}

fn check_url(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "不是合法的网址".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("只支持 http / https".to_string());
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if blocked_host(&host) {
        return Err("不读本机 / 内网的地址".to_string());
    }
    Ok(url)
}

fn blocked_host(host: &str) -> bool {
    use std::net::IpAddr;
    let bare = host.trim_matches(|c| c == '[' || c == ']');
    if bare == "localhost" || bare.ends_with(".localhost") || bare.ends_with(".local") {
        return true;
    }
    if let Ok(ip) = bare.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => {
                v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
            }
            IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
        };
    }
    // 没有点的主机名 = 内网短名（公网域名至少有一个点）。
    !bare.contains('.')
}

fn fetch_page(
    start: &reqwest::Url,
    offset: usize,
    limit: usize,
) -> Result<Page, String> {
    let headers = headers();
    let mut target = start.clone();
    let mut got = None;
    // 自己跟跳转：每一跳都重新验 host —— 被 302 带去内网是提示注入的常见套路。
    for _ in 0..4 {
        let resp = http::send_quick_plain("GET", target.as_str(), &headers)?;
        if (300..400).contains(&resp.status) {
            let location = header_of(&resp, "location");
            if location.is_empty() {
                return Err(format!("HTTP {}", resp.status));
            }
            let next = target.join(&location).map_err(|_| "跳转地址不合法".to_string())?;
            let host = next.host_str().unwrap_or("").to_ascii_lowercase();
            if !matches!(next.scheme(), "http" | "https") || blocked_host(&host) {
                return Err("跳转到了不允许的地址".to_string());
            }
            target = next;
            continue;
        }
        got = Some(resp);
        break;
    }
    let resp = got.ok_or_else(|| "跳转太多次".to_string())?;
    if !(200..300).contains(&resp.status) {
        return Err(format!("HTTP {}", resp.status));
    }
    let ctype = header_of(&resp, "content-type");
    let kind = ctype.to_ascii_lowercase();
    let looks_html = kind.is_empty()
        || kind.contains("text/html")
        || kind.contains("xhtml")
        || kind.contains("xml");
    if !looks_html && !kind.starts_with("text/") && !kind.contains("json") {
        return Err(format!("不是网页（{ctype}）"));
    }

    let raw = String::from_utf8_lossy(&resp.body);
    let (title, text) = if looks_html {
        extract_page(&raw, &target)
    } else {
        (String::new(), tidy(&raw))
    };
    let total = text.chars().count();
    if total == 0 {
        return Err("页面没有可读的正文".to_string());
    }
    let from = offset.min(total);
    let slice: String = text.chars().skip(from).take(limit).collect();
    Ok(Page { url: target.to_string(), title, text: slice, total, offset: from })
}

/// 先让 readability 挑正文；挑得太不像（Rust Book / docs.rs 会挑到侧栏或帮助框）
/// 就改用 `<main>` / `<article>` 里的文字，再不行退回整页。
fn extract_page(html: &str, url: &reqwest::Url) -> (String, String) {
    let full = full_text(html);
    let fallback_title = title_of(html);
    let full_len = full.chars().count();
    let semantic = semantic_text(html);
    let semantic_len = semantic.as_ref().map(|s| s.chars().count()).unwrap_or(0);
    // 外面抓来的 HTML 什么样都有 —— 库 panic 也不能把这一轮吊死。
    let picked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        readability::extractor::extract(&mut std::io::Cursor::new(html.as_bytes()), url)
    }))
    .ok()
    .and_then(Result::ok);

    let mut title = fallback_title;
    let mut body = full;
    let mut picked_text: Option<String> = None;
    let mut picked_len = 0usize;
    if let Some(product) = picked {
        let text = text_of(&product.content);
        picked_len = text.chars().count();
        if !product.title.trim().is_empty() {
            title = tidy(&unescape(&product.title));
        }
        if picked_len > 0 {
            picked_text = Some(text);
        }
    }
    // 少于 400 字、或者只占整页的一小角 —— readability 挑歪了。
    let plausible = picked_len >= 400 && (full_len < 1_200 || picked_len * 100 >= full_len * 35);
    // readability 挑歪了（mdBook 的键盘提示框、只占一角的小块），或者语义容器明显更大，
    // 就用 `<main>` / `<article>` —— 这两个标签是比打分更硬的边界。
    let semantic_wins = semantic_len >= 20 && (!plausible || semantic_len >= picked_len * 2);
    body = match semantic {
        Some(text) if semantic_wins => text,
        _ if plausible => picked_text.unwrap_or_default(),
        _ => body,
    };
    (title, body)
}

/// `<main>` / `<article>` 的直接文本；多个取最长的那个（列表页里一篇文章不该算整页）。
fn semantic_text(html: &str) -> Option<String> {
    let mut best: Option<String> = None;
    for tag in ["main", "article"] {
        for inner in blocks(html, tag) {
            let text = full_text(inner);
            let len = text.chars().count();
            if len < 20 {
                continue;
            }
            if best.as_ref().map(|b| len > b.chars().count()).unwrap_or(true) {
                best = Some(text);
            }
        }
    }
    best
}

/// 找某个标签的内容（不配对嵌套 —— `main` / `article` 不嵌套，够用）。
fn blocks<'a>(html: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{tag}");
    let close = format!("</{tag}");
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(at) = lower[from..].find(&open) {
        let at = from + at;
        let next = lower[at + open.len()..].chars().next();
        if !matches!(next, Some(' ') | Some('>') | Some('\t') | Some('\n') | Some('\r')) {
            from = at + open.len();
            continue;
        }
        let Some(gt) = lower[at..].find('>') else { break };
        let start = at + gt + 1;
        let Some(end) = lower[start..].find(&close) else { break };
        out.push(&html[start..start + end]);
        from = start + end + close.len();
        if out.len() >= 8 {
            break;
        }
    }
    out
}

fn full_text(html: &str) -> String {
    let mut body = html.to_string();
    for tag in ["script", "style", "noscript", "svg", "iframe", "template", "head"] {
        body = strip_block(&body, tag);
    }
    text_of(&body)
}

fn header_of(resp: &http::Response, name: &str) -> String {
    resp.headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

/// 整段去掉一个标签（含内容）。索引在 ASCII 小写副本上找 —— 只改大小写，字节位置不变。
fn strip_block(html: &str, tag: &str) -> String {
    let open = format!("<{tag}");
    let close = format!("</{tag}");
    let mut out = String::new();
    let mut rest = html;
    loop {
        let lower = rest.to_ascii_lowercase();
        let Some(at) = lower.find(&open) else {
            out.push_str(rest);
            break;
        };
        let next = rest[at + open.len()..].chars().next();
        if !matches!(next, Some(' ') | Some('>') | Some('\t') | Some('\n') | Some('\r') | Some('/')) {
            out.push_str(&rest[..at + open.len()]);
            rest = &rest[at + open.len()..];
            continue;
        }
        out.push_str(&rest[..at]);
        let Some(end) = lower[at..].find(&close) else {
            // 没闭合就别把后半篇吃了 —— 原样留着，后面的去标签会收拾它。
            out.push_str(&rest[at..]);
            break;
        };
        let after = at + end;
        let Some(gt) = rest[after..].find('>') else { break };
        rest = &rest[after + gt + 1..];
    }
    out
}

fn title_of(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let Some(at) = lower.find("<title") else { return String::new() };
    let Some(gt) = lower[at..].find('>') else { return String::new() };
    let from = at + gt + 1;
    let Some(end) = lower[from..].find("</title") else { return String::new() };
    tidy(&unescape(&html[from..from + end]))
}

/// 块级标签换行、行内标签直接消失 —— 不然整页正文会挤成一行。
fn text_of(html: &str) -> String {
    const BREAK: &[&str] = &[
        "p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article",
        "blockquote", "pre", "td", "th", "ul", "ol", "table",
    ];
    let mut out = String::new();
    let mut i = 0;
    while let Some(lt) = html[i..].find('<') {
        out.push_str(&html[i..i + lt]);
        i += lt;
        let Some(gt) = html[i..].find('>') else { break };
        let raw = &html[i + 1..i + gt];
        let name = raw
            .trim_start_matches('/')
            .trim_start()
            .split(|c: char| c.is_whitespace() || c == '/')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        if BREAK.contains(&name.as_str()) {
            out.push('\n');
        }
        i += gt + 1;
    }
    if i < html.len() {
        out.push_str(&html[i..]);
    }
    tidy(&unescape(&out))
}

fn tidy(text: &str) -> String {
    text.lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn run(
    custom: &str,
    query: &str,
    limit: usize,
    fresh: Option<&str>,
) -> Result<(Vec<Hit>, String), String> {
    let bases = candidates(custom);
    if bases.len() == 1 {
        let base = bases.into_iter().next().unwrap_or_default();
        let hits = fetch(&base, query, limit, fresh)?;
        if hits.is_empty() {
            return Err(format!("{base}：没结果"));
        }
        remember(&base);
        return Ok((hits, base));
    }

    // 公共实例一起问，谁先回完整结果用谁 —— 串行试的话，一个死站就白等 6 秒。
    let total = bases.len();
    let (tx, rx) = std::sync::mpsc::channel();
    for base in bases {
        let tx = tx.clone();
        let q = query.to_string();
        let f = fresh.map(str::to_string);
        std::thread::spawn(move || {
            let got = fetch(&base, &q, limit, f.as_deref());
            let _ = tx.send((base, got));
        });
    }
    drop(tx);

    let deadline = Instant::now() + Duration::from_millis(RACE_MS);
    let mut tried = Vec::new();
    for _ in 0..total {
        let wait = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(wait) {
            Ok((base, Ok(hits))) if !hits.is_empty() => {
                remember(&base);
                return Ok((hits, base));
            }
            Ok((base, Ok(_))) => tried.push(format!("{base}：没结果")),
            Ok((base, Err(e))) => tried.push(format!("{base}：{e}")),
            Err(_) => break,
        }
    }
    let why = if tried.is_empty() { "都超时了".to_string() } else { tried.join("；") };
    Err(format!(
        "联网搜索没成功（{why}）。可以在「设置 → AI」里填一个自己的 SearXNG 实例地址。"
    ))
}

/* ─────────────────────────── 实例 ─────────────────────────── */

fn candidates(custom: &str) -> Vec<String> {
    if !custom.is_empty() {
        return vec![normalize(custom)];
    }
    let mut out = Vec::new();
    if let Ok(good) = LAST_GOOD.lock() {
        if let Some(base) = good.as_ref() {
            out.push(base.clone());
        }
    }
    for base in DEFAULT_INSTANCES {
        let base = (*base).to_string();
        if !out.contains(&base) {
            out.push(base);
        }
    }
    out
}

fn remember(base: &str) {
    if let Ok(mut good) = LAST_GOOD.lock() {
        *good = Some(base.to_string());
    }
}

/// 用户可能填的是 `…/search` 或带尾斜杠的地址 —— 统一成实例根。
fn normalize(base: &str) -> String {
    let b = base.trim().trim_end_matches('/');
    b.strip_suffix("/search").unwrap_or(b).trim_end_matches('/').to_string()
}

fn headers() -> Vec<(String, String)> {
    vec![
        (
            "User-Agent".to_string(),
            format!(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) self-notion/{}",
                env!("CARGO_PKG_VERSION")
            ),
        ),
        ("Accept".to_string(), "application/json,text/html;q=0.8,*/*;q=0.5".to_string()),
        ("Accept-Language".to_string(), "zh-CN,zh;q=0.9,en;q=0.7".to_string()),
    ]
}

fn search_url(base: &str, query: &str, as_json: bool, fresh: Option<&str>) -> Result<String, String> {
    let mut url = reqwest::Url::parse(&format!("{base}/search")).map_err(|e| e.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("q", query).append_pair("language", "auto").append_pair("safesearch", "1");
        if let Some(f) = fresh {
            pairs.append_pair("time_range", f);
        }
        if as_json {
            pairs.append_pair("format", "json");
        }
    }
    Ok(url.to_string())
}

fn fetch(base: &str, query: &str, limit: usize, fresh: Option<&str>) -> Result<Vec<Hit>, String> {
    let base = normalize(base);
    let headers = headers();

    let url = search_url(&base, query, true, fresh)?;
    let resp = http::send_quick("GET", &url, &headers, None)?;
    if (200..300).contains(&resp.status) {
        let hits = parse_json(&resp.body, limit);
        if !hits.is_empty() {
            return Ok(hits);
        }
    } else if resp.status == 429 {
        return Err("被限流（429）".to_string());
    }

    // JSON 被关掉的实例：再抓一次结果页。
    let url = search_url(&base, query, false, fresh)?;
    let resp = http::send_quick("GET", &url, &headers, None)?;
    if !(200..300).contains(&resp.status) {
        return Err(format!("HTTP {}", resp.status));
    }
    Ok(parse_html(&String::from_utf8_lossy(&resp.body), limit, &base))
}

/* ─────────────────────────── 解析 ─────────────────────────── */

fn parse_json(body: &[u8], limit: usize) -> Vec<Hit> {
    let Ok(v) = serde_json::from_slice::<Value>(body) else { return Vec::new() };
    let Some(rows) = v.get("results").and_then(Value::as_array) else { return Vec::new() };
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in rows {
        let url = row.get("url").and_then(Value::as_str).unwrap_or("").trim().to_string();
        if !url.starts_with("http") || !seen.insert(url.clone()) {
            continue;
        }
        let title = text(row.get("title"));
        let snippet = clip(&text(row.get("content")), 300);
        let published = row
            .get("publishedDate")
            .and_then(Value::as_str)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        out.push(Hit { title: if title.is_empty() { url.clone() } else { title }, url, snippet, published });
        if out.len() >= limit {
            break;
        }
    }
    out
}

fn text(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or("").trim().to_string()
}

/// SearXNG 的结果页：一串 `<article class="result …">`，里面有 `<h3><a href=…>` 和
/// `<p class="content">`。没有 HTML 解析依赖，就按这两个锚点切。
fn parse_html(html: &str, limit: usize, base: &str) -> Vec<Hit> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut rest = html;
    while out.len() < limit {
        let Some(at) = find_result(rest) else { break };
        let start = rest[..at].rfind('<').unwrap_or(at);
        let Some(close) = rest[at..].find("</article>") else { break };
        let end = at + close;
        let block = &rest[start..end];
        let href = attr(block, "href").unwrap_or_default();
        // 有的实例把链接包成 `/redirect?url=…`，补成绝对地址照样能点。
        let url = if href.starts_with('/') { format!("{base}{href}") } else { href };
        if url.starts_with("http") && seen.insert(url.clone()) {
            let title = tag_text(block, "<h3", "</h3>").unwrap_or_default();
            out.push(Hit {
                title: if title.is_empty() { url.clone() } else { title },
                url,
                snippet: content_text(block),
                published: None,
            });
        }
        rest = &rest[end + "</article>".len()..];
    }
    out
}

/// 只认 `class="result "` / `class="result"` —— `class="results"` 是那个外层容器。
fn find_result(html: &str) -> Option<usize> {
    const KEY: &str = "class=\"result";
    let mut from = 0;
    while let Some(at) = html[from..].find(KEY) {
        let pos = from + at;
        match html[pos + KEY.len()..].chars().next() {
            Some(' ') | Some('"') => return Some(pos),
            _ => from = pos + 1,
        }
    }
    None
}

fn attr(block: &str, name: &str) -> Option<String> {
    let key = format!("{name}=\"");
    let at = block.find(&key)? + key.len();
    let end = block[at..].find('"')? + at;
    Some(unescape(&block[at..end]))
}

fn tag_text(block: &str, open: &str, close: &str) -> Option<String> {
    let at = block.find(open)?;
    let from = block[at..].find('>')? + at + 1;
    let end = block[from..].find(close)? + from;
    Some(strip_tags(&block[from..end]))
}

fn content_text(block: &str) -> String {
    let Some(at) = block.find("class=\"content") else { return String::new() };
    let Some(gt) = block[at..].find('>') else { return String::new() };
    let from = at + gt + 1;
    let Some(end) = block[from..].find("</p>") else { return String::new() };
    clip(&strip_tags(&block[from..from + end]), 300)
}

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    collapse(&unescape(&out))
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}
