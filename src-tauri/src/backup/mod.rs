//! GitHub 单向备份（D-0026）：把整个文档库投影成 Markdown 推到 GitHub。
//!
//! **一个文档 → 一个 `.md` 文件 → 一个 commit。** 结构走 GitHub **Git Data API**
//! （blob → tree(base_tree) → commit → ref），不装 git、不用 libgit2，纯 HTTP（D-0026 第 1 条）。
//!
//! 三条纪律：
//!   1. **默认关闭**（D-0026）。没开开关、或没配 token，`now` **响亮报错**，绝不静默成功。
//!   2. **增量**：靠上次推的**内容哈希**只传变了的文件，`base_tree` 让没动的文件被继承。
//!   3. **token 只在 Rust 手里**。它存在 `meta` 表（走 `store::settings_set`），
//!      `status` 只回 "配没配"，**永不回传 webview**（和 D-0026 里 AI 的 apiKey 同一套）。
//!
//! ★ HTTP 全部收敛在 `http.rs` 的那**一个函数**里（见该文件顶部关于依赖的说明）。
//!
//! ponytail: **图片 / 附件这次没推。** D-0027 第 6 条说备份时把被引用的 blob 一并导出，
//! 但那要把 `self-notion://blob/<id>` 的引用改写成相对路径，属于一条独立的管线。
//! 现在只推 Markdown（D-0026 的原话就是「能读就行：只推 Markdown」）。
//! 升级路径：在 `build_files` 里把 md 里命中的 blob 追加成 `assets/<id>` 并改引用。

mod github;
// 内置 AI（`ai::summarize`）也走这一个出口 —— 全仓库的联网只有这一处（见 http.rs 文件头）。
pub(crate) mod http;

use crate::commands::{ApiError, ApiResult};
use crate::store::{self, Db};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashSet};

use github::{Github, Head};

/// 推到仓库里的哪个目录。前端文件的 slug 也挂它下面。
const DIR: &str = "md";

/* ─────────────────────────── 配置（落在 meta 表） ─────────────────────────── */

/// `store::settings_set/get` 会自动加 `setting.` 前缀，所以这里的键名不带。
const K_REPO: &str = "backup.repo";
const K_BRANCH: &str = "backup.branch";
const K_TOKEN: &str = "backup.token";
const K_ENABLED: &str = "backup.enabled";
const K_LAST_AT: &str = "backup.lastAt";
const K_LAST_COMMIT: &str = "backup.lastCommit";
const K_COUNT: &str = "backup.count";
const K_HASHES: &str = "backup.hashes";

const DEFAULT_BRANCH: &str = "main";

#[derive(Clone)]
struct Config {
    repo: String,
    branch: String,
    token: String,
    enabled: bool,
}

fn load_config(conn: &Connection) -> ApiResult<Config> {
    let get = |k: &str| store::settings_get(conn, k).map(|o| o.unwrap_or_default());
    let branch = get(K_BRANCH)?;
    Ok(Config {
        repo: get(K_REPO)?,
        branch: if branch.is_empty() { DEFAULT_BRANCH.into() } else { branch },
        token: get(K_TOKEN)?,
        enabled: get(K_ENABLED)? == "true",
    })
}

/// 上次推的 路径 → 内容 sha256。用来算增量，也是「远程多出来的文件该删哪些」的依据。
fn load_hashes(conn: &Connection) -> ApiResult<BTreeMap<String, String>> {
    let raw = store::settings_get(conn, K_HASHES)?.unwrap_or_default();
    if raw.is_empty() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_str(&raw).map_err(|e| ApiError::new("encode", e.to_string()))
}

/* ─────────────────────────── 命令入口 ─────────────────────────── */

/// `backup:configure` —— 存 repo / branch / token / 开关，回最新 status。
///
/// 只写传进来的字段（缺省 = 不动）。token 传空串是**明确要清掉**，不传才是「保持」。
pub fn configure(db: &Db, args: Value) -> ApiResult<Value> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct A {
        repo: Option<String>,
        branch: Option<String>,
        token: Option<String>,
        enabled: Option<bool>,
    }
    let a: A = parse(args)?;

    db.with(|c| {
        if let Some(r) = &a.repo {
            let r = r.trim();
            if !r.is_empty() && !r.contains('/') {
                return Err(ApiError::new("bad_args", "repo 要写成 owner/name"));
            }
            store::settings_set(c, K_REPO, r)?;
        }
        if let Some(b) = &a.branch {
            store::settings_set(c, K_BRANCH, b.trim())?;
        }
        if let Some(t) = &a.token {
            store::settings_set(c, K_TOKEN, t)?;
        }
        if let Some(e) = a.enabled {
            store::settings_set(c, K_ENABLED, if e { "true" } else { "false" })?;
        }
        Ok(())
    })?;

    status(db, Value::Null)
}

