//! 局域网同步服务（D-0195 ~ D-0198，协议见 `docs/mobile-web-sync.md`）。
//!
//! 一个 HTTPS 端口发两样东西：手机网页版（静态站点）和同步接口。手机与桌面同源，
//! 所以没有 CORS、没有混合内容，cookie 也自然带在 `<img src="/blob/…">` 上。
//!
//! ★ 只在局域网监听，不碰公网；数据只在本机和自己手机之间走。

mod cert;
mod merge;
mod proto;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::commands::{ApiError, ApiResult};
use crate::store::{self, docs, now_ms, Db};
use proto::{
    ChangesQuery, CommentPushResult, LogBody, PairBody, PushBody, PushComment, PushDoc, PushResult,
};

pub const DEFAULT_PORT: u16 = 43110;

struct Srv {
    db: Arc<Db>,
    /// 评论从手机写进来时，通知桌面那个窗口重读评论列表（D-0199）。
    app: tauri::AppHandle,
    token: String,
    code: Mutex<Option<(String, i64)>>,
    /// 配对尝试的时间戳（一分钟窗口内限 10 次）。
    attempts: Mutex<Vec<i64>>,
    tls: cert::Tls,
    web_root: PathBuf,
    port: u16,
    setup_port: u16,
    host: String,
    lan_ip: Option<String>,
    server_id: String,
}

static STATE: OnceLock<Arc<Srv>> = OnceLock::new();

/// 桌面启动时调一次。失败只记日志 —— 手机版挂了不能拖累桌面。
pub fn start(app: &tauri::AppHandle, db: Arc<Db>) {
    let dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            crate::log::record("sync", &format!("拿不到 app data 目录：{e}"));
            return;
        }
    };
    let tls = match cert::ensure(&dir) {
        Ok(t) => t,
        Err(e) => {
            crate::log::record("sync", &format!("证书不可用，手机版不启动：{e}"));
            return;
        }
    };

    let token = match settings_get(&db, "sync.token") {
        Some(t) if !t.is_empty() => t,
        _ => {
            let t = rand_hex(32);
            let _ = settings_set(&db, "sync.token", &t);
            t
        }
    };
    let server_id = match settings_get(&db, "sync.serverId") {
        Some(id) if !id.is_empty() => id,
        _ => {
            let id = rand_hex(12);
            let _ = settings_set(&db, "sync.serverId", &id);
            id
        }
    };

    let host = cert::hostname();
    let lan_ip = local_ip();
    let port = std::env::var("SELF_NOTION_SYNC_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(DEFAULT_PORT);
    let web_root = web_root(app);

    seed(&db);
    seed_comments(&db);

    let state = Arc::new(Srv {
        db: db.clone(),
        app: app.clone(),
        token,
        code: Mutex::new(None),
        attempts: Mutex::new(Vec::new()),
        tls,
        web_root,
        port,
        setup_port: port.saturating_add(1),
        host,
        lan_ip,
        server_id,
    });
    let _ = STATE.set(state.clone());
    refresh_code(&state);

    let url = https_url(&state);
    crate::log::record(
        "sync",
        &format!(
            "手机版已启动：{url}{}（根证书 http://{}:{}/ca.pem）",
            local_url(&state)
                .map(|u| format!("，备用 {u}"))
                .unwrap_or_default(),
            state.lan_ip.clone().unwrap_or_else(|| state.host.clone()),
            state.setup_port
        ),
    );
    if !state.web_root.join("index.html").exists() {
        crate::log::record(
            "sync",
            &format!(
                "网页版产物不存在（{}）：开发时先跑 pnpm build:web；打包版检查 bundle.resources 是否带上了 dist-web",
                state.web_root.display()
            ),
        );
    }

    // HTTPS：网页版 + 接口
    let st = state.clone();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
            Ok(rt) => rt,
            Err(e) => {
                crate::log::record("sync", &format!("起运行时失败：{e}"));
                return;
            }
        };
        rt.block_on(async move {
            rustls::crypto::ring::default_provider().install_default().ok();
            let cfg = match axum_server::tls_rustls::RustlsConfig::from_pem(
                st.tls.cert_pem.clone(),
                st.tls.key_pem.clone(),
            )
            .await
            {
                Ok(c) => c,
                Err(e) => {
                    crate::log::record("sync", &format!("TLS 配置失败：{e}"));
                    return;
                }
            };
            let addr = SocketAddr::from(([0, 0, 0, 0], st.port));
            if let Err(e) = axum_server::bind_rustls(addr, cfg)
                .serve(app_router(st.clone()).into_make_service())
                .await
            {
                crate::log::record("sync", &format!("HTTPS 监听失败（{addr}）：{e}"));
            }
        });
    });

    // 辅助 HTTP：只发根证书和安装说明，避免第一次访问就撞证书警告。
    let st = state.clone();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
            Ok(rt) => rt,
            Err(e) => {
                crate::log::record("sync", &format!("起运行时失败：{e}"));
                return;
            }
        };
        rt.block_on(async move {
            let addr = SocketAddr::from(([0, 0, 0, 0], st.setup_port));
            if let Err(e) = axum_server::bind(addr)
                .serve(setup_router(st.clone()).into_make_service())
                .await
            {
                crate::log::record("sync", &format!("HTTP 监听失败（{addr}）：{e}"));
            }
        });
    });
}

