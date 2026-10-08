//! 用户磁盘上的**真实文件**（D-0137，全文见 `docs/external-md.md`）。
//!
//! 和 `vfs` 是一对反着的：`vfs` 是给 agent 的**投影**（查询出来的虚拟目录，路径不是存放位置），
//! 这里是用户自己的那些 `.md` —— **文件是唯一真相源**，库里关于它的只有「挂在哪些根」。
//!
//! ★ **路径白名单是这条路唯一的安全边界**：任何入参路径 canonicalize 之后必须落在某个挂载根
//!   之下，否则回 `denied`（见 `resolve`）。软链指到根外面的一律拒。
//! ★ 挂载的根存 `meta` 那张 KV 表（键 `disk.roots`，JSON 数组）—— **不碰冻结的 schema**。
//! ★ 读 / 写盘**不走 `call`**：几毫秒到几十毫秒的 I/O 攥着库锁会把别的命令全卡住
//!   （和 `backup:*` 同一个理由）。所以入口自己拿 `&Db`，读库与磁盘 I/O 分段进行。

use crate::commands::{ApiError, ApiResult};
use crate::store::{db_err, Db};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};

/// 挂载根在 `meta` 里的键。**不带 `setting.` 前缀** —— 那是 `settings:list` 的面子，
/// 挂载根是内部状态，不该当设置吐给前端。
const ROOTS_KEY: &str = "disk.roots";

/* ─────────────────────────── 线上形状（照 contract.ts） ─────────────────────────── */

/// 目录树的一行 / 一个挂载的根 —— 形状照 `contract.ts` 的 `FileEntry`。
/// `size` 只对文件给（目录没意义）；省略 = TS 侧的 `undefined`。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    path: String,
    kind: &'static str, // "file" | "dir"
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    mtime: i64,
}

/// `file:read` 的返回 —— 形状照 `FileRead`。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Read {
    text: String,
    mtime: i64,
    hash: String,
}

/// `file:write` 的返回：写完之后的**新**那把锁 —— 形状照 `FileStamp`。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Stamp {
    mtime: i64,
    hash: String,
}

