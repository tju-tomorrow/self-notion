//! MCP server（D-0084）—— 同一个二进制的另一个入口：`self-notion --mcp`。
//!
//! 客户端（Claude Code / Codex…）**自己 spawn 这个进程**，所以它和「正在跑的 app」是两个东西：
//! 这儿没有 Tauri、没有 webview、没有一行前端代码，它自己**只读**打开 `self-notion.db`，
//! 复用 `vfs::*` 和 `store::docs::*`（`docs/vfs.md` 第六节）。
//!
//! ★ **读路径只有只读句柄**（`Db::open_readonly`，WAL 下退化成 `PRAGMA query_only`）。
//! 写工具 `notes_write`（D-0192）**不碰正文**：它只往 `agent_request` 落一条请求，
//! 由桌面端的 `agent-bridge` 用编辑器解析器执行 —— 所以写要求 app 开着，读仍然离线。
//!
//! ★ **stdout 是协议流**：一行一条 JSON，多一个字都不行。日志一律 stderr。

use crate::commands::{ApiError, ApiResult};
use crate::store::Db;
use crate::vfs;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;

mod learn;
mod nav;
mod notes;
mod write;

/// 客户端没报版本（或报了个我们不认识的）时的兜底 —— 我们只用得到 `tools` 那一块。
const PROTOCOL: &str = "2024-11-05";

/// `--mcp` 唯一入口。
pub fn serve() {
    let path = db_path();
    let db = match Db::open_readonly(&path) {
        Ok(db) => db,
        // 这些工具没有一条离得开库，开不了就是彻底不能用 —— 响亮地死，
        // 客户端会把 stderr 显示给用户（这比"起来了但每次都报错"好查）。
        Err(e) => {
            crate::log::record("mcp", &format!("打开 {} 失败：{e}", path.display()));
            std::process::exit(1);
        }
    };
    eprintln!("[self-notion] mcp: 只读打开 {}", path.display());

    let mut nav = nav::Nav::new();
    let mut out = std::io::stdout();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break }; // stdin 断了 = 客户端走了
        if line.trim().is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            // 连 id 都读不出来，只能按 JSON-RPC 的约定回 id: null
            Err(e) => {
                crate::log::record("mcp", &format!("请求不是 JSON：{e}"));
                let _ = writeln!(
                    out,
                    "{}",
                    json!({"jsonrpc": "2.0", "id": null,
                           "error": {"code": -32700, "message": e.to_string()}})
                );
                let _ = out.flush();
                continue;
            }
        };
        if let Some(resp) = handle(&db, &mut nav, &msg) {
            // serde 会把字符串里的换行转义掉，所以一条消息一定是一行
            let _ = writeln!(out, "{resp}");
            let _ = out.flush();
        }
    }
}