/// `backup:status` —— 给设置页看的。**绝不回传 token**，只说「配没配」。
pub fn status(db: &Db, _args: Value) -> ApiResult<Value> {
    db.with(|c| {
        let cfg = load_config(c)?;
        let last_at = store::settings_get(c, K_LAST_AT)?
            .and_then(|s| s.parse::<i64>().ok());
        let last_commit = store::settings_get(c, K_LAST_COMMIT)?.unwrap_or_default();
        let count = store::settings_get(c, K_COUNT)?
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        Ok(json!({
            "configured": !cfg.repo.is_empty() && !cfg.token.is_empty(),
            "enabled": cfg.enabled,
            "repo": cfg.repo,
            "branch": cfg.branch,
            "hasToken": !cfg.token.is_empty(),
            "lastAt": last_at,
            "lastCommit": last_commit,
            "count": count,
        }))
    })
}

/// `backup:now` —— 推一次。**这是唯一会联网的备份命令。**
///
/// ★ 不在 `call(db, …)` 的锁里跑：网络往返可能几秒，攥着库锁会把别的命令全卡住。
///   所以这个入口自己拿 `&Db`，把「读 / 写库」和「HTTP」分成两段，中间**不持锁**。
pub fn now(db: &Db, _args: Value) -> ApiResult<Value> {
    let cfg = db.with(load_config)?;
    // D-0026 默认关闭：没开就**响亮报错**，不是返回一个「成功但啥也没干」。
    if !cfg.enabled {
        return Err(ApiError::new("backup_disabled", "备份没开 —— 先在设置里打开开关"));
    }
    if cfg.repo.is_empty() || cfg.token.is_empty() {
        return Err(ApiError::new("backup_not_configured", "还没配 repo / token"));
    }

    let files = db.with(build_files)?;
    let prev = db.with(load_hashes)?;

    // 增量：内容哈希和上次不同 = 变动；上次推过、这次不在 = 删除
    let mut hashes: BTreeMap<String, String> = BTreeMap::new();
    let mut changed: Vec<&LocalFile> = Vec::new();
    for f in &files {
        let h = sha256_hex(&f.bytes);
        if prev.get(&f.path) != Some(&h) {
            changed.push(f);
        }
        hashes.insert(f.path.clone(), h);
    }
    let live: BTreeSet<&String> = files.iter().map(|f| &f.path).collect();
    let deleted: Vec<String> = prev.keys().filter(|p| !live.contains(p)).cloned().collect();

    if changed.is_empty() && deleted.is_empty() {
        return Ok(json!({
            "pushed": false, "reason": "up_to_date",
            "changed": 0, "deleted": 0, "count": files.len(),
        }));
    }

    let gh = Github::new(&cfg.repo, &cfg.branch, &cfg.token);
    // 空库（一个 commit 都没有）得先用 Contents API 把首个 commit 造出来 ——
    // Git Data API 在空库上**全线 409**，blobs / trees / commits 一个都发不出去。
    if matches!(gh.head()?, Head::Empty) {
        gh.bootstrap_empty()?;
    }
    let (is_new, base_tree, parents) = match gh.head()? {
        Head::At(commit, tree) => (false, Some(tree), vec![commit]),
        // 空库刚引导完还是走到这儿（分支名和 GitHub 默认分支不一样）→ 老老实实建 ref
        _ => (true, None, Vec::new()),
    };

    // blob → tree（带 base_tree）→ commit → ref
    let mut entries: Vec<Value> = Vec::new();
    for f in &changed {
        let sha = gh.create_blob(&f.bytes)?;
        entries.push(json!({ "path": &f.path, "mode": "100644", "type": "blob", "sha": &sha }));
    }
    for p in &deleted {
        // sha: null = 在 base_tree 上删掉这个文件
        entries.push(json!({ "path": p, "mode": "100644", "type": "blob", "sha": Value::Null }));
    }

    let tree = gh.create_tree(base_tree.as_deref(), entries)?;
    let msg = commit_message(files.len(), changed.len(), deleted.len());
    let commit = gh.create_commit(&msg, &tree, &parents)?;
    if is_new {
        gh.create_ref(&commit)?;
    } else {
        gh.update_ref(&commit)?;
    }

    // 写回「上次推了什么」——下次增量靠它
    let hashes_json =
        serde_json::to_string(&hashes).map_err(|e| ApiError::new("encode", e.to_string()))?;
    let at = store::now_ms().to_string();
    let count = files.len().to_string();
    db.with(|c| {
        store::settings_set(c, K_LAST_COMMIT, &commit)?;
        store::settings_set(c, K_LAST_AT, &at)?;
        store::settings_set(c, K_COUNT, &count)?;
        store::settings_set(c, K_HASHES, &hashes_json)?;
        Ok(())
    })?;

    Ok(json!({
        "pushed": true, "commit": commit,
        "changed": changed.len(), "deleted": deleted.len(), "count": files.len(),
    }))
}

