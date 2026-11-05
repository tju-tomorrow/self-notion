//! MCP 写工具：只落请求，不碰正文；桌面端用编辑器解析器执行，再写回结果。
//! 写操作要求 self-notion 开着；读路径不受影响。

use crate::commands::{ApiError, ApiResult};
use crate::mcp::nav;
use crate::store::{self, db_err, docs, Db};
use crate::vfs;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const WAIT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(100);

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct WriteArgs {
    pub action: String,
    pub target: Option<String>,
    pub title: Option<String>,
    pub content: Option<String>,
    pub parent: Option<String>,
    pub tags: Option<Vec<String>>,
    pub confirm: Option<bool>,
    pub if_updated_at: Option<i64>,
}

pub fn write(db: &Db, args: &WriteArgs) -> ApiResult<String> {
    let r = run(db, args);
    if let Err(e) = &r {
        crate::log::record("agent-write", &format!("{}: {}", e.code, e.message));
    }
    r
}

fn run(db: &Db, a: &WriteArgs) -> ApiResult<String> {
    let action = a.action.trim().to_lowercase();
    let mut payload = serde_json::Map::new();
    let mut changed: Option<String> = None;

    match action.as_str() {
        "create" => {
            let title = req(a.title.as_deref(), "title")?;
            let parent_id = resolve_parent(db, a.parent.as_deref())?;
            payload.insert("title".into(), json!(title));
            payload.insert("content".into(), json!(a.content.as_deref().unwrap_or("")));
            payload.insert("parentId".into(), json!(parent_id));
            if let Some(tags) = &a.tags {
                payload.insert("tags".into(), json!(tags));
            }
        }
        "append" | "replace" => {
            let id = target_id(db, a.target.as_deref())?;
            check_fresh(db, &id, a.if_updated_at)?;
            let content = req(a.content.as_deref(), "content")?;
            if action == "replace" && a.confirm != Some(true) {
                return Err(ApiError::new(
                    "confirm",
                    "replace 会整篇覆盖；确认后带 confirm=true 再调",
                ));
            }
            payload.insert("id".into(), json!(id));
            payload.insert("content".into(), json!(content));
            if action == "replace" {
                if let Some(t) = a.title.as_deref().filter(|s| !s.trim().is_empty()) {
                    payload.insert("title".into(), json!(t));
                }
            }
            changed = Some(id);
        }
        "rename" => {
            let id = target_id(db, a.target.as_deref())?;
            let title = req(a.title.as_deref(), "title")?;
            payload.insert("id".into(), json!(id));
            payload.insert("title".into(), json!(title));
            changed = Some(id);
        }
        "move" => {
            let id = target_id(db, a.target.as_deref())?;
            let parent_id = resolve_parent(db, a.parent.as_deref())?;
            guard_cycle(db, &id, parent_id.as_deref())?;
            payload.insert("id".into(), json!(id));
            payload.insert("parentId".into(), json!(parent_id));
            changed = Some(id);
        }
        "trash" => {
            let id = target_id(db, a.target.as_deref())?;
            if a.confirm != Some(true) {
                return Err(ApiError::new(
                    "confirm",
                    "trash 会进回收站；确认后带 confirm=true 再调",
                ));
            }
            payload.insert("id".into(), json!(id));
            changed = Some(id);
        }
        "restore" => {
            let id = restore_id(db, a.target.as_deref())?;
            payload.insert("id".into(), json!(id));
            changed = Some(id);
        }
        "tag" => {
            let id = target_id(db, a.target.as_deref())?;
            let tags = a
                .tags
                .as_ref()
                .ok_or_else(|| ApiError::new("bad_args", "tag 需要 tags"))?;
            payload.insert("id".into(), json!(id));
            payload.insert("tags".into(), json!(tags));
            changed = Some(id);
        }
        "undo" => {
            let id = target_id(db, a.target.as_deref())?;
            payload.insert("id".into(), json!(id));
            changed = Some(id);
        }
        other => {
            return Err(ApiError::new(
                "bad_args",
                format!("不认识的 action：{other}"),
            ))
        }
    }

    let result = send(&action, Value::Object(payload))?;
    let v: Value = serde_json::from_str(&result).unwrap_or(Value::Null);
    let id = v
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or(changed)
        .ok_or_else(|| ApiError::new("agent", "桌面端没回 id"))?;

    let meta = db.with(|c| docs::get(c, &id))?;
    let path = vfs::path_of(db, &id)?.unwrap_or_default();
    let mut out = format!(
        "ok: {action}\nid: {}\ntitle: {}\nupdatedAt: {}\n",
        meta.id, meta.title, meta.updated_at
    );
    if !path.is_empty() {
        out.push_str(&format!("path: {path}\n"));
    }
    if let Some(blocks) = v.get("blocks").and_then(Value::as_u64) {
        out.push_str(&format!("blocks: {blocks}\n"));
    }
    Ok(out)
}

