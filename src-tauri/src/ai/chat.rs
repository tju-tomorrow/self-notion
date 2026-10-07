//! `ai:chat` —— 流式 + 工具调用（D-0087），`docs/ai.md` 第二、五节。
//!
//! OpenAI 兼容的 `POST {baseUrl}`（`baseUrl` 是用户填的**完整地址**，同 `summarize`）：
//! `stream: true` + `tools`。
//!
//! ★ **SSE 得一行一行读，`backup::http::send` 那种「一次读完拿 body」的形状用不了** ——
//!   所以这里自己拿 `reqwest::blocking`（`Response` 本身就是 `std::io::Read`）。
//!   依赖没新增：`reqwest` 已在编译树里，`blocking` feature 也早就开着。
//!
//! ★ **整段往返跑在一条自己的线程上**：这个命令立刻返回，几十秒的流不会占住 IPC 那根线。
//!   前端拿的是事件（下面三个），不是命令的返回值 —— 这也正是 `docs/ai.md` 第九节
//!   把 `ai:delta` / `ai:done` / `ai:error` 列在那里的原因。
//!
//! 归一化：provider 的 delta 只往外面吐契约里那三种 `AiChunk`（`text` / `tool` / `end`）。
//! 前端不解析 OpenAI 的原始形状 —— 换 provider 不该动前端（`contract.ts` 的 `AiChunk`）。

use std::io::{BufRead, BufReader};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Emitter, EventTarget};

use super::{load_config, Config};
use crate::commands::{ApiError, ApiResult};
use crate::store::Db;

/// 事件名。前端 `listen` 这三个（`plugins/ai/chat.ts`）。
const EV_DELTA: &str = "ai:delta";
const EV_DONE: &str = "ai:done";
const EV_ERROR: &str = "ai:error";

/// 一次回合的上限。流式下它是**整段**的上限，给足。
const TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Args {
    /// 前端生成的回合号，事件里原样带回 —— 同一时刻可能不止一条流。
    request_id: String,
    /// 对话消息，形状 = `contract.ts` 的 `AiMessage`。**带 `tool` 角色和工具调用**
    /// —— 少了它们，多轮工具调用就得把结果伪装成用户发言（D-0087 续 之前就是这么绕的）。
    #[serde(default)]
    messages: Vec<Msg>,
    /// 工具清单，形状 = `contract.ts` 的 `ToolSpec` **去掉 `run`**（`{name, description, parameters}`）：
    /// 函数过不了线，前端自己剥掉。
    #[serde(default)]
    tools: Vec<Value>,
}

/// `ai:chat`。校验同步做完（调用方写错了不该变成一个异步事件），真活儿扔给线程。
///
/// `win` = 调用方的窗口 label：流是**发给那个窗口**的，不是发给 `main` 的 ——
/// 多窗口下拿 `main` 当收件人，第二个窗口里问 AI 一个字都收不到。
pub fn chat(
    app: Option<&tauri::AppHandle>,
    db: &Db,
    args: Value,
    win: Option<&str>,
) -> ApiResult<Value> {
    let app = app.cloned().ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
    let win = win.unwrap_or("main").to_string();
    let a: Args =
        serde_json::from_value(args).map_err(|e| ApiError::new("bad_args", e.to_string()))?;

    // ★ 配置只在这里读一次，**HTTP 期间不持库锁** —— 同 `ai::summarize` 的理由：
    //   一次几秒到几十秒的模型往返，攥着锁会把整个应用卡住。
    let cfg = db.with(load_config)?;
    if cfg.base_url.is_empty() || cfg.model.is_empty() || cfg.api_key.is_empty() {
        return Err(ApiError::new("ai_not_configured", "还没配 AI：设置 → AI"));
    }

    let request_id = a.request_id.clone();
    std::thread::spawn(move || {
        if let Err(message) = stream(&app, &cfg, &a, &win) {
            let _ = app.emit_to(
                EventTarget::webview_window(win),
                EV_ERROR,
                json!({ "requestId": request_id, "message": message }),
            );
        }
    });

    Ok(json!({ "started": true }))
}