/// `backup:restore` —— 从 GitHub 拉回 Markdown，重建文档。
///
/// ponytail: 只能重建 **元数据 + Markdown 投影 + 全文索引**，**重建不出正文** ——
/// 备份里只有 Markdown，Rust 不解析它成 doc JSON（D-0035），Markdown→块的还原是编辑器的活。
/// 所以恢复出来的文档一打开就要走一遍导入（那份管线是另一个插件）。等导入落地后，这里只需再调它一步。
pub fn restore(db: &Db, _args: Value) -> ApiResult<Value> {
    let cfg = db.with(load_config)?;
    if cfg.repo.is_empty() || cfg.token.is_empty() {
        return Err(ApiError::new("backup_not_configured", "还没配 repo / token"));
    }
    let gh = Github::new(&cfg.repo, &cfg.branch, &cfg.token);
    // 空库 / 缺分支都是「没东西可拉」。★ 这里**不引导** —— 恢复不该往人家仓库里写 README。
    let tree = match gh.head()? {
        Head::At(_, tree) => tree,
        Head::Empty => return Err(ApiError::new("backup_not_found", "仓库还是空的，没有可恢复的内容")),
        Head::NoBranch => return Err(ApiError::new("backup_not_found", "分支上还没有 commit")),
    };

    // 先全拉下来、在内存里解析完，最后一次性进库（一个事务、一把锁）
    let prefix = format!("{DIR}/");
    let mut docs: Vec<ParsedMd> = Vec::new();
    for (path, sha) in gh.tree_blobs(&tree)? {
        if !path.starts_with(prefix.as_str()) || !path.ends_with(".md") {
            continue;
        }
        let bytes = gh.blob(&sha)?;
        let text = String::from_utf8_lossy(&bytes);
        docs.push(parse_md(&text));
    }

    let n = docs.len();
    db.with(|c| {
        let tx = c.unchecked_transaction().map_err(store::db_err)?;
        for d in &docs {
            upsert_restored(&tx, d)?;
        }
        tx.commit().map_err(store::db_err)
    })?;

    Ok(json!({ "restored": n }))
}

/// `backup:detectToken` —— 从 `gh auth token` 捡现成的 token。**永不回传 token 本身。**
///
/// 没装 gh / 没登录 / token 无效都**不算错**，回 `found:false`。
pub fn detect_token(db: &Db, _args: Value) -> ApiResult<Value> {
    let token = match gh_token() {
        Some(t) => t,
        None => return Ok(json!({ "found": false, "login": "", "source": "" })),
    };
    let gh = Github::new("", DEFAULT_BRANCH, &token);
    match gh.user() {
        Ok((login, _)) => {
            db.with(|c| store::settings_set(c, K_TOKEN, &token))?;
            Ok(json!({ "found": true, "login": login, "source": "gh" }))
        }
        Err(_) => Ok(json!({ "found": false, "login": "", "source": "" })),
    }
}

/// `backup:user` —— 当前 token 对应的账号。
pub fn user(db: &Db, _args: Value) -> ApiResult<Value> {
    let token = db.with(|c| Ok(load_config(c)?.token))?;
    if token.is_empty() {
        return Err(ApiError::new("backup_not_configured", "还没配 token"));
    }
    let (login, name) = Github::new("", DEFAULT_BRANCH, &token).user()?;
    Ok(json!({ "login": login, "name": name }))
}

/// `backup:repos` —— 当前账号名下（owner）的仓库列表。
pub fn repos(db: &Db, _args: Value) -> ApiResult<Value> {
    let token = db.with(|c| Ok(load_config(c)?.token))?;
    if token.is_empty() {
        return Err(ApiError::new("backup_not_configured", "还没配 token"));
    }
    let repos = Github::new("", DEFAULT_BRANCH, &token).repos()?;
    Ok(json!({ "repos": repos }))
}

