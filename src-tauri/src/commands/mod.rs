//! Tauri 命令的唯一入口：**一个通用入口，参数是 `"命名空间:方法名"`**。
//!
//! 照抄 `simple-notion/src-tauri/src/api.rs` 的形状 —— 前端那层薄封装原样可用。
//! 命名空间清单见 docs/execution-plan.md 第 6.2 节。**加方法 = 加一个 match 分支。**
//!
//! 错误一律 `Result<T, ApiError>`。**类型源是 `apps/desktop/src/kernel/contract.ts`** ——
//! tauri-specta 已推翻（D-0049）：通用入口下 `method` 是运行时字符串，
//! 从 Rust 类型生成 TS 在这条路上抓不到任何东西。
//!
//! 分派本身不碰 SQL —— 逻辑全在 `store::*`，这里只做「解析参数 → 拿锁 → 序列化」。
//! `dispatch` 独立于 `api` 是为了能 `cargo test` 直接打（不用起 Tauri runtime）。

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::store::{self, agent, blob, comment, docs, learn, links, sync, version, Db};
use crate::vfs;

/// 字节字段的线上形状：**base64 字符串**。
///
/// `Vec<u8>` 直接走 JSON 会变成 `[49,50,51,…]` —— 一个字节 ~3.5 个字符。
/// 现在只剩 blob（图片/附件）走它 —— 文档正文是 JSON 字符串，不走 base64 这条（D-0131）。
///
/// 只在这里实现一次，所有字节字段都套它 —— 漏一个，下游就会拿到形状不一致的字段。
/// 解不开就是 `bad_args` 错误（`parse` 兜住），不是 panic。
#[derive(Debug, Clone, Default)]
pub struct Bytes(pub Vec<u8>);

impl std::ops::Deref for Bytes {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        &self.0
    }
}

impl Serialize for Bytes {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&B64.encode(&self.0))
    }
}

impl<'de> Deserialize<'de> for Bytes {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        B64.decode(String::deserialize(d)?.as_bytes())
            .map(Bytes)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Serialize, thiserror::Error)]
#[error("{code}: {message}")]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl ApiError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug, Deserialize)]
pub struct Request {
    pub method: String,
    #[serde(default)]
    pub args: Value,
}

#[tauri::command]
pub fn api(
    app: tauri::AppHandle,
    // ★ **不收 `WebviewWindow`**（2026-10-07 修）。那个 CommandArg 要求「窗口里**每个** webview 的
    //   label 都等于窗口 label」（`Window::is_webview_window` = `webviews().iter().all(…)`）——
    //   网页版 AI 的子 webview 一挂上来，这个条件就永远为假，**整个 IPC 桥当场全断**：
    //   面板收不起来、子 webview 钉在原地、mem / version-history 的轮询全炸。
    //   `Window` 的 CommandArg 从不失败（`Ok(command.message.webview().window())`），
    //   label 取到的还是同一个窗口。
    window: tauri::Window,
    db: tauri::State<'_, std::sync::Arc<Db>>,
    req: Request,
) -> ApiResult<Value> {
    // `window`：命令得知道是**哪个窗口**在调（露窗 / 新窗口 / 事件回执都按 label 走）。
    let Request { method, args } = req;
    let label = window.label().to_string();
    let at = std::time::Instant::now();
    crate::perf::rpc_begin(&label, &method);
    let out = dispatch(Some(&app), Some(label.as_str()), &db, &method, args);
    crate::perf::rpc_end(&label, &method, at.elapsed().as_millis() as u64);
    out
}

/// 慢命令（联网 / 拉模型 / 起进程）走这条：async 命令不在主线程上跑，再扔进阻塞池。
///
/// ★ 普通 `api` 是**同步命令**，Tauri 把它放在主线程执行 —— `backup:now` 一次 5–8 秒的
///   GitHub 往返会把窗口帧一起冻住（perf.log 里每条 `freeze-begin` 的 `in_flight` 都是它）。
///   前端按方法名前缀选这条（`plugins/plugin-rpc/index.ts` 的 `SLOW`）。
#[tauri::command]
pub async fn api_bg(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, std::sync::Arc<Db>>,
    req: Request,
) -> ApiResult<Value> {
    let Request { method, args } = req;
    let label = window.label().to_string();
    let db = std::sync::Arc::clone(state.inner());
    let at = std::time::Instant::now();
    crate::perf::rpc_begin(&label, &method);
    let task_label = label.clone();
    let task_method = method.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        dispatch(Some(&app), Some(task_label.as_str()), &db, &task_method, args)
    })
    .await
    .map_err(|e| ApiError::new("join", e.to_string()))?;
    crate::perf::rpc_end(&label, &method, at.elapsed().as_millis() as u64);
    out
}