/* ─────────────────────────── 入参 ─────────────────────────── */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathArgs {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteArgs {
    path: String,
    text: String,
    expect: Expect,
}

/// `file:read` 时拿到的锁，写回时原样带回来（对不上 → `conflict`）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expect {
    mtime: i64,
    hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateArgs {
    dir: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameArgs {
    path: String,
    name: String,
}

/* ─────────────────────────── 命令入口（dispatch 的 match 分支引用它们） ─────────────────────────── */

/// `file:roots` —— 挂载的根。已经不在了的根**跳过并列一行**（拔了移动盘不该让整条命令挂掉）。
pub fn roots(db: &Db, _args: Value) -> ApiResult<Value> {
    let mounts = db.with(load_roots)?;
    let mut out = Vec::new();
    for r in mounts {
        match entry_of(&r) {
            Ok(e) => out.push(e),
            Err(e) => crate::log::record("disk", &format!("挂载根不可用 {}: {e}", r.display())),
        }
    }
    encode(out)
}

/// `file:addRoot` —— 加一个根。回**规范化之后**的路径（软链 / `..` 归到一处，D-0138）。
pub fn add_root(db: &Db, args: Value) -> ApiResult<Value> {
    let a: PathArgs = parse(args)?;
    // 规范化在**锁外**做（是磁盘 I/O）。
    let p = std::fs::canonicalize(&a.path).map_err(|e| canon_err(Path::new(&a.path), e))?;
    if !p.is_dir() {
        return Err(fail("io", format!("不是一个目录：{}", a.path)));
    }
    db.with(|c| {
        let mut mounts = load_roots(c)?;
        // 幂等：同一个根加两次不重复。
        if !mounts.contains(&p) {
            mounts.push(p.clone());
            save_roots(c, &mounts)?;
        }
        Ok(())
    })?;
    encode(entry_of(&p)?)
}

/// `file:removeRoot`。
pub fn remove_root(db: &Db, args: Value) -> ApiResult<Value> {
    let a: PathArgs = parse(args)?;
    // 根可能已经被删了 —— canonicalize 失败就按原样字符串比。
    let want = std::fs::canonicalize(&a.path).unwrap_or_else(|_| PathBuf::from(&a.path));
    let raw = PathBuf::from(&a.path);
    db.with(|c| {
        let mut mounts = load_roots(c)?;
        let before = mounts.len();
        mounts.retain(|r| *r != want && *r != raw);
        if mounts.len() != before {
            save_roots(c, &mounts)?;
        }
        Ok(())
    })?;
    Ok(Value::Null)
}

/// `file:list` —— **只列一层**，按需展开（跟 `vfs:list` 同一个手感）。
pub fn list(db: &Db, args: Value) -> ApiResult<Value> {
    let a: PathArgs = parse(args)?;
    let mounts = db.with(load_roots)?;
    let dir = resolve(&mounts, Path::new(&a.path), true)?;

    let rd = std::fs::read_dir(&dir).map_err(|e| io(&format!("读目录 {}", dir.display()), e))?;
    let mut out: Vec<Entry> = Vec::new();
    for ent in rd {
        let ent = match ent {
            Ok(e) => e,
            Err(_) => continue, // 单项读不了不连累整条
        };
        let name = ent.file_name();
        let name = name.to_string_lossy();
        // 隐藏项（`.git` / `.DS_Store`）不列；非 markdown 文件不列 —— 这个树只服务 `.md`，
        // 列出来就是双击打不开的死行。
        if name.starts_with('.') {
            continue;
        }
        let md = match std::fs::metadata(ent.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = md.is_dir();
        if !is_dir && !is_md(&name) {
            continue;
        }
        out.push(Entry {
            path: ent.path().to_string_lossy().into_owned(),
            kind: if is_dir { "dir" } else { "file" },
            name: name.into_owned(),
            size: if is_dir { None } else { Some(md.len()) },
            mtime: mtime_ms(&md),
        });
    }
    // 目录在前、同类按名字排 —— 顺序在这儿定，前端不排。
    out.sort_by(|a, b| {
        (a.kind != "dir", a.name.to_lowercase()).cmp(&(b.kind != "dir", b.name.to_lowercase()))
    });
    encode(out)
}

/// `file:read` —— 回 `{text, mtime, hash}`（后两个就是那把乐观锁）。
pub fn read(db: &Db, args: Value) -> ApiResult<Value> {
    let a: PathArgs = parse(args)?;
    let mounts = db.with(load_roots)?;
    let path = resolve(&mounts, Path::new(&a.path), true)?;

    let bytes = std::fs::read(&path).map_err(|e| io(&format!("读 {}", path.display()), e))?;
    let md = std::fs::metadata(&path).map_err(|e| canon_err(&path, e))?;
    let text = String::from_utf8(bytes)
        .map_err(|_| fail("io", format!("不是 UTF-8 文本：{}", path.display())))?;
    encode(Read { mtime: mtime_ms(&md), hash: hash(text.as_bytes()), text })
}

/// `file:write` —— 三道：`expect` 对不上回 `conflict` · 原子写（`.tmp` + rename）· 回新的锁。
pub fn write(db: &Db, args: Value) -> ApiResult<Value> {
    let a: WriteArgs = parse(args)?;
    let mounts = db.with(load_roots)?;
    let path = resolve(&mounts, Path::new(&a.path), true)?;

    // 写前比锁：磁盘那份被 git / 别的编辑器改过 → **不覆盖**（D-0137 §3）。
    let cur = std::fs::read(&path).map_err(|e| io(&format!("读 {}", path.display()), e))?;
    let md = std::fs::metadata(&path).map_err(|e| canon_err(&path, e))?;
    if a.expect.mtime != mtime_ms(&md) || a.expect.hash != hash(&cur) {
        return Err(fail("conflict", format!("磁盘上这份被改过，没保存：{}", path.display())));
    }
    // 只读文件不悄悄改写 —— 用户 chmod 444 是有意的。
    if md.permissions().readonly() {
        return Err(fail("io", format!("文件是只读的：{}", path.display())));
    }

    // 原子：写 `x.md.tmp` 再 rename。**绝不原地 truncate** —— 断电不能把用户的笔记写成半截。
    let tmp = tmp_path(&path);
    std::fs::write(&tmp, a.text.as_bytes())
        .map_err(|e| io(&format!("写 {}", tmp.display()), e))?;
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(io(&format!("rename 到 {}", path.display()), e));
    }

    let md = std::fs::metadata(&path).map_err(|e| canon_err(&path, e))?;
    encode(Stamp { mtime: mtime_ms(&md), hash: hash(a.text.as_bytes()) })
}

/// `file:create` —— 在 `dir` 下建一个 `.md`。
pub fn create(db: &Db, args: Value) -> ApiResult<Value> {
    let a: CreateArgs = parse(args)?;
    safe_name(&a.name)?;
    let mounts = db.with(load_roots)?;
    // 目标还不存在 —— 校验父目录在根之下，再接上文件名（见 `resolve`）。
    let path = resolve(&mounts, &Path::new(&a.dir).join(md_name(&a.name)), false)?;

    // `create_new`：同名就报错，不悄悄清空人家。
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(fail("io", format!("已经有一个同名的了：{}", path.display())));
        }
        Err(e) => return Err(io(&format!("建 {}", path.display()), e)),
    }
    encode(entry_of(&path)?)
}

