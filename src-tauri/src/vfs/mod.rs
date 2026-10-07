//! 虚拟文档目录（D-0040）。完整设计见 `docs/vfs.md`。
//!
//! 把 `documents`（父子层级）+ `doc_text`（Markdown 投影）**投影成一棵虚拟目录树** ——
//! 目录名是查询条件，路径是筛选器。外接 agent 和内置 AI（D-0042）用的是**同一棵树**。
//! **这不是导出功能**：同一篇文档同时出现在 `/tree/` `/by-date/` `/recent/` 之下，
//! 因为每个目录是一次查询，不是存放位置。
//!
//! `vfs:list` / `vfs:grep` / `vfs:read` / `vfs:stat` 四条命令都在这儿。
//!
//! ★ **不建索引，每次调用全量重建整棵树**（`docs/vfs.md` 第五节）：几千篇 ≈ 几十 MB，
//! ripgrep 在 250 MB 的语料上（还热在 page cache 里）是几十毫秒。
//! ponytail: 全量重建。天花板 = 几万篇 / 语料过 500 MB，那时再上缓存或 trigram 倒排。
//!
//! ★ 但**只重建「形状」，不重建「正文」**（D-0101）：`list` / `stat` 的 SQL 只量
//! `LENGTH(CAST(t.md AS BLOB))`，正文留给 `read`（一篇）和 `grep` / `/search/`（那是它们的活）。
//! 原来那版四条命令都把整库正文读进内存 —— 一次 `ls` 就得搬几十 MB。
//!
//! ★ grep 是**字面子串**匹配，**不是正则** —— `regex` crate 在 D-0040 里是**待批准**依赖，
//! 按 CONVENTIONS 第十节不许自己加。要真正则，先让 D-0040 那条「新增依赖待批」过审。
//!
//! ★ **全部投影都接上了，没有欠账**：`/tree/` `/by-date/` `/recent/` `/favorites/` `/outline/`
//! `/trash/` `/search/<q>/`（动态，见下面 `search_matches`）+ 这一轮补的 `/by-tag/`（D-0086）
//! 和 `/links/`（D-0085）。
//!
//! ⚠️ 这里原来写的是「没投影的目录：`/by-tag/`（schema 里没有标签表）、`/links/`（没有链接表）」。
//! 那两个这一轮补完了 —— **但补的时候一度被改写成「只剩 `/search/` 没做」，那是错的**：
//! `/search/` 从 D-0040 起就在这个文件里（`search_matches` / `search_file_content`），
//! 不是欠账。写注释时别只看这一行，往下翻一屏。

use crate::commands::{ApiError, ApiResult};
use crate::store::links::{self, Edge};
use crate::store::{db_err, now_ms};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

/* ─────────────────────────── 线上形状（照 contract.ts） ─────────────────────────── */