/// 把 provider 的 SSE 归一化成 `AiChunk` 发出去。`Err` = 这条流死了（命令层据此发 `ai:error`）。
fn stream(app: &tauri::AppHandle, cfg: &Config, a: &Args, win: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client
        .post(cfg.base_url.trim_end_matches('/'))
        .header("Authorization", format!("Bearer {}", cfg.api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream");
    // opencode 的 zen/go 网关要一个像样的 UA + 一个稳定的 session 头（见 `mod.rs` 的 `gateway_headers`）。
    for (k, v) in crate::ai::gateway_headers(&cfg.base_url) {
        req = req.header(k, v);
    }
    let resp = req
        .body(build_payload(cfg, a).to_string())
        .send()
        .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        let body = resp.text().unwrap_or_default();
        return Err(format!("HTTP {status} — {}", clip_msg(&body)));
    }

    // 工具调用的参数是**一段段拼出来的** —— 攒着，拼完了才发（`contract.ts` 的 `AiToolCall`）。
    let mut calls: Vec<Call> = Vec::new();
    let mut reason: Option<String> = None;

    for line in BufReader::new(resp).lines() {
        let line = line.map_err(|e| e.to_string())?;
        let Some(data) = line.strip_prefix("data:") else { continue };
        let data = data.trim();
        if data.is_empty() {
            continue;
        }
        if data == "[DONE]" {
            break;
        }
        // 认不出的行跳过 —— 有的网关会夹心跳 / 注释，为一行把整条流打断不值得。
        let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
        // 有的网关把错误塞在 200 回包里（同 `mod.rs` 的 `pick_content`）。
        if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(Value::as_str) {
            return Err(msg.to_string());
        }

        let choice = &v["choices"][0];
        let text = choice["delta"]["content"].as_str().unwrap_or_default();
        if !text.is_empty() {
            emit(app, win, EV_DELTA, delta(a, json!({ "type": "text", "text": text })))?;
        }
        if let Some(list) = choice["delta"]["tool_calls"].as_array() {
            for c in list {
                absorb(&mut calls, c);
            }
        }
        let done = choice["finish_reason"].as_str().unwrap_or_default();
        if !done.is_empty() {
            reason = Some(done.to_string());
        }
    }

    for (i, c) in calls.iter_mut().enumerate() {
        // 有的网关不发 `id`（或只在第一片发，`absorb` 之后仍是空）。没有 id 的话下一轮那条
        // `role: "tool"` 就对不上号 —— 给它一个本地 id：发出去的 `tool_calls[].id` 和前端
        // 回传的 `tool_call_id` 是同一个，对上的是我们自己发的那个字符串，与网关无关。
        if c.id.is_empty() {
            c.id = format!("call_{i}");
        }
        emit(
            app,
            win,
            EV_DELTA,
            delta(
                a,
                json!({ "type": "tool", "call": { "id": c.id, "name": c.name, "args": c.args } }),
            ),
        )?;
    }

    // provider 没给 `finish_reason` 也不能让前端猜：有工具就是 `tool_calls`，没有就是 `stop`。
    let reason = reason.unwrap_or_else(|| {
        if calls.is_empty() { "stop".to_string() } else { "tool_calls".to_string() }
    });
    emit(app, win, EV_DELTA, delta(a, json!({ "type": "end", "reason": reason })))?;
    emit(app, win, EV_DONE, json!({ "requestId": a.request_id, "reason": reason }))?;
    Ok(())
}

/// 一条 `ai:delta` 的载荷：`requestId` 给前端挑自己的流，`chunk` 就是契约的 `AiChunk`。
fn delta(a: &Args, chunk: Value) -> Value {
    json!({ "requestId": a.request_id, "chunk": chunk })
}

/// 一个正在拼的工具调用。`index` 是 provider 给的位置（不是数组下标的话按顺序接）。
#[derive(Default)]
struct Call {
    id: String,
    name: String,
    args: String,
}

/// 契约里的**一条对话消息**（`contract.ts` 的 `AiMessage`）。
///
/// ★ **provider 的线上形状只在这个文件里拼**：前端认的是 `toolCalls` / `toolCallId` 这套中性形状，
/// `tool_calls[].function.arguments` 那种嵌套是 OpenAI 的方言 —— 换 provider 不该动前端
/// （和 `AiChunk` 归一化同一个理由）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Msg {
    role: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    tool_calls: Vec<MsgCall>,
    #[serde(default)]
    tool_call_id: Option<String>,
}