/// `file:rename` —— 改名（**不跨目录**，v1 不动删除，见 `docs/external-md.md` §7）。
pub fn rename(db: &Db, args: Value) -> ApiResult<Value> {
    let a: RenameArgs = parse(args)?;
    safe_name(&a.name)?;
    let mounts = db.with(load_roots)?;
    let src = resolve(&mounts, Path::new(&a.path), true)?;
    let parent = src.parent().ok_or_else(|| fail("denied", "源路径没有父目录"))?;
    let dst = resolve(&mounts, &parent.join(&a.name), false)?;
    if dst.exists() {
        return Err(fail("io", format!("已经有一个同名的了：{}", dst.display())));
    }
    std::fs::rename(&src, &dst).map_err(|e| io(&format!("改名 {}", src.display()), e))?;
    encode(entry_of(&dst)?)
}

/* ─────────────────────────── 路径白名单（唯一的安全边界） ─────────────────────────── */

/// 把入参路径归一到磁盘上的真路径，并要求它落在某个挂载根之下。
///
/// ★ 两条都做，缺一不可：
///   1. `canonicalize` 把 `..` 和软链**解到一处** —— 指到根外面的一律 `denied`；
///   2. 结果必须 `starts_with` 某个**已规范化**的根（根在 `add_root` 时也归过一遍）。
///
/// `must_exist=false`（新建 / 写新文件）：目标还没在 —— 归一**父目录**再拼上文件名。
/// 父在根之下、文件名是**单个普通段**（`safe_name`），于是拼出来的也一定在根之下。
fn resolve(roots: &[PathBuf], target: &Path, must_exist: bool) -> ApiResult<PathBuf> {
    let canon = if must_exist {
        std::fs::canonicalize(target).map_err(|e| canon_err(target, e))?
    } else {
        let parent = target.parent().ok_or_else(|| fail("denied", "路径没有父目录"))?;
        // ★ 名字必须是单个普通段：`starts_with` 是**逐段**比的，`cp/../x` 照样算 `cp` 的前缀 ——
        //   不挡住 `..`，拼出来的路径能骗过下面的检查逃出根。
        if let Some(name) = target.file_name().and_then(|n| n.to_str()) {
            safe_name(name)?;
        }
        let cp = std::fs::canonicalize(parent).map_err(|e| canon_err(parent, e))?;
        cp.join(target.file_name().ok_or_else(|| fail("denied", "路径没有文件名"))?)
    };
    if roots.iter().any(|r| canon.starts_with(r)) {
        Ok(canon)
    } else {
        Err(fail("denied", format!("路径不在任何挂载根之下：{}", target.display())))
    }
}

