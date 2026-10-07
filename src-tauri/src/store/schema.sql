-- ★★★ 冻结的 schema ★★★（docs/architecture.md 第三节）
--
-- 并行施工时这份文件是法律。改它 = 回 Stage 0。
-- 一次建齐 —— 数据模型后改就是丢数据。功能可以以后落地，表必须现在就在。
--
-- 依据：D-0020（Rust 直连 SQLite 存 Yjs）· D-0023（FTS5）· D-0027（blob 进库）
--       · D-0026（备份推 Markdown）· D-0040（doc_text 投影）· D-0043（doc_version）

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── 文档元数据（Rust 是唯一真相源）────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id             TEXT PRIMARY KEY,
  parent_id      TEXT,                        -- 子页面树
  title          TEXT NOT NULL DEFAULT '',
  icon           TEXT,
  sort_order     REAL NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,                     -- 非空 = 在回收站
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  -- 置顶（D-0123）：非空 = 被置顶，存的是**什么时候置的顶** —— 「置顶」那一页按它倒序。
  -- ★ 旧库靠 MIGRATIONS v3 补这一列（ALTER 不幂等，所以不能只写在这儿）。
  pinned_at      INTEGER,
  last_opened_at INTEGER,
  -- 平标签，JSON 数组（D-0086）。形状照 doc_summary.entities —— 一处存 JSON 数组，别处跟着它。
  -- ★ 旧库靠 MIGRATIONS v2 补这一列（ALTER 不幂等，所以不能只写在这儿）。
  tags           TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS documents_parent ON documents(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS documents_recent ON documents(last_opened_at DESC);

-- ── Yjs 内容：增量追加，定期合并进 snapshot（顺带就是版本历史）─────────────
CREATE TABLE IF NOT EXISTS doc_snapshot (
  doc_id   TEXT PRIMARY KEY,
  update_  BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS doc_update (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id   TEXT NOT NULL,
  update_  BLOB NOT NULL,
  at       INTEGER NOT NULL,
  origin   TEXT NOT NULL DEFAULT 'user'        -- 'user' | 'ai' | 'import'（D-0043）
);
CREATE INDEX IF NOT EXISTS doc_update_doc ON doc_update(doc_id, seq);

-- ── 文档版本点（D-0043）：AI 写入前 / 文档关闭 / 每 10 分钟 ─────────────────
-- 撤销 + 版本历史面板共用它。历史只增不改 —— 「恢复到这里」是再记一个新版本。
CREATE TABLE IF NOT EXISTS doc_version (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id   TEXT NOT NULL,
  update_  BLOB NOT NULL,                     -- 该时刻的完整 Yjs 状态
  at       INTEGER NOT NULL,
  origin   TEXT NOT NULL,                     -- 'user' | 'ai' | 'import'
  group_id TEXT,                              -- 一次 AI 回合 = 一个组，撤销按组来
  label    TEXT                               -- AI 写的一句说明
);
CREATE INDEX IF NOT EXISTS doc_version_doc ON doc_version(doc_id, at DESC);
CREATE INDEX IF NOT EXISTS doc_version_group ON doc_version(group_id);

-- ── 全文索引（D-0023）。纯文本由渲染侧在保存时一并送来，Rust 不解析 Yjs ────
CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(doc_id UNINDEXED, title, body);

-- ── Markdown 投影（D-0040）：和 doc_fts 同一个 payload，一份投影三处复用 ───
--    grep 的语料 · vfs:read 的内容 · 备份的产物（D-0026）
CREATE TABLE IF NOT EXISTS doc_text (
  doc_id TEXT PRIMARY KEY,
  title  TEXT NOT NULL DEFAULT '',
  md     TEXT NOT NULL DEFAULT '',
  at     INTEGER NOT NULL
);

-- ── 每篇的 AI 总结（D-0075）：一句话 + 一段话 + 这篇里出现的实体 ────────
--    ★ 存盘：重开应用、换前端、插件卸了都还在。生成总结**不改文档一个字**。
--    chars 是生成时正文的字符数 —— 对不上就是这篇改过了（能不能当依据看 `ai::summary`）。
CREATE TABLE IF NOT EXISTS doc_summary (
  doc_id   TEXT PRIMARY KEY,
  line     TEXT NOT NULL DEFAULT '',
  para     TEXT NOT NULL DEFAULT '',
  entities TEXT NOT NULL DEFAULT '[]',       -- JSON 数组
  chars    INTEGER NOT NULL DEFAULT 0,
  at       INTEGER NOT NULL
);

-- ── 链接图谱（D-0085）：正文里的 @提及 + 子页面，抽成边 ────────────────────
--    ★ 抽取在**投影产出点**（`editor.ts` 那个 {title, md} 的同一处，随 doc:apply 送上来）。
--    Rust 只做**替换式重建**：一篇的全部出链先删后插，和 md 投影同一个事务。
--    PK 三列 = 天然去重（同一篇里 @同一篇两次只留一条），所以不用先 SELECT 再插。
--    ★ 不含网页链接 / 书签链接 —— 那些是正文字符，不是文档之间的边。
CREATE TABLE IF NOT EXISTS doc_link (
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  kind    TEXT NOT NULL,                      -- 'mention' | 'subpage'
  at      INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id, kind)
);
-- 反链（谁指向我）= WHERE to_id = ? —— 没有这个索引就是每篇全表扫。
CREATE INDEX IF NOT EXISTS doc_link_to ON doc_link(to_id);

-- ── 图片 / 附件（D-0027）：id = 内容 sha256 → 天然去重 ─────────────────────
CREATE TABLE IF NOT EXISTS blob (
  id    TEXT PRIMARY KEY,
  mime  TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size  INTEGER NOT NULL,
  at    INTEGER NOT NULL
);

-- ── 键值：上次备份的 commit sha、schema 版本、全部 UI 状态（D-0039）────────
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── 评论（D-0067）：回复 = parent_id 非空的行。锚点在正文，解决状态只在这儿 ──
CREATE TABLE IF NOT EXISTS comment (
  id         TEXT PRIMARY KEY,
  doc_id     TEXT NOT NULL,                    -- 属于哪篇文档
  parent_id  TEXT,                             -- 非空 = 这是某条评论的回复
  anchor     TEXT NOT NULL,                    -- 'page' | 'block' | 'inline'
  block_id   TEXT,                             -- block/inline 锚定在哪个块
  quote      TEXT NOT NULL DEFAULT '',         -- 建的时候抓的原文（截断到 200 字）
  body       TEXT NOT NULL DEFAULT '',         -- 空串 = 还没写完的草稿
  resolved   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comment_doc ON comment(doc_id, created_at);