/// `"命名空间:方法名"` → 一个 match 分支。
///
/// `app` 是 `Option`：碰 SQL 的那些分支不看它，只有 `aiweb:*`（要操作窗口 / 子 webview）才要。
/// `win` = 调用方的窗口 label，同上。
pub fn dispatch(
    app: Option<&tauri::AppHandle>,
    win: Option<&str>,
    db: &Db,
    method: &str,
    args: Value,
) -> ApiResult<Value> {
    match method {
        // echo 原样吐回参数 —— S1 验 invoke 桥、S3 验 serde 形状都用它
        "meta:ping" => Ok(Value::String("pong".into())),
        "meta:echo" => Ok(args),

        // 前端画完第一帧 → 把**自己那个**窗口露出来（定义里是 `visible: false`，见 `lib.rs::reveal`）。
        "boot:ready" => {
            let h = app.ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
            crate::reveal(h, win).map_err(|e| ApiError::new("boot", e))?;
            Ok(Value::Null)
        }

        // 多窗口（D-0019）。菜单那条走前端绕一圈（前端才知道现在哪一篇），这里只管建。
        "window:new" => {
            let h = app.ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
            let a: WindowNew = parse(args)?;
            crate::windows::open(h, a.doc_id.as_deref())
                .map(|label| serde_json::json!({ "label": label }))
                .map_err(|e| ApiError::new("window", e))
        }

        // 前端出错往这个唯一出口写（见 AGENTS.md 第 3 条）。不碰库，所以不走 `call`。
        "log:error" => {
            let a: LogError = parse(args)?;
            crate::log::record(&a.source, &a.message);
            Ok(Value::Null)
        }

        // bug 现场包（D-0126）：前端打包 → `<app data>/bugs/`。不碰库，不走 `call`。
        "bug:write" => crate::bugs::write(args).map_err(|e| ApiError::new("bugs", e)),
        "bug:list" => crate::bugs::list().map_err(|e| ApiError::new("bugs", e)),
        "bug:read" => crate::bugs::read(args).map_err(|e| ApiError::new("bugs", e)),

        // ── 内置 AI（D-0042）：BYO endpoint，现在只做一篇笔记的总结 ────────────
        "ai:configure" => crate::ai::configure(db, args),
        "ai:status" => crate::ai::status(db, args),
        // 拉网关的模型清单（设置页那个下拉）。**不走 `call`** —— 它要发网络请求。
        "ai:models" => crate::ai::models(db, args),
        // ★ 这条**故意不走 `call`**：一次几秒级的模型往返，攥着库锁会把整个应用卡住
        //（和上面 `backup:*` 同一个理由）。
        "ai:summarize" => crate::ai::summarize(db, args),
        // 读盘上那份（没生成过回 null）。纯读，走 `call` 拿锁没关系。
        "ai:summary" => crate::ai::summary(db, args),
        // 内置 agent 的一轮（D-0087）：流式 + 工具。同 `ai:summarize` —— **不走 `call`**，
        // 一次模型往返几秒到几十秒，攥着库锁会把整个应用卡住。要 AppHandle 发 `ai:delta`。
        "ai:chat" => crate::ai::chat(app, db, args, win),

        // ── web 版 AI 面板（D-0074；实现在 `src/aiweb.rs`）─────────────────────
        "aiweb:show" => {
            let a: crate::aiweb::ShowArgs = parse(args)?;
            aiweb_call(app, win, |h, w| crate::aiweb::show(h, w, a))
        }
        "aiweb:url" => {
            let h = app.ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
            let url = crate::aiweb::current_url(h, win.unwrap_or("main"))
                .map_err(|e| ApiError::new("aiweb", e))?;
            Ok(Value::String(url))
        }
        "aiweb:hide" => aiweb_call(app, win, crate::aiweb::hide),
        "aiweb:close" => aiweb_call(app, win, crate::aiweb::close),
        "aiweb:probe" => aiweb_call(app, win, crate::aiweb::probe),
        // 面板那一页丢给系统默认浏览器（`src/aiweb.rs::open_external`）。
        "aiweb:open-external" => aiweb_call(app, win, crate::aiweb::open_external),
        "aiweb:inject" => {
            let a: crate::aiweb::InjectArgs = parse(args)?;
            aiweb_call(app, win, |h, w| crate::aiweb::inject(h, w, &a.text))
        }
        // 朗读（D-0081）：一个看不见的 webview 里「送全文 → 等复述 → 点朗读」，一次推一步。
        "aiweb:voice-tick" => {
            let a: crate::aiweb::VoiceArgs = parse(args)?;
            aiweb_call(app, win, |h, w| crate::aiweb::voice_tick(h, w, &a.text))
        }
        // 朗读那个页面摆出来给人看 / 收回去（收回去**不丢声音**，见 aiweb.rs）
        "aiweb:voice-show" => {
            let a: crate::aiweb::Rect = parse(args)?;
            aiweb_call(app, win, |h, w| crate::aiweb::voice_show(h, w, a))
        }
        "aiweb:voice-hide" => aiweb_call(app, win, crate::aiweb::voice_hide),

        // 朗读（Edge TTS，`src/tts.rs`）。划线读 / 全篇读都是一句一句来。
        "read:warm" => crate::tts::warm(),
        "read:speak" => {
            let h = app.ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
            crate::tts::speak(h, args)
        }

        // ── 语音输入（D-0190；实现在 `src/voice/`）────────────────────────────
        "voice:status" => crate::voice::status(app, args),
        "voice:download" => crate::voice::download_model(app, args),
        "voice:start" => crate::voice::start(app, win, args),
        "voice:stop" => crate::voice::stop(win, args),
        "voice:cancel" => crate::voice::cancel(win, args),

        // ── 卡死监控（实现在 `src/perf.rs`）───────────────────────────────────
        "perf:beat" => crate::perf::beat(win.unwrap_or("unknown"), args)
            .map_err(|e| ApiError::new("perf", e)),

        // ── 内存监控（D-0079；实现在 `src/mem.rs`）─────────────────────────────
        // 前两条不碰窗口，走 mem 自己的分派；`mem:tray` 要 AppHandle，得在这儿。
        "mem:snapshot" | "mem:render" => {
            crate::mem::dispatch(method, args).map_err(|e| ApiError::new("mem", e))
        }
        "mem:tray" => {
            let a: MemTray = parse(args)?;
            let h = app.ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
            crate::mem::set_tray(h, a.on).map_err(|e| ApiError::new("mem", e))?;
            Ok(Value::Null)
        }

        // ── 外部 agent 写请求（D-0191）─────────────────────────────────────────
        "agent:pending" => call(db, |c| agent::pending(c, 20)),
        "agent:finish" => call(db, |c| {
            let a: AgentFinish = parse(args)?;
            agent::finish(c, &a.id, a.ok, &a.result, &a.error)
        }),

        // ── 文档 ──────────────────────────────────────────────────────────────
        "doc:list" => call(db, |c| {
            let a: DocList = parse(args)?;
            docs::list(c, a.include_trashed)
        }),
        "doc:create" => call(db, |c| {
            let a: DocCreate = parse(args)?;
            docs::create(c, a.id.as_deref(), a.parent_id.as_deref(), &a.title, a.icon.as_deref())
        }),
        "doc:rename" => call(db, |c| {
            let a: DocRename = parse(args)?;
            docs::rename(c, &a.id, &a.title)
        }),
        "doc:icon" => call(db, |c| {
            let a: DocIcon = parse(args)?;
            docs::set_icon(c, &a.id, a.icon.as_deref())
        }),
        "doc:move" => call(db, |c| {
            let a: DocMove = parse(args)?;
            docs::move_(c, &a.id, a.parent_id.as_deref(), a.sort_order)
        }),
        "doc:trash" => call(db, |c| {
            let a: DocId = parse(args)?;
            docs::trash(c, &a.id)
        }),
        "doc:restore" => call(db, |c| {
            let a: DocId = parse(args)?;
            docs::restore(c, &a.id)
        }),
        "doc:remove" => call(db, |c| {
            let a: DocId = parse(args)?;
            docs::remove(c, &a.id)
        }),
        "doc:favorite" => call(db, |c| {
            let a: DocFlag = parse(args)?;
            docs::favorite(c, &a.id, a.value)
        }),
        "doc:pin" => call(db, |c| {
            let a: DocFlag = parse(args)?;
            docs::pin(c, &a.id, a.value)
        }),
        // 首页每行的正文摘要（从 doc_text 取，见 docs.rs::summary）
        "doc:summary" => call(db, |c| {
            let a: DocIds = parse(args)?;
            docs::summary(c, &a.ids)
        }),
        // 搜索面板右侧预览：一整篇的投影正文（`doc:summary` 只有 160 字的副标题）
        "doc:text" => call(db, |c| {
            let a: DocId = parse(args)?;
            docs::text(c, &a.id).map(|md| serde_json::json!({ "md": md }))
        }),
        // 回收站的两个整仓操作（没有单篇时用它）
        "doc:emptyTrash" => call(db, docs::empty_trash),
        "doc:restoreTrash" => call(db, docs::restore_trash),
        // 要字节 = `doc:open`（**不动** `last_opened_at`，旁路读也不许改人家最近顺序）
        "doc:open" => call(db, |c| {
            let a: DocId = parse(args)?;
            docs::open(c, &a.id)
        }),
        // 用户真在看这一篇了（编辑器挂上时）—— 首页「最近」靠它
        "doc:touch" => call(db, |c| {
            let a: DocId = parse(args)?;
            docs::touch(c, &a.id)
        }),
        // 学习指标（D-0193）。打开 / 进度只该由编辑器打；熟悉度人也能打。
        "learn:list" => call(db, learn::list),
        "learn:get" => call(db, |c| {
            let a: DocId = parse(args)?;
            learn::get(c, &a.id)
        }),
        "learn:opened" => call(db, |c| {
            let a: DocId = parse(args)?;
            learn::opened(c, &a.id)
        }),
        "learn:progress" => call(db, |c| {
            let a: LearnProgress = parse(args)?;
            learn::progress(c, &a.id, a.add_ms, a.depth)
        }),
        "learn:familiarity" => call(db, |c| {
            let a: LearnFamiliarity = parse(args)?;
            if let Some(n) = a.level {
                if !(1..=4).contains(&n) {
                    return Err(learn::bad_level(n));
                }
            }
            learn::set_familiarity(c, &a.id, a.level)
        }),
        // ★ 落一份正文（PM doc JSON，覆盖式）。origin != 'user' 时由 Rust 强制先快照再写（D-0043）
        // 写完广播给别的窗口（架构第七节）—— 别的窗口开着这篇的话重读，两边才是一份数据。
        "doc:apply" => {
            let a: DocApply = parse(args)?;
            let id = a.id.clone();
            let links: Option<Vec<links::Link>> = a.links.as_ref().map(|v| {
                v.iter()
                    .map(|l| links::Link { to_id: l.to_id.clone(), kind: l.kind.clone() })
                    .collect()
            });
            let out = call(db, |c| {
                docs::apply(
                    c,
                    docs::Apply {
                        id: &a.id,
                        content: a.content.as_deref(),
                        origin: &a.origin,
                        group_id: a.group_id.as_deref(),
                        label: a.label.as_deref(),
                        title: a.title.as_deref(),
                        md: a.md.as_deref(),
                        links: links.as_deref(),
                    },
                )
            })?;
            if let Some(h) = app {
                crate::windows::relay_doc(h, win, &id);
            }
            Ok(out)
        },
        // 标签整组替换（D-0086）。唯一写入口是文档 ⋯ 菜单那一行。
        "doc:tags" => call(db, |c| {
            let a: DocTags = parse(args)?;
            docs::set_tags(c, &a.id, &a.tags)
        }),

        // 反向链接（P3-3）：谁指向我。入参只要 id，回指向它的那些文档（按建边时间倒序）。
        "link:backlinks" => call(db, |c| {
            let a: DocId = parse(args)?;
            links::backlinks(c, &a.id)
        }),

        // 同步块（P3-4 / D-0136）：内容在源里只有一份，节点只存 id。
        "sync:new" => call(db, |c| sync::new(c).map(|id| serde_json::json!({ "id": id }))),
        "sync:get" => call(db, |c| {
            let a: DocId = parse(args)?;
            sync::get(c, &a.id).map(|content| serde_json::json!({ "content": content }))
        }),
        "sync:put" => call(db, |c| {
            let a: SyncPut = parse(args)?;
            sync::put(c, &a.id, &a.content).map(|_| serde_json::json!({ "ok": true }))
        }),

        // ── 搜索 ──────────────────────────────────────────────────────────────
        "search:query" => call(db, |c| {
            let a: SearchQuery = parse(args)?;
            docs::search(c, &a.q, a.limit.unwrap_or(50).clamp(1, 500), a.include_trashed)
        }),

        // ── 图片 / 附件 ───────────────────────────────────────────────────────
        "blob:put" => call(db, |c| {
            let a: BlobPut = parse(args)?;
            blob::put(c, &a.bytes, &a.mime)
        }),
        "blob:getUrl" => call(db, |c| {
            let a: DocId = parse(args)?;
            blob::url(c, &a.id)
        }),
        // 只回 mime / 大小，不回字节 —— 内置助手据它决定这张图要不要读。
        "blob:meta" => call(db, |c| {
            let a: DocId = parse(args)?;
            blob::info(c, &a.id)
        }),
        // 复制图片到系统剪贴板。webview 自己的 execCommand 只填它那份视图，别的应用读不到 ——
        // 真正写 NSPasteboard 只能在 Rust 这侧做。
        #[cfg(target_os = "macos")]
        "clipboard:copyImage" => call(db, |c| {
            let a: DocId = parse(args)?;
            let Some((_mime, bytes)) = blob::get(c, &a.id)? else {
                return Err(ApiError::new("not_found", "blob"));
            };
            crate::clipboard::copy_image(&bytes).map_err(|e| ApiError::new("clipboard", e))?;
            Ok(serde_json::Value::Null)
        }),
        #[cfg(not(target_os = "macos"))]
        "clipboard:copyImage" => Err(ApiError::new("unsupported", "只支持 macOS")),

        // ── 标注（D-0202）：颜色 / 块颜色 / 评论锚点，给内置 AI 的 doc_annotations ──
        "doc:annotations" => call(db, |c| {
            let a: crate::annotations::Args = parse(args)?;
            crate::annotations::list(c, &a.id)
        }),

        // ── 评论（D-0067）─────────────────────────────────────────────────────
        "comment:list" => call(db, |c| {
            let a: CommentList = parse(args)?;
            comment::list(c, &a.doc_id)
        }),
        "comment:create" => call(db, |c| {
            let a: CommentCreate = parse(args)?;
            comment::create(
                c,
                &a.doc_id,
                a.parent_id.as_deref(),
                &a.anchor,
                a.block_id.as_deref(),
                &a.quote,
                &a.body,
            )
        }),
        "comment:update" => call(db, |c| {
            let a: CommentUpdate = parse(args)?;
            comment::update_body(c, &a.id, &a.body)
        }),
        "comment:resolve" => call(db, |c| {
            let a: CommentResolve = parse(args)?;
            comment::set_resolved(c, &a.id, a.resolved)
        }),
        "comment:remove" => call(db, |c| {
            let a: DocId = parse(args)?;
            comment::remove(c, &a.id).map(|_| serde_json::json!({"ok": true}))
        }),

        // ── 手机版 / 局域网同步（D-0198）──────────────────────────────────────
        // 这两条只读服务状态，不碰库：设置页拿它显示地址和配对码。
        "mobile:status" => Ok(crate::syncing::status()),
        "mobile:code" => Ok(crate::syncing::new_code()),

        // ── 设置（meta 表）────────────────────────────────────────────────────
        "settings:get" => call(db, |c| {
            let a: SettingsGet = parse(args)?;
            store::settings_get(c, &a.key)
        }),
        "settings:set" => call(db, |c| {
            let a: SettingsSet = parse(args)?;
            store::settings_set(c, &a.key, &a.value)
        }),
        // 插件装载时预热内存副本用 —— `settings.get` 是同步的，不回读就等于每次启动全丢。
        "settings:list" => call(db, store::settings_all),

        // ── 版本 ──────────────────────────────────────────────────────────────
        "version:list" => call(db, |c| {
            let a: VersionList = parse(args)?;
            version::list(c, &a.id, a.limit.unwrap_or(100).clamp(1, 500))
        }),
        "version:restore" => call(db, |c| {
            let a: VersionRestore = parse(args)?;
            version::restore(c, &a.id, a.version_id)
        }),
        "version:checkpoint" => call(db, |c| {
            let a: VersionCheckpoint = parse(args)?;
            version::checkpoint(
                c,
                &a.id,
                a.content.as_deref(),
                &a.origin,
                a.group_id.as_deref(),
                a.label.as_deref(),
            )
        }),

        // ── 虚拟文档目录（D-0040）───────────────────────────────────────────────
        // ★ 这四条**不走 `call`**：`vfs::*` 自己管库锁（语义那路要在锁外发 HTTP），
        //   外面再套一层 `db.with` 就是拿两次锁 —— 当场死锁。直接调、自己序列化。
        "vfs:list" => {
            let a: vfs::ListArgs = parse(args)?;
            to_value(vfs::list(db, &a.path)?)
        }
        "vfs:grep" => {
            let a: vfs::GrepArgs = parse(args)?;
            to_value(vfs::grep(db, &a.pattern, a.ignore_case)?)
        }
        "vfs:read" => {
            let a: vfs::ReadArgs = parse(args)?;
            to_value(vfs::read(db, &a.path, a.offset, a.limit)?)
        }
        "vfs:stat" => {
            let a: vfs::StatArgs = parse(args)?;
            to_value(vfs::stat(db, &a.path)?)
        }

        // ── 有范围的预检索（D-0200，`docs/ai-rag.md`）──────────────────────────
        // ★ 也不走 `call`：`rag::search` 自己 `db.with`，并且还要进 vfs 建树。
        "rag:scopes" => to_value(vfs::tree_scopes(db)?),
        "rag:search" => {
            let a: crate::rag::SearchArgs = parse(args)?;
            to_value(crate::rag::search(db, a)?)
        }

        // ── 外部 Markdown 文件（D-0137，全文见 docs/external-md.md）─────────────
        // 双击一个 .md → 直接编辑那个文件，文件是唯一真相源，正文不落库。
        // ★ 这 8 条**故意不走 `call`**：读写盘是几毫秒到几十毫秒的 I/O，攥着库锁会把别的
        //   命令全卡住（和 `backup:*` 同一个理由）。入口自己拿 `&Db`，读库与磁盘 I/O 分段进行。
        "file:roots" => crate::disk::roots(db, args),
        "file:addRoot" => crate::disk::add_root(db, args),
        "file:removeRoot" => crate::disk::remove_root(db, args),
        "file:list" => crate::disk::list(db, args),
        "file:read" => crate::disk::read(db, args),
        "file:write" => crate::disk::write(db, args),
        "file:create" => crate::disk::create(db, args),
        "file:rename" => crate::disk::rename(db, args),
        // 接住系统递进来的文件 / 「设为默认」—— A2 的 `src-tauri/src/assoc.rs`。不碰库，不走 `call`。
        "file:drainOpened" => crate::assoc::drain()
            .map_err(|e| ApiError::new("io", e))
            .and_then(|v| serde_json::to_value(v).map_err(|e| ApiError::new("encode", e.to_string()))),
        "file:defaultStatus" => crate::assoc::status()
            .map_err(|e| ApiError::new("io", e))
            .and_then(|v| serde_json::to_value(v).map_err(|e| ApiError::new("encode", e.to_string()))),
        "file:setDefault" => {
            crate::assoc::set_default().map_err(|e| ApiError::new("io", e))?;
            Ok(Value::Null)
        }

        // ── GitHub 备份（D-0026）────────────────────────────────────────────────
        // ★ 这几条**故意不走 `call`**：里面有一次几秒级的网络往返，攥着库锁会把
        // 整个应用卡住（前端每次 `doc:list` 都在等它）。入口自己拿 `&Db`，读写库与
        // HTTP 分段进行，中间不持锁 —— 这正是 `call` 那个「拿锁 → 干活 → 序列化」
        // 形状在这里不成立的原因。
        "backup:configure" => crate::backup::configure(db, args),
        "backup:now" => crate::backup::now(db, args),
        "backup:status" => crate::backup::status(db, args),
        "backup:restore" => crate::backup::restore(db, args),
        // 建仓 / 列仓 / 认账号：都是用户级接口，`repo` 参数用不上，只借 token 和 headers。
        "backup:detectToken" => crate::backup::detect_token(db, args),
        "backup:user" => crate::backup::user(db, args),
        "backup:repos" => crate::backup::repos(db, args),
        "backup:createRepo" => crate::backup::create_repo(db, args),

        // ── 知识库（D-0181…D-0189，设计见 docs/kb.md）────────────────────────────
        // 纯读 / 纯本地的那批走 `call`（拿库锁）。
        "kb:status" => call(db, |c| {
            let curator_on = store::settings_get(c, "kb.curator")?.as_deref() != Some("false");
            let embed_model = store::settings_get(c, "kb.embedModel")?.unwrap_or_default();
            Ok(serde_json::json!({
                "curatorOn": curator_on,
                "semanticOn": !embed_model.trim().is_empty(),
                "embedModel": embed_model,
                "docs": docs::list(c, false)?.len(),
                "tags": store::kb::tag_list(c)?.len(),
                "topics": store::kb::topic_list(c)?.len(),
                "entities": store::kb::entity_list(c, KB_COUNT_CAP)?.len(),
                "pending": store::kb::proposal_list(c, Some("pending"), KB_COUNT_CAP)?.len(),
                "stale": store::kb::run_stale(c, KB_COUNT_CAP)?.len(),
            }))
        }),
        "kb:proposals" => call(db, |c| {
            let a: KbProposals = parse(args)?;
            let limit = a.limit.unwrap_or(50).clamp(1, 500) as usize;
            // 默认 pending —— 跟 `kb_proposals` 工具一致；要看已处理的得显式传 state。
            let state = a.state.unwrap_or_else(|| "pending".to_string());
            let mut out = Vec::new();
            for p in store::kb::proposal_list(c, Some(&state), limit)? {
                out.push(serde_json::json!({
                    "id": p.id,
                    "docId": p.doc_id,
                    "docTitle": doc_title(c, &p.doc_id),
                    "kind": p.kind,
                    "payload": p.payload,
                    "confidence": p.confidence,
                    "reason": p.reason,
                    "origin": p.origin,
                    "state": p.state,
                    "at": p.at,
                    "doneAt": p.done_at,
                }));
            }
            Ok(out)
        }),
        "kb:proposal" => {
            let a: KbProposalSet = parse(args)?;
            if a.accept {
                // 采纳 = 真落库（见 `curator::accept`）—— 以前只改状态，库里什么都不变。
                crate::kb::curator::accept(db, a.id)?;
                // 实体/边变了，共现边跟着重算（收 &Connection，得在 with 里）。
                db.with(|c| crate::kb::graph::recompute_cooccur(c, COOCCUR_MIN_SHARED))?;
            } else {
                crate::kb::curator::reject(db, a.id)?;
            }
            Ok(serde_json::json!({ "ok": true }))
        }
        "kb:tags" => call(db, |c| {
            let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
            for d in docs::list(c, false)? {
                for t in d.tags {
                    *counts.entry(t).or_insert(0) += 1;
                }
            }
            let mut out = Vec::new();
            for t in store::kb::tag_list(c)? {
                let count = counts.get(&t.name).copied().unwrap_or(0);
                out.push(serde_json::json!({
                    "name": t.name,
                    "aliases": t.aliases,
                    "desc": t.desc,
                    "origin": t.origin,
                    "count": count,
                }));
            }
            Ok(out)
        }),
        "kb:tag:merge" => call(db, |c| {
            let a: KbTagMerge = parse(args)?;
            store::kb::tag_merge(c, &a.from, &a.into)?;
            Ok(serde_json::json!({ "ok": true }))
        }),
        "kb:topics" => call(db, |c| {
            let mut out = Vec::new();
            for t in store::kb::topic_list(c)? {
                let count = store::kb::docs_by_topic(c, &t.name)?.len();
                out.push(serde_json::json!({ "name": t.name, "desc": t.desc, "count": count }));
            }
            Ok(out)
        }),
        "kb:entities" => call(db, |c| {
            let mut out = Vec::new();
            for e in store::kb::entity_list(c, KB_COUNT_CAP)? {
                out.push(serde_json::json!({
                    "id": e.id,
                    "name": e.name,
                    "kind": e.kind,
                    "desc": e.desc,
                    "at": e.at,
                    "docs": Vec::<String>::new(),
                }));
            }
            Ok(out)
        }),
        "kb:entity" => call(db, |c| {
            let a: KbEntityGet = parse(args)?;
            match crate::kb::graph::entity_detail(c, &a.name)? {
                Some(d) => Ok(serde_json::json!({
                    "id": d.entity.id,
                    "name": d.entity.name,
                    "kind": d.entity.kind,
                    "desc": d.entity.desc,
                    "at": d.entity.at,
                    "docs": d.docs,
                })),
                None => Ok(Value::Null),
            }
        }),
        "kb:graph" => call(db, |c| {
            let a: KbGraphArgs = parse(args)?;
            let depth = a.depth.unwrap_or(1).clamp(1, 3);
            let limit = a.limit.unwrap_or(60).clamp(1, 500) as usize;
            let seeds = vec![("doc".to_string(), a.seed)];
            crate::kb::graph::subgraph(c, &seeds, depth, limit)
        }),
        "kb:tools" => call(db, |_c| Ok(crate::kb::tools::catalog_writable())),

        // ★ 这四条**故意不走 `call`**：都可能在网络那头停几秒（策展一轮是几次模型往返、
        //   语义那一路要先 embed 一次），攥着库锁会把整个应用卡住 —— 照 `ai:summarize` 的先例。
        "kb:curate" => {
            let a: KbCurate = parse(args)?;
            // `Outcome` 自己分开了「直接落库」和「进收件箱」两个计数 —— 不用再去查表取差。
            let out = match a.doc_id.as_deref() {
                Some(id) => crate::kb::curator::run_one(db, id)?,
                None => crate::kb::curator::run_all(db, CURATE_ROUND)?,
            };
            // 后处理：实体变了重算共现边 → 新总结向量化 → 提标签合并建议。
            // 三步各自拿锁 / 发网络（**别串在同一个 with 里，Mutex 不可重入**），
            // 且全部 best-effort —— 出错只记日志，不能让整条命令失败。
            if let Err(e) = db.with(|c| crate::kb::graph::recompute_cooccur(c, COOCCUR_MIN_SHARED)) {
                crate::log::record("kb", &format!("共现边重算跳过：{}", e.message));
            }
            // 没配 embedding 时 refresh 会 Err —— 吞掉（那本来就不是错误）。
            if let Err(e) = crate::kb::embed::refresh(db, "doc", 0) {
                crate::log::record("kb", &format!("向量刷新跳过：{}", e.message));
            }
            if let Err(e) = crate::kb::curator::suggest_merges(db, crate::kb::curator::MERGE_THRESHOLD) {
                crate::log::record("kb", &format!("合并建议跳过：{}", e.message));
            }
            to_value(out)
        }
        "kb:related" => {
            let a: KbRelatedArgs = parse(args)?;
            let limit = a.limit.unwrap_or(15).clamp(1, 500) as usize;
            let edges = crate::kb::graph::related(db, &a.id, limit)?;
            let out = db.with(|c| {
                let mut out = Vec::with_capacity(edges.len());
                for e in &edges {
                    // `related` 出来的边都是 doc→doc，另一端就是要显示的那一篇。
                    let other = if e.src_id == a.id { e.dst_id.clone() } else { e.src_id.clone() };
                    out.push(serde_json::json!({
                        "id": other,
                        "title": doc_title(c, &other),
                        "kind": e.kind,
                        "weight": e.weight,
                        "reason": e.reason,
                    }));
                }
                Ok(out)
            })?;
            Ok(serde_json::json!(out))
        }
        "kb:semantic" => {
            let a: KbSemanticArgs = parse(args)?;
            let limit = a.limit.unwrap_or(10).clamp(1, 500) as usize;
            let hits = crate::kb::embed::search(db, &a.query, limit)?;
            let out = db.with(|c| {
                let mut out = Vec::with_capacity(hits.len());
                for h in &hits {
                    out.push(serde_json::json!({
                        "docId": h.owner_id,
                        "title": doc_title(c, &h.owner_id),
                        "score": h.score,
                    }));
                }
                Ok(out)
            })?;
            Ok(serde_json::json!(out))
        }
        "kb:call" => {
            let a: KbCallArgs = parse(args)?;
            crate::kb::tools::call(db, &a.name, &a.args).map(Value::String)
        }

        other => Err(ApiError::new("unknown_method", other)),
    }
}