/// `backup:createRepo` —— 建一个私有仓库，建成即绑定为当前备份仓库。
pub fn create_repo(db: &Db, args: Value) -> ApiResult<Value> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct A {
        name: String,
    }
    let a: A = parse(args)?;
    let name = a.name.trim();
    if name.is_empty() {
        return Err(ApiError::new("bad_args", "仓库名不能为空"));
    }
    let token = db.with(|c| Ok(load_config(c)?.token))?;
    if token.is_empty() {
        return Err(ApiError::new("backup_not_configured", "还没配 token"));
    }
    let full_name = Github::new("", DEFAULT_BRANCH, &token).create_repo(name)?;
    db.with(|c| store::settings_set(c, K_REPO, &full_name))?;
    Ok(json!({ "repo": full_name }))
}

/// 找 `gh` 并要一个 token。先走 PATH，再试绝对路径 ——
/// ★ 从 Finder 启动的 app，PATH 里通常没有 `/opt/homebrew/bin`，不试绝对路径就永远找不到。
fn gh_token() -> Option<String> {
    const CANDIDATES: [&str; 3] = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
    for bin in CANDIDATES {
        let out = match std::process::Command::new(bin).args(["auth", "token"]).output() {
            Ok(o) if o.status.success() => o,
            _ => continue,
        };
        let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !token.is_empty() {
            return Some(token);
        }
    }
    None
}

/* ─────────────────────────── 文档 → 文件 ─────────────────────────── */

struct LocalFile {
    path: String,
    bytes: Vec<u8>,
}

