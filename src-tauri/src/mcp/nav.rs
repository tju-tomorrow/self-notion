//! MCP 的会话内导航：`notes_cd` / `notes_read`。
//! 状态只在进程内存里，active 存 id —— 路径是派生的，改名不失效。

use crate::commands::{ApiError, ApiResult};
use crate::store::{docs, Db};
use crate::vfs;
use serde::Deserialize;

const LIST_LIMIT: usize = 20;
const PREVIEW_CHARS: usize = 1000;
const READ_LIMIT: usize = 4000;
const CANDIDATES: usize = 6;

pub struct Nav {
    pub cwd: String,
    pub active_doc: Option<String>,
    pub active_section: Option<String>,
}

impl Nav {
    pub fn new() -> Self {
        Self { cwd: "/".into(), active_doc: None, active_section: None }
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct CdArgs {
    pub target: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ReadArgs {
    pub target: Option<String>,
    pub section: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

pub fn cd(db: &Db, nav: &mut Nav, target: Option<&str>) -> ApiResult<String> {
    let Some(raw) = target.map(clean).filter(|s| !s.is_empty()) else {
        return locate(db, nav);
    };
    let (raw, section) = split_section(&raw);

    match raw.as_str() {
        "." => return locate(db, nav),
        ".." => {
            if nav.active_doc.take().is_some() {
                nav.active_section = None;
            } else {
                nav.cwd = parent(&nav.cwd).to_string();
            }
            return locate(db, nav);
        }
        "/" => {
            nav.cwd = "/".into();
            nav.active_doc = None;
            nav.active_section = None;
            return locate(db, nav);
        }
        _ => {}
    }

    if raw.starts_with('/') || raw.starts_with("tree/") {
        let path = if raw.starts_with('/') { raw.clone() } else { format!("/{raw}") };
        return cd_path(db, nav, &path, section.as_deref());
    }
    if raw.starts_with("../") || raw.starts_with("./") {
        return cd_path(db, nav, &join(&nav.cwd, &raw), section.as_deref());
    }

    if is_id_prefix(&raw) {
        match pick_doc(db, &raw)? {
            Pick::One(id) => return open_id(db, nav, &id, section.as_deref()),
            Pick::Many(list) => return Ok(candidates(&list, "找到多篇")),
            Pick::None => {}
        }
    }

    let joined = join(&nav.cwd, &raw);
    if vfs::stat(db, &joined)?.is_some() {
        return cd_path(db, nav, &joined, section.as_deref());
    }

    let dirs = match_dirs(db, &raw)?;
    match dirs.len() {
        1 => return cd_path(db, nav, &dirs[0], section.as_deref()),
        n if n > 1 => return Ok(dir_candidates(&dirs)),
        _ => {}
    }

    match pick_doc(db, &raw)? {
        Pick::One(id) => open_id(db, nav, &id, section.as_deref()),
        Pick::Many(list) => Ok(candidates(&list, "找到多篇")),
        Pick::None => search_candidates(db, &raw),
    }
}

pub fn read(db: &Db, nav: &Nav, args: &ReadArgs) -> ApiResult<String> {
    let target = args.target.as_deref().map(clean).filter(|s| !s.is_empty());
    let (id, section) = match target {
        Some(q) => match resolve_read_target(db, &q)? {
            ReadTarget::Doc(id) => (id, args.section.clone()),
            ReadTarget::File(path) => {
                return Ok(clip(
                    vfs::read(db, &path, args.offset, args.limit)?,
                    READ_LIMIT,
                ))
            }
        },
        None => {
            let id = nav.active_doc.clone().ok_or_else(|| {
                ApiError::new("bad_args", "没有当前文章；先 notes_cd(标题|id)，或传 target")
            })?;
            (id, args.section.clone().or_else(|| nav.active_section.clone()))
        }
    };

    let md = db.with(|c| docs::text(c, &id))?;
    if md.trim().is_empty() {
        return Ok("（这篇还没有 Markdown 投影；在编辑器里打开一次就会补上）".into());
    }

    if let Some(sec) = section.as_deref() {
        let body = match find_section(&md, sec) {
            Some(t) => t,
            None => find_text(&md, sec).ok_or_else(|| {
                ApiError::new(
                    "not_found",
                    format!("没有这一节：「{sec}」。可用标题：\n{}", outline(&md)),
                )
            })?,
        };
        let body = slice_lines(&body, args.offset, args.limit);
        return Ok(clip(body, READ_LIMIT));
    }

    if args.offset.is_some() || args.limit.is_some() {
        return Ok(clip(slice_lines(&md, args.offset, args.limit), READ_LIMIT));
    }

    if md.chars().count() > READ_LIMIT {
        return Ok(clip(
            format!(
                "outline:\n{}\n\npreview:\n{}\n\n[长文 {} 字；用 section=… 或 offset/limit 继续]",
                outline(&md),
                preview_text(&md, PREVIEW_CHARS),
                md.chars().count()
            ),
            READ_LIMIT,
        ));
    }
    Ok(md)
}

/// 给写工具用：标题 / id / 路径 → 文档 id。
pub fn resolve_id(db: &Db, q: &str) -> ApiResult<String> {
    match resolve_read_target(db, q)? {
        ReadTarget::Doc(id) => Ok(id),
        ReadTarget::File(path) => {
            Err(ApiError::new("bad_args", format!("{path} 不是文章正文")))
        }
    }
}

fn locate(db: &Db, nav: &Nav) -> ApiResult<String> {
    if let Some(id) = &nav.active_doc {
        let meta = db.with(|c| docs::get(c, id))?;
        let md = db.with(|c| docs::text(c, id))?;
        let path = vfs::path_of(db, id)?.unwrap_or_default();
        return Ok(render_doc(&meta, &path, &md, nav.active_section.as_deref(), false));
    }
    list_dir(db, nav)
}

fn list_dir(db: &Db, nav: &Nav) -> ApiResult<String> {
    let entries = vfs::list(db, &nav.cwd)?;
    let total = entries.len();
    let mut s = format!("pwd: {}\n", nav.cwd);
    if total == 0 {
        s.push_str("（空目录）\n");
        return Ok(s);
    }
    s.push_str(&format!("（{} 项）\n", total));
    for e in entries.iter().take(LIST_LIMIT) {
        if e.kind == "dir" {
            s.push_str(&format!("- {}/\n", name_of(&e.path)));
        } else {
            s.push_str(&format!("- {}{}\n", name_of(&e.path), size_label(e.size)));
        }
    }
    if total > LIST_LIMIT {
        s.push_str(&format!("… 还有 {} 项；用 notes_find 缩小\n", total - LIST_LIMIT));
    }
    s.push_str("cd <标题> 打开一篇\n");
    Ok(clip(s, 1200))
}

fn cd_path(db: &Db, nav: &mut Nav, path: &str, section: Option<&str>) -> ApiResult<String> {
    let path = normalize(path);
    match vfs::stat(db, &path)? {
        Some(e) if e.kind == "dir" => {
            nav.cwd = path;
            nav.active_doc = None;
            nav.active_section = None;
            list_dir(db, nav)
        }
        Some(_) => {
            let Some(id) = vfs::id_of(db, &path)? else {
                return Err(ApiError::new(
                    "bad_args",
                    format!("{path} 不是文章正文（是清单文件）；用 vfs_read 读"),
                ));
            };
            open_id(db, nav, &id, section)
        }
        None => Err(ApiError::new("not_found", path)),
    }
}

fn open_id(db: &Db, nav: &mut Nav, id: &str, section: Option<&str>) -> ApiResult<String> {
    let meta = db.with(|c| docs::get(c, id))?;
    if meta.deleted_at.is_some() {
        return Err(ApiError::new("not_found", format!("《{}》在回收站里", meta.title)));
    }
    let md = db.with(|c| docs::text(c, id))?;
    let path = vfs::path_of(db, id)?.unwrap_or_default();
    nav.active_doc = Some(id.to_string());
    nav.active_section = section.map(str::to_string);
    nav.cwd = if path.is_empty() { "/".into() } else { parent(&path).to_string() };
    Ok(render_doc(&meta, &path, &md, section, true))
}

fn render_doc(
    meta: &docs::DocMeta,
    path: &str,
    md: &str,
    section: Option<&str>,
    preview: bool,
) -> String {
    let mut s = format!(
        "opened: {}\nid: {}\npath: {}\nupdated: {}\nupdatedAt: {}\n",
        meta.title,
        meta.id,
        if path.is_empty() { "(无路径)" } else { path },
        vfs::ymd_str(meta.updated_at),
        meta.updated_at
    );
    if md.trim().is_empty() {
        s.push_str("\n（这篇还没有 Markdown 投影；在编辑器里打开一次就会补上）\n");
        return s;
    }
    s.push_str(&format!("size: {} 字\n", md.chars().count()));
    if let Some(sec) = section {
        match find_section(md, sec) {
            Some(text) => {
                s.push_str(&format!("\n## {sec}\n{}\n", clip(text, READ_LIMIT)));
                return clip(s, READ_LIMIT);
            }
            None => match find_text(md, sec) {
                Some(text) => {
                    s.push_str(&format!(
                        "\n## {sec}（按正文匹配，不是标题）\n{}\n",
                        clip(text, READ_LIMIT)
                    ));
                    return clip(s, READ_LIMIT);
                }
                None => {
                    s.push_str(&format!("\n没找到「{sec}」。可用标题：\n"));
                    s.push_str(&outline(md));
                    return clip(s, 1800);
                }
            },
        }
    }
    s.push_str("\noutline:\n");
    s.push_str(&outline(md));
    s.push('\n');
    if preview {
        s.push_str("\npreview:\n");
        s.push_str(&preview_text(md, PREVIEW_CHARS));
        s.push_str("\n[继续: notes_read(section=\"…\")]\n");
    }
    clip(s, 1800)
}

enum Pick {
    One(String),
    Many(Vec<docs::DocMeta>),
    None,
}

fn pick_doc(db: &Db, q: &str) -> ApiResult<Pick> {
    // 卡片上印的是 8 位短 id；它必须能直接打开。长的 32 位 id 也走这一支。
    if is_id_prefix(q) {
        let ql = q.to_lowercase();
        let mut hits: Vec<docs::DocMeta> = db
            .with(|c| docs::list(c, false))?
            .into_iter()
            .filter(|m| m.id.starts_with(&ql))
            .collect();
        match hits.len() {
            1 => return Ok(Pick::One(hits.remove(0).id)),
            n if n > 1 => return Ok(Pick::Many(hits.into_iter().take(CANDIDATES).collect())),
            _ => {}
        }
    }

    let list = db.with(|c| docs::list(c, false))?;
    let needle = q.to_lowercase();
    let mut hits: Vec<(u8, docs::DocMeta)> = list
        .into_iter()
        .filter(|m| m.deleted_at.is_none())
        .filter_map(|m| {
            let t = m.title.to_lowercase();
            let score = if t == needle {
                0
            } else if t.starts_with(&needle) {
                1
            } else if t.contains(&needle) {
                2
            } else {
                return None;
            };
            Some((score, m))
        })
        .collect();
    hits.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.updated_at.cmp(&a.1.updated_at)));
    let mut out: Vec<docs::DocMeta> = hits.into_iter().map(|(_, m)| m).take(CANDIDATES).collect();
    match out.len() {
        0 => Ok(Pick::None),
        1 => Ok(Pick::One(out.remove(0).id)),
        _ => Ok(Pick::Many(out)),
    }
}

enum ReadTarget {
    Doc(String),
    File(String),
}

fn resolve_read_target(db: &Db, q: &str) -> ApiResult<ReadTarget> {
    if q.starts_with('/') || q.starts_with("tree/") {
        let path = if q.starts_with('/') {
            normalize(q)
        } else {
            normalize(&format!("/{q}"))
        };
        if let Some(id) = vfs::id_of(db, &path)? {
            return Ok(ReadTarget::Doc(id));
        }
        return match vfs::stat(db, &path)? {
            Some(e) if e.kind == "file" => Ok(ReadTarget::File(path)),
            Some(_) => Err(ApiError::new("bad_args", format!("{path} 是目录，不是文件"))),
            None => Err(ApiError::new("not_found", path)),
        };
    }
    match pick_doc(db, q)? {
        Pick::One(id) => Ok(ReadTarget::Doc(id)),
        Pick::Many(list) => Err(ApiError::new("ambiguous", candidates(&list, "找到多篇"))),
        Pick::None => Err(ApiError::new(
            "not_found",
            format!("没找到「{q}」；试试 notes_find 或 notes_cd()"),
        )),
    }
}

fn match_dirs(db: &Db, q: &str) -> ApiResult<Vec<String>> {
    let needle = q.trim_end_matches('/').to_lowercase();
    // 裸目录名只认 `/tree/` 和顶层静态目录 —— 否则 `/outline/...` 会和 `/tree/...` 抢同一个名字。
    let all: Vec<String> = vfs::dirs(db)?
        .into_iter()
        .filter(|p| {
            p == "/tree"
                || p.starts_with("/tree/")
                || matches!(
                    p.as_str(),
                    "/recent"
                        | "/favorites"
                        | "/by-date"
                        | "/by-tag"
                        | "/links"
                        | "/graph"
                        | "/outline"
                        | "/trash"
                        | "/search"
                )
        })
        .collect();
    let exact: Vec<String> = all
        .iter()
        .filter(|p| p.rsplit('/').next().unwrap_or(p.as_str()).to_lowercase() == needle)
        .cloned()
        .collect();
    let mut out = if exact.is_empty() {
        all.into_iter()
            .filter(|p| {
                p.rsplit('/').next().unwrap_or(p.as_str()).to_lowercase().contains(&needle)
            })
            .collect()
    } else {
        exact
    };
    out.sort_by(|a, b| a.len().cmp(&b.len()).then_with(|| a.cmp(b)));
    out.truncate(CANDIDATES);
    Ok(out)
}

fn search_candidates(db: &Db, q: &str) -> ApiResult<String> {
    let hits = db.with(|c| docs::search(c, q, CANDIDATES as i64, false))?;
    if hits.is_empty() {
        return Err(ApiError::new(
            "not_found",
            format!("没找到「{q}」；试试 notes_find 或换个词"),
        ));
    }
    let mut s = String::from("没找到精确匹配，候选（用 notes_cd(\"<id>\") 打开）：\n");
    for h in hits.iter().take(CANDIDATES) {
        let path = vfs::path_of(db, &h.id)?.unwrap_or_default();
        s.push_str(&format!("- 《{}》 [{}] {}\n", h.title, short_id(&h.id), path));
    }
    Ok(clip(s, 1200))
}

fn candidates(list: &[docs::DocMeta], head: &str) -> String {
    let mut s = format!("{head}，用 notes_cd(\"<id>\") 打开：\n");
    for m in list.iter().take(CANDIDATES) {
        s.push_str(&format!("- 《{}》 [{}]\n", m.title, short_id(&m.id)));
    }
    clip(s, 1200)
}

fn dir_candidates(dirs: &[String]) -> String {
    let mut s = String::from("找到多个目录，用 notes_cd(\"<路径>\") 进入：\n");
    for d in dirs.iter().take(CANDIDATES) {
        s.push_str(&format!("- {d}\n"));
    }
    clip(s, 1200)
}

fn split_section(s: &str) -> (String, Option<String>) {
    match s.split_once('#') {
        Some((a, b)) if !a.trim().is_empty() && !b.trim().is_empty() => {
            (a.trim().to_string(), Some(b.trim().to_string()))
        }
        _ => (s.to_string(), None),
    }
}

fn find_section(md: &str, needle: &str) -> Option<String> {
    let needle = needle.trim_start_matches('#').trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    let lines: Vec<&str> = md.lines().collect();
    let mut start = None;
    let mut level = 0;
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_start();
        if !t.starts_with('#') {
            continue;
        }
        let lv = t.chars().take_while(|c| *c == '#').count();
        let title = t.trim_start_matches('#').trim().to_lowercase();
        if start.is_none() && title.contains(&needle) {
            start = Some(i);
            level = lv;
        } else if let Some(st) = start {
            if i > st && lv <= level {
                return Some(lines[st..i].join("\n"));
            }
        }
    }
    start.map(|st| lines[st..].join("\n"))
}

/// 标题没有命中时，按正文找一段：给没写小标题的笔记用。
fn find_text(md: &str, needle: &str) -> Option<String> {
    let needle = needle.trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    let lines: Vec<&str> = md.lines().collect();
    let i = lines.iter().position(|l| l.to_lowercase().contains(&needle))?;
    let start = i.saturating_sub(10);
    let end = (i + 30).min(lines.len());
    Some(lines[start..end].join("\n"))
}

fn outline(md: &str) -> String {
    let mut out = String::new();
    for (n, line) in md.lines().filter(|l| l.trim_start().starts_with('#')).enumerate() {
        if n >= 40 {
            out.push_str("…（标题过多，已截断）\n");
            break;
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
    if out.is_empty() {
        out.push_str("（没有标题行）\n");
    }
    out
}

fn preview_text(md: &str, max: usize) -> String {
    let mut s: String = md.chars().take(max).collect();
    if md.chars().count() > max {
        if let Some(i) = s.rfind('\n') {
            if i > max / 2 {
                s.truncate(i);
            }
        }
        s.push_str("\n…");
    }
    s
}

fn slice_lines(s: &str, offset: Option<usize>, limit: Option<usize>) -> String {
    if offset.is_none() && limit.is_none() {
        return s.to_string();
    }
    let lines: Vec<&str> = s.lines().collect();
    let start = offset.unwrap_or(0).min(lines.len());
    let end = match limit {
        Some(n) => start.saturating_add(n).min(lines.len()),
        None => lines.len(),
    };
    lines[start..end].join("\n")
}

fn clip(s: impl Into<String>, max: usize) -> String {
    let s = s.into();
    if s.chars().count() <= max {
        return s;
    }
    let mut out: String = s.chars().take(max).collect();
    out.push_str("\n[truncated]");
    out
}

fn clean(s: &str) -> String {
    let s = s.trim();
    let s = s.strip_prefix("cd ").or_else(|| s.strip_prefix("ls ")).unwrap_or(s);
    s.trim()
        .trim_matches(|c| matches!(c, '《' | '》' | '"' | '\'' | '「' | '」' | '`'))
        .trim()
        .to_string()
}

fn normalize(p: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    format!("/{}", out.join("/"))
}

fn join(cwd: &str, target: &str) -> String {
    if target.starts_with('/') {
        normalize(target)
    } else {
        normalize(&format!("{cwd}/{target}"))
    }
}

fn parent(p: &str) -> &str {
    if p == "/" {
        return "/";
    }
    match p.rfind('/') {
        Some(0) | None => "/",
        Some(i) => &p[..i],
    }
}

fn name_of(path: &str) -> &str {
    let last = path.rsplit('/').next().unwrap_or(path);
    last.strip_suffix(".md").unwrap_or(last)
}

fn size_label(size: Option<u64>) -> String {
    match size {
        Some(n) if n >= 1024 => format!("  {:.1}KB", n as f64 / 1024.0),
        Some(n) => format!("  {n}B"),
        None => String::new(),
    }
}

fn is_id_prefix(s: &str) -> bool {
    (8..=32).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn short_id(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}