#[derive(Deserialize)]
struct MsgCall {
    id: String,
    name: String,
    args: String,
}

/// 契约形状 → OpenAI 线上形状。三个分支就够：工具结果 / 带调用的 assistant / 普通消息。
fn wire(m: &Msg) -> Value {
    match m.role.as_str() {
        // 工具结果**必须**带 `tool_call_id`：没有它模型不知道这是哪一次调用的回执，
        // 会把结果当成一条凭空冒出来的用户发言。
        "tool" => json!({
            "role": "tool",
            "tool_call_id": m.tool_call_id.clone().unwrap_or_default(),
            "content": m.content,
        }),
        "assistant" if !m.tool_calls.is_empty() => {
            let calls: Vec<Value> = m
                .tool_calls
                .iter()
                .map(|c| {
                    json!({
                        "id": c.id,
                        "type": "function",
                        "function": {
                            "name": c.name,
                            // 参数是**字符串**（模型原样给的 JSON 文本）。空的时候给 `{}` ——
                            // 有些网关会去 parse 它，空串直接 400。
                            "arguments": if c.args.is_empty() { "{}" } else { c.args.as_str() },
                        },
                    })
                })
                .collect();
            // 只调工具、一个字没说时 `content` 必须是 null —— 空串的 assistant 有些网关不收。
            let content = if m.content.is_empty() {
                Value::Null
            } else {
                Value::String(m.content.clone())
            };
            json!({ "role": "assistant", "content": content, "tool_calls": calls })
        }
        _ => json!({ "role": m.role, "content": m.content }),
    }
}

fn absorb(acc: &mut Vec<Call>, c: &Value) {
    let at = c["index"].as_u64().unwrap_or(acc.len() as u64) as usize;
    while acc.len() <= at {
        acc.push(Call::default());
    }
    let slot = &mut acc[at];
    let id = c["id"].as_str().unwrap_or_default();
    if !id.is_empty() {
        slot.id = id.to_string();
    }
    // 名字有两种发法：整段一次给（多数）或拆成几片。已经在尾巴上了就不再拼一遍。
    let name = c["function"]["name"].as_str().unwrap_or_default();
    if !name.is_empty() && !slot.name.ends_with(name) {
        slot.name.push_str(name);
    }
    // 参数**一定**是分片的，只能往尾巴上接。
    slot.args.push_str(c["function"]["arguments"].as_str().unwrap_or_default());
}

fn build_payload(cfg: &Config, a: &Args) -> Value {
    let messages: Vec<Value> = a.messages.iter().map(wire).collect();
    let mut p = json!({
        "model": cfg.model,
        "stream": true,
        "messages": messages,
    });
    if !a.tools.is_empty() {
        // `ToolSpec` → OpenAI 的 function 形状。`run` 已经在前面剥掉了（函数过不了线）。
        let list: Vec<Value> = a
            .tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.get("name").cloned().unwrap_or(Value::Null),
                        "description": t.get("description").cloned().unwrap_or(Value::Null),
                        "parameters": t
                            .get("parameters")
                            .cloned()
                            .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                    }
                })
            })
            .collect();
        p["tools"] = Value::Array(list);
    }
    p
}

fn emit(app: &tauri::AppHandle, win: &str, event: &str, payload: Value) -> Result<(), String> {
    app.emit_to(EventTarget::webview_window(win), event, payload)
        .map_err(|e| e.to_string())
}

/// 错误正文（可能是 HTML 错误页）摊进一句话里 —— 它会被写进 `errors.log` 和右上角浮层。
fn clip_msg(raw: &str) -> String {
    let flat = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    flat.chars().take(300).collect()
}