/// 把没进回收站的文档铺成一堆 `md/<slug>.md`。回收站里的不推。
fn build_files(conn: &Connection) -> ApiResult<Vec<LocalFile>> {
    let mut stmt = conn
        .prepare(
            "SELECT d.id, d.parent_id, d.title, d.updated_at, COALESCE(t.md, '')
             FROM documents d LEFT JOIN doc_text t ON t.doc_id = d.id
             WHERE d.deleted_at IS NULL
             ORDER BY d.id",
        )
        .map_err(store::db_err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(store::db_err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(store::db_err)?;

    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::with_capacity(rows.len());
    for (id, parent, title, updated, md) in rows {
        let slug = unique_slug(&title, &id, &mut seen);
        let path = format!("{DIR}/{slug}.md");
        let bytes = render_md(&id, &title, parent.as_deref(), updated, &md).into_bytes();
        out.push(LocalFile { path, bytes });
    }
    Ok(out)
}

/// 一篇文章的线上形状：front matter（id / parent 是恢复必需，title / updated 给人看）+ 正文。
///
/// 用 front matter 而不是把 id 编进文件名：文件名可以照标题起得好看，恢复时又能**精确**
/// 拿回 id / 层级。手写解析（不引 yaml crate，见 CONVENTIONS 第十节）。
fn render_md(id: &str, title: &str, parent: Option<&str>, updated: i64, md: &str) -> String {
    format!(
        "---\nid: {id}\ntitle: {}\nparent: {}\nupdated: {updated}\n---\n\n{md}",
        one_line(title),
        parent.unwrap_or(""),
    )
}

/// front matter 的值必须是单行 —— 标题里的换行会把块撑破。
fn one_line(s: &str) -> String {
    s.replace(['\r', '\n'], " ").trim().to_string()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

/* ─────────────────────────── 恢复 ─────────────────────────── */

struct ParsedMd {
    id: String,
    title: String,
    parent: Option<String>,
    md: String,
}

/// `render_md` 的逆。没有 front matter 就当整篇是正文（宽容，不报错）。
fn parse_md(text: &str) -> ParsedMd {
    let mut id = String::new();
    let mut title = String::new();
    let mut parent: Option<String> = None;

    let mut lines = text.lines().peekable();
    if lines.peek().map(|l| l.trim()) == Some("---") {
        lines.next(); // 吃掉起始的 ---
        for l in lines.by_ref() {
            if l.trim() == "---" {
                break;
            }
            if let Some(v) = l.strip_prefix("id: ") {
                id = v.trim().to_string();
            } else if let Some(v) = l.strip_prefix("title: ") {
                title = v.trim().to_string();
            } else if let Some(v) = l.strip_prefix("parent: ") {
                let v = v.trim();
                parent = if v.is_empty() { None } else { Some(v.to_string()) };
            }
        }
    }
    let md = lines.collect::<Vec<_>>().join("\n").trim_start_matches('\n').to_string();
    ParsedMd { id, title, parent, md }
}

/// 按 id upsert（同一篇推两次 = 幂等）。id 空 = 没前端 matter，跳过（不是我们能认的文件）。
fn upsert_restored(conn: &Connection, d: &ParsedMd) -> ApiResult<()> {
    if d.id.is_empty() {
        return Err(ApiError::new("backup_bad_file", "这个 .md 没有 front matter 的 id"));
    }
    let at = store::now_ms();
    // 从别处推回来的 Markdown 也可能带控制符 —— 进库前清（见 `store::clean_controls`）。
    let title = store::clean_controls(&d.title);
    let md = store::clean_controls(&d.md);
    conn.execute(
        "INSERT INTO documents(id, parent_id, title, sort_order, created_at, updated_at)
         VALUES(?1, ?2, ?3, 0, ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, parent_id = excluded.parent_id, updated_at = excluded.updated_at",
        params![d.id, d.parent, title, at],
    )
    .map_err(store::db_err)?;
    // 推的时候在回收站里的不推，所以恢复回来的都是「在用」的
    conn.execute("UPDATE documents SET deleted_at = NULL WHERE id = ?1", [&d.id])
        .map_err(store::db_err)?;
    conn.execute(
        "INSERT INTO doc_text(doc_id, title, md, at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(doc_id) DO UPDATE SET title = excluded.title, md = excluded.md, at = excluded.at",
        params![d.id, title, md, at],
    )
    .map_err(store::db_err)?;

    // ★ FTS 重索引：**和 `store::docs::reindex` 是同一套变换**，但那个函数是私有的、
    //   `store/` 不在本 subagent 的写范围内。这份是**被迫的副本**，两边必须一致 ——
    //   等 store 把 reindex 开成 pub 就删掉这段、改调它。
    conn.execute("DELETE FROM doc_fts WHERE doc_id = ?1", [&d.id]).map_err(store::db_err)?;
    conn.execute(
        "INSERT INTO doc_fts(doc_id, title, body) VALUES(?1, ?2, ?3)",
        params![d.id, cjk_space(&title), cjk_space(&md)],
    )
    .map_err(store::db_err)?;
    Ok(())
}

/* ─────────────────────────── 小工具 ─────────────────────────── */

fn parse<T: serde::de::DeserializeOwned>(args: Value) -> ApiResult<T> {
    serde_json::from_value(args).map_err(|e| ApiError::new("bad_args", e.to_string()))
}

/// 标题 → 文件名。只留字母数字、`-`、`_`（中文算字母数字），其余并成一个 `-`。
/// 空标题回落到 id 前 8 位。
fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in title.trim().chars() {
        if c.is_alphanumeric() || c == '-' || c == '_' {
            out.push(c);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
        if out.chars().count() >= 80 {
            break;
        }
    }
    out.trim_matches('-').to_string()
}

/// 同一个 slug 撞了就在后面接 `-2`、`-3`……（标题重名很常见）。
fn unique_slug(title: &str, id: &str, seen: &mut HashSet<String>) -> String {
    let base = {
        let s = slugify(title);
        if s.is_empty() { id.chars().take(8).collect() } else { s }
    };
    let mut candidate = base.clone();
    let mut n = 2;
    while !seen.insert(candidate.clone()) {
        candidate = format!("{base}-{n}");
        n += 1;
    }
    candidate
}

/// D-0026 第 6 条的格式：`backup: 2026-10-06 14:30 · 312 篇（+4 -1）`。
fn commit_message(total: usize, added: usize, deleted: usize) -> String {
    format!(
        "backup: {} · {} 篇（+{} -{}）",
        fmt_utc(store::now_ms()),
        total,
        added,
        deleted
    )
}

/// `now_ms` → UTC "YYYY-MM-DD HH:MM"。手写而不是引 chrono —— 只要一个格式，不值得一个依赖。
fn fmt_utc(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}", rem / 3600, (rem % 3600) / 60)
}

/// Howard Hinnant 的 `civil_from_days`（纯整数，无依赖）。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 和 `store::docs` 里那份**必须一致**的 CJK 分词（见 `upsert_restored` 的说明）。
fn cjk_space(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for c in s.chars() {
        if is_cjk(c) {
            out.push(' ');
            out.push(c);
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

fn is_cjk(c: char) -> bool {
    matches!(
        c as u32,
        0x3040..=0x30FF        // 平假名 / 片假名
        | 0x3400..=0x4DBF      // CJK 扩展 A
        | 0x4E00..=0x9FFF      // CJK 基本区
        | 0xF900..=0xFAFF      // 兼容表意文字
        | 0xAC00..=0xD7AF      // 谚文
    )
}
