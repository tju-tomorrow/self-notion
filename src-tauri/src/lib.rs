//! Tauri 核心：**能力提供方，不插件化**（docs/architecture.md 第九节）。
//! 组合与扩展全在前端的 Cordis 层。

use tauri::http::{header, HeaderValue, StatusCode};
use tauri::Manager;

mod ai;
mod aiweb;
mod assoc;
mod backup;
mod bugs;
mod commands;
mod disk;
#[cfg(target_os = "macos")]
mod dock;
mod log;
pub mod mcp;
mod mem;
mod store;
mod vfs;
mod windows;

pub fn run() {
    // panic 也进 errors.log —— 先装，后面任何一步崩了都有记录。
    log::install_panic_hook();

    let mut builder = tauri::Builder::default();

    // ★ 必须第一个注册：两个实例会同时打开同一个 SQLite。
    // 第二个进程**到不了 `run()`** —— 它把 argv 交给第一个实例后自己退出（插件在自己的
    // setup 钩子里 `exit(0)`，plugin setup 先于 app setup），所以这次 `Db::open` 不会跑第二遍。
    // 回调跑在**先起的那个进程**里：把已有窗口提到前台，让「再点一次图标」有反馈。
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));

    builder
        // 只恢复用户真的改过的东西：大小 / 位置 / 最大化。
        // 不能用默认的 `all()` —— 那是连 decorations / fullscreen / visible 一起存，
        // 等于让「上次运行」去改写 `tauri.conf.json` 里冻结的窗口定义。
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // 应用菜单：默认那套 + File ▸ New Window（`windows.rs`）。
        .menu(windows::menu)
        .on_menu_event(|app, event| windows::on_menu(app, &event.id().0))
        // 图片 / 附件（D-0027）：`blob:getUrl` 回的就是 `self-notion://blob/<id>`，这里把它接上。
        // **只读** —— 写一律走 `blob:put` 命令，协议只服务 `<img src>` / `<video>` / `<audio>`。
        // 协议名和 CSP 里那句 `self-notion:`（img-src / connect-src）必须逐字一致，
        // 名字对不上不是报错，是白图（D-0050）。
        .register_uri_scheme_protocol("self-notion", |ctx, request| {
            let id = blob_id_from(request.uri());
            let db = ctx.app_handle().state::<store::Db>();
            // 取字节这件事只有 store::blob 一个出口（它和 blob:put 共用同一张表的知识）。
            let hit = db.with(|conn| store::blob::get(conn, id));
            match hit {
                // ★ 带 Range 就回 206 的那一段 —— `<video>` / `<audio>` 拖进度靠它（没有 Range
                //   的 `<img>` 那条路维持 200 全量）。
                Ok(Some((mime, bytes))) => {
                    blob_response(request.headers().get(header::RANGE), &mime, bytes)
                }
                // 信任边界：id 是外面给的，查不到就是 404，不 panic。前端 `<img>` 显示裂图，
                // 那正是「这个 blob 不存在」该有的样子。
                // 但**要留痕** —— 404 是静默失败里最难查的一种（AGENTS.md §3）：
                // 没有这一行，界面上看到的只有「裂图」，看不出是存错了还是查错了。
                Ok(None) => {
                    log::record("blob", &format!("404 {id}"));
                    reply(StatusCode::NOT_FOUND, "text/plain", Vec::new())
                }
                Err(err) => {
                    log::record("blob", &format!("{id}: {err}"));
                    reply(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", Vec::new())
                }
            }
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            log::init(app.handle());
            // Dock 图标的右键菜单（`dock.rs`）：要主线程 + Tauri 的 delegate 已挂上。
            #[cfg(target_os = "macos")]
            crate::dock::install(app.handle());
            // 磁盘上只有一个 self-notion.db（外加 blob / 索引，都在同一库里）
            app.manage(store::Db::open(&dir.join("self-notion.db"))?);
            // 兜底（见 `reveal`）：前端要是压根没起来，窗口也得出来 ——
            // 那里面至少有个错误框，比「窗口一直不出现」好查得多。
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                let _ = reveal(&handle, Some("main"));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::api])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // ★ 有回调才接得到 `RunEvent::Opened`（原来那个 `builder.run(ctx)` 是 `build()?.run(|_,_| {})`，
        //   事件全被丢掉了）。这条路径只在 macOS 上存在，别的平台连 variant 都没有。
        .run(|handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if let Err(err) = assoc::deliver(handle, paths) {
                    log::record("assoc", &err);
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (handle, event);
        });
}

