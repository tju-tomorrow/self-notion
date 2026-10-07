//! 数据层。SQLite 是唯一真相源；前端是薄缓存。
//!
//! schema 冻结（schema.sql）。迁移走 `meta.schema_version` + 函数表（D-0039）。
//!
//! 模块分工：`docs` 文档元数据 + 内容 + 全文索引 · `version` 版本点 · `links` 链接图谱（D-0085）
//! · `blob` 图片 · `comment` 评论 · `summary` 每篇的 AI 总结（D-0075）。
//! `meta` 表（键值）就留在这里 —— 它和 `migrate` 是同一张表，分出去没意义。

pub mod blob;
pub mod comment;
pub mod docs;
pub mod links;
pub mod summary;
pub mod version;

use crate::commands::{ApiError, ApiResult};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

/// 当前 schema 版本。改 schema.sql 时 +1，并在 `migrations()` 里补一条。
pub const SCHEMA_VERSION: i64 = 2;

/// 从 v(n-1) 到 v(n) 的那一步。**只增不改** —— 已经发出去的一步改了，
/// 就是有人在旧库上跑到一半跟别人不一样。索引 = 目标版本号。
///
/// ★ **这里只放"加列"这类不幂等的语句**。建表/建索引写在 `schema.sql` 里用
/// `IF NOT EXISTS` —— 那句每次 open 都跑一遍，新库老库一起照顾到，不用占一个版本号。
fn migrations() -> &'static [(i64, &'static str)] {
    &[(
        2,
        // v2：标签（D-0086）。`doc_link` 表不需要这一步 —— 它走 schema.sql 的
        // CREATE TABLE IF NOT EXISTS 就够（新表，老库下次 open 时补上）。
        // ★ 新库这里会**跳过**：它的 schema_version 一开始就写的是 SCHEMA_VERSION。
        "ALTER TABLE documents ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
    )]
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch(include_str!("schema.sql"))?;
        let db = Db(Mutex::new(conn));
        db.migrate()?;
        Ok(db)
    }

    /// **只读**打开（D-0084）。MCP 那个进程专用 —— 它跑在 app 外面，只该有读的能力。
    ///
    /// ★ 不跑 `schema.sql`、不跑迁移：那个进程不该有能力改库，而 `execute_batch` 在只读句柄上会报错。
    ///
    /// ★ **一条路：`PRAGMA query_only`**，不用 `SQLITE_OPEN_READ_ONLY`。
    /// 原写法是先试 `READ_ONLY`、开不起来再退到 `query_only` —— 那是个**几乎不会走的死分支**：
    /// 库是 WAL 模式，`-shm` 不在时（app 刚关干净 —— 用 MCP 的常见时刻）只读句柄根本开不起来，
    /// 于是永远走退路。两条路里只有一条被跑过，不如只留那一条。
    ///
    /// ★ `query_only` 是 pragma 不是边界 —— 但**这里从来没打算让它当边界**：
    /// 真正的边界是 MCP 的工具清单里根本没有写工具（D-0084 第 3 条，硬的：没有实现就没有开关）。
    ///
    /// ⚠️ **一条被自己推翻的注释记录在这儿**：改这一行时我一度写「实测只读句柄读到旧快照」，
    /// 那是**误判** —— 真相是我把标签打在了**回收站里的文档**上（库里 10 篇有 8 篇在回收站，
    /// `SELECT ... LIMIT 2` 正好挑中两篇），`/by-tag` 把它过滤掉了，看起来像"读不到"。
    /// 教训写在 D-0084 里：**验证一个投影时先看一眼数据是不是活的**，别拿回收站当样本。
    pub fn open_readonly(path: &Path) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA query_only = ON")?;
        Ok(Db(Mutex::new(conn)))
    }

    fn migrate(&self) -> Result<(), rusqlite::Error> {
        let conn = self.0.lock().unwrap();
        let cur: Option<i64> = conn
            .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
            .and_then(|v| v.parse().ok());

        // 全新的库：schema.sql 已经是最新形状（含 tags），一步都不用跑。
        if let Some(cur) = cur {
            for (v, sql) in migrations() {
                if *v > cur {
                    conn.execute_batch(sql)?;
                }
            }
        }

        conn.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [SCHEMA_VERSION.to_string()],
        )?;
        Ok(())
    }

    /// 所有走库的命令都从这里过：拿锁 → 干活。
    /// 锁中毒返回错误而不是 panic —— 前端拿到的是一个正常的 ApiError。
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> ApiResult<T>) -> ApiResult<T> {
        let conn = self.0.lock().map_err(|_| ApiError::new("db", "lock poisoned"))?;
        f(&conn)
    }
}

