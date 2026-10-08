/**
 * ★ 冻结的契约 ★
 *
 * 并行施工时这份文件是法律。改它 = 回 Stage 0，先问一句为什么。
 * 依据：D-0031 · D-0035 · D-0040 · D-0042 · D-0043 · D-0052 · D-0053 · D-0137 ~ D-0142。
 */

/* ─────────────────────────── 硬依赖（inject 声明，缺了不装载） ─────────────────────────── */

/** 正文里抽出来的一条边（D-0085）。`toId` 已经在文档库里，不是网页链接、不是书签。 */
export interface DocLink {
  toId: string
  /** `mention` = @提及（`inlines/reference`）· `subpage` = 子页面（`embed-linked-doc`） */
  kind: 'mention' | 'subpage'
}

/** 文档句柄。字节的格式由存储实现决定，别处不解释（D-0035）。
 *
 *  ★ 2026-10-08 换了编辑器基座（D-0128 / D-0131）：字节从 **Yjs 二进制**（snapshot + updates）
 *  变成**一个 JSON 字符串**（ProseMirror 的 `doc.toJSON()`）。没有 CRDT 就没有「增量」这个概念，
 *  所以 `updates` 整个消失。形状 = `doc:open` 的返回。 */
export interface DocHandle {
  readonly id: string
  /** 正文（PM doc JSON 的字符串形式）。`null` = 库里还没有这一篇的字节 —— 编辑器自己造一个空的。
   *  ★ **外部文件那条路上它也是 `null`**：那种文档的载荷是 `raw`（读进来）和 `md`（写回去），
   *    见下面两个字段。 */
  content: string | null
  /** 正文投影（纯文本）与标题，只有**落库**方向用得上：Rust 拿它喂 FTS / 摘要（`doc_text`）。
   *  不给就保持库里原值，所以 `load` 的返回不必带。没有这两个字段，`doc_text` 永远是空的 ——
   *  搜索搜不到正文，首页也给不出摘要。
   *  ★ **外部文件模式下 `md` 是另一件事**：它是**要写回那个文件的整篇内容**（保真序列化的结果，
   *    未被碰过的块写原文）。这条路上 `content` 恒为 `null`、只有 `md` 有货。 */
  title?: string
  md?: string
  /** **外部文件模式：文件那一段原文。** `load` 给出来，编辑器**自己解析** ——
   *  解析的顺带把每块的原文和「打开那一刻的快照」记进 side table（D-0142）。
   *  所以这条路上的文档**不能再走 `docFromMarkdown`**（那条路把原文扔了，保真就没了）。
   *  没有这个字段 = 库里的文档，照旧。 */
  raw?: string
  /** 这一篇的**出链**（D-0085）。和 `md` 同一个 payload、同一个时机 ——
   *  「一份投影多处复用」现在多这一处。**全量**：Rust 拿它替换式重建这篇的边
   *  （先删后插），所以给空数组 = 这篇没有出链，不是"别动"。 */
  links?: DocLink[]
}

/** 只有三个方法，不多不少（D-0035）。加第四个之前先问一句为什么。 */
export interface DocsService {
  load(id: string): Promise<DocHandle>
  save(id: string, doc: DocHandle): Promise<void>
  delete(id: string): Promise<void>
}