/// 把窗口露出来。**窗口定义里是 `visible: false`**（`tauri.conf.json`）——
/// 不然启动那一下会先闪一个空的毛玻璃窗，然后内容「啪」地一下顶上来。
/// 前端画完第一帧调 `boot:ready`，这条就被调到；`setup` 里那个 4 秒定时器是兜底。
/// 幂等：已经露着再调一次没事。
///
/// `label` = 调 `boot:ready` 的那个窗口（多开出来的窗口也得自己露出来，不能只认 `main`）。
pub fn reveal(app: &tauri::AppHandle, label: Option<&str>) -> Result<(), String> {
    let want = label.unwrap_or("main");
    // ★ 报错要带上是**哪个** label 没找到 —— 日志里那句干巴巴的「窗口不见了」查不出是哪条路
    //   （`errors.log` 里它已经攒了几十条，全是同一个谜）。
    let w = app.get_webview_window(want).ok_or(format!("窗口不见了：{want}"))?;
    w.show().map_err(|e| e.to_string())?;
    let _ = w.set_focus();
    Ok(())
}

/// `self-notion://blob/<id>` → `<id>`。
///
/// WKWebView 只认 `scheme://host/path` 这个形状，所以正常请求是 host=`blob`、path=`/<id>`。
/// **不假设 id 一定在 path 里**：host 段直接就是 id 的也认。别的形状回空串 → 查不到 → 404。
fn blob_id_from(uri: &tauri::http::Uri) -> &str {
    let host = uri.host().unwrap_or_default();
    let seg = uri.path().trim_start_matches('/');
    if host == "blob" {
        seg
    } else if seg.is_empty() {
        host
    } else {
        ""
    }
}

/// blob 的响应：带 `Range` 就回 206 的那一段，不带（图片那条路）回 200 全量。
///
/// ★ 为什么非有 Range 不可：媒体块把 `self-notion://blob/<id>` 当 `<video>` / `<audio>` 的
///   `src`，WKWebView 拉本地媒体**常常先发 Range 探测**，拖进度也是 Range。只回 200 全量时
///   它拿不到 `Content-Range`，就不给播 / 不给拖。图片从不需要 Range，所以这条对图片是透明的。
fn blob_response(
    range: Option<&HeaderValue>,
    mime: &str,
    bytes: Vec<u8>,
) -> tauri::http::Response<Vec<u8>> {
    let total = bytes.len() as u64;
    match range.and_then(|v| v.to_str().ok()).and_then(|h| parse_range(h, total)) {
        Some((start, end)) => {
            // 闭区间两端都要，`..=` 而不是 `..`。
            let slice = bytes[start as usize..=end as usize].to_vec();
            let mut out = reply(StatusCode::PARTIAL_CONTENT, mime, slice);
            if let Ok(v) = HeaderValue::from_str(&format!("bytes {start}-{end}/{total}")) {
                out.headers_mut().insert(header::CONTENT_RANGE, v);
            }
            out
        }
        // 没有 Range / 认不出 / 不可满足 → 全量（对 Range 无所谓的调用方拿到的还是整份）。
        None => reply(StatusCode::OK, mime, bytes),
    }
}

/// `Range: bytes=<start>-<end>` → 闭区间的字节范围。认不出 / 不满足回 `None`（退成 200 全量）。
///
/// 只认**单段**（多段的 `bytes=0-1,3-4` 要 multipart 响应，媒体播放用不上，整份给它就行）。
/// 三种写法都认：`start-end` · `start-`（到结尾）· `-suffix`（最后 N 字节）。
fn parse_range(h: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let spec = h.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let last = total - 1;
    let (start, end) = if a.is_empty() {
        let n: u64 = b.trim().parse().ok()?;
        if n == 0 {
            return None;
        }
        (total.saturating_sub(n), last)
    } else {
        let start: u64 = a.trim().parse().ok()?;
        let end = if b.is_empty() { last } else { b.trim().parse().ok()? };
        (start, end.min(last))
    };
    // start 越界 / 区间反了 = 不可满足 → 当没给。
    (start <= end && start < total).then_some((start, end))
}

/// 读协议的出参。`mime` 是库里的自由文本 —— 拼不出合法头就退成 octet-stream，不 panic。
fn reply(status: StatusCode, mime: &str, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    let ctype = HeaderValue::from_str(mime)
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"));
    let mut out = tauri::http::Response::new(body);
    *out.status_mut() = status;
    let head = out.headers_mut();
    head.insert(header::CONTENT_TYPE, ctype);
    // 声明支持按字节取段 —— 媒体块据此才敢拖进度（见 `blob_response`）。
    head.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    // ★ 跨源：响应体是给 `http://localhost:1420`（dev）和 `tauri://localhost`（打包）中的
    //   网页看的，而请求发往 `self-notion://`。WKWebView 对跨源 fetch 做 CORS 检查，
    //   缺这个头就是 `TypeError: Load failed` —— 请求根本到不了这里，图片全裂（D-0027）。
    //   本地应用、内容又是按 sha256 寻址的公开图片，`*` 就够了。
    head.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    // 内容寻址：id 就是内容的 sha256，同一 id 的字节永不改变 → 可以永久缓存。
    // 没有这条，每次滚回视口都会重读一遍 SQLite（D-0027）。
    head.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    out
}
