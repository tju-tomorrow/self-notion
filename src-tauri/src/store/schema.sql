-- ★★★ 冻结的 schema ★★★（docs/architecture.md 第三节）
--
-- 并行施工时这份文件是法律。改它 = 回 Stage 0。
-- 一次建齐 —— 数据模型后改就是丢数据。功能可以以后落地，表必须现在就在。
--
-- 依据：D-0020（Rust 直连 SQLite 存正文）· D-0023（FTS5）· D-0027（blob 进库）
--       · D-0026（备份推 Markdown）· D-0040（doc_text 投影）· D-0043（doc_version）
--       · D-0131（正文 = PM doc JSON，砍掉 Yjs）
--       · D-0181…D-0189（知识库：策展人 / 图谱 / 语义层，见 docs/kb.md）

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
  pinned_at      INTEGER,
  last_opened_at INTEGER,
  -- 平标签，JSON 数组（D-0086）。形状照 doc_summary.entities —— 一处存 JSON 数组，别处跟着它。
  tags           TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS documents_parent ON documents(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS documents_recent ON documents(last_opened_at DESC);

-- ── 文档正文（D-0131）：ProseMirror doc JSON 的**字符串形式**。砍了 CRDT 就没有「增量」
--    这条路 —— 一次覆盖就是全部（原来的 doc_snapshot + doc_update 两张表合成这一张）。
--    没有这一行 = 这篇还没落过字节 → `doc:open` 回 content = null，编辑器自己造一份空的。
CREATE TABLE IF NOT EXISTS doc (
  doc_id  TEXT PRIMARY KEY,
  content TEXT NOT NULL
);

-- ── 同步块（P3-4 / D-0136）：节点只存一个 id，**内容在源里只有一份** ——
--    「没有 CRDT 也能做到一致」的原因就是要保证一致的是一份、不是两份副本。
--    ★ **不属于任何一篇文档**，所以清库 / 硬删不跟着 subtree 走（见 `store::reset` 的 DROP 清单）。
CREATE TABLE IF NOT EXISTS sync (
  id      TEXT PRIMARY KEY,
  content TEXT NOT NULL,                      -- 那一段块的 JSON
  at      INTEGER NOT NULL
);

-- ── 文档版本点（D-0043）：AI 写入前 / 文档关闭 / 每 10 分钟 ─────────────────
-- 撤销 + 版本历史面板共用它。历史只增不改 —— 「恢复到这里」是再记一个新版本。
CREATE TABLE IF NOT EXISTS doc_version (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id   TEXT NOT NULL,
  content  TEXT NOT NULL,                     -- 该时刻**完整**的 doc JSON
  at       INTEGER NOT NULL,
  origin   TEXT NOT NULL,                     -- 'user' | 'ai' | 'import'
  group_id TEXT,                              -- 一次 AI 回合 = 一个组，撤销按组来
  label    TEXT                               -- AI 写的一句说明
);
CREATE INDEX IF NOT EXISTS doc_version_doc ON doc_version(doc_id, at DESC);
CREATE INDEX IF NOT EXISTS doc_version_group ON doc_version(group_id);

-- ── 全文索引（D-0023）。纯文本由渲染侧在保存时一并送来，Rust 不解析 doc JSON ────
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

-- ══════════════════════════════════════════════════════════════════════════
-- ── 知识库（D-0181…D-0189）：策展人 + 图谱 + 语义层 ─────────────────────────
--
-- ★ 检索层不动 —— 虚拟目录 / grep / doc_fts 一个字都不改。下面这些表只给它
--   **多几个目录**和**多几条工具**（D-0188）。语义层同理：按 D-0040 的立场只做
--   「一个目录 + 一个工具」，不是新地基（D-0184）。
-- ★ 加新表**不占 SCHEMA_VERSION**（store/mod.rs 的规矩）。但要进 `reset()` 的 DROP 清单。
-- ══════════════════════════════════════════════════════════════════════════

-- 受控词表。自动打标签不收敛到词表必然标签爆炸（机器学习 / ML / machine-learning 三份）。
CREATE TABLE IF NOT EXISTS tag (
  name       TEXT PRIMARY KEY,
  aliases    TEXT NOT NULL DEFAULT '[]',      -- JSON 数组
  desc       TEXT NOT NULL DEFAULT '',
  origin     TEXT NOT NULL,                   -- 'user' | 'llm'
  created_at INTEGER NOT NULL
);

-- AI 分的类。name 是**全路径**（`技术/数据库/SQLite`），层级隐式在路径里，不另存 parent。
-- ★ 只喂 `/by-topic/` 投影，**不碰 documents.parent_id**（D-0183）。
CREATE TABLE IF NOT EXISTS topic (
  name TEXT PRIMARY KEY,
  desc TEXT NOT NULL DEFAULT '',
  at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_topic (
  doc_id TEXT NOT NULL,
  topic  TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  at     INTEGER NOT NULL,
  PRIMARY KEY (doc_id, topic)
);
CREATE INDEX IF NOT EXISTS doc_topic_topic ON doc_topic(topic);

-- 策展人的幂等闸：hash = 正文 md 的 sha256。没变就不重跑（D-0181 的拉模式调度靠它）。
CREATE TABLE IF NOT EXISTS curator_run (
  doc_id TEXT PRIMARY KEY,
  hash   TEXT NOT NULL,
  status TEXT NOT NULL,                       -- 'ok' | 'error'
  note   TEXT NOT NULL DEFAULT '',            -- 出错原因 / 上次产出几条
  at     INTEGER NOT NULL
);

-- 建议收件箱。★ 高置信的直接落库、**不进来**（D-0185：判据是规则，不是 LLM 自报的 confidence）。
CREATE TABLE IF NOT EXISTS proposal (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id     TEXT NOT NULL,
  kind       TEXT NOT NULL,                   -- 'tag'|'topic'|'link'|'entity'|'merge'
  payload    TEXT NOT NULL,                   -- JSON，形状随 kind
  confidence REAL NOT NULL DEFAULT 0,
  reason     TEXT NOT NULL DEFAULT '',
  origin     TEXT NOT NULL,                   -- 'llm' | 'rule'
  state      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'rejected'
  at         INTEGER NOT NULL,
  done_at    INTEGER
);
CREATE INDEX IF NOT EXISTS proposal_state ON proposal(state, at DESC);
CREATE INDEX IF NOT EXISTS proposal_doc ON proposal(doc_id, state);

-- 实体（归一后）。填 D-0075 续 留的口子 —— 那边写着「实体只存不索引」。
CREATE TABLE IF NOT EXISTS entity (
  id   TEXT PRIMARY KEY,                      -- sha256(规范化名) 前 32 hex
  name TEXT NOT NULL,                         -- 显示名：第一次见到的那个写法
  kind TEXT NOT NULL DEFAULT '',              -- 'person'|'org'|'place'|'work'|'event'|'concept'|''
  desc TEXT NOT NULL DEFAULT '',
  at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS entity_mention (
  entity_id TEXT NOT NULL,
  doc_id    TEXT NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (entity_id, doc_id)
);
CREATE INDEX IF NOT EXISTS entity_mention_doc ON entity_mention(doc_id);

-- 派生边。★ **只装派生的**（related / co_occur）—— 用户画的边在 doc_link 里，
--    不复制过来，免得两份真相。查图时 union 两张表（D-0186）。
CREATE TABLE IF NOT EXISTS graph_edge (
  src_kind TEXT NOT NULL,                     -- 'doc'|'entity'|'topic'|'tag'
  src_id   TEXT NOT NULL,
  dst_kind TEXT NOT NULL,
  dst_id   TEXT NOT NULL,
  kind     TEXT NOT NULL,                     -- 'related' | 'co_occur'
  weight   REAL NOT NULL DEFAULT 1,
  reason   TEXT NOT NULL DEFAULT '',
  origin   TEXT NOT NULL,                     -- 'llm' | 'computed'
  at       INTEGER NOT NULL,
  PRIMARY KEY (src_kind, src_id, dst_kind, dst_id, kind)
);
CREATE INDEX IF NOT EXISTS graph_edge_src ON graph_edge(src_kind, src_id, kind);
CREATE INDEX IF NOT EXISTS graph_edge_dst ON graph_edge(dst_kind, dst_id, kind);

-- 向量。只对 doc_summary 那一两句 + 标签/主题名做 —— 几千条暴力算余弦是毫秒级，
-- 不上向量库（D-0184）。model / dim 不匹配 = 用户换了 embedding 模型 → 全量重算。
CREATE TABLE IF NOT EXISTS vec (
  owner_kind TEXT NOT NULL,                   -- 'doc'|'tag'|'topic'|'entity'
  owner_id   TEXT NOT NULL,
  model      TEXT NOT NULL,
  dim        INTEGER NOT NULL,
  vec        BLOB NOT NULL,                   -- f32 小端拼接
  hash       TEXT NOT NULL,                   -- 被向量化那段文字的 sha256
  at         INTEGER NOT NULL,
  PRIMARY KEY (owner_kind, owner_id)
);

-- ── 外部 agent 的写请求（D-0191）────────────────────────────────────────────
-- MCP 只读进程不碰正文：它落一条请求，桌面端用编辑器解析器执行，再回写结果。
-- 写操作要求桌面端开着；读不受影响。
CREATE TABLE IF NOT EXISTS agent_request (
  id      TEXT PRIMARY KEY,
  action  TEXT NOT NULL,                      -- create/append/replace/rename/move/trash/restore/tag/undo
  args    TEXT NOT NULL,                      -- JSON
  state   TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'done' | 'failed'
  result  TEXT NOT NULL DEFAULT '',
  error   TEXT NOT NULL DEFAULT '',
  at      INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS agent_request_state ON agent_request(state, at);

-- ── 学习指标（D-0193）。行为计数只由编辑器累加；熟悉度是人手（或 Agent）打的档。
--    行为分不存，读的时候算。加表不占 SCHEMA_VERSION。
CREATE TABLE IF NOT EXISTS doc_learn (
  doc_id       TEXT PRIMARY KEY,
  opens        INTEGER NOT NULL DEFAULT 0,
  read_ms      INTEGER NOT NULL DEFAULT 0,
  depth        INTEGER NOT NULL DEFAULT 0,    -- 0–100，读到过的最深位置
  familiarity  INTEGER,                       -- 1–4，null = 没打过
  at           INTEGER NOT NULL
);

-- ── 局域网同步（D-0195 / D-0196）：文档级 rev + 变更日志游标 ──────────────────
-- ★ 为什么不是 `updated_at`：正文改动不更新 `documents.updated_at`（只有标题变才写它），
--   拿它当同步游标会漏掉整篇正文的修改。日志表是唯一可靠的游标。
-- ★ 只增表、只加触发器，不改已有列 —— 老库每次 open 跑一遍 schema 就补齐。
CREATE TABLE IF NOT EXISTS doc_sync (
  doc_id TEXT PRIMARY KEY,
  rev    INTEGER NOT NULL DEFAULT 0,
  at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_log (
  seq    INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,                       -- 'doc' | 'meta' | 'del' | 'blob'
  id     TEXT NOT NULL,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_log_entity ON sync_log(entity, seq);

-- 正文写入 = 一次 rev + 一条日志。`doc` 一行就是整篇，所以内容变了才算改。
CREATE TRIGGER IF NOT EXISTS sync_doc_ins AFTER INSERT ON doc
BEGIN
  INSERT INTO doc_sync(doc_id, rev, at)
  VALUES(NEW.doc_id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(doc_id) DO UPDATE SET rev = rev + 1, at = excluded.at;
  INSERT INTO sync_log(entity, id, at)
  VALUES('doc', NEW.doc_id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

CREATE TRIGGER IF NOT EXISTS sync_doc_upd AFTER UPDATE OF content ON doc
WHEN OLD.content IS NOT NEW.content
BEGIN
  INSERT INTO doc_sync(doc_id, rev, at)
  VALUES(NEW.doc_id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(doc_id) DO UPDATE SET rev = rev + 1, at = excluded.at;
  INSERT INTO sync_log(entity, id, at)
  VALUES('doc', NEW.doc_id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

-- 元数据 / 回收站 / 收藏 / 置顶 / 标签 / 排序 —— 都算这篇“变了”。
-- `last_opened_at` 故意不在条件里：打开一篇不算改过它。
CREATE TRIGGER IF NOT EXISTS sync_meta_ins AFTER INSERT ON documents
BEGIN
  INSERT INTO doc_sync(doc_id, rev, at)
  VALUES(NEW.id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(doc_id) DO UPDATE SET rev = rev + 1, at = excluded.at;
  INSERT INTO sync_log(entity, id, at)
  VALUES('meta', NEW.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

CREATE TRIGGER IF NOT EXISTS sync_meta_upd AFTER UPDATE ON documents
WHEN OLD.title IS NOT NEW.title
  OR OLD.parent_id IS NOT NEW.parent_id
  OR OLD.icon IS NOT NEW.icon
  OR OLD.sort_order IS NOT NEW.sort_order
  OR OLD.deleted_at IS NOT NEW.deleted_at
  OR OLD.is_favorite IS NOT NEW.is_favorite
  OR OLD.pinned_at IS NOT NEW.pinned_at
  OR OLD.tags IS NOT NEW.tags
BEGIN
  INSERT INTO doc_sync(doc_id, rev, at)
  VALUES(NEW.id, 1, CAST(strftime('%s','now') AS INTEGER) * 1000)
  ON CONFLICT(doc_id) DO UPDATE SET rev = rev + 1, at = excluded.at;
  INSERT INTO sync_log(entity, id, at)
  VALUES('meta', NEW.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

-- 硬删除：留一条 'del'，客户端据此删本地副本。rev 行一起清掉。
CREATE TRIGGER IF NOT EXISTS sync_meta_del AFTER DELETE ON documents
BEGIN
  DELETE FROM doc_sync WHERE doc_id = OLD.id;
  INSERT INTO sync_log(entity, id, at)
  VALUES('del', OLD.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

CREATE TRIGGER IF NOT EXISTS sync_blob_ins AFTER INSERT ON blob
BEGIN
  INSERT INTO sync_log(entity, id, at)
  VALUES('blob', NEW.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

-- 同步块源（D-0136）跟着局域网同步走：节点只存 id，源内容不跟着文档推，
-- 所以单独记一条日志，让手机端也能拿到同一份源。
CREATE TRIGGER IF NOT EXISTS sync_src_ins AFTER INSERT ON sync
BEGIN
  INSERT INTO sync_log(entity, id, at)
  VALUES('src', NEW.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

CREATE TRIGGER IF NOT EXISTS sync_src_upd AFTER UPDATE OF content ON sync
WHEN OLD.content IS NOT NEW.content
BEGIN
  INSERT INTO sync_log(entity, id, at)
  VALUES('src', NEW.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

-- 评论也跨端（D-0199）：插入 / 改动都记一条；删除记 'cdel'，手机端据此删本地那条。
-- 冲突不按 rev 三方合并 —— 评论按 updated_at 最后写入者胜，单人应用够了。
CREATE TRIGGER IF NOT EXISTS sync_comment_ins AFTER INSERT ON comment
BEGIN
  INSERT INTO sync_log(entity, id, at)
  VALUES('comment', NEW.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

CREATE TRIGGER IF NOT EXISTS sync_comment_upd AFTER UPDATE ON comment
WHEN OLD.body IS NOT NEW.body
  OR OLD.resolved IS NOT NEW.resolved
  OR OLD.quote IS NOT NEW.quote
  OR OLD.block_id IS NOT NEW.block_id
  OR OLD.anchor IS NOT NEW.anchor
  OR OLD.parent_id IS NOT NEW.parent_id
BEGIN
  INSERT INTO sync_log(entity, id, at)
  VALUES('comment', NEW.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;

CREATE TRIGGER IF NOT EXISTS sync_comment_del AFTER DELETE ON comment
BEGIN
  INSERT INTO sync_log(entity, id, at)
  VALUES('cdel', OLD.id, CAST(strftime('%s','now') AS INTEGER) * 1000);
END;
