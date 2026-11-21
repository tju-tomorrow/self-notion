//! 文档：元数据（documents）+ 正文（doc，PM doc JSON）+ 索引（doc_text / doc_fts）。
//!
//! ★ **改内容的唯一入口是 `apply`**，`version::restore` 是另一个。
//! 「先快照后写」的顺序在这两个函数里强制，调用方（命令分派、AI、前端）跳不过去（D-0043）。

use super::{clean_controls, db_err, links, new_id, not_found, now_ms, version};
use crate::commands::{ApiError, ApiResult};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::Serialize;

/// 文档元数据。Rust 是唯一真相源，前端只是缓存（CONVENTIONS 第四节）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocMeta {
    pub id: String,
    pub parent_id: Option<String>,
    pub title: String,
    pub icon: Option<String>,
    pub sort_order: f64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub is_favorite: bool,
    /// 置顶（D-0123）。非空 = 被置顶，值是**置顶那一刻**的时间戳（「置顶」页按它倒序）。
    /// null = 没置顶，**不是 0**（跟 `last_opened_at` 同一个约定）。
    pub pinned_at: Option<i64>,
    pub last_opened_at: Option<i64>,
    /// 平标签（D-0086）。库里是 JSON 数组字符串，这里**解析成数组**再出去 ——
    /// 前端不该看见 `"[\"架构\"]"` 这种东西。解析失败当空数组（不 panic：库里的一行脏数据
    /// 不该让整个文档列表打不开）。
    pub tags: Vec<String>,
}

/// `doc:open` 的返回（形状 = 契约里的 `DocHandle`）：元数据 + 正文。
/// `content` = PM doc JSON 的字符串；库里没有这一行 → null，编辑器自己造一份空的。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocContent {
    pub doc: DocMeta,
    pub content: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub id: String,
    pub title: String,
    pub parent_id: Option<String>,
    pub updated_at: i64,
    /// 正文里命中的那一段，带 `HIT_OPEN`/`HIT_CLOSE` 包住命中词（见 `snippet` 调用处）。
    /// 前端按标记切成若干 run **渲染成元素**，不是 innerHTML —— 正文是用户内容，
    /// 也是导入进来的，不能当 HTML 用。
    pub body: String,
}

/// `doc:summary` 的一行：首页每行标题下的正文摘要（`camelCase`，形状对齐 contract.ts）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub body: String,
}

/// 命中片段的边界标记。用 U+0002/U+0003 这两个控制字符，不用 `<mark>`：
/// 正文里出现 `<` 是家常便饭，出现 U+0002 基本不可能 —— 标记本身不能是可注入的。
/// 前端侧的同名常量在 `apps/desktop/src/kernel/contract.ts`。
const HIT_OPEN: char = '\u{2}';
const HIT_CLOSE: char = '\u{3}';

/// `apply` 的入参。借用而不是拥有，省掉一次 doc JSON 的拷贝。
pub struct Apply<'a> {
    pub id: &'a str,
    /// 正文（PM doc JSON 字符串）。**覆盖式**：给了就是「这篇现在长这样」——
    /// 没有增量、没有合并，一次一份。必给（不给 = 空调用，见 `apply`）。
    pub content: Option<&'a str>,
    pub origin: &'a str,
    pub group_id: Option<&'a str>,
    pub label: Option<&'a str>,
    pub title: Option<&'a str>,
    /// Markdown 投影（D-0040），和 FTS 同一个 payload
    pub md: Option<&'a str>,
    /// 出链（D-0085）。**全量**：`Some(vec![])` = 这篇现在没有出链；
    /// `None` = 这次调用没带链接信息（比如只改标题），**别动**已有的边。
    pub links: Option<&'a [crate::store::links::Link]>,
}

const COLS: &str = "id, parent_id, title, icon, sort_order, created_at, updated_at, \
                    deleted_at, is_favorite, pinned_at, last_opened_at, tags";

/// 子树物化（回收站 / 硬删除都要它）。所有引用它的语句都必须用 `?1` 传根 id。
const SUBTREE: &str = "WITH RECURSIVE sub(id) AS (
        SELECT id FROM documents WHERE id = ?1
        UNION ALL
        SELECT d.id FROM documents d JOIN sub ON d.parent_id = sub.id)";