fn send(action: &str, payload: Value) -> ApiResult<String> {
    let path = store::default_db_path();
    let w = Db::open_readwrite(&path)
        .map_err(|e| ApiError::new("db", format!("打开库失败：{e}")))?;
    let id = store::new_id();
    let args =
        serde_json::to_string(&payload).map_err(|e| ApiError::new("encode", e.to_string()))?;
    w.with(|c| {
        c.execute(
            "INSERT INTO agent_request(id, action, args, state, at)
             VALUES(?1, ?2, ?3, 'pending', ?4)",
            params![&id, action, &args, store::now_ms()],
        )
        .map_err(db_err)?;
        Ok(())
    })
    .map_err(|e| {
        ApiError::new(
            "agent",
            format!("写请求落库失败（桌面端还没建表？）：{}", e.message),
        )
    })?;

    let start = Instant::now();
    while start.elapsed() < WAIT {
        std::thread::sleep(POLL);
        let row = w.with(|c| {
            c.query_row(
                "SELECT state, result, error FROM agent_request WHERE id = ?1",
                [id.as_str()],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(db_err)
        })?;
        if let Some((state, result, error)) = row {
            match state.as_str() {
                "done" => return Ok(result),
                "failed" => return Err(ApiError::new("agent", error)),
                _ => {}
            }
        }
    }

    let _ = w.with(|c| {
        c.execute(
            "DELETE FROM agent_request WHERE id = ?1 AND state = 'pending'",
            [id.as_str()],
        )
        .map_err(db_err)
    });
    Err(ApiError::new(
        "agent",
        "桌面端没响应（10s）。写操作需要 self-notion 开着；读不受影响。",
    ))
}

fn req<'a>(v: Option<&'a str>, name: &str) -> ApiResult<&'a str> {
    v.map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::new("bad_args", format!("缺 {name}")))
}

fn target_id(db: &Db, target: Option<&str>) -> ApiResult<String> {
    nav::resolve_id(db, req(target, "target")?)
}

fn resolve_parent(db: &Db, parent: Option<&str>) -> ApiResult<Option<String>> {
    let Some(q) = parent.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if q == "/" || q == "根" || q == "root" || q == "tree" || q == "/tree" {
        return Ok(None);
    }
    if q.starts_with('/') || q.starts_with("tree/") {
        let path = if q.starts_with('/') { q.to_string() } else { format!("/{q}") };
        return vfs::dir_id_of(db, &path)?
            .map(Some)
            .ok_or_else(|| ApiError::new("not_found", format!("父目录不存在：{path}")));
    }

    let dirs: Vec<String> = vfs::dirs(db)?
        .into_iter()
        .filter(|p| p.starts_with("/tree/"))
        .filter(|p| p.ends_with(&format!("/{q}")))
        .collect();
    if dirs.len() == 1 {
        if let Some(id) = vfs::dir_id_of(db, &dirs[0])? {
            return Ok(Some(id));
        }
    }
    if dirs.len() > 1 {
        return Err(ApiError::new(
            "ambiguous",
            format!("多个目录叫 {q}：{}", dirs.join(" · ")),
        ));
    }

    // 叶子也能当父页（Notion 里加子页就把叶子变成容器）。
    nav::resolve_id(db, q)
        .map(Some)
        .map_err(|_| ApiError::new("not_found", format!("父目录/父页面不存在：{q}")))
}

fn guard_cycle(db: &Db, id: &str, parent: Option<&str>) -> ApiResult<()> {
    let mut cur = parent.map(str::to_string);
    while let Some(p) = cur {
        if p == id {
            return Err(ApiError::new("bad_args", "不能移动到自己的子页面"));
        }
        cur = db.with(|c| Ok(docs::get(c, &p).ok().and_then(|m| m.parent_id)))?;
    }
    Ok(())
}

fn check_fresh(db: &Db, id: &str, expected: Option<i64>) -> ApiResult<()> {
    if let Some(want) = expected {
        let now = db.with(|c| docs::get(c, id))?.updated_at;
        if now != want {
            return Err(ApiError::new(
                "stale",
                format!("文档已变更（now={now}）；先 notes_cd 重读再写"),
            ));
        }
    }
    Ok(())
}

fn restore_id(db: &Db, target: Option<&str>) -> ApiResult<String> {
    let q = req(target, "target")?;
    let ql = q.to_lowercase();
    if (8..=32).contains(&q.len()) && q.chars().all(|c| c.is_ascii_hexdigit()) {
        let hits: Vec<docs::DocMeta> = db
            .with(|c| docs::list(c, true))?
            .into_iter()
            .filter(|m| m.id.starts_with(&ql))
            .collect();
        match hits.len() {
            1 => return Ok(hits[0].id.clone()),
            n if n > 1 => {
                return Err(ApiError::new(
                    "ambiguous",
                    format!("短 id `{q}` 匹配了 {n} 篇；用完整 id 或标题"),
                ))
            }
            _ => {}
        }
    }
    let hits: Vec<docs::DocMeta> = db
        .with(|c| docs::list(c, true))?
        .into_iter()
        .filter(|m| m.deleted_at.is_some())
        .filter(|m| m.title.to_lowercase().contains(&ql))
        .collect();
    match hits.len() {
        1 => Ok(hits[0].id.clone()),
        0 => Err(ApiError::new("not_found", format!("回收站里没有：{q}"))),
        _ => Err(ApiError::new(
            "ambiguous",
            format!(
                "回收站里多篇匹配：{}",
                hits.iter()
                    .take(6)
                    .map(|m| m.title.as_str())
                    .collect::<Vec<_>>()
                    .join(" · ")
            ),
        )),
    }
}
