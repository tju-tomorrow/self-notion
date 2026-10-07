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

use crate::store::{self, blob, comment, docs, links, version, Db};
use crate::vfs;

/// 字节字段的线上形状：**base64 字符串**。
///
/// `Vec<u8>` 直接走 JSON 会变成 `[49,50,51,…]` —— 一个字节 ~3.5 个字符。
/// Yjs update 在「打开文档」和「每次 apply」的热路径上，100 KB 的 update 会变成 350 KB 文本。
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
    db: tauri::State<'_, Db>,
    req: Request,
) -> ApiResult<Value> {
    // `window`：命令得知道是**哪个窗口**在调（露窗 / 新窗口 / 事件回执都按 label 走）。
    dispatch(Some(&app), Some(window.label()), &db, &req.method, req.args)
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
        "aiweb:hide" => aiweb_call(app, win, crate::aiweb::hide),
        "aiweb:close" => aiweb_call(app, win, crate::aiweb::close),
        "aiweb:probe" => aiweb_call(app, win, crate::aiweb::probe),
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
        // ★ 收 Yjs update。origin != 'user' 时由 Rust 强制先快照再写（D-0043）
        // 写完广播给别的窗口（架构第七节）—— 别的窗口开着这筇的话重读，两边才是一份数据。
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
                        update: a.update.as_deref(),
                        origin: &a.origin,
                        group_id: a.group_id.as_deref(),
                        label: a.label.as_deref(),
                        snapshot: a.snapshot.as_deref(),
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
                a.update.as_deref(),
                &a.origin,
                a.group_id.as_deref(),
                a.label.as_deref(),
            )
        }),

        // ── 虚拟文档目录（D-0040）───────────────────────────────────────────────
        // 纯读、纯本地，跟 doc:* 一样走 `call`（拿库锁）。
        "vfs:list" => call(db, |c| {
            let a: vfs::ListArgs = parse(args)?;
            vfs::list(c, &a.path)
        }),
        "vfs:grep" => call(db, |c| {
            let a: vfs::GrepArgs = parse(args)?;
            vfs::grep(c, &a.pattern, a.ignore_case)
        }),
        "vfs:read" => call(db, |c| {
            let a: vfs::ReadArgs = parse(args)?;
            vfs::read(c, &a.path, a.offset, a.limit)
        }),
        "vfs:stat" => call(db, |c| {
            let a: vfs::StatArgs = parse(args)?;
            vfs::stat(c, &a.path)
        }),

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
struct DocApply {
    id: String,
    /// 增量。**和 snapshot 至少给一个** —— 见 `store::docs::Apply`。
    /// `default` 而不是必填：合并/关文档时前端只送完整快照，不必把同一份 base64 送两遍。
    #[serde(default)]
    update: Option<Bytes>,
    #[serde(default = "user_origin")]
    origin: String,
    group_id: Option<String>,
    label: Option<String>,
    /// 完整状态：前端关文档 / 合并时把活的 Y.Doc 一次性送来
    snapshot: Option<Bytes>,
    /// 纯文本由渲染侧一并送来，Rust 不解析 Yjs（doc_fts + doc_text 的 payload）
    title: Option<String>,
    md: Option<String>,
    /// 出链（D-0085）。`default` + `Option` 两层是有意的：
    /// **老前端不送这个字段**（现在就在跑的那份），那时的语义是"别动已有的边"，
    /// 不是"把边全删了"。少了 `default` 这一层，升级应用的一瞬间所有反链消失。
    #[serde(default)]
    links: Option<Vec<LinkArg>>,
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
    /// 完整 Yjs 状态；不给就用 Rust 手里的最近一份（doc_snapshot）
    update: Option<Bytes>,
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