/// 名字必须是一个**普通路径段**（不是 `.` / `..` / 空的 / 带 `/` 的）——
/// 否则 `dir.join(name)` 能穿出去。
fn safe_name(name: &str) -> ApiResult<()> {
    match (Path::new(name).components().next(), Path::new(name).components().nth(1)) {
        (Some(Component::Normal(_)), None) => Ok(()),
        _ => Err(fail("denied", format!("名字不合法：{name}"))),
    }
}

/* ─────────────────────────── 挂载根（`meta` KV，不碰冻结的 schema） ─────────────────────────── */

fn load_roots(conn: &Connection) -> ApiResult<Vec<PathBuf>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = ?1", [ROOTS_KEY], |r| r.get(0))
        .optional()
        .map_err(db_err)?;
    let Some(s) = raw else { return Ok(Vec::new()) };
    // 坏了就按空处理（降级到「一个根都没有」，用户重挂即可），不把整条路堵死。
    let list: Vec<String> = match serde_json::from_str(&s) {
        Ok(v) => v,
        Err(e) => {
            crate::log::record("disk", &format!("{ROOTS_KEY} 坏了，按空处理: {e}"));
            Vec::new()
        }
    };
    Ok(list.into_iter().map(PathBuf::from).collect())
}

fn save_roots(conn: &Connection, roots: &[PathBuf]) -> ApiResult<()> {
    let list: Vec<String> = roots.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    let json = serde_json::to_string(&list).map_err(|e| fail("encode", e.to_string()))?;
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![ROOTS_KEY, json],
    )
    .map_err(db_err)?;
    Ok(())
}

/* ─────────────────────────── 小工具 ─────────────────────────── */

fn parse<T: serde::de::DeserializeOwned>(args: Value) -> ApiResult<T> {
    serde_json::from_value(args).map_err(|e| fail("bad_args", e.to_string()))
}

fn encode<T: Serialize>(v: T) -> ApiResult<Value> {
    serde_json::to_value(v).map_err(|e| fail("encode", e.to_string()))
}

/// 出错只有一个出口（AGENTS.md §3）—— 造一个错并记一行。
fn fail(code: &str, msg: impl Into<String>) -> ApiError {
    let e = ApiError::new(code, msg);
    crate::log::record("disk", &e.to_string());
    e
}

fn io(what: &str, e: std::io::Error) -> ApiError {
    fail("io", format!("{what}: {e}"))
}

/// 路径访问失败：找不到给 `not_found`，其余（权限等）给 `io`。
fn canon_err(p: &Path, e: std::io::Error) -> ApiError {
    if e.kind() == std::io::ErrorKind::NotFound {
        fail("not_found", p.display().to_string())
    } else {
        io(&format!("无法访问 {}", p.display()), e)
    }
}

fn entry_of(path: &Path) -> ApiResult<Entry> {
    let md = std::fs::metadata(path).map_err(|e| canon_err(path, e))?;
    let is_dir = md.is_dir();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    Ok(Entry {
        path: path.to_string_lossy().into_owned(),
        kind: if is_dir { "dir" } else { "file" },
        name,
        size: if is_dir { None } else { Some(md.len()) },
        mtime: mtime_ms(&md),
    })
}

fn mtime_ms(md: &std::fs::Metadata) -> i64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// `x.md` → `x.md.tmp`（和它同目录，rename 才是原子的）。
fn tmp_path(path: &Path) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!("{name}.tmp"))
}

fn is_md(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// 新建时保证是 markdown —— 已经是 `.md` / `.markdown` 就不动，否则补 `.md`。
fn md_name(name: &str) -> String {
    if is_md(name) {
        name.to_string()
    } else {
        format!("{name}.md")
    }
}