fn row_meta(r: &rusqlite::Row) -> rusqlite::Result<DocMeta> {
    Ok(DocMeta {
        id: r.get(0)?,
        parent_id: r.get(1)?,
        title: r.get(2)?,
        icon: r.get(3)?,
        sort_order: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
        deleted_at: r.get(7)?,
        is_favorite: r.get::<_, i64>(8)? != 0,
        pinned_at: r.get(9)?,
        last_opened_at: r.get(10)?,
        tags: serde_json::from_str(&r.get::<_, String>(11)?).unwrap_or_default(),
    })
}

/// `doc:tags` —— 整组替换（D-0086）。**不是"加一个"**：标签是平的、没有顺序，
/// 加/删的语义都在调用方，这里只管把这一列写成什么样。返回更新后的整行，
/// 省掉调用方再问一次（⋯ 菜单拿它直接刷新那几行）。
pub fn set_tags(conn: &Connection, id: &str, tags: &[String]) -> ApiResult<DocMeta> {
    let json = serde_json::to_string(tags).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
    let n = conn
        .execute(
            "UPDATE documents SET tags = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, json, now_ms()],
        )
        .map_err(db_err)?;
    if n == 0 {
        return Err(not_found("doc"));
    }
    // 词表跟着长（D-0185）—— 用户手打的标签也要进受控词表。
    // 失败不拦住「打标签」本身，记一笔就走。
    if let Err(e) = super::kb::sync_vocab_from_docs(conn) {
        crate::log::record("kb", &format!("同步标签词表失败：{}", e.message));
    }
    get(conn, id)
}

pub fn get(conn: &Connection, id: &str) -> ApiResult<DocMeta> {
    conn.query_row(&format!("SELECT {COLS} FROM documents WHERE id = ?1"), [id], row_meta)
        .optional()
        .map_err(db_err)?
        .ok_or_else(|| not_found("doc"))
}

fn next_sort(conn: &Connection, parent_id: Option<&str>) -> ApiResult<f64> {
    conn.query_row(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM documents WHERE parent_id IS ?1",
        [parent_id],
        |r| r.get(0),
    )
    .map_err(db_err)
}

pub fn list(conn: &Connection, include_trashed: bool) -> ApiResult<Vec<DocMeta>> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {COLS} FROM documents WHERE (?1 OR deleted_at IS NULL)
             ORDER BY sort_order, created_at"
        ))
        .map_err(db_err)?;
    let rows = stmt
        .query_map([include_trashed], row_meta)
        .map_err(db_err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_err);
    rows
}

pub fn create(
    conn: &Connection,
    id: Option<&str>,
    parent_id: Option<&str>,
    title: &str,
    icon: Option<&str>,
) -> ApiResult<DocMeta> {
    let id = id.map(str::to_string).unwrap_or_else(new_id);
    let sort = next_sort(conn, parent_id)?;
    let at = now_ms();
    // 库是唯一真相 —— 标题进库前先清掉控制符（见 `clean_controls`）。
    let title = clean_controls(title);
    conn.execute(
        "INSERT INTO documents(id, parent_id, title, icon, sort_order, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, parent_id, title, icon, sort, at],
    )
    .map_err(db_err)?;
    get(conn, &id)
}

pub fn rename(conn: &Connection, id: &str, title: &str) -> ApiResult<DocMeta> {
    // 侧栏改名那条路（`doc:rename`）—— 侧栏 / 标签条直接读库，脏字符必须先清。
    let title = clean_controls(title);
    conn.execute(
        "UPDATE documents SET title = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, title, now_ms()],
    )
    .map_err(db_err)?;
    // 标题也进了 FTS，重命名要一并重建索引，否则按标题搜不到
    reindex(conn, id, Some(&title), None)?;
    get(conn, id)
}

/// 页面图标（emoji）。`None` = 清掉，回到默认图标。
pub fn set_icon(conn: &Connection, id: &str, icon: Option<&str>) -> ApiResult<DocMeta> {
    conn.execute(
        "UPDATE documents SET icon = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, icon, now_ms()],
    )
    .map_err(db_err)?;
    get(conn, id)
}