export interface EditorService {
  /**
   * 编辑器本体是**懒装载**的 —— 冷启动不为不需要它的人付解析费。
   *
   * 所以这里多了一条：**要用 `schema()` 的先 `await ready()`**。它同时保证
   * `connectDocs` 那几条线已经接上（`mount` 内部也等它）。调几次都是同一个 promise，
   * 但**第一次调才开始装载** —— 别在启动路径上顺手 await 一下，那等于没懒。
   *
   * ★ 换基座后（D-0128）这一条**照旧**：ProseMirror 比 BlockSuite 小一个数量级
   *   （200 KB 级 vs 4 MB+），但「首页 / 搜索 / 设置页不需要编辑器」这个事实没变。
   */
  ready(): Promise<void>
  /** 挂到 el 上，返回卸载函数 */
  mount(el: HTMLElement, doc: DocHandle): () => void
  /**
   * 库里这篇的字节换过了（恢复历史版本，D-0043）→ 重读一遍。
   *
   * ★ 这是 Stage 0 冻结之后往契约里加的**第三件**事情（前两件都是评论），破例的理由：
   *   「先改库、再重读」是一对必须原子的动作 —— 中间夹一次落库就会把刚恢复的状态
   *   盖回旧内容，所以不能拆成两个事件让两边各管一半。
   * ★ 重读 = **丢掉手里的活编辑器、用库里那份重建**。不是把新 JSON 塞进现有的 doc ——
   *   那样选区和撤销历史会跟内容对不上。
   */
  reload(id: string): Promise<void>
  /**
   * 这一篇**攒着的改动立刻落库**，不等那 300ms 的节流窗口。没开着 / 没装载过就什么都不做。
   *
   * ★ 加它的理由：内置助手的写工具是**从库里的字节**重做一篇的（`plugins/tools/doc.ts`），
   *   改完再 `reload` 把那篇活文档丢掉 —— 不先 flush，用户最后敲的那 ≤300ms 还在活 Y.Doc 里、
   *   没进库，就被这一读一丢吞掉了（静默丢字，没有任何提示）。
   * ★ 这又是一处**「问不回去」**（D-0052 的老毛病）：编辑器这一侧一直只有"攒着"的能力
   *   （`markDirty`），没有"现在就写"的口子 —— 别人想问它一句都问不了。
   */
  flush(id: string): Promise<void>
  /** 编辑器的 schema（ProseMirror `Schema` 对象，只读）。
   *
   *  ★ 2026-10-08 换基座（D-0129）：这条**取代**了原来的 `defineBlock` + `blocks()`。
   *  「往基座注册一种块」这件事消失了 —— 块类型是我们 schema 里的一等代码，不再由外部注册。
   *  这个口子留给**要自己构造一篇文档**的插件（import-notion —— 它要把 Notion 的块写成 doc JSON，
   *  schema 里少一个节点名那个块就构造不出来）。
   *
   *  形状是不透明的（`unknown`）：拿的人自己 `import { Schema } from 'prosemirror-model'` 再 cast，
   *  跟原来那条 `blocks()` 交给 `StoreExtensionManager` 一个规矩。
   *  ★ 节点名与 attrs 属于**持久化格式**（写进 JSON），冻在 `docs/editor-architecture.md` §2。 */
  schema(): unknown
  /** markdown → 一篇文档的正文（PM doc JSON 字符串）。
   *
   *  ★ 给「拿模型产出的 markdown 造块」的插件用 —— 就两个：`tools` 的写工具（模型给的是
   *  markdown）、`import-notion`（Notion 导出的内容按 markdown 走）。**先 `await ready()`**。
   *  ★ 走契约不走内部文件：插件之间不许 import 内部（CONVENTIONS §6.2）。
   *  ★ 解析器留在编辑器这一侧 —— 它拥有「schema 节点名 ↔ markdown 语法」这份映射，
   *  别处再抄一份就会漂。拿到的整篇 doc JSON 里 `content[0]` 是那个 `blockGroup`，
   *  它的 children 就是块数组。 */
  docFromMarkdown(markdown: string): string
  /**
   * 这一篇**活文档**的正文（纯文本，按块树顺序摊平）。没打开过 → null。
   *
   * ★ 朗读 / 总结这种「用户正看着这篇」的事读它（D-0110）：库里的投影是给**看不见这篇的人**
   *   用的副本（搜索预览 / 首页副标题 / 全文索引），慢一拍、还丢格式 —— 拿它当正文读是错的路子。
   */
  text(id: string): string | null
  /* ── 评论：编辑器只给**机制**，UI 和库都在评论插件那边（D-0067 / docs/comment.md） ── */

  /** 当前文字选区。没有选区、或选中的不是文字 → null。`rect` 给浮出按钮定位用。 */
  textSelection(): TextAnchorInfo | null
  /** 当前块选区（点拖拽手柄选中的那个块）—— 图片/表格这类没法选文字的东西靠它评论。 */
  blockSelection(): BlockAnchorInfo | null
  /** 给一段范围打上评论锚点。`kind: 'block'` 时不写正文，只登记这个块（锚点只活在库里）。 */
  addCommentAnchor(id: string, at: CommentTarget): void
  /** 擦掉某条评论在正文里的所有锚点（删评论时调）。 */
  removeCommentAnchor(id: string): void
  /** 滚到某条评论的锚点并闪一下（面板里点一条评论时调）。锚点不在正文里（页面/块级）就什么都不做。 */
  revealComment(id: string): void
  /** 把库里评论的"解决没有"推给渲染层 —— 高亮只给未解决的。评论列表一变就推一次。 */
  setCommentStates(states: readonly CommentState[]): void
}

/** 文字选区 + 它在屏幕上的位置 + 原文（`quote` 已截断）。 */
export interface TextAnchorInfo {
  blockId: string
  index: number
  length: number
  quote: string
  rect: DOMRect
}

export interface BlockAnchorInfo {
  blockId: string
  quote: string
  rect: DOMRect
}

/** 锚点往哪儿打。`block` 那种不落正文 —— 库里记一行就够。 */
export type CommentTarget =
  | { kind: 'inline'; blockId: string; index: number; length: number }
  | { kind: 'block'; blockId: string }

export interface CommentState {
  id: string
  resolved: boolean
}