/// 一条消息进，一条（或零条）出。`None` = 不回。
fn handle(db: &Db, nav: &mut nav::Nav, msg: &Value) -> Option<String> {
    // 通知没有 id —— 客户端那条 `notifications/initialized` 就在这儿被静默收掉，
    // 别的通知（cancelled / roots 变了…）一视同仁：不回，也不当未知方法报错。
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or_default();
    let params = msg.get("params").cloned().unwrap_or(Value::Null);

    let r: Result<Value, (i64, String)> = match method {
        "initialize" => Ok(json!({
            // 客户端报什么就回什么：握手之后我们用不到版本差异
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "self-notion", "version": env!("CARGO_PKG_VERSION") },
            // 进来的第一站：这棵树的语法本身写在 /AGENTS.md 里（docs/vfs.md 第七节）
            "instructions": "这是 self-notion 个人笔记库。notes_map() 看全局，\
                             notes_find(q) 定位，notes_cd(标题|id|目录) 打开，\
                             notes_read(section=…) 读，notes_related(id) 找关联。\
                             写用 notes_write（create/append/replace/rename/move/trash/restore/tag/undo）；\
                             replace/trash 要 confirm。写需要桌面端开着。\
                             notes_learn 读打开次数、阅读时长、读到多深、行为分和熟悉度；\
                             只能改熟悉度（familiarity=1–4，0 清除）。不要一次读全库。",
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => call_tool(db, nav, &params),
        other => Err((-32601, format!("unknown method: {other}"))),
    };

    Some(match r {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string(),
        Err((code, message)) => {
            json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
                .to_string()
        }
    })
}

/// `tools/call`。**业务失败走 `isError: true`，不是 JSON-RPC 层的错** ——
/// 那段文本直接喂给模型，它据此改参数重试就完了。
fn call_tool(db: &Db, nav: &mut nav::Nav, params: &Value) -> Result<Value, (i64, String)> {
    let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

    let text: ApiResult<String> = match name {
        "vfs_list" => tool(&args, |a: vfs::ListArgs| {
            vfs::list(db, &a.path).and_then(|v| json_text(&v))
        }),
        "vfs_stat" => tool(&args, |a: vfs::StatArgs| -> ApiResult<String> {
            let p = a.path.clone();
            // 路径不存在在这儿是一次失败（stat 在文件系统里也是 ENOENT），不静默回 null
            let e = vfs::stat(db, &a.path)?.ok_or_else(|| ApiError::new("not_found", p))?;
            json_text(&e)
        }),
        "notes_cd" => tool(&args, |a: nav::CdArgs| nav::cd(db, nav, a.target.as_deref())),
        "notes_read" => tool(&args, |a: nav::ReadArgs| nav::read(db, nav, &a)),
        "notes_find" => tool(&args, |a: notes::FindArgs| notes::find(db, &a)),
        "notes_map" => tool(&args, |a: notes::MapArgs| notes::map(db, &a)),
        "notes_related" => tool(&args, |a: notes::RelatedArgs| notes::related(db, nav, &a)),
        "notes_learn" => tool(&args, |a: learn::Args| learn::call(db, &a)),
        "notes_write" => tool(&args, |a: write::WriteArgs| write::write(db, &a)),
        // kb_* 落到知识库工具面的唯一实现（D-0187）。★ 走 `call_readonly`，**不是** `call` ——
        // 分派是按名字走的，「清单里没列」拦不住客户端自己编一个 `kb_accept` 发过来（实测过）。
        n if n.starts_with("kb_") => crate::kb::tools::call_readonly(db, n, &args),
        other => return Err((-32602, format!("unknown tool: {other}"))),
    };

    Ok(match text {
        Ok(t) => json!({"content": [{"type": "text", "text": t}]}),
        Err(e) => json!({"content": [{"type": "text", "text": e.to_string()}], "isError": true}),
    })
}

/// 工具清单：6 条主工具 + 2 条逃生口（D-0191/D-0192）。
/// 读工具只读；唯一的写工具 `notes_write` 只落请求，正文由桌面端执行。
fn tools() -> Value {
    json!([
        {
            "name": "notes_cd",
            "description": "笔记导航。不传 target = pwd + ls；传目录名进目录，传标题/id/路径打开文章，回大纲 + 1k 预览。支持 ..、/、标题#小节。",
            "_meta": {
                "anthropic/searchHint": "cd ls open note article 笔记 打开 进入 目录",
                "anthropic/maxResultSizeChars": 12000
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target": {"type": "string", "description": "目录名 / 标题 / 32 位 id / 虚拟路径；不传 = 列当前目录"}
                }
            }
        },
        {
            "name": "notes_read",
            "description": "读当前文章或指定文章。section 先按标题匹配、再按正文匹配；不传 section 时，长文先回大纲 + 预览。",
            "_meta": {
                "anthropic/searchHint": "read note section cat 笔记 正文 读",
                "anthropic/maxResultSizeChars": 12000
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target": {"type": "string", "description": "标题 / id / 路径；不传 = 当前文章"},
                    "section": {"type": "string", "description": "标题或正文关键字，如「三刀流」"},
                    "offset": {"type": "integer", "description": "从第几行开始，0 起数"},
                    "limit": {"type": "integer", "description": "最多几行"}
                }
            }
        },
        {
            "name": "notes_find",
            "description": "按关键词/问题找笔记，回 6–8 张卡片（标题、一句摘要、命中片段、id），不返回全文。",
            "_meta": {
                "anthropic/searchHint": "search find note query 笔记 搜索 查找 之前写过",
                "anthropic/maxResultSizeChars": 12000
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "关键词、问题或标题片段"},
                    "limit": {"type": "integer", "description": "最多几条，默认 8"}
                },
                "required": ["query"]
            }
        },
        {
            "name": "notes_map",
            "description": "全局地图：按规则聚类出主题和篇数，每类给 3 个例子。传 scope 下钻某个主题或目录。",
            "_meta": {
                "anthropic/searchHint": "map overview topics library 笔记 全局 地图 主题 分类",
                "anthropic/maxResultSizeChars": 12000
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scope": {"type": "string", "description": "主题名或目录名；不传 = 根地图"},
                    "limit": {"type": "integer", "description": "下钻时最多几条，默认 20"}
                }
            }
        },
        {
            "name": "notes_related",
            "description": "跟一篇相关的笔记：显式链接 + AI 推断的 pending 链接 + 标题相近。不传 id = 当前文章。",
            "_meta": {
                "anthropic/searchHint": "related similar backlinks 笔记 关联 相关 反链",
                "anthropic/maxResultSizeChars": 12000
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "文档 id；不传 = 当前文章"},
                    "limit": {"type": "integer", "description": "最多几条，默认 8"}
                }
            }
        },
        {
            "name": "notes_learn",
            "description": "一篇笔记的学习数据：打开次数、阅读时长、读到的最深位置（0–100）、行为分、熟悉度（不熟/略懂/熟悉/很熟）。不传 target 列有记录的；unfamiliar=true 只列「不熟」。familiarity=1–4 打档、0 清除，改档需要桌面端开着。行为计数不能由这里改。",
            "_meta": {
                "anthropic/searchHint": "learn familiarity reading progress 笔记 熟悉度 学习 阅读 不熟",
                "anthropic/maxResultSizeChars": 12000
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target": {"type": "string", "description": "标题 / id / 路径；不传 = 列表"},
                    "unfamiliar": {"type": "boolean", "description": "true = 只列熟悉度为「不熟」的"},
                    "familiarity": {"type": "integer", "description": "1 不熟 · 2 略懂 · 3 熟悉 · 4 很熟 · 0 清除。传了就是写，需要 target"}
                }
            }
        },
        {
            "name": "notes_write",
            "description": "管理笔记：create/append/replace/rename/move/trash/restore/tag/undo。写操作需要 self-notion 桌面端开着；replace/trash 必须 confirm=true。",
            "_meta": {
                "anthropic/searchHint": "write create append move rename delete tag note 笔记 写入 新建 移动 删除",
                "anthropic/maxResultSizeChars": 12000
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "append", "replace", "rename", "move", "trash", "restore", "tag", "undo"]
                    },
                    "target": {"type": "string", "description": "标题 / id / 路径；create 以外必填"},
                    "title": {"type": "string", "description": "create/rename 的新标题"},
                    "content": {"type": "string", "description": "Markdown；create/append/replace 用"},
                    "parent": {"type": "string", "description": "create/move 的目标目录；空 = 根"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "confirm": {"type": "boolean", "description": "replace/trash 必须为 true"},
                    "if_updated_at": {"type": "integer", "description": "可选：notes_cd 回的 updatedAt，防覆盖"}
                },
                "required": ["action"]
            }
        },
        {
            "name": "vfs_list",
            "description": "逃生口：列虚拟目录。优先用 notes_cd()。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "虚拟路径：/ · /tree · /by-date · /recent · /by-tag/<标签> · /links/to · /search/<词>"}
                },
                "required": ["path"]
            }
        },
        {
            "name": "vfs_stat",
            "description": "逃生口：看路径是文件还是目录、多大。",
            "inputSchema": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"]
            }
        }
    ])
}

/* ─────────────────────────── 小工具 ─────────────────────────── */

/// 参数 → 干活。解不开就是 `bad_args`（和 `commands::dispatch` 同一个口径）。
fn tool<T: serde::de::DeserializeOwned>(
    args: &Value,
    f: impl FnOnce(T) -> ApiResult<String>,
) -> ApiResult<String> {
    let a: T =
        serde_json::from_value(args.clone()).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
    f(a)
}

/// 结构化结果 → 给模型的文本（一行 JSON）。
fn json_text<T: serde::Serialize>(v: &T) -> ApiResult<String> {
    serde_json::to_string(v).map_err(|e| ApiError::new("encode", e.to_string()))
}

/* ─────────────────────────── 路径 / 错误出口 ─────────────────────────── */

/// `<app data>` 目录。规则照抄 `lib.rs` 的 `app.path().app_data_dir()` ——
/// MCP 进程里没有 Tauri，为一行路径把整个 tauri 拖进来不值（D-0084 第 6 条）。
/// 库路径。**算在 `store` 里**（app 的 `errors.log` 也认它）—— 路径只有一个来源。
fn db_path() -> PathBuf {
    crate::store::default_db_path()
}