/// 所有走库的分支都从这儿过。加了 `with` 就顺带把「锁中毒 → 错误」也统一了。
fn call<T: Serialize>(
    db: &Db,
    f: impl FnOnce(&rusqlite::Connection) -> ApiResult<T>,
) -> ApiResult<Value> {
    let v = db.with(f)?;
    serde_json::to_value(v).map_err(|e| ApiError::new("encode", e.to_string()))
}

fn parse<T: serde::de::DeserializeOwned>(args: Value) -> ApiResult<T> {
    serde_json::from_value(args).map_err(|e| ApiError::new("bad_args", e.to_string()))
}

/// 结果已经拿到手里（函数自己管锁）时用它序列化 —— 别套 `call`，那会再拿一次锁（死锁）。
fn to_value<T: Serialize>(v: T) -> ApiResult<Value> {
    serde_json::to_value(v).map_err(|e| ApiError::new("encode", e.to_string()))
}

/// `aiweb:*` 统一收口：要窗口句柄、统统一元错误码、一律回 `null`。
/// `win` = 调用方的窗口 label（面板是**每个窗口一份**，见 `aiweb.rs`）。
fn aiweb_call(
    app: Option<&tauri::AppHandle>,
    win: Option<&str>,
    f: impl FnOnce(&tauri::AppHandle, &str) -> Result<(), String>,
) -> ApiResult<Value> {
    let h = app.ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
    f(h, win.unwrap_or("main")).map_err(|e| ApiError::new("aiweb", e))?;
    Ok(Value::Null)
}