/** 唯一的对外通道：桥到 Tauri / Rust。类型源是本文件（D-0049 推翻了 tauri-specta）。 */
export interface RpcService {
  call<T = unknown>(method: `${string}:${string}`, args?: unknown): Promise<T>
}

/** `titlebar.center` 归标签条；覆盖层（⌘K 之类）portal 到 body，不走槽。 */
export type SlotName =
  | 'sidebar.item'
  /** 侧栏**最底部**那格（导航和文档树都装不下它的地方）。宠物住这儿（D-0072）——
   *  它要固定在底部，放 `sidebar.item` 里就只能跟着可滚区跑。 */
  | 'sidebar.foot'
  | 'main.home'
  | 'main.view'
  /** 「助手」那一页（D-0095）。外壳的**第三个**分支：主区整块交给助手（左边历史、右边对话），
   *  跟 `main.view` 分开一格 —— 它不该叠在正文上，也不该跟正文抢一半宽度。 */
  | 'main.page'
  | 'settings.section'
  | 'titlebar.center'
  | 'titlebar.right'
  | 'doc.header'
  /** `doc.header` 那一行的**右侧动作区最左端**（`doc.header.actions` 再往左）。
   *  网页版 AI 那颗住这儿（D-0096）—— 用户点名要它在最左边。 */
  | 'doc.header.leading'
  /** `doc.header` 那一行的**右侧动作区**（☆ / ⋯ 所在的那一小撮）里的**第一格**。
   *  总结那颗按钮就住这儿（D-0075）—— 它要在 ☆ 左边，而 `doc.header` 里注册的东西
   *  只会排在 `shell-doc-header` 整块（面包屑 + ☆ + ⋯）后面。分出一格，位置才定得住。 */
  | 'doc.header.actions'
  /** 顶栗那一行的**最右端**（星星 / ⋯ 再往右）。评论入口就住这儿（D-0070）——
   *  跟 `doc.header` 分开两格，因为插件装载顺序定不了左右，捋到一个格保靠。 */
  | 'doc.header.right'
  /** **网页版 AI 那颗（`doc.header.leading`）的右边一位**：内置助手的入口（D-0106）。
   *  渲染在顶栏动作区里、leading 与 actions 之间（`shell-doc-header/view.tsx`）——
   *  同一格里的左右是装载顺序说了算，想钉住「就在它右边一位」只能另立一格。 */
  | 'doc.header.agent'
  /** 主区右侧那一列（评论面板）。没插件往里塞东西时这一列宽度是 0，不占地方。 */
  | 'doc.aside'
  /** `doc.aside` **再往外**那一列（web 版 AI 面板，D-0074）。和评论那一列**分开两格**是为了
   *  两边能同时开着，而且谁靠外是定死的 —— 塞进同一个槽就只能靠装载顺序决定左右（D-0070 同理）。 */
  | 'doc.aside.right'
  /** 再再往外那一列：**内置助手的侧栏**（D-0098）。用户要的是一句话：「边聊 边看到 笔记」
   *  —— 所以助手得能收进右边一列，跟评论列、web 版 AI 列并排，而不是把正文顶掉。
   *  同样单独一格：三列摆在一起的左右是真定死的。 */
  | 'doc.aside.agent'
  /** 顶栏左侧、侧栏折叠开关**右边**那一格：前进/后退两颗箭头（`shell-nav`）。
   *  单独一格是因为那格里已经有折叠开关了，塞进同一个槽就只能靠装载顺序抢左右。 */
  | 'titlebar.left'
  | 'toast'

export interface SlotService {
  /** 往槽里塞一个东西；返回注销函数。每个槽外面包一层 ErrorBoundary（D-0039）。
   *
   *  `component` 必须保持 `unknown`：它是 React 组件和自定义元素标签名的并集，
   *  收紧成任何一种都会打断另一种（编辑器走标签名，所以插件可以零 React 依赖）。 */
  register(name: SlotName, component: unknown): () => void

  /** 宿主（外壳）也要读回来 —— 它在别的目录里，不声明就只能 import 内核内部（D-0052）。 */
  list(name: SlotName): readonly unknown[]
  subscribe(name: SlotName, cb: () => void): () => void
}

export interface CommandSpec {
  id: string
  title: string
  run(): void | Promise<void>
}

export interface CommandService {
  register(cmd: CommandSpec): () => void
  /** 命令面板打开时读一次，够了 —— 等出现常驻列表再加 `subscribe`。 */
  list(): readonly CommandSpec[]
}

export interface SettingsService {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  onChange(key: string, cb: () => void): () => void
}

export interface ThemeService {
  readonly scheme: 'light' | 'dark'
  readonly tokens: Readonly<Record<string, string>>
  onChange(cb: () => void): () => void
}