pub fn move_(
    conn: &Connection,
    id: &str,
    parent_id: Option<&str>,
    sort_order: Option<f64>,
) -> ApiResult<DocMeta> {
    let sort = match sort_order {
        Some(s) => s,
        None => next_sort(conn, parent_id)?,
    };
    conn.execute(
        "UPDATE documents SET parent_id = ?2, sort_order = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, parent_id, sort, now_ms()],
    )
    .map_err(db_err)?;
    get(conn, id)
}

/// ponytail: 回收站整棵子树 —— SQLite 的 recursive CTE 一条语句搞定，不写递归遍历。
pub fn trash(conn: &Connection, id: &str) -> ApiResult<()> {
    let at = now_ms();
    conn.execute(
        &format!(
            "{SUBTREE} UPDATE documents SET deleted_at = ?2, updated_at = ?2
             WHERE id IN (SELECT id FROM sub)"
        ),
        params![id, at],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn restore(conn: &Connection, id: &str) -> ApiResult<()> {
    conn.execute(
        &format!("{SUBTREE} UPDATE documents SET deleted_at = NULL WHERE id IN (SELECT id FROM sub)"),
        [id],
    )
    .map_err(db_err)?;
    Ok(())
}

/// 恢复**整座**回收站。trash 是整棵子树标脏的，所以一条 UPDATE 就能全恢复。
pub fn restore_trash(conn: &Connection) -> ApiResult<usize> {
    conn.execute("UPDATE documents SET deleted_at = NULL WHERE deleted_at IS NOT NULL", [])
        .map_err(db_err)
}

/// 清空回收站 —— 连同内容一起硬删，**没有撤销**这条路（同 `remove`）。
pub fn empty_trash(conn: &Connection) -> ApiResult<usize> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    for table in ["doc", "doc_version", "doc_text", "doc_fts", "doc_summary", "doc_learn"] {
        tx.execute(
            &format!(
                "DELETE FROM {table} WHERE doc_id IN
                 (SELECT id FROM documents WHERE deleted_at IS NOT NULL)"
            ),
            [],
        )
        .map_err(db_err)?;
    }
    // doc_link 的列不叫 doc_id（是 from_id / to_id），两个方向都要断 ——
    // 只断出链的话，库里会留一堆"指向已不存在文档"的边，反链查询 JOIN 不到它们，
    // 但它们会一直在表里烂着（D-0085）。
    for col in ["from_id", "to_id"] {
        tx.execute(
            &format!(
                "DELETE FROM doc_link WHERE {col} IN
                 (SELECT id FROM documents WHERE deleted_at IS NOT NULL)"
            ),
            [],
        )
        .map_err(db_err)?;
    }
    let n = tx
        .execute("DELETE FROM documents WHERE deleted_at IS NOT NULL", [])
        .map_err(db_err)?;
    tx.commit().map_err(db_err)?;
    Ok(n)
}

/// 硬删除。内容表全清 —— 否则 blob 之外的数据会永远留在库里没人认领。
pub fn remove(conn: &Connection, id: &str) -> ApiResult<()> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;
    // documents 留到最后 —— 子树是靠它物化的，先删就拿不到子孙了
    for table in ["doc", "doc_version", "doc_text", "doc_fts", "doc_summary", "doc_learn"] {
        tx.execute(
            &format!("{SUBTREE} DELETE FROM {table} WHERE doc_id IN (SELECT id FROM sub)"),
            [id],
        )
        .map_err(db_err)?;
    }
    // 两个方向都断（见 empty_trash 那条注释）。
    for col in ["from_id", "to_id"] {
        tx.execute(
            &format!("{SUBTREE} DELETE FROM doc_link WHERE {col} IN (SELECT id FROM sub)"),
            [id],
        )
        .map_err(db_err)?;
    }
    tx.execute(&format!("{SUBTREE} DELETE FROM documents WHERE id IN (SELECT id FROM sub)"), [id])
        .map_err(db_err)?;
    tx.commit().map_err(db_err)
}