/// `vfs:list` / `vfs:stat` 的返回 —— 形状照 `contract.ts` 的 `VfsEntry`。
/// `size` 只对文件给（目录没意义）；省略 = TS 侧的 `undefined`。
#[derive(Debug, Serialize)]
pub struct Entry {
    pub path: String,
    pub kind: &'static str, // "file" | "dir"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

/// `vfs:grep` 的返回 —— 形状照 `contract.ts` 的 `VfsHit`。
#[derive(Debug, Serialize)]
pub struct Hit {
    pub path: String,
    /// 1 起数（`cat -n` 的直觉）
    pub line: u64,
    pub text: String,
}

/* ─────────────────────────── 入参（dispatch 的 match 分支引用它们） ─────────────────────────── */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListArgs {
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatArgs {
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepArgs {
    pub pattern: String,
    #[serde(default)]
    pub ignore_case: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadArgs {
    pub path: String,
    /// 从第几行开始（**0 起数**）
    pub offset: Option<usize>,
    /// 最多几行
    pub limit: Option<usize>,
}

/* ─────────────────────────── 四条命令 ─────────────────────────── */

/// 列一个目录的直接子项（目录在前，其次按名字）。
pub fn list(conn: &Connection, path: &str) -> ApiResult<Vec<Entry>> {
    let w = World::build(conn)?;
    let p = normalize(path);
    match lookup(&w, &p) {
        Lookup::Dir => {
            let mut items: Vec<(String, Option<FileRef>)> = Vec::new();
            for (fp, r) in &w.files {
                if parent_of(fp) == Some(p.as_str()) {
                    items.push((fp.clone(), Some(*r)));
                }
            }
            for dp in &w.dirs {
                if parent_of(dp) == Some(p.as_str()) {
                    items.push((dp.clone(), None));
                }
            }
            // 目录（None）在前，其次按名字
            items.sort_by(|a, b| a.1.is_some().cmp(&b.1.is_some()).then_with(|| a.0.cmp(&b.0)));
            Ok(items
                .into_iter()
                .map(|(path, r)| {
                    let size = r.and_then(|r| file_size(&w, r));
                    Entry { path, kind: if r.is_some() { "file" } else { "dir" }, size }
                })
                .collect())
        }
        // `/search/<q>/` 的一次列举 = 先 grep 的结果，长得像目录（docs/vfs.md 第三节）
        Lookup::SearchDir(q) => {
            if q.is_empty() {
                return Ok(Vec::new()); // 没有查询词 = 空目录，不是错误
            }
            // 查询词进路径段，得转义 —— 里面的 `/` 会把这一层切成两层（D-0101）
            let prefix = format!("/search/{}", enc(&q));
            Ok(search_matches(&w, &all_texts(conn)?, &q)
                .into_iter()
                .map(|(i, name)| Entry {
                    path: format!("{prefix}/{name}"),
                    kind: "file",
                    size: Some(w.docs[i].md_len),
                })
                .collect())
        }
        Lookup::File(_) | Lookup::SearchFile(_, _) => {
            Err(ApiError::new("bad_args", format!("{p} 是文件，不是目录")))
        }
        Lookup::None => Err(ApiError::new("not_found", p)),
    }
}

pub fn stat(conn: &Connection, path: &str) -> ApiResult<Option<Entry>> {
    let w = World::build(conn)?;
    let p = normalize(path);
    Ok(match lookup(&w, &p) {
        Lookup::Dir | Lookup::SearchDir(_) => Some(Entry { path: p, kind: "dir", size: None }),
        Lookup::File(r) => Some(Entry { path: p, kind: "file", size: file_size(&w, r) }),
        Lookup::SearchFile(q, name) => {
            let text = search_file_content(conn, &w, &q, &name)?;
            Some(Entry { path: p, kind: "file", size: Some(text.len() as u64) })
        }
        Lookup::None => None,
    })
}

/// 读一个文件的正文。目录 → `bad_args`；路径不存在 → `not_found`（**响亮地失败**）。
pub fn read(
    conn: &Connection,
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> ApiResult<String> {
    let w = World::build(conn)?;
    let p = normalize(path);
    let text = match lookup(&w, &p) {
        Lookup::File(r) => content(conn, &w, r)?,
        Lookup::SearchFile(q, name) => search_file_content(conn, &w, &q, &name)?,
        Lookup::Dir | Lookup::SearchDir(_) => {
            return Err(ApiError::new("bad_args", format!("{p} 是目录，不是文件")))
        }
        Lookup::None => return Err(ApiError::new("not_found", p)),
    };
    Ok(slice_lines(&text, offset, limit))
}

/// 全扫所有**未删除**文档的投影正文，逐行找**字面子串**（不是正则，见模块头）。
/// 返回的 `path` 是该文档在 `/tree/` 下的规范路径（一篇文档只报一次路径）。
pub fn grep(conn: &Connection, pattern: &str, ignore_case: bool) -> ApiResult<Vec<Hit>> {
    if pattern.is_empty() {
        // 空模式会匹配每一行 —— 信任边界上响亮报错，不静默吐整库（CONVENTIONS 第十节）
        return Err(ApiError::new("bad_args", "vfs:grep 的模式不能为空"));
    }
    let w = World::build(conn)?;
    // 全扫是 grep 的本分 —— 正文只在这一条和 `/search/` 上才全量拉。
    let texts = all_texts(conn)?;
    let needle = if ignore_case { pattern.to_lowercase() } else { pattern.to_string() };
    let mut out = Vec::new();
    for (i, d) in w.docs.iter().enumerate() {
        // tree_path 只在未删除的文档上被填 —— 回收站里的不进 grep（和 `/tree/` 一致）
        let Some(path) = w.tree_path[i].as_ref() else { continue };
        // 还没投影过的文档这儿是空的：扫不到 ≠ 没写，`/index.md` 会把它算出来
        let Some(md) = texts.get(&d.id) else { continue };
        for (n, line) in md.lines().enumerate() {
            let hit =
                if ignore_case { line.to_lowercase().contains(&needle) } else { line.contains(&needle) };
            if hit {
                out.push(Hit { path: path.clone(), line: (n + 1) as u64, text: line.to_string() });
            }
        }
    }
    Ok(out)
}

/* ─────────────────────────── 投影 ─────────────────────────── */

/// 一行 `documents JOIN doc_text`。
struct Doc {
    id: String,
    parent_id: Option<String>,
    title: String,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    is_favorite: bool,
    last_opened_at: Option<i64>,
    /// `doc_text` 里有没有这一行。**没有 ≠ 空**：还没投影过的文档，在这儿和「真的是空的」
    /// 长得一模一样 —— 所以这个标志得留着，`/index.md` 拿它提醒（D-0101）。
    projected: bool,
    /// 投影正文的**字节数**。SQL 里就量好了 —— `list` / `stat` 只报个大小，
    /// 不该为了那个数字把整库正文读进内存。
    md_len: u64,
    /// 平标签（D-0086），`documents.tags` 的 JSON 数组解出来的
    tags: Vec<String>,
}

/// 一个虚拟文件指向谁。`Index` / `Agents` 是系统生成的文件，不指向任何文档。
#[derive(Clone, Copy)]
enum FileRef {
    Doc(usize),
    Outline(usize),
    /// `/links/to/<文档>.md` —— 装的是**链接清单**（谁指向它），不是那篇的正文（D-0085）
    LinkTo(usize),
    /// `/links/from/<文档>.md` —— 它指向谁
    LinkFrom(usize),
    Index,
    Agents,
}

/// 路径查出来的东西。
enum Lookup {
    Dir,
    File(FileRef),
    /// `/search/<q>`，q 可能为空
    SearchDir(String),
    /// `/search/<q>/<name>.md`
    SearchFile(String, String),
    None,
}

struct World {
    docs: Vec<Doc>,
    /// parent_id → 子文档下标。顺序 = SQL 的 `ORDER BY sort_order, created_at`。
    children: HashMap<Option<String>, Vec<usize>>,
    files: BTreeMap<String, FileRef>,
    dirs: BTreeSet<String>,
    /// 每篇文档在 `/tree/` 下的路径（未删除的才有；它是 grep 的规范路径）
    tree_path: Vec<Option<String>>,
    /// 文档 id → 下标（`/links/` 的两个方向要从边的另一端反查标题/路径）
    by_id: HashMap<String, usize>,
    /// id → 谁指向它（`/links/to/`）。每次 build 现查现拼，不跨调用缓存。
    in_links: HashMap<String, Vec<Edge>>,
    /// id → 它指向谁（`/links/from/`）
    out_links: HashMap<String, Vec<Edge>>,
}

impl World {
    fn build(conn: &Connection) -> ApiResult<World> {
        let mut stmt = conn
            .prepare(
                "SELECT d.id, d.title, d.parent_id, d.created_at, d.updated_at,
                        d.deleted_at, d.is_favorite, d.last_opened_at, d.tags,
                        t.md IS NOT NULL,
                        COALESCE(LENGTH(CAST(t.md AS BLOB)), 0)
                 FROM documents d LEFT JOIN doc_text t ON t.doc_id = d.id
                 ORDER BY d.sort_order, d.created_at",
            )
            .map_err(db_err)?;
        let docs = stmt
            .query_map([], |r| {
                Ok(Doc {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    parent_id: r.get(2)?,
                    created_at: r.get(3)?,
                    updated_at: r.get(4)?,
                    deleted_at: r.get(5)?,
                    is_favorite: r.get::<_, i64>(6)? != 0,
                    last_opened_at: r.get(7)?,
                    // 坏 JSON 就当没有标签 —— 目录投影不该因为一列脏数据整棵树建不起来
                    tags: serde_json::from_str(&r.get::<_, String>(8)?).unwrap_or_default(),
                    projected: r.get::<_, i64>(9)? != 0,
                    // LENGTH(CAST(… AS BLOB)) 才是**字节**数；直接 LENGTH() 给的是字符数
                    md_len: r.get::<_, i64>(10)?.max(0) as u64,
                })
            })
            .map_err(db_err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_err)?;

        // 子索引：保持 SQL 给的顺序，同一个父下的相对顺序就是排序键的顺序
        let mut children: HashMap<Option<String>, Vec<usize>> = HashMap::new();
        let mut by_id: HashMap<String, usize> = HashMap::new();
        for (i, d) in docs.iter().enumerate() {
            children.entry(d.parent_id.clone()).or_default().push(i);
            by_id.insert(d.id.clone(), i);
        }

        let mut w = World {
            tree_path: vec![None; docs.len()],
            docs,
            children,
            by_id,
            files: BTreeMap::new(),
            dirs: BTreeSet::new(),
            in_links: HashMap::new(),
            out_links: HashMap::new(),
        };
        for d in [
            "/",
            "/tree",
            "/by-date",
            "/recent",
            "/favorites",
            "/outline",
            "/trash",
            "/search",
            "/links",
            "/links/to",
            "/links/from",
            "/by-tag",
        ] {
            w.dirs.insert(d.to_string());
        }
        w.files.insert("/index.md".into(), FileRef::Index);
        w.files.insert("/AGENTS.md".into(), FileRef::Agents);

        w.build_tree();
        w.build_outline();
        w.build_favorites();
        w.build_recent();
        w.build_trash();
        w.build_by_date();
        w.build_links(conn)?;
        w.build_by_tag();
        Ok(w)
    }

    /// `/tree/`：唯一「真实」的层级 = `documents.parent_id`。一篇文档一个 `.md`；
    /// 有可见子页的还额外当目录（同时是文件和目录，和 Notion 的页面一样）。
    fn build_tree(&mut self) {
        let (docs, children) = (&self.docs, &self.children);
        let mut files = Vec::new();
        let mut dirs = Vec::new();
        let mut tree_path = vec![None; docs.len()];
        walk(docs, children, None, "/tree", &mut files, &mut dirs, &mut tree_path);
        for (p, i) in files {
            self.files.insert(p, FileRef::Doc(i));
        }
        for d in dirs {
            self.dirs.insert(d);
        }
        self.tree_path = tree_path;
    }

    /// `/outline/`：镜像 `/tree/` 的结构，内容只留标题行（喂给 agent 的目录页）。
    fn build_outline(&mut self) {
        let (docs, children) = (&self.docs, &self.children);
        let mut files = Vec::new();
        let mut dirs = Vec::new();
        let mut unused = vec![None; docs.len()];
        walk(docs, children, None, "/outline", &mut files, &mut dirs, &mut unused);
        for (p, i) in files {
            self.files.insert(p, FileRef::Outline(i));
        }
        for d in dirs {
            self.dirs.insert(d);
        }
    }

    fn build_favorites(&mut self) {
        let idx = self.live_indices(|d| d.is_favorite);
        let names = self.names_of(&idx);
        for (&i, name) in idx.iter().zip(names) {
            self.files.insert(format!("/favorites/{name}"), FileRef::Doc(i));
        }
    }

    /// `/recent/`：按 `last_opened_at` 降序，文件名前缀是位次（`1-标题.md`）。
    fn build_recent(&mut self) {
        let mut idx = self.live_indices(|d| d.last_opened_at.is_some());
        idx.sort_by_key(|&i| std::cmp::Reverse(self.docs[i].last_opened_at.unwrap_or(0)));
        for (rank, &i) in idx.iter().enumerate() {
            let name = format!("{}-{}.md", rank + 1, stem(&self.docs[i].title));
            self.files.insert(format!("/recent/{name}"), FileRef::Doc(i));
        }
    }

    /// `/trash/`：`deleted_at` 非空的（平铺，不还原层级）。
    fn build_trash(&mut self) {
        let idx: Vec<usize> =
            self.docs.iter().enumerate().filter(|(_, d)| d.deleted_at.is_some()).map(|(i, _)| i).collect();
        let names = self.names_of(&idx);
        for (&i, name) in idx.iter().zip(names) {
            self.files.insert(format!("/trash/{name}"), FileRef::Doc(i));
        }
    }

    /// `/by-date/年/月/日/`：按 `created_at` 分组。**UTC**（见 `ymd`）。
    fn build_by_date(&mut self) {
        let mut groups: BTreeMap<(i64, u32, u32), Vec<usize>> = BTreeMap::new();
        for (i, d) in self.docs.iter().enumerate() {
            if d.deleted_at.is_none() {
                groups.entry(ymd(d.created_at)).or_default().push(i);
            }
        }
        for ((y, m, d), idx) in groups {
            let dir = format!("/by-date/{y:04}/{m:02}/{d:02}");
            self.dirs.insert(format!("/by-date/{y:04}"));
            self.dirs.insert(format!("/by-date/{y:04}/{m:02}"));
            self.dirs.insert(dir.clone());
            let names = self.names_of(&idx);
            for (&i, name) in idx.iter().zip(names) {
                self.files.insert(format!("{dir}/{name}"), FileRef::Doc(i));
            }
        }
    }

    /// `/links/to/` `/links/from/`：链接图谱（D-0085）。每篇一个文件，
    /// ★ `X.md` 装的**不是 X 的正文**，是链接清单 —— 同一段路径名在不同目录下不是同一类东西。
    fn build_links(&mut self, conn: &Connection) -> ApiResult<()> {
        let idx = self.live_indices(|_| true);
        let names = self.names_of(&idx);
        for (&i, name) in idx.iter().zip(names) {
            let id = self.docs[i].id.clone();
            self.in_links.insert(id.clone(), links::in_links(conn, &id)?);
            self.out_links.insert(id.clone(), links::out_links(conn, &id)?);
            self.files.insert(format!("/links/to/{name}"), FileRef::LinkTo(i));
            self.files.insert(format!("/links/from/{name}"), FileRef::LinkFrom(i));
        }
        Ok(())
    }

    /// `/by-tag/<标签>/<文档>.md`：每个标签一个目录（D-0086）。标签名里的 `/` 用 `stem` 换掉，
    /// 不拆层级 —— 平标签。
    fn build_by_tag(&mut self) {
        let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for i in self.live_indices(|_| true) {
            for tag in self.docs[i].tags.clone() {
                groups.entry(stem(&tag)).or_default().push(i);
            }
        }
        for (tag, members) in groups {
            self.dirs.insert(format!("/by-tag/{tag}"));
            let names = self.names_of(&members);
            for (&i, name) in members.iter().zip(names) {
                self.files.insert(format!("/by-tag/{tag}/{name}"), FileRef::Doc(i));
            }
        }
    }

    /// 一批文档 → 它们在同一个目录下的文件名（重名的带 id 后缀，见 `dedup`）。
    fn names_of(&self, idx: &[usize]) -> Vec<String> {
        dedup(idx.iter().map(|&i| (file_name(&self.docs[i].title), self.docs[i].id.as_str())).collect())
    }

    /// 未删除、且满足 `keep` 的文档下标。
    fn live_indices(&self, keep: impl Fn(&Doc) -> bool) -> Vec<usize> {
        self.docs
            .iter()
            .enumerate()
            // `x.1` 是 `&Doc`；直接 `|(_, d)|` 绑定出来的是 `&&Doc`，喂不进 `keep`
            .filter(|x| x.1.deleted_at.is_none() && keep(x.1))
            .map(|(i, _)| i)
            .collect()
    }
}

/// 递归铺 `/tree/` 或 `/outline/`。`tree_path` 只在铺 `/tree/` 时有意义。
fn walk(
    docs: &[Doc],
    children: &HashMap<Option<String>, Vec<usize>>,
    parent: Option<&str>,
    prefix: &str,
    files: &mut Vec<(String, usize)>,
    dirs: &mut Vec<String>,
    tree_path: &mut [Option<String>],
) {
    let kids = live_children(docs, children, parent);
    let names = dedup(kids.iter().map(|&i| (file_name(&docs[i].title), docs[i].id.as_str())).collect());
    for (&i, name) in kids.iter().zip(names) {
        let path = format!("{prefix}/{name}");
        files.push((path.clone(), i));
        tree_path[i] = Some(path);
        if !live_children(docs, children, Some(&docs[i].id)).is_empty() {
            let base = name.strip_suffix(".md").unwrap_or(&name);
            let dir = format!("{prefix}/{base}");
            dirs.push(dir.clone());
            walk(docs, children, Some(&docs[i].id), &dir, files, dirs, tree_path);
        }
    }
}

/// 未删除的直接子文档。
fn live_children(
    docs: &[Doc],
    children: &HashMap<Option<String>, Vec<usize>>,
    parent: Option<&str>,
) -> Vec<usize> {
    children
        .get(&parent.map(str::to_string))
        .map(|v| v.iter().copied().filter(|&i| docs[i].deleted_at.is_none()).collect())
        .unwrap_or_default()
}

/* ─────────────────────────── 内容 ─────────────────────────── */

/// 取一个文件的内容。**只有 `Doc` / `Outline` 要读正文** —— 其余几种是现算出来的清单。
fn content(conn: &Connection, w: &World, r: FileRef) -> ApiResult<String> {
    Ok(match r {
        FileRef::Doc(i) => text_of(conn, &w.docs[i].id)?,
        FileRef::Outline(i) => headings(&text_of(conn, &w.docs[i].id)?),
        FileRef::LinkTo(i) => link_list_md(w, i, true),
        FileRef::LinkFrom(i) => link_list_md(w, i, false),
        FileRef::Index => index_md(w),
        FileRef::Agents => agents_md(),
    })
}

/// `/links/to/X.md` 与 `/links/from/X.md` 的内容（D-0085）—— **清单，不是正文**。
fn link_list_md(w: &World, i: usize, incoming: bool) -> String {
    let id = &w.docs[i].id;
    let edges = if incoming { w.in_links.get(id) } else { w.out_links.get(id) };
    let what = if incoming { "反链：谁指向它" } else { "出链：它指向谁" };
    let title = &w.docs[i].title;
    let mut s = format!("# {what} · {title}\n\n");
    let list: &[Edge] = edges.map(|v| v.as_slice()).unwrap_or(&[]);
    if list.is_empty() {
        s.push_str("（没有）\n");
        return s;
    }
    s.push_str(&format!("共 {} 篇。\n\n", list.len()));
    for e in list {
        // 边上另一端在 `/tree/` 下的路径（agent 能直接 read）；拿不到就退回 id
        let path = w
            .by_id
            .get(&e.doc_id)
            .and_then(|&j| w.tree_path[j].as_deref())
            .unwrap_or(e.doc_id.as_str());
        s.push_str(&format!("- {}  —— {}  ({})\n", e.title, path, e.kind));
    }
    s
}

/// 一个文件的字节数。`None` = **不知道**（不是 0）。
fn file_size(w: &World, r: FileRef) -> Option<u64> {
    match r {
        // 正文长度 SQL 里已经量好了，不用把正文读进来
        FileRef::Doc(i) => Some(w.docs[i].md_len),
        // `/outline/` 的长度得读了正文才能数标题行 —— 为一行大小把正文拉进来不值当，报「不知道」
        FileRef::Outline(_) => None,
        // 下面几种都是现算的清单，算一遍很便宜
        FileRef::LinkTo(i) => Some(link_list_md(w, i, true).len() as u64),
        FileRef::LinkFrom(i) => Some(link_list_md(w, i, false).len() as u64),
        FileRef::Index => Some(index_md(w).len() as u64),
        FileRef::Agents => Some(agents_md().len() as u64),
    }
}

/// 一篇文档的投影正文。**没投影过就回空串** —— 「还没投影」和「真的是空的」
/// 在库里长得一模一样，所以想分辨得看 `Doc::projected`。
fn text_of(conn: &Connection, id: &str) -> ApiResult<String> {
    Ok(conn
        .query_row("SELECT md FROM doc_text WHERE doc_id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(db_err)?
        .unwrap_or_default())
}

/// 全库的投影正文。只有 `grep` 和 `/search/` 该调它 —— 它们本来就要扫全部。
fn all_texts(conn: &Connection) -> ApiResult<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT doc_id, md FROM doc_text").map_err(db_err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(db_err)?;
    let mut out = HashMap::new();
    for row in rows {
        let (id, md) = row.map_err(db_err)?;
        out.insert(id, md);
    }
    Ok(out)
}

/// 只留标题行（ATX `#`）。
/// ponytail: 不认 setext（`===` / `---` 下划线）式标题，够用。
fn headings(md: &str) -> String {
    md.lines().filter(|l| l.trim_start().starts_with('#')).collect::<Vec<_>>().join("\n")
}

/// `/index.md` —— agent 进来的第一站（docs/vfs.md 第七节）。**给地图比给数据重要。**
fn index_md(w: &World) -> String {
    let now = now_ms();
    let live = w.live_indices(|_| true);

    let mut s = String::from("# 文档库\n");
    match live.iter().map(|&i| w.docs[i].updated_at).max() {
        Some(ts) => s.push_str(&format!("共 {} 篇 · 最近更新 {}\n", live.len(), ymd_str(ts))),
        None => s.push_str(&format!("共 {} 篇\n", live.len())),
    }

    // 还没投影过正文的文档：`grep` / `read` 在它们身上什么都看不到，而这**不是**「没写」。
    // 沉默地少几篇 = 看着一切正常（D-0045 防的就是这个），所以在这儿点名。
    let unprojected = live.iter().filter(|&&i| !w.docs[i].projected).count();
    if unprojected > 0 {
        s.push_str(&format!(
            "⚠️ {unprojected} 篇还没投影过正文（在编辑器里打开一次就会补上）——grep 扫不到它们\n"
        ));
    }

    // 标签统计（D-0086）：目录承诺了 `/by-tag/`，这一段就得有真数据
    let mut tags: BTreeMap<String, usize> = BTreeMap::new();
    for &i in &live {
        for tag in &w.docs[i].tags {
            *tags.entry(stem(tag)).or_default() += 1;
        }
    }
    s.push_str("\n## 标签\n");
    if tags.is_empty() {
        s.push_str("（暂无）\n");
    } else {
        let parts: Vec<String> = tags.iter().map(|(t, c)| format!("{t}({c})")).collect();
        s.push_str(&parts.join(" · "));
        s.push('\n');
    }

    s.push_str("\n## 最近改动\n");
    let mut recent = live;
    recent.sort_by_key(|&i| std::cmp::Reverse(w.docs[i].updated_at));
    for &i in recent.iter().take(20) {
        if let Some(p) = &w.tree_path[i] {
            s.push_str(&format!("- {p}  ({})\n", human_age(now - w.docs[i].updated_at)));
        }
    }

    s.push_str("\n## 这个目录怎么用\n见 /AGENTS.md\n");
    s
}

/// `/AGENTS.md` —— 说明书。**约定比内容重要**：告诉 agent 这棵树的语法。
fn agents_md() -> String {
    "\
这是一个虚拟文档目录（D-0040）。同一篇文档会出现在多个目录下 —— 每个目录是一次查询，不是存放位置。
用 list / grep / read 检索：目录名是查询条件，路径是筛选器。

- /tree/            真实层级（documents.parent_id），一篇文档一个 .md；有子页的还能当目录进去
- /by-date/年/月/日/   按创建日（UTC）
- /recent/          按最近打开，文件名前缀是**位次**（跟着打开顺序变，别当身份）
- /favorites/       收藏
- /by-tag/<标签>/    按平标签（D-0086）
- /links/to/<文档>.md   反链：谁指向它 —— 找上下文最快的一条路
- /links/from/<文档>.md 出链：它指向谁
- /outline/         只有标题行（目录页）
- /trash/           回收站
- /search/<q>/      动态查询：一次查询 = 一次目录列举

建议：先读 /index.md 看全局 → grep 定位 → read 拿正文；要上下文就去 /links/to/。

⚠️ **路径是派生的**：改名 / 移动 / 换排序都会改路径，重名的还带 `~id` 后缀。
要记住一篇文档，就记 `/tree/` 下的规范路径（grep 返回的也是它），不要记 /recent/ 那种排序视图。

⚠️ **同名不同类**：`/links/to/X.md` 和 `/links/from/X.md` 装的**不是 X 的正文**，是链接清单。
其余目录下 `X.md` 才是那篇的正文。路径名像不代表内容同类。
"
    .to_string()
}

/// `/search/<q>/` 的一次列举：标题或正文**包含** q（不分大小写）的文档。
/// 等价于先 grep（docs/vfs.md 第三节）。
fn search_matches(w: &World, texts: &HashMap<String, String>, q: &str) -> Vec<(usize, String)> {
    let needle = q.to_lowercase();
    let idx: Vec<usize> = w
        .docs
        .iter()
        .enumerate()
        .filter(|(_, d)| d.deleted_at.is_none())
        .filter(|(_, d)| {
            d.title.to_lowercase().contains(&needle)
                || texts.get(&d.id).is_some_and(|md| md.to_lowercase().contains(&needle))
        })
        .map(|(i, _)| i)
        .collect();
    let names = dedup(
        idx.iter()
            .map(|&i| (file_name(&w.docs[i].title), w.docs[i].id.as_str()))
            .collect(),
    );
    idx.into_iter().zip(names).collect()
}

fn search_file_content(conn: &Connection, w: &World, q: &str, name: &str) -> ApiResult<String> {
    let texts = all_texts(conn)?;
    for (i, n) in search_matches(w, &texts, q) {
        if n == name {
            return Ok(texts.get(&w.docs[i].id).cloned().unwrap_or_default());
        }
    }
    Err(ApiError::new("not_found", format!("/search/{}/{name}", enc(q))))
}

/* ─────────────────────────── 路径 ─────────────────────────── */

/// `/search/<q>` 的查询词要放进**一个路径段**，而路径靠 `/` 分段 ——
/// 所以查询词里的 `/`、空格、`.` 都得转义（`.` 也不行：`normalize` 会把 `.` 段丢掉）。
/// 不转义时搜 `a/b` 会把 `/search/` 切成两层，直接 `not_found`（D-0101）。
fn enc(seg: &str) -> String {
    let mut out = String::new();
    for b in seg.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'~' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `enc` 的逆。认不出的 `%XX` 原样留着 —— 宁可把字面量当查询词，也不要静默吃字符。
fn dec(seg: &str) -> String {
    let bytes = seg.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 3 <= bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(b) = hex {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 折叠重复 `/`、去掉 `.` 段和尾斜杠。根恒为 `/`。
fn normalize(p: &str) -> String {
    let mut out = String::from("/");
    let segs: Vec<&str> = p.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
    out.push_str(&segs.join("/"));
    out
}

/// 父目录路径。`/` 没有父（`None`）。
fn parent_of(p: &str) -> Option<&str> {
    if p == "/" {
        return None;
    }
    match p.rfind('/') {
        Some(0) => Some("/"),
        Some(i) => Some(&p[..i]),
        None => None,
    }
}

fn lookup(w: &World, path: &str) -> Lookup {
    // /search 是动态的：先于静态表判断
    if path == "/search" {
        return Lookup::SearchDir(String::new());
    }
    if let Some(rest) = path.strip_prefix("/search/") {
        return match rest.split_once('/') {
            None => Lookup::SearchDir(dec(rest)),
            Some((q, name)) if !name.is_empty() && !name.contains('/') => {
                Lookup::SearchFile(dec(q), name.to_string())
            }
            _ => Lookup::None,
        };
    }
    if w.dirs.contains(path) {
        return Lookup::Dir;
    }
    if let Some(r) = w.files.get(path) {
        return Lookup::File(*r);
    }
    Lookup::None
}

/// `read` 的 offset/limit：**按行**（offset 0 起数，limit 是行数）。都不给 = 全文。
/// ponytail: 按行而不是按字节 —— agent 拿到的该是 `cat` 的直觉。
fn slice_lines(s: &str, offset: Option<usize>, limit: Option<usize>) -> String {
    if offset.is_none() && limit.is_none() {
        return s.to_string();
    }
    let lines: Vec<&str> = s.lines().collect();
    let start = offset.unwrap_or(0).min(lines.len());
    let end = match limit {
        Some(l) => start.saturating_add(l).min(lines.len()),
        None => lines.len(),
    };
    lines[start..end].join("\n")
}

/* ─────────────────────────── 名字 ─────────────────────────── */

/// 标题 → 名字（**不含扩展名**）。`/` 和 `\` 换成 `-`（否则路径会多切一层），
/// 控制字符丢掉，空的叫 `untitled`，首尾的点丢掉（免得造出 `.` / `..`）。
fn stem(title: &str) -> String {
    let mut s = String::with_capacity(title.len());
    for c in title.chars() {
        match c {
            '/' | '\\' => s.push('-'),
            c if (c as u32) < 0x20 => {}
            c => s.push(c),
        }
    }
    let s = s.trim().trim_matches('.');
    if s.is_empty() {
        "untitled".to_string()
    } else {
        s.to_string()
    }
}

fn file_name(title: &str) -> String {
    format!("{}.md", stem(title))
}

/// 同一个目录里重名 → 在 `.md` 之前带上文档 id 的前 6 位（`标题~a1b2c3.md`）。
///
/// ★ 后缀来自 **id**，不来自顺序。只给「后来的」带后缀的话，谁是第一个又变成顺序说了算，
///   而顺序会因为改名 / 移动 / 换排序而变 —— agent 上一轮记下的路径就失效了（D-0101）。
///   组里重名的**每一个**都带后缀，所以同一篇文档的路径只由（标题 + id）决定。
fn dedup(pairs: Vec<(String, &str)>) -> Vec<String> {
    let mut seen: HashMap<String, u32> = HashMap::new();
    for (name, _) in &pairs {
        *seen.entry(name.clone()).or_insert(0) += 1;
    }
    pairs
        .into_iter()
        .map(|(name, id)| {
            if seen.get(&name).copied().unwrap_or(0) < 2 {
                return name;
            }
            let base = name.strip_suffix(".md").unwrap_or(name.as_str());
            let short: String = id.chars().take(6).collect();
            format!("{base}~{short}.md")
        })
        .collect()
}

/* ─────────────────────────── 日期 / 时间 ─────────────────────────── */

/// 毫秒 → (年, 月, 日)，**UTC**。Howard Hinnant 的 `civil_from_days` —— 不引 chrono。
/// ponytail: 用 UTC。要按「本地日」分组得引时区数据，等内容真受它影响再说。
fn ymd(ms: i64) -> (i64, u32, u32) {
    let z = ms.div_euclid(86_400_000) + 719_468;
    // 括号不能省：`if a {b} else {c} / d` 会被解析成 `if a {b} else {(c / d)}`
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let (m, d) = (m as u32, d as u32);
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn ymd_str(ms: i64) -> String {
    let (y, m, d) = ymd(ms);
    format!("{y:04}-{m:02}-{d:02}")
}

fn human_age(delta_ms: i64) -> String {
    let secs = delta_ms.max(0) / 1000;
    if secs < 60 {
        "刚刚".into()
    } else if secs < 3600 {
        format!("{} 分钟前", secs / 60)
    } else if secs < 86_400 {
        format!("{} 小时前", secs / 3600)
    } else {
        format!("{} 天前", secs / 86_400)
    }
}
