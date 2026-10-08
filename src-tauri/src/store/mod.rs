//! 数据层。SQLite 是唯一真相源；前端是薄缓存。
//!
//! schema 冻结（schema.sql）。版本对不上就**重建文档相关的表**（`meta` 留着）——
//! 换基座后旧库是 Yjs 形状，文档数据不要了（D-0130），不写增量迁移 SQL。
//!
//! 模块分工：`docs` 文档元数据 + 内容 + 全文索引 · `version` 版本点 · `links` 链接图谱（D-0085）
//! · `blob` 图片 · `comment` 评论 · `summary` 每篇的 AI 总结（D-0075）。
//! `meta` 表（键值）就留在这里 —— 它和 `migrate` 是同一张表，分出去没意义。

pub mod blob;
pub mod comment;
pub mod docs;
pub mod links;
pub mod summary;
pub mod sync;
pub mod version;

use crate::commands::{ApiError, ApiResult};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

/// 当前 schema 版本。★ **只有「改现有表的形状」才 +1** —— 对不上的库会被重建文档相关的表（见
/// `migrate`，那是**丢数据**的动作）。**加一张新表不算**：它写在 `schema.sql` 里用
/// `CREATE TABLE IF NOT EXISTS`，每次 open 都跑一遍，新库老库一起照顾到，不用占版本号。
/// （2026-10-08：加 `sync` 表时误 +1 过，那会把用户的库清掉 —— 已改回。）
pub const SCHEMA_VERSION: i64 = 4;

/// 换基座那次（D-0131）：正文从 Yjs 二进制变成 PM doc JSON，表形状整个变了。
/// 只清**文档相关**的表（D-0130：旧数据不要了）—— `meta` 不碰：里面是 settings /
/// AI 的 baseUrl·model·key / UI 状态 / 上次备份 sha，换编辑器不该让用户重填这些。
/// 旧表全 DROP 再让 `schema.sql` 重建，不写增量迁移。新库（没有 schema_version 那一行）不走这儿。
fn reset(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS documents;
         DROP TABLE IF EXISTS doc;
         DROP TABLE IF EXISTS doc_snapshot;
         DROP TABLE IF EXISTS doc_update;
         DROP TABLE IF EXISTS doc_version;
         DROP TABLE IF EXISTS doc_fts;
         DROP TABLE IF EXISTS doc_text;
         DROP TABLE IF EXISTS doc_summary;
         DROP TABLE IF EXISTS doc_link;
         DROP TABLE IF EXISTS blob;
         DROP TABLE IF EXISTS comment;
         DROP TABLE IF EXISTS sync;",
    )?;
    conn.execute_batch(include_str!("schema.sql"))
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

        // 版本对不上 → 把文档相关的表全重建（`meta` 留着）。`open()` 里那句 schema.sql
        // 已经把新表建出来了，但旧表的列还是老形状（比如 doc_version.update_ 还在）——
        // 所以这里必须 DROP 再建。
        // 没有 schema_version 这一行 = 全新的库，一步都不用跑。
        if let Some(cur) = cur {
            if cur != SCHEMA_VERSION {
                reset(&conn)?;
            }
        }

        conn.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [SCHEMA_VERSION.to_string()],
        )?;
        // 写路径只保新的；历史脏行（`sda\x1d\x1d\x1d` 那种方框）得这趟一次性洗掉。
        clean_existing(&conn)?;
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

/// 清掉控制符：C0（`\n`=0x0a / `\t`=0x09 除外，正文里是正常排版）+ DEL/C1（0x7f..=0x9f）。
/// 判据和编辑器那侧**逐字一致**（`plugins/editor-prosemirror/sanitize.ts`）。
///
/// ★ 为什么清在**写库这一层**：库是唯一真相，它脏了就所有人跟着脏 —— 侧栏 / 标签条直接读库，
///   一排方框就是这么来的。这些字符不是任何人写的，是从 DOM 那侧漏进来的；清在这儿比清在
///   每个读的人那里都省。
pub fn clean_controls(s: &str) -> String {
    s.chars().filter(|c| !is_control(*c as u32)).collect()
}

fn is_control(code: u32) -> bool {
    (code < 0x20 && code != 0x0a && code != 0x09) || (0x7f..=0x9f).contains(&code)
}

/// **一次性**：把库里既有的控制符洗掉（写路径只管新的，历史行没人管 —— P3 收尾抓到的真 bug）。
/// 洗 `documents.title`（侧栏 / 标签条直接读它）和 `doc_text.title, md`（搜索 / 摘要的投影）。
///
/// ★ **版本闸**：`meta.clean_controls` = 1 表示跑过了，之后每次开库直接返回 —— 不全表扫。
fn clean_existing(conn: &Connection) -> Result<(), rusqlite::Error> {
    let done = conn
        .query_row("SELECT value FROM meta WHERE key = 'clean_controls'", [], |r| {
            r.get::<_, String>(0)
        })
        .optional()?
        .as_deref()
        == Some("1");
    if done {
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;

    let metas: Vec<(String, String)> = {
        let mut st = tx.prepare("SELECT id, title FROM documents")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (id, title) in metas {
        let clean = clean_controls(&title);
        if clean != title {
            tx.execute("UPDATE documents SET title = ?2 WHERE id = ?1", params![id, clean])?;
        }
    }

    let texts: Vec<(String, String, String)> = {
        let mut st = tx.prepare("SELECT doc_id, title, md FROM doc_text")?;
        let rows = st.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (id, title, md) in texts {
        let (ct, cm) = (clean_controls(&title), clean_controls(&md));
        if ct != title || cm != md {
            tx.execute("UPDATE doc_text SET title = ?2, md = ?3 WHERE doc_id = ?1", params![id, ct, cm])?;
        }
    }

    // 标记落库 —— 跟那批 UPDATE 同一个事务，成了才记「跑过」。
    tx.execute("INSERT INTO meta(key, value) VALUES('clean_controls', '1')", [])?;
    tx.commit()
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