pub fn favorite(conn: &Connection, id: &str, value: Option<bool>) -> ApiResult<bool> {
    let cur: i64 = conn
        .query_row("SELECT is_favorite FROM documents WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(db_err)?
        .ok_or_else(|| not_found("doc"))?;
    let next = value.unwrap_or(cur == 0);
    conn.execute(
        "UPDATE documents SET is_favorite = ?2 WHERE id = ?1",
        params![id, next as i64],
    )
    .map_err(db_err)?;
    Ok(next)
}

/// `doc:pin` —— 置顶 / 取消置顶（D-0123）。
/// 置顶写的是**时间戳**（不是 1）：「置顶」那一页要按「最近置的」排。
/// 跟 `favorite` 一样**不动 `updated_at`** —— 置个顶不算「改过这篇」。
pub fn pin(conn: &Connection, id: &str, value: Option<bool>) -> ApiResult<bool> {
    let cur: Option<Option<i64>> = conn
        .query_row("SELECT pinned_at FROM documents WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(db_err)?;
    let next = value.unwrap_or(cur.ok_or_else(|| not_found("doc"))?.is_none());
    conn.execute(
        "UPDATE documents SET pinned_at = ?2 WHERE id = ?1",
        params![id, next.then(now_ms)],
    )
    .map_err(db_err)?;
    Ok(next)
}

pub fn open(conn: &Connection, id: &str) -> ApiResult<DocContent> {
    let doc = get(conn, id)?;
    let content: Option<String> = conn
        .query_row("SELECT content FROM doc WHERE doc_id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(db_err)?;
    Ok(DocContent { doc, content })
}

/// 落一份正文。
///
/// ★ **先快照后写**：origin 不是 `user` 时，这里先把当前状态写进 `doc_version`，再改 ——
/// 顺序由 Rust 保证，不由模型自觉，也不由前端自觉（D-0043）。
///
/// ponytail: `user` 的 300ms flush 不打版本点（粒度太细，写一次打一次 = 爆炸）。
/// 用户的版本点由 `version:checkpoint` 在显式事件上打（关文档 / 每 10 分钟）。
/// 哪天要「每次编辑都可回退」，把下面这个 if 去掉即可。
pub fn apply(conn: &Connection, a: Apply<'_>) -> ApiResult<()> {
    let tx = conn.unchecked_transaction().map_err(db_err)?;

    // 没 content = 空调用。静默吞掉是信任边界上的坏味道（前端写错了没人知道），
    // 响亮报错。注意这一句在 checkpoint 之前 —— 别为一次没写的调用打版本点。
    let content = a
        .content
        .ok_or_else(|| ApiError::new("bad_args", "doc:apply 需要 content"))?;

    if a.origin != "user" {
        version::checkpoint(&tx, a.id, None, a.origin, a.group_id, a.label)?;
    }

    // 合并点（D-0131）：Rust 仍是唯一写正文的地方 —— 但动作从「合并 Yjs」变成**覆盖 JSON**。
    tx.execute(
        "INSERT INTO doc(doc_id, content) VALUES(?1, ?2)
         ON CONFLICT(doc_id) DO UPDATE SET content = excluded.content",
        params![a.id, content],
    )
    .map_err(db_err)?;

    // 标题 / 投影进库前清掉控制符（`doc:apply` 的 title / md，见 `clean_controls`）。
    let title = a.title.map(clean_controls);
    let md = a.md.map(clean_controls);
    if title.is_some() || md.is_some() {
        reindex(&tx, a.id, title.as_deref(), md.as_deref())?;
    }

    // 出链和 md 投影同一个事务（D-0085）：投影和边一起成一起败，
    // 不会出现「正文改了、图还是旧的」那种半截状态。
    if let Some(links) = a.links {
        links::replace(&tx, a.id, links)?;
    }

    tx.commit().map_err(db_err)
}

/// 维护 Markdown 投影 + 全文索引。**两者同一个 payload**（D-0040）。
/// `doc_fts` 是虚拟表，没有 upsert，只能删了重插。
fn reindex(conn: &Connection, doc_id: &str, title: Option<&str>, md: Option<&str>) -> ApiResult<()> {
    let cur: Option<(String, String)> = conn
        .query_row("SELECT title, md FROM doc_text WHERE doc_id = ?1", [doc_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()
        .map_err(db_err)?;
    let (cur_title, cur_md) = cur.unwrap_or_default();

    // 编辑器里的标题就是这篇的**名字**（D-0073）：`doc:apply` 带上 title 时，
    // `documents.title` 也跟着改。少了这一句，顶栏/侧栏/标签条永远停在旧名字上。
    if let Some(t) = title {
        conn.execute(
            "UPDATE documents SET title = ?2, updated_at = ?3 WHERE id = ?1 AND title <> ?2",
            params![doc_id, t, now_ms()],
        )
        .map_err(db_err)?;
    }

    let title = title.unwrap_or(&cur_title);
    let md = md.unwrap_or(&cur_md);

    conn.execute(
        "INSERT INTO doc_text(doc_id, title, md, at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(doc_id) DO UPDATE SET title = excluded.title, md = excluded.md, at = excluded.at",
        params![doc_id, title, md, now_ms()],
    )
    .map_err(db_err)?;
    conn.execute("DELETE FROM doc_fts WHERE doc_id = ?1", [doc_id]).map_err(db_err)?;
    conn.execute(
        "INSERT INTO doc_fts(doc_id, title, body) VALUES(?1, ?2, ?3)",
        params![doc_id, cjk_space(title), cjk_space(md)],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn search(
    conn: &Connection,
    q: &str,
    limit: i64,
    include_trashed: bool,
) -> ApiResult<Vec<Hit>> {
    let m = fts5_match(q);
    search_with_match(conn, &m, limit, include_trashed)
}

/// 拿一段**自由文字**当宽松查询：切词后 **OR** 起来找。
///
/// ★ 为什么需要它：`search` 走 `fts5_match`，词之间是**空格 = 隐式 AND**。
///   拿整条标题去 AND，等于要求候选笔记同时包含标题里的**每一个**字 ——
///   两篇相关的笔记几乎不可能做到，于是「候选邻居」永远是空的。
/// ★ 中文按相邻 bigram 切：单字 `的` / `是` 会命中全库；整段又会把语序绑死。
///   `记忆淘汰` → `"记 忆" OR "忆 淘" OR "淘 汰"`，既有区分度又不怕标点。
pub fn search_any(
    conn: &Connection,
    text: &str,
    limit: i64,
    include_trashed: bool,
) -> ApiResult<Vec<Hit>> {
    let terms = query_terms(text);
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let m = terms.iter().map(|t| fts_term(t)).collect::<Vec<_>>().join(" OR ");
    search_with_match(conn, &m, limit, include_trashed)
}

/// 在给定 id 集合里按 FTS 召回，按 `bm25` 排。给 `rag:search` 圈定范围后挑候选 ——
/// 范围再大也只在这里过一遍索引，不把整棵树的正文读进内存。
pub fn match_ids_in(
    conn: &Connection,
    terms: &[String],
    ids: &[String],
    limit: usize,
) -> ApiResult<Vec<String>> {
    if terms.is_empty() || ids.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let m = terms.iter().map(|t| fts_term(t)).collect::<Vec<_>>().join(" OR ");
    let mut hits: Vec<(String, f64)> = Vec::new();
    for batch in ids.chunks(400) {
        let marks = std::iter::repeat_n("?", batch.len()).collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT doc_id, bm25(doc_fts) FROM doc_fts
             WHERE doc_fts MATCH ?1 AND doc_id IN ({marks})
             ORDER BY 2 LIMIT {limit}"
        );
        let mut stmt = conn.prepare(&sql).map_err(db_err)?;
        let mut vals: Vec<&str> = Vec::with_capacity(batch.len() + 1);
        vals.push(m.as_str());
        vals.extend(batch.iter().map(String::as_str));
        let rows = stmt
            .query_map(params_from_iter(vals), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
            })
            .map_err(db_err)?;
        for row in rows {
            hits.push(row.map_err(db_err)?);
        }
    }
    hits.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (id, _) in hits {
        if seen.insert(id.clone()) {
            out.push(id);
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

/// 自由文字 → FTS 词项：中文相邻 bigram，英文/数字整词。
pub(crate) fn query_terms(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cjk = String::new();
    let mut word = String::new();

    let flush_cjk = |run: &mut String, out: &mut Vec<String>| {
        let cs: Vec<char> = run.chars().collect();
        if cs.len() == 1 {
            out.push(cs[0].to_string());
        } else {
            for w in cs.windows(2) {
                out.push(format!("{}{}", w[0], w[1]));
            }
        }
        run.clear();
    };
    let flush_word = |w: &mut String, out: &mut Vec<String>| {
        let t = w.to_lowercase();
        if t.chars().count() >= 2 {
            out.push(t);
        }
        w.clear();
    };

    for c in text.chars() {
        if is_cjk(c) {
            flush_word(&mut word, &mut out);
            cjk.push(c);
        } else if c.is_alphanumeric() {
            flush_cjk(&mut cjk, &mut out);
            word.push(c);
        } else {
            flush_cjk(&mut cjk, &mut out);
            flush_word(&mut word, &mut out);
        }
    }
    flush_cjk(&mut cjk, &mut out);
    flush_word(&mut word, &mut out);

    let mut seen = Vec::new();
    out.retain(|t| {
        if seen.contains(t) {
            false
        } else {
            seen.push(t.clone());
            true
        }
    });
    out
}

/// 一个词项 → FTS5 短语。中文 run 已经按字切过，所以 `记忆` 要写成 `"记 忆"`。
pub(crate) fn fts_term(term: &str) -> String {
    let inner = cjk_space(term)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace('"', "");
    format!("\"{inner}\"")
}

/// `search` / `search_any` 共用的下半段 —— MATCH 表达式已经拼好了。
fn search_with_match(
    conn: &Connection,
    m: &str,
    limit: i64,
    include_trashed: bool,
) -> ApiResult<Vec<Hit>> {
    if m.is_empty() {
        return Ok(Vec::new());
    }
    // `snippet()` 的第 2 个参数是**列序号**：doc_fts 是 (doc_id UNINDEXED, title, body)，
    // 所以 body 是 2。末两个参数是标记和最多 12 个 token。
    // 标记拼进 SQL 而不是绑参数：snippet 只收常量。拼进来的是 HIT_OPEN/HIT_CLOSE，
    // 这样前端 `contract.ts` 里那两个常量和这里**同源** —— 各写一份字面量迟早会错开，
    // 错开了高亮就静默失效（D-0053）。
    let sql = format!(
        "SELECT d.id, d.title, d.parent_id, d.updated_at,
                snippet(doc_fts, 2, '{HIT_OPEN}', '{HIT_CLOSE}', '…', 12)
         FROM doc_fts JOIN documents d ON d.id = doc_fts.doc_id
         WHERE doc_fts MATCH ?1 AND (?2 OR d.deleted_at IS NULL)
         ORDER BY bm25(doc_fts), d.updated_at DESC
         LIMIT ?3"
    );
    let mut stmt = conn.prepare(&sql).map_err(db_err)?;
    let rows = stmt
        .query_map(params![m, include_trashed, limit], |r| {
            Ok(Hit {
                id: r.get(0)?,
                title: r.get(1)?,
                parent_id: r.get(2)?,
                updated_at: r.get(3)?,
                body: unspace(&r.get::<_, String>(4)?),
            })
        })
        .map_err(db_err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_err);
    rows
}

/// 首页每行的正文摘要。数据来自 `doc_text.md`（编辑器落库时投影进来的正文）——
/// 从没落过库的文档没有这一行，前端据此**不画**摘要，而不是拿标题当占位糊上去。
pub fn summary(conn: &Connection, ids: &[String]) -> ApiResult<Vec<Summary>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    // ponytail: 一次最多问 200 篇，首页也就画这么多行；多了用 IN 列表也不合适。
    let ids = &ids[..ids.len().min(200)];
    let marks = std::iter::repeat_n("?", ids.len()).collect::<Vec<_>>().join(",");
    let mut stmt = conn
        .prepare(&format!("SELECT doc_id, md FROM doc_text WHERE doc_id IN ({marks})"))
        .map_err(db_err)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |r| {
            let md: String = r.get(1)?;
            Ok(Summary { id: r.get(0)?, body: excerpt(&md) })
        })
        .map_err(db_err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_err);
    rows
}

/// 用户真的在看这一篇了（编辑器挂上时可编辑的那次）—— 首页「最近」按它排。
/// ★ 和 `open` 拆开（D-0109）：`open` 只是向库里要字节，旁路读一次不该把人家的
///   `last_opened_at` 刷新，否则批量补投影会把首页顺序整片打乱。
pub fn touch(conn: &Connection, id: &str) -> ApiResult<()> {
    conn.execute(
        "UPDATE documents SET last_opened_at = ?2 WHERE id = ?1",
        params![id, now_ms()],
    )
    .map_err(db_err)?;
    Ok(())
}

/// 一篇文档的投影正文（Markdown），给搜索面板右侧的预览用。
/// `summary` 只取 160 字当副标题，预览要整篇；从没落过库的文档返回空串（不是报错）。
pub fn text(conn: &Connection, id: &str) -> ApiResult<String> {
    conn.query_row("SELECT md FROM doc_text WHERE doc_id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(db_err)
        .map(|v| v.unwrap_or_default())
}

/// 摘要取正文前 160 个字符，并把换行压成空格 —— 副标题就一行。
fn excerpt(md: &str) -> String {
    md.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect()
}

/* ─────────────────────────── FTS5 与中文 ─────────────────────────── */

/// FTS5 自带的 unicode61 把一整段中文当成**一个** token —— "你好世界" 里搜 "你好" 匹配不到。
/// 所以按字切开：入库和查询走同一个变换，两边的 token 才对齐。
///
/// ponytail: 按字切会让中文索引放大两三倍（单人几百篇无所谓）。
/// 上万篇或要词边界，再换 `tokenize='trigram'` 或接一个真的中文分词器。
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

/// `cjk_space` 的逆：把逐字加进去的空格收回来。
///
/// ★ 为什么需要它：`doc_fts` 里存的是 `cjk_space(md)`，而 `snippet()` 读的就是**索引里那份** ——
///   不收回来，搜出来的摘要就是「不 阻 塞 写 。」这种，中文全被拆散。
///   判据是「这个空格紧挨着 CJK 字符」= `cjk_space` 插的（它只在 CJK 两侧插空格）。
///   代价：原文里两个汉字之间本来就有的空格会被吃掉（罕见，可接受）。
fn unspace(s: &str) -> String {
    let cs: Vec<char> = s.chars().collect();
    // ★ 命中标记是**夹在字之间**的（`[标记]数[标记] [空格] [标记]据[标记]`），
    //   看邻居时必须跳过它，否则看到的永远是标记、空格一个都收不回来。
    //   ⚠️ **只跳标记**：把标点也跳过去的话，「个 token」里那个真实的空格会被误吃。
    let skip = |c: char| c == HIT_OPEN || c == HIT_CLOSE;
    // 「该不该收」的判据比 `is_cjk` 宽一档：中日韩标点也算。
    // `cjk_space` 只切汉字，但 FTS5 的 `snippet()` 会在 token 之间补空格，
    // 于是 `token，检索` 出来是 `token ， 检索` —— 那两个空格只有把标点算进来才收得掉。
    // 真实文本里不会有人在全角标点旁边写空格，所以这个放宽是安全的。
    let cjkish = |c: char| {
        let u = c as u32;
        is_cjk(c)
            || (0x3000..=0x303F).contains(&u) // CJK 标点（、。〈〉…）
            || (0xFF00..=0xFFEF).contains(&u) // 全角形式（，！？：）
            || (0x2010..=0x2027).contains(&u) // 引号 / 破折号 / 省略号
    };
    let neighbor = |from: usize, forward: bool| -> char {
        let mut i = from;
        loop {
            if forward {
                i += 1;
                if i >= cs.len() {
                    return '\0';
                }
            } else {
                if i == 0 {
                    return '\0';
                }
                i -= 1;
            }
            if !skip(cs[i]) {
                return cs[i];
            }
        }
    };
    let mut out = String::with_capacity(s.len());
    for (i, &c) in cs.iter().enumerate() {
        if c == ' ' && (cjkish(neighbor(i, false)) || cjkish(neighbor(i, true))) {
            continue;
        }
        out.push(c);
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

/// 用户输入 → FTS5 查询串。
/// 每个 token 都加引号：用户随手打的 `-` `"` `*` `(` 在 FTS5 里是语法字符，
/// 不引起来就是一个语法错误（不是「搜不到」，是整个查询报错）。
fn fts5_match(q: &str) -> String {
    cjk_space(q)
        .split_whitespace()
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
}