fn user_origin() -> String {
    "user".into()
}

/// 计数类的上限：`proposal_list` / `entity_list` / `run_stale` 都带 `LIMIT`，
/// 要给「全部」得递一个足够大的数（不拿 `usize::MAX` 去溢）。
const KB_COUNT_CAP: usize = 100_000;
/// 手动跑一轮策展最多几篇 —— 别一次把用户的 endpoint 打爆（跟 tick 的 `BATCH` 一个道理）。
const CURATE_ROUND: usize = 10;
/// 共现边：两篇共享 ≥ 这么多个实体才连一条边（共享一个多半是噪声）。
pub(crate) const COOCCUR_MIN_SHARED: usize = 2;

/// 一篇的标题（`kb:related` / `kb:semantic` / `kb:proposals` 要显示「哪一篇」）。
/// 查不到就当 id —— 边可能指向一篇已删的文档，不该因此整条命令报错。
fn doc_title(conn: &rusqlite::Connection, id: &str) -> String {
    docs::get(conn, id).map(|d| d.title).unwrap_or_else(|_| id.to_string())
}


/* ─────────────────── 入参形状（TS 侧的对应类型在 contract.ts，见文件头） ─────────────────── */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowNew {
    /// 新窗口起来就开这一篇（菜单那条会带上，前端不知道就不带 → 落在首页）。
    doc_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocList {
    #[serde(default)]
    include_trashed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentFinish {
    id: String,
    ok: bool,
    #[serde(default)]
    result: String,
    #[serde(default)]
    error: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocCreate {
    id: Option<String>,
    parent_id: Option<String>,
    #[serde(default)]
    title: String,
    icon: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocId {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocRename {
    id: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocIcon {
    id: String,
    #[serde(default)]
    icon: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocMove {
    id: String,
    parent_id: Option<String>,
    sort_order: Option<f64>,
}

/// 「给文档翻一个开关」的入参 —— 收藏（`doc:favorite`）和置顶（`doc:pin`）共用一个形状。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocFlag {
    id: String,
    /// 不给就是切换
    value: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocIds {
    ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LearnProgress {
    id: String,
    add_ms: i64,
    depth: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LearnFamiliarity {
    id: String,
    /// 1–4；null = 清掉。
    level: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocApply {
    id: String,
    /// 正文：**PM doc JSON 的字符串**（覆盖式，一次一份）。没有 `update` 这个参数了。
    content: Option<String>,
    #[serde(default = "user_origin")]
    origin: String,
    group_id: Option<String>,
    label: Option<String>,
    /// 纯文本由渲染侧一并送来，Rust 不解析 doc JSON（doc_fts + doc_text 的 payload）
    title: Option<String>,
    md: Option<String>,
    /// 出链（D-0085）。`default` + `Option` 两层是有意的：
    /// **老前端不送这个字段**（现在就在跑的那份），那时的语义是"别动已有的边"，
    /// 不是"把边全删了"。少了 `default` 这一层，升级应用的一瞬间所有反链消失。
    #[serde(default)]
    links: Option<Vec<LinkArg>>,
}

/// `sync:put`（P3-4）：覆盖源内容。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncPut {
    id: String,
    content: String,
}

/// 一条边的线上形状（`contract.ts` 的 `DocLink`）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkArg {
    to_id: String,
    kind: String,
}

/// `doc:tags`（D-0086）：整组替换，不是"加一个"。
#[derive(Deserialize)]
struct DocTags {
    id: String,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct MemTray {
    on: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogError {
    source: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchQuery {
    q: String,
    limit: Option<i64>,
    #[serde(default)]
    include_trashed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlobPut {
    bytes: Bytes,
    #[serde(default = "octet_stream")]
    mime: String,
}

fn octet_stream() -> String {
    "application/octet-stream".into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsGet {
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsSet {
    key: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionList {
    id: String,
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionRestore {
    id: String,
    version_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionCheckpoint {
    id: String,
    /// 完整 doc JSON；不给就用库里那一份（`doc`）
    content: Option<String>,
    #[serde(default = "user_origin")]
    origin: String,
    group_id: Option<String>,
    label: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentList {
    doc_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentCreate {
    doc_id: String,
    parent_id: Option<String>,
    anchor: String,
    block_id: Option<String>,
    #[serde(default)]
    quote: String,
    #[serde(default)]
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentUpdate {
    id: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentResolve {
    id: String,
    resolved: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KbCurate {
    /// 给了就只跑这一篇；不给跑一轮。
    doc_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KbProposals {
    state: Option<String>,
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KbProposalSet {
    id: i64,
    accept: bool,
}

#[derive(Deserialize)]
struct KbTagMerge {
    from: Vec<String>,
    into: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KbEntityGet {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KbRelatedArgs {
    id: String,
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KbGraphArgs {
    seed: String,
    depth: Option<u32>,
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KbSemanticArgs {
    query: String,
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KbCallArgs {
    name: String,
    #[serde(default)]
    args: Value,
}