export interface I18nService {
  t(key: string, vars?: Record<string, string | number>): string
}

/* ─────────────────────────── 跨插件事件（ctx.emit / ctx.on） ─────────────────────────── */

/** 侧栏/标签条点了一篇文档 → 编辑器去挂它。
 *  用事件不用服务：没有请求-应答，收的人可能还没装载完（D-0053）。 */
export const OPEN_DOC = 'ui:openDoc'

/** 「助手」那个虚拟标签页的 id（D-0095）。**它不是文档** —— 库里没有这一行。
 *  三方靠这一个常量对齐：标签条画它的图标和名字、外壳认出它就走 `main.page` 那个分支、
 *  助手插件拿 `OPEN_DOC` 带上它 = 「把助手那一页打开」。 */
export const AGENT_TAB_ID = 'sn:agent'

export interface OpenDocEvent {
  id: string
}

/** 关掉**某一个**标签（D-0104 续）。发出去的人只有一处：助手那一页上那颗「收进右侧栏」——
 *  它要把整页收成右边一列，而「关标签」是标签条自己的内部状态，外面没有别的口子。
 *  收到的人按跟点标签上那个 × 一模一样的规矩办：关掉、邻居上位、没标签了回首页。 */
export const CLOSE_TAB = 'ui:closeTab'

export interface CloseTabEvent {
  id: string
}

/** 「主区该有几栏」（并排看笔记，D-0118）。`1` = 不分栏，最多 3 栏。
 *  ★ 「现在有几栏、哪一栏是当前」是编辑器插件的**内部状态**（跟「当前是哪篇」同一类，
 *    契约里不存它的值）。所以顶栏那颗按钮够不着它 —— 只能发这条事件**请求**；
 *    编辑器接到就设，设完再**回发同一条**广播新值，按钮的文字据此跟着变。
 *    回发的那一条也会回到编辑器，那会儿值已经相等 → 短路，不转圈。 */
export const SPLIT_VIEW = 'ui:splitView'

export interface SplitViewEvent {
  panes: number
}

/** 「回到首页」—— 点侧栏的「全部文档」时发。主区据此切回文档列表。
 *  ★ 和 `OPEN_DOC` 一样是**事件不是服务**：发的人不关心谁在听、有没有人在听。
 *  只记录「主区现在该显示哪一页」，**不动标签条** —— 标签该留着（AFFiNE 也是）。 */
export const CLOSE_ALL = 'ui:closeAll'

/** 主区该显示哪一页列表。侧栏点「全部文档 / 最近 / 收藏 / 置顶 / 回收站」时发。
 *  ★ 事件不是服务：外侧栏不关心主区有没有装。`all` 就是「All docs」首页。 */
export const SHOW_LIST = 'ui:showList'

/** `vfs` = 虚拟目录那一页（D-0094）· `bugs` = bug 现场那一页（D-0126）·
 *  `files` = 外部文件那一页（D-0137）。这三个**不是文档列表**，由各自的插件自己画；
 *  这里只是为了让它仨蹭同一条「主区该显示哪一页」的路 —— 首页靠这个值**让开**
 *  （`plugins/home/home.tsx`，不让就两页叠在一起）。
 *  `pinned` = 置顶那一页（D-0123），是普通的文档列表（跟 `favorite` 同一类）。 */
export type ListGroup = 'all' | 'recent' | 'favorite' | 'pinned' | 'trash' | 'vfs' | 'bugs' | 'files'

export interface ShowListEvent {
  group: ListGroup
}

/** 文档集合变了（新建 / 改名 / 收藏 / 进退回收站 / 硬删 / 重排）。
 *  ★ 事件而不是让每个视图各自轮询：标签条靠它刷新标题，首页/侧栏靠它重取列表。
 *  载荷为空 —— 收的人一律全量重取（`doc:list` 本来就一次给全）。 */
export const DOCS_CHANGED = 'ui:docsChanged'

/** 一篇文档真的落到库里了（编辑器 300ms 节流之后的实写完成）。顶栏拿它显示「已保存」。 */
export const DOC_SAVED = 'ui:docSaved'

export interface DocSavedEvent {
  id: string
}

/* ───────── 外部 Markdown 文件（D-0137 ~ D-0142，全文见 docs/external-md.md） ─────────
 *
 * 双击一个 `.md` → **直接编辑那个文件**。它不进 `documents` 表：没有 `doc_id`、正文不落库，
 * 文件是唯一真相源。所以这类文档靠 **id 前缀**和库里的文档分开：`plugin-storage` 按前缀分流
 * （`file:` → `file:read` / `file:write`，其余照旧走 `doc:*`）——
 * **编辑器那一侧不需要知道背后是库还是文件**。
 *
 * 代价（D-0140）：进不了评论 / 版本历史 / AI 写工具 / vfs 树 / 全文搜索 / 备份。
 * 界面上这些入口对这种文档**如实不见**。 */