/// 库的默认路径 —— **给没有 `AppHandle` 的进程用**（MCP，D-0084）。
///
/// app 自己走 Tauri 的 `app_data_dir()`（`lib.rs` 的 `Db::open`），这里算出来是同一个文件，
/// **但那是两处代码** —— ⚠️ 改 identifier / 目录名要两边一起改。
///
/// `SELF_NOTION_DB` 可覆盖（dev：指到一份测试库上，不用先开着 app）。**日志也跟着它走**
/// （`log.rs::record` 用这个路径的兄弟文件）—— 否则拿测试库跑出来的错会写进真 app 的 `errors.log`。
pub fn default_db_path() -> PathBuf {
    match std::env::var_os("SELF_NOTION_DB") {
        Some(p) => PathBuf::from(p),
        None => std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join("Library/Application Support/app.selfnotion.desktop/self-notion.db"),
    }
}

/// 统一 SQL 错误 → ApiError。code 固定 `db`，message 保留原文（调试时唯一有用的东西）。
pub fn db_err(e: rusqlite::Error) -> ApiError {
    ApiError::new("db", e.to_string())
}

pub fn not_found(what: &str) -> ApiError {
    ApiError::new("not_found", format!("no such {what}"))
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 文档 id。sha256(毫秒 + 计数器 + 线程) 取前 32 位 hex。
///
/// ponytail: 不引 `uuid` crate —— id 只需要唯一，不需要可排序、不需要可解析、
/// 也不需要跨机去重（单人应用）。哪天要同步了再换成 ULID。
pub fn new_id() -> String {
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let seed = format!("{}:{}:{:?}", now_ms(), n, std::thread::current().id());
    let hex = format!("{:x}", Sha256::digest(seed.as_bytes()));
    hex[..32].to_string()
}

/* ─────────────────────────── meta：键值（设置 + schema 版本 + UI 状态） ─────────────────────────── */

/// 设置和 `schema_version` 共用 `meta` 表，所以设置一律带前缀。
/// 不加的话 `settings:list` 会把内部迁移状态一并吐给前端 —— 那是会随版本变的东西，
/// 不是设置。用前缀而不是黑名单：将来 meta 里再加内部键，不必回来改这里。
const SETTING_PREFIX: &str = "setting.";

pub fn settings_get(conn: &Connection, key: &str) -> ApiResult<Option<String>> {
    conn.query_row(
        "SELECT value FROM meta WHERE key = ?1",
        [format!("{SETTING_PREFIX}{key}")],
        |r| r.get(0),
    )
    .optional()
    .map_err(db_err)
}

pub fn settings_set(conn: &Connection, key: &str, value: &str) -> ApiResult<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![format!("{SETTING_PREFIX}{key}"), value],
    )
    .map_err(db_err)?;
    Ok(())
}

/// 全部设置，`settings:list` 用。
///
/// 为什么需要它：契约里的 `settings.get` 是**同步**的（组件在渲染路径上要能直接读），
/// 而库是异步的 —— 没有这条命令，插件在装载时**无法预热**内存副本：
/// 同一次会话里没人 `set` 过的键，`get` 就永远是 `undefined`（S7 撞出来的）。
pub fn settings_all(conn: &Connection) -> ApiResult<BTreeMap<String, String>> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM meta WHERE key LIKE 'setting.%' ORDER BY key")
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(db_err)?;

    let mut out = BTreeMap::new();
    for row in rows {
        let (k, v) = row.map_err(db_err)?;
        out.insert(k[SETTING_PREFIX.len()..].to_string(), v);
    }
    Ok(out)
}