/* ─────────────────────────── 供设置页用的两条命令 ─────────────────────────── */

pub fn status() -> Value {
    let Some(st) = STATE.get() else {
        return json!({ "running": false });
    };
    let paired = settings_get(&st.db, "sync.paired").as_deref() == Some("1");
    let code = current_code(st).unwrap_or_default();
    let pair_url = pair_url(st, &code);
    json!({
        "running": true,
        "url": https_url(st),
        "urlAlt": local_url(st),
        "setupUrl": format!("http://{}:{}/", st.lan_ip.clone().unwrap_or_else(|| st.host.clone()), st.setup_port),
        "caUrl": format!("http://{}:{}/ca.pem", st.lan_ip.clone().unwrap_or_else(|| st.host.clone()), st.setup_port),
        "code": code,
        "pairUrl": pair_url,
        "qrSvg": qr_svg(&pair_url),
        "paired": paired,
        "port": st.port,
    })
}

pub fn new_code() -> Value {
    let Some(st) = STATE.get() else {
        return json!({ "running": false });
    };
    refresh_code(st);
    let code = current_code(st).unwrap_or_default();
    let pair_url = pair_url(st, &code);
    json!({ "code": code, "pairUrl": pair_url, "qrSvg": qr_svg(&pair_url) })
}

/** 扫一下就能直接配对：地址后面带上 6 位码，网页配对页会自己填。 */
fn pair_url(st: &Srv, code: &str) -> String {
    if code.is_empty() {
        return String::new();
    }
    format!("{}/?code={code}", https_url(st))
}

fn qr_svg(text: &str) -> String {
    qrcode::QrCode::new(text.as_bytes())
        .map(|code| {
            code.render::<qrcode::render::svg::Color>()
                .min_dimensions(200, 200)
                .build()
        })
        .unwrap_or_default()
}

/* ─────────────────────────── 路由 ─────────────────────────── */

fn app_router(st: Arc<Srv>) -> Router {
    let data = Router::new()
        .route("/sync/hello", get(hello))
        .route("/sync/changes", get(changes))
        .route("/sync/push", post(push))
        .route("/blob/{id}", get(blob_get))
        .route("/blob", post(blob_put))
        // 手机端的现场包（D-0126 的同一个目录）：网页侧把 DOM / 尺寸 / 报错打成一包，
        // 桌面 agent 直接读 `bugs/`，不用让用户在手机上开控制台。
        .route("/bug", post(bug_report))
        .layer(middleware::from_fn_with_state(st.clone(), auth));

    // 日志接口不鉴权：配对之前的启动错误也要能落进 errors.log（AGENTS §3）。
    let open = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ca.pem", get(ca_pem))
        .route("/pair", post(pair))
        .route("/log/error", post(log_error));

    let index = st.web_root.join("index.html");
    let serve = ServeDir::new(&st.web_root).not_found_service(ServeFile::new(index));
    data.merge(open)
        .fallback_service(serve)
        // 默认 2 MB：一张图就超了，一批文档更不用说。
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        // 手机走局域网拿 JS / CSS 时先压一遍（D-0199）。
        .layer(CompressionLayer::new())
        .with_state(st)
}

fn setup_router(st: Arc<Srv>) -> Router {
    Router::new()
        .route("/", get(setup_page))
        .route("/ca.pem", get(ca_pem))
        .layer(CompressionLayer::new())
        .with_state(st)
}

async fn auth(State(st): State<Arc<Srv>>, req: Request, next: Next) -> Response {
    if authorized(&st, req.headers()) {
        return next.run(req).await;
    }
    (StatusCode::UNAUTHORIZED, "unauthorized").into_response()
}