/** 外部文件的 id = `file:` + **绝对路径**。库里没有这一行，这个 id 只在内存里活着。 */
export const FILE_ID_PREFIX = 'file:'

export const fileId = (path: string): string => FILE_ID_PREFIX + path

export const isFileId = (id: string): boolean => id.startsWith(FILE_ID_PREFIX)

/** `file:/a/b.md` → `/a/b.md`。不是文件 id → null —— 别把库里的 id 当路径剥。 */
export const filePathOf = (id: string): string | null =>
  isFileId(id) ? id.slice(FILE_ID_PREFIX.length) : null

/** 外部文件在界面上显示的名字：`file:/a/b/notes.md` → `notes`。
 *  不是文件 id → null（调用方自己回退到库里的标题）。
 *  放契约里是因为**两个外壳插件都要它**（标签条 + 顶栏面包屑），各抄一份就会漂。 */
export const fileTitleOf = (id: string): string | null => {
  const path = filePathOf(id)
  if (path === null) return null
  return (path.split('/').pop() ?? path).replace(/\.(md|markdown)$/i, '')
}

/** 用户要打开的文件。Rust 收到 macOS 的 `RunEvent::Opened` 就发它
 *  （双击 / 拖到图标上 / 「打开方式 → self-notion」）。
 *
 *  ★ 事件不是服务：发的人（Rust）不知道前端起来没有、有没有人在听。
 *  ★ **可能早于前端**：那会儿来的存在 Rust 的信箱里，boot 时用 `file:drainOpened` 取走 ——
 *    只发事件会丢（`tauri dev` 下不可验，见 D-0050 第 4 条那条纪律）。 */
export const FILE_OPENED = 'ui:fileOpened'

export interface FileOpenedEvent {
  /** 绝对路径。一次可能多个（Finder 里选中一批回车厢）。 */
  paths: string[]
}

/** 目录树的一行 / 一个挂载的根。形状 = Rust `fsx::Entry`。 */
export interface FileEntry {
  path: string
  kind: 'file' | 'dir'
  /** 基名 —— 路径的显示名，别让每处自己切。 */
  name: string
  /** 字节数。目录没有这个字段。 */
  size?: number
  /** 最后修改时间（毫秒）。写盘的冲突检测拿它比。 */
  mtime: number
}

/** `file:read` 的返回。`mtime` + `hash` 一起当**乐观锁**：写回时原样带回去（`file:write` 的
 *  `expect`），对不上就是在外面被改过 → `conflict`，**不覆盖**（D-0137 §3）。 */
export interface FileRead {
  text: string
  mtime: number
  /** 内容的 sha256。 */
  hash: string
}

/** `file:write` 的返回：写完之后的**新**那把锁。 */
export interface FileStamp {
  mtime: number
  hash: string
}

/** 「是不是 .md 的默认应用」。`bundlePath` = 系统现在认的那个 app ——
 *  不是我们的时候显示出来，让用户知道被谁占着（D-0138）。 */
export interface FileDefaultStatus {
  isDefault: boolean
  bundlePath: string | null
}

/* ────────────────────── IPC 载荷的形状（类型源就是这儿，D-0049） ────────────────────── */

/** `doc:list` / `doc:create` / `doc:open` 里那个 `doc`。形状 = Rust `store::docs::DocMeta`。 */
export interface DocMeta {
  id: string
  parentId: string | null
  title: string
  icon: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
  /** 非 null = 在回收站里 */
  deletedAt: number | null
  isFavorite: boolean
  /** 置顶（D-0123）。非 null = 被置顶，值是**置顶那一刻**的时间戳 —— 「置顶」那一页按它倒序。
   *  从没置顶过是 null，不是 0。跟 `isFavorite` 是两个独立的标记，可以同时占。 */
  pinnedAt: number | null
  /** 从没打开过是 null，不是 0 */
  lastOpenedAt: number | null
  /** 平标签（D-0086）。库里是 JSON 字符串，Rust 解析成数组再出来。
   *  写入口只有一个：⋯ 菜单那一行（`doc:tags`），没有标签管理面板。 */
  tags: string[]
}

/** `search:query` 的一行。形状 = Rust `store::docs::Hit`。 */
export interface SearchHit {
  id: string
  title: string
  parentId: string | null
  updatedAt: number
  body: string
}

/** `doc:text` 的一行：一整篇的投影正文（Markdown），搜索面板右侧的预览用。
 *  `doc:summary` 那条路只给 160 字的副标题，预览要整篇。没落过库的文档是空串。 */
export interface DocText {
  md: string
}

