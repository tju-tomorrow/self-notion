//! MCP server（D-0084）—— 同一个二进制的另一个入口：`self-notion --mcp`。
//!
//! 客户端（Claude Code / Codex…）**自己 spawn 这个进程**，所以它和「正在跑的 app」是两个东西：
//! 这儿没有 Tauri、没有 webview、没有一行前端代码，它自己**只读**打开 `self-notion.db`，
//! 复用 `vfs::*` 和 `store::docs::*`（`docs/vfs.md` 第六节）。
//!
//! ★ **只读的硬边界是下面那份工具清单是字面量、里面没有写工具** —— 不是句柄那层：
//! `Db::open_readonly` 在 WAL 下会退化成 `PRAGMA query_only`（见它自己的注释）。
//!
//! ★ **stdout 是协议流**：一行一条 JSON，多一个字都不行。日志一律 stderr。

use crate::commands::{ApiError, ApiResult};
use crate::store::{docs, Db};
use crate::vfs;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;

/// 客户端没报版本（或报了个我们不认识的）时的兜底 —— 我们只用得到 `tools` 那一块。
const PROTOCOL: &str = "2024-11-05";

/// `--mcp` 唯一入口。
pub fn serve() {
    let path = db_path();
    let db = match Db::open_readonly(&path) {
        Ok(db) => db,
        // 六条工具没有一条离得开库，开不了就是彻底不能用 —— 响亮地死，
        // 客户端会把 stderr 显示给用户（这比"起来了但每次都报错"好查）。
        Err(e) => {
            crate::log::record("mcp", &format!("打开 {} 失败：{e}", path.display()));
            std::process::exit(1);
        }
    };
    eprintln!("[self-notion] mcp: 只读打开 {}", path.display());

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
        if let Some(resp) = handle(&db, &msg) {
            // serde 会把字符串里的换行转义掉，所以一条消息一定是一行
            let _ = writeln!(out, "{resp}");
            let _ = out.flush();
        }
    }
}

/// 一条消息进，一条（或零条）出。`None` = 不回。
fn handle(db: &Db, msg: &Value) -> Option<String> {
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
            "instructions": "这是 self-notion 的虚拟文档目录。先 vfs_read /index.md 看全局，\
                             再 vfs_grep 定位，正文用 vfs_read 拿。目录语法见 /AGENTS.md。",
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => call_tool(db, &params),
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
fn call_tool(db: &Db, params: &Value) -> Result<Value, (i64, String)> {
    let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

    let text: ApiResult<String> = match name {
        "vfs_list" => tool(&args, |a: vfs::ListArgs| {
            db.with(|c| vfs::list(c, &a.path)).and_then(|v| json_text(&v))
        }),
        "vfs_grep" => tool(&args, |a: vfs::GrepArgs| {
            db.with(|c| vfs::grep(c, &a.pattern, a.ignore_case)).and_then(|v| json_text(&v))
        }),
        // read 回正文本身，不套 JSON —— 模型要的是 `cat` 的样子
        "vfs_read" => tool(&args, |a: vfs::ReadArgs| {
            db.with(|c| vfs::read(c, &a.path, a.offset, a.limit))
        }),
        "vfs_stat" => tool(&args, |a: vfs::StatArgs| -> ApiResult<String> {
            let p = a.path.clone();
            // 路径不存在在这儿是一次失败（stat 在文件系统里也是 ENOENT），不静默回 null
            let e = db.with(|c| vfs::stat(c, &a.path))?.ok_or_else(|| ApiError::new("not_found", p))?;
            json_text(&e)
        }),
        "doc_list" => tool(&args, |a: DocListArgs| {
            db.with(|c| docs::list(c, a.include_trashed)).and_then(|v| json_text(&v))
        }),
        // 先 get 一下再读：id 打错要报 not_found，不能和「从没落过库的文档」一样静默回空串
        "doc_text" => tool(&args, |a: DocTextArgs| {
            db.with(|c| docs::get(c, &a.id).and_then(|_| docs::text(c, &a.id)))
        }),
        other => return Err((-32602, format!("unknown tool: {other}"))),
    };

    Ok(match text {
        Ok(t) => json!({"content": [{"type": "text", "text": t}]}),
        Err(e) => json!({"content": [{"type": "text", "text": e.to_string()}], "isError": true}),
    })
}

/// 六条工具。**这就是只读边界本身**（D-0084 第 3 条）：没有写工具，不是"默认关"。
/// `inputSchema` 的形状对着 `vfs/mod.rs` 的入参结构（那边是 camelCase）。
fn tools() -> Value {
    json!([
        {
            "name": "vfs_list",
            "description": "列一个虚拟目录的直接子项（目录在前，其次按名字）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        // 列**真的存在**的：`/search/<词>` 是动态目录（vfs/mod.rs 的 `search_matches`），
                        // 它不在静态表里，但能列举、能读，所以算数。
                        "description": "虚拟路径：/ · /tree · /tree/工作 · /by-date · /recent · /favorites · /outline · /trash · /by-tag/<标签> · /links/to · /links/from · /search/<词>"
                    }
                },
                "required": ["path"]
            }
        },
        {
            "name": "vfs_grep",
            "description": "在所有未删除文档的正文里找**字面子串**（不是正则），回 path + 行号 + 整行。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "字面子串，不能为空"},
                    "ignoreCase": {"type": "boolean", "description": "忽略大小写，默认 false"}
                },
                "required": ["pattern"]
            }
        },
        {
            "name": "vfs_read",
            "description": "读一个虚拟文件的正文。也可以读系统生成的 /index.md 和 /AGENTS.md。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "虚拟路径，如 /tree/工作/周报.md"},
                    "offset": {"type": "integer", "description": "从第几行开始，0 起数"},
                    "limit": {"type": "integer", "description": "最多几行"}
                },
                "required": ["path"]
            }
        },
        {
            "name": "vfs_stat",
            "description": "看一个路径存不存在、是文件还是目录、多大。",
            "inputSchema": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"]
            }
        },
        {
            "name": "doc_list",
            "description": "全部文档的元数据（一行 JSON：id / title / parentId / updatedAt / tags…）。按路径找正文用 vfs_*。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "includeTrashed": {"type": "boolean", "description": "连回收站一起，默认 false"}
                }
            }
        },
        {
            "name": "doc_text",
            "description": "按文档 id 读 Markdown 投影正文（id 从 doc_list 拿）。",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"]
            }
        }
    ])
}

/* ─────────────────────────── 小工具 ─────────────────────────── */

/// doc_list 的入参。只有这一条工具的参数不在 `vfs/mod.rs` 里，就写在这儿。
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct DocListArgs {
    include_trashed: bool,
}

#[derive(Deserialize)]
struct DocTextArgs {
    id: String,
}

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