fn authorized(st: &Srv, headers: &HeaderMap) -> bool {
    if let Some(v) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if v.strip_prefix("Bearer ") == Some(st.token.as_str()) {
            return true;
        }
    }
    headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|c| {
            c.split(';').any(|part| {
                let part = part.trim();
                part.strip_prefix("sn_token=") == Some(st.token.as_str())
            })
        })
        .unwrap_or(false)
}

/* ─────────────────────────── 配对 / 证书 / 说明页 ─────────────────────────── */

async fn pair(State(st): State<Arc<Srv>>, Json(body): Json<PairBody>) -> Response {
    if !allow_attempt(&st) {
        return (StatusCode::TOO_MANY_REQUESTS, "too many attempts").into_response();
    }
    let ok = {
        let mut guard = match st.code.lock() {
            Ok(g) => g,
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "lock").into_response(),
        };
        match guard.as_ref() {
            Some((code, exp)) if *exp > now_ms() && code == &body.code => {
                *guard = None;
                true
            }
            _ => false,
        }
    };
    if !ok {
        return (StatusCode::FORBIDDEN, "wrong code").into_response();
    }
    let _ = settings_set(&st.db, "sync.paired", "1");
    let cookie = format!(
        "sn_token={}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure",
        st.token
    );
    let mut resp = Json(json!({ "token": st.token })).into_response();
    if let Ok(v) = cookie.parse() {
        resp.headers_mut().insert(header::SET_COOKIE, v);
    }
    resp
}