/** `doc:summary` 的一行：首页每行标题下的正文摘要。形状 = Rust `store::docs::Summary`。
 *  数据来自 `doc_text`（编辑器落库时投影进来的正文），从没落过库的文档没有这一行。 */
export interface DocSummary {
  id: string
  body: string
}

/** `ai:summary` / `ai:summarize` 的返回。形状 = Rust `store::summary::Summary` + 现算的 `stale`（D-0075）。
 *  **存在盘上**（`doc_summary` 表）；没生成过时 `ai:summary` 回 `null`（不是错误）。 */
export interface AiSummary {
  docId: string
  /** 一句话 —— 顶栏那颗按钮上显示的就是它。 */
  line: string
  /** 一段话。 */
  para: string
  /** 模型从这篇里抽出来的实体（人名 / 项目 / 概念 / 工具），最多 8 个。 */
  entities: string[]
  /** 生成时正文的字数（`stale` 的算法用得上）。 */
  chars: number
  at: number
  /** 正文跟生成那会儿不一样了。**现算的，不存盘**。 */
  stale: boolean
}

/** `ai:status` 的返回。**没有 key** —— 它永不回传 webview（D-0042）。 */
export interface AiStatus {
  configured: boolean
  baseUrl: string
  model: string
  hasKey: boolean
  /** `baseUrl` 是明文 http://（本地模型允许，公网会提示） */
  insecure: boolean
}

/** `version:list` 的一行。形状 = Rust `store::version::VersionMeta`。
 *
 * **不回字节**（200 个版本 × 几十 KB 不该一次塞进 webview）—— 所以预览没有原地那一种：
 * `version:restore` 是无损的（先记现在，再装回目标），看一眼再退回来即可。 */
export interface VersionMeta {
  id: number
  at: number
  /** `'user'` | `'ai'` | `'import'`。 */
  origin: string
  /** 一次 AI 回合 = 一个组（撤销按组来）；手动打点是 null。 */
  groupId: string | null
  /** 一句话说明（AI 写的那句）—— 自动打点存的是当时那句「自动记录」。 */
  label: string | null
}

/** 命中片段的边界标记（U+0002 / U+0003）。按它切 run 渲染成元素，**不要 innerHTML** ——
 *  正文是用户内容，永远不当 HTML 用。正文里有 `<` 是家常便饭，所以标记不能是可注入的。
 *  Rust 侧同名常量在 `src-tauri/src/store/docs.rs`，两边同时改。 */
export const HIT_OPEN = '\u0002'
export const HIT_CLOSE = '\u0003'

/* ─────────────────────────── 软依赖（ctx.get() 取，拿不到就降级） ─────────────────────────── */

export interface VfsEntry {
  path: string
  kind: 'file' | 'dir'
  /** 字节数。**省略 = 不知道**，不是 0 —— `/outline/` 的长度要读了正文才数得出来，
   *  为一行数字把正文拉进来不值当（D-0101）。 */
  size?: number
}

export interface VfsHit {
  path: string
  line: number
  text: string
}

/* ─────────────────────────── 内存监控（D-0088） ─────────────────────────── */

/** 一篇**当前加载在内存里**的文档的运行时占用。
 *
 *  ★ `bytes` **不是磁盘大小**：它是这篇 Y.Doc 在内存里编码出来的字节数 ——
 *    「这篇现在占了多少」的**代理指标**。WebKit **没有** per-page 的 heap API
 *    （Chrome 有 `measureUserAgentSpecificMemory`），所以拿不到真正的"哪片内存属于哪一篇"。
 *    界面上必须写明它是这个，别冒充 heap。 */
export interface DocMem {
  id: string
  title: string
  /** Y.Doc 编码后的字节数（运行时那个 CRDT 结构有多大，不是落库的字节）。 */
  bytes: number
  blocks: number
  chars: number
}

/** 软依赖：`ctx.get('mem')`。编辑器是唯一知道「哪几篇正加载在内存里」的人。
 *  拿不到（编辑器插件不在）就只有进程那部分数字，文档那几行空着。 */
export interface MemService {
  stats(): DocMem[]
}

/** 虚拟文档目录（D-0040）。见 docs/vfs.md。 */
export interface VfsService {
  list(path: string): Promise<VfsEntry[]>
  grep(pattern: string, opts?: { ignoreCase?: boolean }): Promise<VfsHit[]>
  read(path: string, opts?: { offset?: number; limit?: number }): Promise<string>
  stat(path: string): Promise<VfsEntry | undefined>
}

/** 软依赖：`ctx.get('webai')`。**只有一个消费者**：编辑器工具条上那颗「问 AI」
 *  （`editor-blocksuite` 传一段选中的字进来）。
 *  ★ 侧栏左下角那只宠物**不碰这条**（用户 2026-10-07：「他不要跟 web ai 联系一起，我要他做
 *    agentic 的」）—— 它留给内置 agent（D-0042 / `docs/ai.md`）。 */
export interface WebAiService {
  /** 选中一段文字 → 把那一段填进面板的输入框（只填不发，自己按回车）。D-0079 之前
   *  这件事是 ai-web 自己浮一颗按钮干的，现在按钮挪进了编辑器的工具栏。 */
  askSelection(text: string): void
}

/** 软依赖：`ctx.get('agent')`。**只有一个消费者**：侧栏左下角那只宠物（`plugins/mascot/`）。
 *  点它开关内置助手的面板 —— 就是 D-0072 说好的那一格（用户 2026-10-07：「我要他做
 *  agentic 的」）。
 *  ★ 跨插件不 import 别人的内部（D-0052），所以这件事只能走契约里的一个方法。
 *  ★ 它是**内置助手**（`docs/ai.md`，能读写笔记），**不是**网页版 AI 面板（`WebAiService`）。 */
export interface AgentService {
  /** 开↔关。为什么不是 `open()`：宠物点一下就该是个开关，跟左下角那颗的语义一致。 */
  toggle(): void
}

/** 软依赖：`ctx.get('mascot')`。**只有一个消费者**：内置助手那一页（D-0095）拿它当标志和头像
 *  —— 用户：「不要用这个 icon，用那个宠物」。
 *  ★ 宠物长什么样归 `plugins/mascot/` 管，别的插件不 import 它的内部（D-0052），
 *    所以这里只开一个「画一只宠物」的口子。
 *  ★ 返回的是**不透明的**（`unknown`）：契约不引 React，消费方自己当元素插进去。 */
export interface MascotService {
  /** 一只会眨眼的宠物，塞进界面就完事。`size` = 画出来的宽度（CSS 像素，高是按比例的三分之四）。 */
  face(size: number): unknown
}

/* ─────────────────────────── 评论（D-0067，全文见 docs/comment.md） ─────────────────────────── */

/** 锚点打在哪儿。`inline` 的那份**正文里也有一份**（delta 上的 `comment` 属性），两边 id 对上；
 *  另外两种只在库里。 */
export type CommentAnchor = 'page' | 'block' | 'inline'

/** 一行评论或回复。形状 = Rust `store::comment::Comment`。回复就是 `parentId` 非空的那行。 */
export interface Comment {
  id: string
  docId: string
  parentId: string | null
  anchor: CommentAnchor
  blockId: string | null
  /** 建的时候抓的原文（截断 200 字）。 */
  quote: string
  /** 空串 = 还没写完的草稿。 */
  body: string
  resolved: boolean
  createdAt: number
  updatedAt: number
}

/** 软依赖：`ctx.get('comment')`。编辑器拿它把"点了正文里的高亮"转出去 —— 拿不到就只是点不动。 */
export interface CommentService {
  /** 打开面板；给了 id 就定位到那一条（并让它闪一下）。 */
  open(id?: string): void
  /** 选中一段**文字** → 就地建一条评论（D-0079）。
   *  工具栏那颗「评论」走这儿 —— 按钮归编辑器画（跟 B / I / U 同一条），办事归评论插件。 */
  onSelection(at: { blockId: string; index: number; length: number; quote: string }): void
}

/** 软依赖：`ctx.get('version')`。文档页的 ⋯ 菜单里那个「历史版本」入口用它 ——
 *  拿不到（插件不在）就不显示那张二级页，面板本体跟这一格同一份，不会漂。 */
export interface VersionService {
  open(): void
}

/** 软依赖：`ctx.get('files')`。**外部文件那一页**（D-0137，全文见 `docs/external-md.md`）。
 *
 *  侧栏那一行靠这个服务**探在不在**（插件卸了就整行不画 —— 不留一个点了没反应的入口，
 *  跟 vfs 那条同一个规矩），点它就是 `open()`。
 *  ★ 它同时负责把 `SHOW_LIST { group: 'files' }` 广播出去（首页靠那个值让开），
 *    所以侧栏只需要这一句、不需要自己发事件。 */
export interface FilesService {
  open(): void
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema：内置 agent 导出成 OpenAI function，外接导出成 MCP tool（D-0042） */
  parameters: unknown
  run(args: unknown): Promise<unknown>
}

/** 工具清单的唯一定义处（D-0042）。
 *  ★ **只有一个消费者：`plugin-ai`**。D-0084 把 MCP 改成进程外的只读 bin 之后，
 *  「`plugin-mcp` 也从这儿导出」那句**作废了** —— 它根本够不着 webview 里的 ctx。 */