async fn ca_pem(State(st): State<Arc<Srv>>) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/x-pem-file")
        .header(header::CONTENT_DISPOSITION, "attachment; filename=\"self-notion-ca.pem\"")
        .body(Body::from(st.tls.cert_pem.clone()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn setup_page(State(st): State<Arc<Srv>>) -> Html<String> {
    let url = https_url(&st);
    let alt = local_url(&st)
        .map(|u| format!("<li>备用地址：<a href=\"{u}\"><code>{u}</code></a>（IP 变了再用）</li>"))
        .unwrap_or_default();
    Html(format!(
        r#"<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>self-notion 手机版</title>
<style>
body{{font:16px/1.7 -apple-system,system-ui,"PingFang SC",sans-serif;max-width:36rem;margin:0 auto;padding:2rem 1.2rem;color:#222}}
a.btn{{display:inline-block;margin:.8rem 0;padding:.7rem 1.2rem;border-radius:.6rem;background:#1e96eb;color:#fff;text-decoration:none}}
code{{background:#f2f2f2;padding:.15rem .35rem;border-radius:.25rem;word-break:break-all}}
li{{margin:.4rem 0}} ol{{padding-left:1.2rem}}
</style>
<h2>self-notion 手机版</h2>
<p>先装根证书，再用手机浏览器打开网页版。整个过程只在你自己的局域网里。</p>
<ol>
<li><a class="btn" href="/ca.pem">1. 下载根证书</a>
  <div style="font-size:14px;color:#666">iPhone：设置 → 已下载描述文件 → 安装；再到「通用 → 关于本机 → 证书信任设置」里打开完全信任。<br>
  Android：设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书。</div></li>
<li>用 Safari / Chrome 打开 <a href="{url}"><code>{url}</code></a></li>
{alt}
<li>在桌面端「设置 → 手机版」里看 6 位配对码，输入即可。</li>
<li>浏览器菜单里选「添加到主屏幕」—— 之后断网也能用。</li>
</ol>
<p style="font-size:13px;color:#888">如果打不开，确认手机和电脑在同一个 Wi-Fi，且电脑没休眠。</p>
</html>"#
    ))
}

/* ─────────────────────────── 同步接口 ─────────────────────────── */

async fn hello(State(st): State<Arc<Srv>>) -> Response {
    let cursor = match st.db.with(max_seq) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let paired = settings_get(&st.db, "sync.paired").as_deref() == Some("1");
    Json(json!({
        "protocol": 1,
        "serverId": st.server_id,
        "cursor": cursor,
        "paired": paired,
    }))
    .into_response()
}

async fn changes(State(st): State<Arc<Srv>>, Query(q): Query<ChangesQuery>) -> Response {
    let since = q.since.unwrap_or(0);
    let limit = q.limit.unwrap_or(200).clamp(1, 500);
    match st.db.with(|c| collect_changes(c, since, limit)) {
        Ok(v) => Json(v).into_response(),
        Err(e) => err(e),
    }
}

async fn push(State(st): State<Arc<Srv>>, Json(body): Json<PushBody>) -> Response {
    let mut results = Vec::with_capacity(body.docs.len());
    let mut reload_ids: Vec<String> = Vec::new();
    let mut docs_changed = false;
    for d in body.docs {
        match st.db.with(|c| apply_push(c, &d)) {
            Ok(r) => {
                // 冲突时库里还是桌面这份，窗口不用动。其余写进了库，开着的窗口还停在旧正文上。
                if r.status == "accepted" || r.status == "merged" {
                    docs_changed = true;
                    reload_ids.push(r.id.clone());
                } else if r.status == "deleted" {
                    docs_changed = true;
                }
                results.push(r);
            }
            Err(e) => return err(e),
        }
    }
    if docs_changed {
        let _ = st.app.emit("sn:docs", json!({ "ids": reload_ids }));
    }
    for src in body.sources {
        let out = st.db.with(|c| {
            if store::sync::get(c, &src.id).is_ok() {
                store::sync::put(c, &src.id, &src.content)
            } else {
                c.execute(
                    "INSERT INTO sync(id, content, at) VALUES(?1, ?2, ?3)",
                    rusqlite::params![src.id, src.content, now_ms()],
                )
                .map_err(store::db_err)?;
                Ok(())
            }
        });
        if let Err(e) = out {
            return err(e);
        }
    }
    let mut comment_results = Vec::with_capacity(body.comments.len());
    for c in body.comments {
        match st.db.with(|conn| apply_comment(conn, &c)) {
            Ok(r) => comment_results.push(r),
            Err(e) => return err(e),
        }
    }
    if !comment_results.is_empty() {
        // 桌面窗口可能正开着这篇：让它重读评论，不然手机上写的评论要等下次打开才出现。
        let _ = st.app.emit("sn:comments", json!({}));
    }
    Json(json!({ "results": results, "commentResults": comment_results })).into_response()
}

async fn blob_get(State(st): State<Arc<Srv>>, Path(id): Path<String>, headers: HeaderMap) -> Response {
    let hit = match st.db.with(|c| store::blob::get(c, &id)) {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let Some((mime, bytes)) = hit else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    let total = bytes.len();
    if let Some(range) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
        if let Some(rest) = range.strip_prefix("bytes=") {
            let mut it = rest.split('-');
            let start: usize = it.next().unwrap_or("").parse().unwrap_or(0);
            let end: usize = it
                .next()
                .unwrap_or("")
                .parse()
                .unwrap_or(total.saturating_sub(1))
                .min(total.saturating_sub(1));
            if start <= end && start < total {
                let body = bytes[start..=end].to_vec();
                return Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_TYPE, mime)
                    .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                    .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                    .body(Body::from(body))
                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
            }
        }
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn blob_put(State(st): State<Arc<Srv>>, headers: HeaderMap, body: Bytes) -> Response {
    let want = headers.get("x-sn-id").and_then(|v| v.to_str().ok()).unwrap_or("");
    let got = format!("{:x}", Sha256::digest(&body));
    if want != got {
        return (StatusCode::BAD_REQUEST, "id mismatch").into_response();
    }
    let mime = headers
        .get("x-sn-mime")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    match st.db.with(|c| store::blob::put(c, &body, &mime)) {
        Ok(meta) => Json(meta).into_response(),
        Err(e) => err(e),
    }
}

async fn bug_report(Json(payload): Json<Value>) -> Response {
    match crate::bugs::write(payload) {
        Ok(v) => {
            let name = v.get("name").and_then(Value::as_str).unwrap_or("?");
            crate::log::record("bug", &format!("收到手机端现场包：{name}"));
            Json(v).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

async fn log_error(State(_st): State<Arc<Srv>>, Json(body): Json<LogBody>) -> Response {
    crate::log::record(
        if body.source.is_empty() { "web" } else { &body.source },
        &body.message,
    );
    StatusCode::NO_CONTENT.into_response()
}

/* ─────────────────────────── 数据操作 ─────────────────────────── */

fn collect_changes(conn: &rusqlite::Connection, since: i64, limit: i64) -> ApiResult<Value> {
    // ★ 带 entity 出来：同一个 id 可能先写过文档、后被硬删（'del'），也可能先是评论、后被删（'cdel'）。
    //   SQLite 的「bare column + MAX」取的正是 seq 最大的那一步。
    let mut stmt = conn
        .prepare(
            "SELECT id, entity, MAX(seq) FROM sync_log
             WHERE seq > ?1 AND entity IN ('doc','meta','del','src','comment','cdel')
             GROUP BY id ORDER BY MAX(seq) LIMIT ?2",
        )
        .map_err(store::db_err)?;
    let rows = stmt
        .query_map(rusqlite::params![since, limit], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        })
        .map_err(store::db_err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(store::db_err)?;

    let mut cursor = since;
    let mut docs_out = Vec::new();
    let mut deleted = Vec::new();
    let mut sources = Vec::new();
    let mut comments = Vec::new();
    let mut deleted_comments = Vec::new();
    for (id, entity, seq) in &rows {
        cursor = cursor.max(*seq);
        match entity.as_str() {
            "comment" => match comment_record(conn, id)? {
                Some(v) => comments.push(v),
                None => deleted_comments.push(id.clone()),
            },
            "cdel" => deleted_comments.push(id.clone()),
            "src" => match store::sync::get(conn, id) {
                Ok(content) => sources.push(json!({ "id": id, "content": content })),
                Err(_) => deleted.push(id.clone()),
            },
            "del" => deleted.push(id.clone()),
            _ => match record(conn, id)? {
                Some(v) => docs_out.push(v),
                None => match store::sync::get(conn, id) {
                    Ok(content) => sources.push(json!({ "id": id, "content": content })),
                    Err(_) => deleted.push(id.clone()),
                },
            },
        }
    }
    if (rows.len() as i64) < limit {
        cursor = max_seq(conn)?;
    }
    Ok(json!({
        "cursor": cursor,
        "docs": docs_out,
        "deleted": deleted,
        "sources": sources,
        "comments": comments,
        "deletedComments": deleted_comments
    }))
}

fn record(conn: &rusqlite::Connection, id: &str) -> ApiResult<Option<Value>> {
    let meta = match docs::get(conn, id) {
        Ok(m) => m,
        Err(e) if e.code == "not_found" => return Ok(None),
        Err(e) => return Err(e),
    };
    let content: Option<String> = conn
        .query_row("SELECT content FROM doc WHERE doc_id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(store::db_err)?;
    // 投影一起给：手机端搜索 / 摘要不联网也要有正文。没落过投影就是空串。
    let md: String = conn
        .query_row("SELECT md FROM doc_text WHERE doc_id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(store::db_err)?
        .unwrap_or_default();
    Ok(Some(json!({
        "id": id,
        "rev": rev(conn, id)?,
        "content": content,
        "md": md,
        "meta": serde_json::to_value(meta).unwrap_or(Value::Null),
    })))
}

fn comment_record(conn: &rusqlite::Connection, id: &str) -> ApiResult<Option<Value>> {
    conn.query_row(
        "SELECT id, doc_id, parent_id, anchor, block_id, quote, body, resolved, created_at, updated_at
         FROM comment WHERE id = ?1",
        [id],
        |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "docId": r.get::<_, String>(1)?,
                "parentId": r.get::<_, Option<String>>(2)?,
                "anchor": r.get::<_, String>(3)?,
                "blockId": r.get::<_, Option<String>>(4)?,
                "quote": r.get::<_, String>(5)?,
                "body": r.get::<_, String>(6)?,
                "resolved": r.get::<_, i64>(7)? != 0,
                "createdAt": r.get::<_, i64>(8)?,
                "updatedAt": r.get::<_, i64>(9)?,
            }))
        },
    )
    .optional()
    .map_err(store::db_err)
}

/// 评论按 updated_at 最后写入者胜（单人应用，不需要三方合并）。
fn apply_comment(conn: &rusqlite::Connection, c: &PushComment) -> ApiResult<CommentPushResult> {
    let at = if c.updated_at > 0 { c.updated_at } else { now_ms() };
    let existing: Option<i64> = conn
        .query_row("SELECT updated_at FROM comment WHERE id = ?1", [&c.id], |r| r.get(0))
        .optional()
        .map_err(store::db_err)?;

    if c.mode == "delete" {
        if let Some(server) = existing {
            if server > at {
                return Ok(CommentPushResult {
                    id: c.id.clone(),
                    status: "stale",
                    comment: comment_record(conn, &c.id)?,
                });
            }
            // 连带删回复（和 `store::comment::remove` 同一条规矩）。
            conn.execute("DELETE FROM comment WHERE id = ?1 OR parent_id = ?1", [&c.id])
                .map_err(store::db_err)?;
        }
        return Ok(CommentPushResult { id: c.id.clone(), status: "deleted", comment: None });
    }

    if let Some(server) = existing {
        if server > at {
            return Ok(CommentPushResult {
                id: c.id.clone(),
                status: "stale",
                comment: comment_record(conn, &c.id)?,
            });
        }
    }
    conn.execute(
        "INSERT INTO comment(id, doc_id, parent_id, anchor, block_id, quote, body, resolved,
                             created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           doc_id = excluded.doc_id,
           parent_id = excluded.parent_id,
           anchor = excluded.anchor,
           block_id = excluded.block_id,
           quote = excluded.quote,
           body = excluded.body,
           resolved = excluded.resolved,
           updated_at = excluded.updated_at",
        rusqlite::params![
            c.id,
            c.doc_id,
            c.parent_id,
            c.anchor,
            c.block_id,
            c.quote,
            c.body,
            c.resolved as i64,
            c.created_at.unwrap_or(at),
            at
        ],
    )
    .map_err(store::db_err)?;
    Ok(CommentPushResult {
        id: c.id.clone(),
        status: "accepted",
        comment: comment_record(conn, &c.id)?,
    })
}

fn rev(conn: &rusqlite::Connection, id: &str) -> ApiResult<i64> {
    conn.query_row("SELECT rev FROM doc_sync WHERE doc_id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(store::db_err)
        .map(|v| v.unwrap_or(0))
}

fn content(conn: &rusqlite::Connection, id: &str) -> ApiResult<Option<String>> {
    conn.query_row("SELECT content FROM doc WHERE doc_id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(store::db_err)
}

fn max_seq(conn: &rusqlite::Connection) -> ApiResult<i64> {
    conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM sync_log", [], |r| r.get(0))
        .map_err(store::db_err)
}

fn apply_push(conn: &rusqlite::Connection, d: &PushDoc) -> ApiResult<PushResult> {
    let exists = docs::get(conn, &d.id).is_ok();
    let current = rev(conn, &d.id)?;

    match d.mode.as_str() {
        "hardDelete" => {
            if !exists {
                return Ok(PushResult::deleted(&d.id));
            }
            if d.base_rev != current {
                return conflict(conn, &d.id);
            }
            docs::remove(conn, &d.id)?;
            Ok(PushResult::deleted(&d.id))
        }
        "trash" | "restore" => {
            if exists && d.base_rev != current {
                return conflict(conn, &d.id);
            }
            ensure_row(conn, d)?;
            let at = d.updated_at.unwrap_or_else(now_ms);
            let deleted = if d.mode == "trash" { Some(at) } else { None };
            conn.execute(
                "UPDATE documents SET deleted_at = ?2, updated_at = ?3 WHERE id = ?1",
                rusqlite::params![d.id, deleted, at],
            )
            .map_err(store::db_err)?;
            accepted(conn, &d.id)
        }
        _ => {
            if !exists {
                ensure_row(conn, d)?;
                write_doc(conn, d, d.content.as_deref())?;
                return accepted(conn, &d.id);
            }
            if d.base_rev != current {
                // 远端在手机离线期间变过：先试块级三方合并。
                let server = content(conn, &d.id)?;
                match (&d.content, &server) {
                    (Some(cc), Some(sc)) => match merge::three_way(d.base_content.as_deref(), sc, cc) {
                        Some(merged) => {
                            // 合并后的投影要按合并结果重算，不能沿用手机那份（它没有桌面后加的块）。
                            let mut edited = d.clone();
                            edited.md = merge::plain_md(&merged);
                            write_doc(conn, &edited, Some(&merged))?;
                            return Ok(PushResult::merged(
                                &d.id,
                                rev(conn, &d.id)?,
                                Some(merged),
                                md_of(conn, &d.id)?,
                                docs::get(conn, &d.id).ok().and_then(|m| serde_json::to_value(m).ok()),
                            ));
                        }
                        None => return conflict(conn, &d.id),
                    },
                    (None, _) => {
                        write_doc(conn, d, server.as_deref())?;
                        return accepted(conn, &d.id);
                    }
                    (Some(cc), None) => {
                        write_doc(conn, d, Some(cc))?;
                        return accepted(conn, &d.id);
                    }
                }
            }
            write_doc(conn, d, d.content.as_deref())?;
            accepted(conn, &d.id)
        }
    }
}

fn conflict(conn: &rusqlite::Connection, id: &str) -> ApiResult<PushResult> {
    let r = rev(conn, id)?;
    Ok(PushResult::conflict(
        id,
        r,
        content(conn, id)?,
        md_of(conn, id)?,
        docs::get(conn, id).ok().and_then(|m| serde_json::to_value(m).ok()),
    ))
}

fn accepted(conn: &rusqlite::Connection, id: &str) -> ApiResult<PushResult> {
    Ok(PushResult::accepted(
        id,
        rev(conn, id)?,
        content(conn, id)?,
        md_of(conn, id)?,
        docs::get(conn, id).ok().and_then(|m| serde_json::to_value(m).ok()),
    ))
}

fn md_of(conn: &rusqlite::Connection, id: &str) -> ApiResult<Option<String>> {
    conn.query_row("SELECT md FROM doc_text WHERE doc_id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(store::db_err)
}

fn ensure_row(conn: &rusqlite::Connection, d: &PushDoc) -> ApiResult<()> {
    if docs::get(conn, &d.id).is_ok() {
        return Ok(());
    }
    let at = d.created_at.unwrap_or_else(now_ms);
    conn.execute(
        "INSERT OR IGNORE INTO documents(id, parent_id, title, icon, sort_order, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            d.id,
            d.parent_id,
            d.title,
            d.icon,
            d.sort_order.unwrap_or(0.0),
            at,
            d.updated_at.unwrap_or(at)
        ],
    )
    .map_err(store::db_err)?;
    Ok(())
}

fn write_doc(conn: &rusqlite::Connection, d: &PushDoc, body: Option<&str>) -> ApiResult<()> {
    ensure_row(conn, d)?;
    if let Some(c) = body {
        docs::apply(
            conn,
            docs::Apply {
                id: &d.id,
                content: Some(c),
                origin: "user",
                group_id: None,
                label: None,
                title: Some(&d.title),
                md: Some(&d.md),
                links: None,
            },
        )?;
    } else {
        // 标题清空也要同步 —— 不能因为空串就跳过。
        docs::rename(conn, &d.id, &d.title)?;
    }

    let tags = serde_json::to_string(d.tags.as_deref().unwrap_or(&[] as &[String])).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "UPDATE documents SET
           parent_id = ?2,
           icon = ?3,
           sort_order = COALESCE(?4, sort_order),
           is_favorite = COALESCE(?5, is_favorite),
           pinned_at = ?6,
           deleted_at = ?7,
           tags = ?8,
           updated_at = MAX(updated_at, COALESCE(?9, updated_at))
         WHERE id = ?1",
        rusqlite::params![
            d.id,
            d.parent_id,
            d.icon,
            d.sort_order,
            d.is_favorite.map(|v| v as i64),
            d.pinned_at,
            d.deleted_at,
            tags,
            d.updated_at
        ],
    )
    .map_err(store::db_err)?;
    Ok(())
}

/* ─────────────────────────── 杂项 ─────────────────────────── */

fn err(e: ApiError) -> Response {
    let status = match e.code.as_str() {
        "not_found" => StatusCode::NOT_FOUND,
        "bad_args" => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    (status, Json(json!({ "code": e.code, "message": e.message }))).into_response()
}

/// 第一次启动时把**已有的**文档补进变更日志 —— 触发器只管以后写的，
/// 老库里那批不补，手机第一次拉取会是一张空表。只跑一次，`sync.seeded` 记住。
fn seed(db: &Db) {
    if settings_get(db, "sync.seeded").as_deref() == Some("1") {
        return;
    }
    let out = db.with(|conn| {
        let tx = conn.unchecked_transaction().map_err(store::db_err)?;
        let at = now_ms();
        tx.execute(
            "INSERT INTO sync_log(entity, id, at) SELECT 'meta', id, ?1 FROM documents",
            [at],
        )
        .map_err(store::db_err)?;
        tx.execute(
            "INSERT INTO sync_log(entity, id, at) SELECT 'doc', doc_id, ?1 FROM doc",
            [at],
        )
        .map_err(store::db_err)?;
        tx.execute(
            "INSERT OR IGNORE INTO doc_sync(doc_id, rev, at) SELECT id, 0, ?1 FROM documents",
            [at],
        )
        .map_err(store::db_err)?;
        tx.execute(
            "INSERT INTO sync_log(entity, id, at) SELECT 'src', id, ?1 FROM sync",
            [at],
        )
        .map_err(store::db_err)?;
        tx.execute(
            "INSERT INTO meta(key, value) VALUES('setting.sync.seeded', '1')
             ON CONFLICT(key) DO UPDATE SET value = '1'",
            [],
        )
        .map_err(store::db_err)?;
        tx.commit().map_err(store::db_err)
    });
    if let Err(e) = out {
        crate::log::record("sync", &format!("首次同步种子失败：{}", e.message));
    }
}

/// 评论是后加进同步的（D-0199）：老库里已有的评论补一次日志，否则手机首轮拉不到。
fn seed_comments(db: &Db) {
    if settings_get(db, "sync.seeded.comments").as_deref() == Some("1") {
        return;
    }
    let out = db.with(|conn| {
        let at = now_ms();
        conn.execute("INSERT INTO sync_log(entity, id, at) SELECT 'comment', id, ?1 FROM comment", [at])
            .map_err(store::db_err)?;
        Ok(())
    });
    match out {
        Ok(()) => {
            let _ = settings_set(db, "sync.seeded.comments", "1");
        }
        Err(e) => crate::log::record("sync", &format!("评论同步种子失败：{}", e.message)),
    }
}

fn settings_get(db: &Db, key: &str) -> Option<String> {
    db.with(|c| store::settings_get(c, key)).ok().flatten()
}

fn settings_set(db: &Db, key: &str, value: &str) -> ApiResult<()> {
    db.with(|c| store::settings_set(c, key, value))
}

fn rand_hex(n: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn refresh_code(st: &Srv) {
    use rand::Rng;
    let code = format!("{:06}", rand::thread_rng().gen_range(0..1_000_000u32));
    if let Ok(mut g) = st.code.lock() {
        *g = Some((code, now_ms() + 5 * 60_000));
    }
}

fn current_code(st: &Srv) -> Option<String> {
    let g = st.code.lock().ok()?;
    if let Some((code, exp)) = g.as_ref() {
        if *exp > now_ms() {
            return Some(code.clone());
        }
    }
    drop(g);
    refresh_code(st);
    st.code.lock().ok()?.as_ref().map(|(c, _)| c.clone())
}

fn allow_attempt(st: &Srv) -> bool {
    let now = now_ms();
    let Ok(mut g) = st.attempts.lock() else {
        return false;
    };
    g.retain(|t| now - *t < 60_000);
    if g.len() >= 10 {
        return false;
    }
    g.push(now);
    true
}

/// 首选地址：局域网 IP。手机和 Mac 在同一网段时一定能解析，证书里也有这条。
fn ip_url(st: &Srv) -> Option<String> {
    st.lan_ip.as_ref().map(|ip| format!("https://{ip}:{}", st.port))
}

/// 备用地址：Bonjour 名字。换 IP 之后仍然可用（证书 SAN 里有 `*.local`）。
fn local_url(st: &Srv) -> Option<String> {
    if st.host.is_empty() || st.host.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }
    Some(format!("https://{}.local:{}", st.host, st.port))
}

fn https_url(st: &Srv) -> String {
    ip_url(st)
        .or_else(|| local_url(st))
        .unwrap_or_else(|| format!("https://localhost:{}", st.port))
}

fn local_ip() -> Option<String> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    s.local_addr().ok().map(|a| a.ip().to_string())
}

/// 网页版构建产物：开发期读仓库里的 `dist-web`，打包后读 Tauri 资源目录。
fn web_root(app: &tauri::AppHandle) -> PathBuf {
    if let Some(p) = std::env::var_os("SELF_NOTION_WEB") {
        return PathBuf::from(p);
    }
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../apps/desktop/dist-web");
    }
    // 打包版：先看 bundle.resources 的目标目录，再看几种常见落点 —— 目录映射写错时
    // 不至于让手机端直接 404（`app data/web` 还能手动补一份）。
    if let Ok(dir) = app.path().resource_dir() {
        for cand in [dir.join("web"), dir.join("dist-web"), dir.join("resources/web")] {
            if cand.join("index.html").exists() {
                return cand;
            }
        }
    }
    if let Ok(dir) = app.path().app_data_dir() {
        let cand = dir.join("web");
        if cand.join("index.html").exists() {
            return cand;
        }
    }
    app.path()
        .resource_dir()
        .map(|d| d.join("web"))
        .unwrap_or_else(|_| PathBuf::from("web"))
}