export interface ToolsService {
  register(spec: ToolSpec): () => void
  list(): ToolSpec[]
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /**
   * 这条 assistant 消息要求调的**工具**。
   *
   * ★ 非空时它**必须**跟着回给模型：模型靠它知道自己上一轮提过什么，
   *   少了它就会**重复调同一个工具**（同一个回合里转圈转到轮数上限）。
   */
  toolCalls?: AiToolCall[]
  /** 这条工具结果对应**哪一次**调用（`role: 'tool'` 时必填）。
   *  一次回答可能同时提好几个调用，模型靠它对上号。 */
  toolCallId?: string
}

/** 模型要求调一次工具（D-0087）。`args` 是模型给的 JSON **字符串** ——
 *  流式下它是一段段拼起来的，所以别在中间解析；拼完了才发出来。 */
export interface AiToolCall {
  id: string
  name: string
  args: string
}

/** 流上一片。**只发这三种**：Rust 把 provider 的 SSE 归一化成它们，
 *  前端不解析 OpenAI 的原始形状（换 provider 不该动前端）。 */
export type AiChunk =
  | { type: 'text'; text: string }
  | { type: 'tool'; call: AiToolCall }
  /** `reason` = provider 给的结束原因（`stop` / `tool_calls` / `length`…）——
   *  循环据此决定还转不转下一轮，不自己猜。 */
  | { type: 'end'; reason: string }

/** 内置 agent（D-0042）。key 不出 Rust。 */
export interface AiService {
  ask(messages: AiMessage[], tools?: string[]): Promise<AsyncIterable<string>>
  /** 流式 + 工具调用（D-0087）。**工具的执行在前端**（`plugin-ai` 拿到 `call` 之后
   *  自己 `ctx.tools` 里找、自己 await），Rust 只负责把 HTTP 和 SSE 讲完。 */
  chat(messages: AiMessage[], tools?: ToolSpec[]): AsyncIterable<AiChunk>
}

/**
 * bug 现场包（D-0126）。**为什么走服务不走事件**：抓现场是「现在就问一遍在场的人」——
 * 事件是广播、收的人自己决定要不要理；这里是「谁有现场谁来供」，得有个注册点。
 *
 * ★ 判据（不变量）由**有现场的那一侧**判，这里只负责收：编辑器那边看 DOM 和模型，
 *   粘贴那边看块数 —— 它们把结论（`broken`）和现场（`provider`）喂进来。
 *   于是本插件不 import 任何人的内部文件，编辑器也不用知道现场包长什么样。
 */
export interface BugsService {
  /** 记一条进事件带（按键 / 粘贴 / 开关文档 / 撤销 / 落库）。环形，只留最近 N 条。 */
  event(what: string, detail?: string): void
  /** 不变量被破坏 —— 记一条事件**并且自动抓一份现场**。同一判据 5 秒内只抓一次。 */
  broken(kind: string, title: string, detail: string, facts?: Record<string, unknown>): void
  /** 手动抓一份现场（⌘⇧B / 命令面板）。`note` 是用户写的一句话。 */
  capture(note?: string): void
  /** 谁有现场谁来供：抓现场时按注册顺序问一遍，返回的东西并进 `facts`。 */
  provider(fn: () => Record<string, unknown> | Promise<Record<string, unknown>>): () => void
}

/* ─────────────────────────── 挂到 Cordis 的 Context 上 ─────────────────────────── */

// 这行看着多余，但 TS 的模块增强要求本文件先解析到 'cordis'，否则 TS2664。
import type {} from 'cordis'

// `slot` / `theme` / `i18n` 由 main.tsx 在任何插件之前 provide，inject 里写不写都能装载。
// 其余五个（rpc / docs / command / settings / editor）**必须 inject**：漏了就是永久 PENDING 且不报错（D-0045）。
declare module 'cordis' {
  interface Events {
    [CLOSE_TAB]: (payload: CloseTabEvent) => void
    [OPEN_DOC]: (payload: OpenDocEvent) => void
    [SPLIT_VIEW]: (payload: SplitViewEvent) => void
    [CLOSE_ALL]: () => void
    [SHOW_LIST]: (payload: ShowListEvent) => void
    [DOCS_CHANGED]: () => void
    [DOC_SAVED]: (payload: DocSavedEvent) => void
    [FILE_OPENED]: (payload: FileOpenedEvent) => void
  }
}

declare module 'cordis' {
  interface Context {
    rpc: RpcService
    docs: DocsService
    editor: EditorService
    slot: SlotService
    command: CommandService
    settings: SettingsService
    theme: ThemeService
    i18n: I18nService

    // 软依赖：ctx.get('vfs')。
    vfs?: VfsService
    bugs?: BugsService
    mem?: MemService
    comment?: CommentService
    version?: VersionService
    files?: FilesService
    webai?: WebAiService
    agent?: AgentService
    mascot?: MascotService
    tools?: ToolsService
    ai?: AiService
  }
}
