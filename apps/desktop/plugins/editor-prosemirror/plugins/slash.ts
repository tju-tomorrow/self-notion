/**
 * 斜杠菜单（P1-4）—— 自己写的 suggestion，不引 `@tiptap/suggestion`（架构 §4.3）。
 *
 * ★ 触发**不看 keydown 的时序**：每一笔事务后直接从文档里读光标前那段文字。
 *   中文输入法是「字先落、keydown 后到」（D-0126 的根因），读文档天然避开这一类；
 *   `view.composing` / composition 事件只用来「组字期间别动手（键别吞、菜单别重建）」，
 *   不参与「该不该弹」的判断。
 * ★ 这一层不认识 ctx / i18n（editor.ts 立的规矩）—— 文案写死在这里，块名保持英文（D-0089），
 *   中文和拼音走**别名**搜。组标题保持英文（D-0124）。
 * ★ 出口只有 `slashPlugin()`。样式在自己的 `slash.css.ts`（CONVENTIONS §6.2：不 import 外壳的）。
 * ★ 菜单挂在 `document.body` 上（fixed 定位）—— 挂在栏里会被 `.sn-pane-body` 的 overflow 裁掉。
 * ★ **接线时放进 `buildPlugins()` 得排在 `keymap(baseKeymap)` 前面**：PM 的 `handleKeyDown`
 *   按插件顺序取「第一个说处理了的」，排在 baseKeymap 后面的话回车会先去拆块，菜单选不中。
 */
import type { Node as PMNode, NodeType } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { allDocs, createDoc } from '../doc-meta'
import { newSrc } from '../sync'
import { emptyTableRows } from './table'
import './slash.css'
import './template-picker.css'

/* ─────────────────────────────── 菜单项 ─────────────────────────────── */

/**
 * 组标题保持英文（D-0124），顺序就是渲染顺序。
 * Media 现在空着 —— 图片要 blob 管线（P2）；**空组不画表头**，哪天加一条进来自然就出现。
 */
const GROUPS = [
  { id: 'basic', label: 'Basic' },
  { id: 'media', label: 'Media' },
  { id: 'advanced', label: 'Advanced' },
] as const

type GroupId = (typeof GROUPS)[number]['id']

interface SlashItem {
  readonly name: string
  readonly group: GroupId
  readonly hint: string
  /** 图标只用一个短字形 —— 不为几个图标引一套图标库（CONVENTIONS §6.7）。 */
  readonly icon: string
  /** 中文 / 拼音别名（D-0089）：名字不改，只让 `/待办` `/daiban` 也搜得到。 */
  readonly alias: readonly string[]
  /** 插哪个块。`type` 必须是 schema 里的节点名（那是持久化格式，不许改名）。 */
  readonly block: {
    readonly type: string
    readonly attrs?: Record<string, unknown>
    /** 内容得现造的块（表格）：给一份子节点。其余块交给 createAndFill 自动填。 */
    readonly content?: () => readonly PMNode[]
  }
  /** 「子页面」：先插一张空卡片（`docId` 空），再异步建文档把 id 回填（架构 §2.2.1 那条默认）。 */
  readonly page?: true
  /** 「同步块」：先插一个 `srcId` 空的节点，再异步建源把 id 回填（跟「子页面」同一套两拍）。 */
  readonly sync?: true
  /** 「模板按钮」：先插一个空节点，再弹选文档列表，选中后回填 `docId` + `label`（同一套两拍）。 */
  readonly template?: true
}

/** 能插的块就是 schema `blockContent` 那一组里能自己站住的那些（架构 §2.2）。 */
const ITEMS: readonly SlashItem[] = [
  {
    name: 'Page',
    group: 'basic',
    hint: 'Subpage',
    icon: '▤',
    block: { type: 'subpage' },
    page: true,
    alias: ['子页面', '页面', '子文档', '新建页面', 'ziyemian', 'yemian', 'ziwendang', 'page', 'subpage'],
  },
  {
    name: 'Text',
    group: 'basic',
    hint: 'Plain text',
    icon: '¶',
    block: { type: 'paragraph' },
    alias: ['正文', '文本', '段落', 'wenben', 'zhengwen', 'duanluo', 'paragraph'],
  },
  {
    name: 'Heading 1',
    group: 'basic',
    hint: 'Big heading',
    icon: 'H1',
    block: { type: 'heading', attrs: { level: 1 } },
    alias: ['一级标题', '标题一', '标题', 'biaoti', 'yijibiaoti', 'heading1'],
  },
  {
    name: 'Heading 2',
    group: 'basic',
    hint: 'Medium heading',
    icon: 'H2',
    block: { type: 'heading', attrs: { level: 2 } },
    alias: ['二级标题', '标题二', '标题', 'biaoti', 'erjibiaoti', 'heading2'],
  },
  {
    name: 'Heading 3',
    group: 'basic',
    hint: 'Small heading',
    icon: 'H3',
    block: { type: 'heading', attrs: { level: 3 } },
    alias: ['三级标题', '标题三', '标题', 'biaoti', 'sanjibiaoti', 'heading3'],
  },
  {
    name: 'To-do List',
    group: 'basic',
    hint: 'Track tasks',
    icon: '☐',
    block: { type: 'todoItem' },
    alias: [
      '待办',
      '待办列表',
      '任务',
      '任务列表',
      '清单',
      '复选框',
      'daiban',
      'renwu',
      'qingdan',
      'fuxuankuang',
      'to-do',
      'todo',
      'task',
      'checkbox',
    ],
  },
  {
    name: 'Bulleted List',
    group: 'basic',
    hint: 'Bulleted list',
    icon: '•',
    block: { type: 'bulletedListItem' },
    alias: ['圆点列表', '无序列表', '项目符号', '列表', 'liebiao', 'yuandian', 'wuxu', 'bullet'],
  },
  {
    name: 'Numbered List',
    group: 'basic',
    hint: 'Numbered list',
    icon: '1.',
    block: { type: 'numberedListItem' },
    alias: ['数字列表', '有序列表', '编号列表', '列表', 'liebiao', 'shuzi', 'youxu', 'number'],
  },
  {
    name: 'Toggle',
    group: 'advanced',
    hint: 'Collapsible',
    icon: '▸',
    block: { type: 'toggle' },
    alias: ['折叠', '折叠列表', '开关', 'zhedie', 'toggle', 'fold'],
  },
  {
    name: 'Quote',
    group: 'advanced',
    hint: 'Quote',
    icon: '❝',
    block: { type: 'quote' },
    alias: ['引用', '引述', 'yinyong', 'quote'],
  },
  {
    name: 'Divider',
    group: 'advanced',
    hint: 'Visual divider',
    icon: '—',
    block: { type: 'divider' },
    alias: ['分割线', '分隔线', '分界线', '横线', 'fengexian', 'hengxian', 'divider'],
  },
  {
    name: 'Code Block',
    group: 'advanced',
    hint: 'Code',
    icon: '<>',
    block: { type: 'codeBlock' },
    alias: ['代码块', '代码', 'daima', 'daimakuai', 'codeblock'],
  },
  {
    name: 'Callout',
    group: 'advanced',
    hint: 'Highlighted note',
    icon: '!',
    block: { type: 'callout', attrs: { icon: '💡' } },
    alias: ['标注', '提示', '高亮块', 'biaozhu', 'tishi', 'callout'],
  },
  {
    name: 'Table',
    group: 'advanced',
    hint: 'Simple table',
    icon: '▦',
    block: { type: 'table', content: () => emptyTableRows() },
    alias: ['表格', '表单', 'biaoge', 'table', 'grid'],
  },
  {
    name: 'Synced Block',
    group: 'advanced',
    hint: 'Same content everywhere',
    icon: '⇄',
    block: { type: 'syncedBlock' },
    sync: true,
    alias: ['同步块', '同步', '引用块', '复用', 'tongbukuai', 'tongbu', 'synced', 'sync'],
  },
  {
    name: 'Template Button',
    group: 'advanced',
    hint: 'Insert a page as template',
    icon: '⧉',
    block: { type: 'templateButton' },
    template: true,
    alias: ['模板', '模板按钮', '模版', '复用', 'muban', 'moban', 'template', 'templatebutton'],
  },
]

/* ─────────────────────────── 最近使用（D-0124） ─────────────────────────── */

/** key 跟旧实现一致 —— 换基座不丢这份记录。 */
const RECENT_KEY = 'self-notion:slash-recent'
const RECENT_MAX = 5

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    // 隐私模式读不了不是功能问题
    return []
  }
}

function rememberRecent(name: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...readRecent().filter((n) => n !== name)].slice(0, RECENT_MAX)))
  } catch {
    // 同上
  }
}

/** 记的是**名字**：块改名或卸掉之后查不到，那一格自动少一条，不用清库（D-0124）。 */
function recentItems(): SlashItem[] {
  const byName = new Map<string, SlashItem>(ITEMS.map((item) => [item.name, item]))
  return readRecent().flatMap((name) => {
    const item = byName.get(name)
    return item ? [item] : []
  })
}

/* ─────────────────────────────── 匹配 ─────────────────────────────── */

/** 触发符到光标那段的 inline decoration —— 也是「菜单绑在这段字上」的记号。 */
const HIT_CLASS = 'sn-slash-hit'

interface SlashMatch {
  /** 触发符在文档里的位置。 */
  readonly from: number
  /** 光标位置（query 的右端，不含）。 */
  readonly to: number
  readonly query: string
}

interface SlashState {
  readonly match: SlashMatch | null
}

/**
 * 从光标往前找触发符。半角 `/` **哪儿都算** —— 中文里打 `/` 前面不带空格，收紧了中文用户就
 * 呼不出来（D-0125 那一轮的教训）。全角 `／` 和顿号 `、` 只在块首算：顿号是中文的普通标点，
 * 句子中间每打一次就弹一次是纯打扰（D-0125）。
 */
function triggerIndex(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch !== '/' && ch !== '／' && ch !== '、') continue
    if (ch === '/' && text[i - 1] === '/') return -1 // `https://` 里那第二个
    if (ch !== '/' && text.slice(0, i).trim() !== '') return -1
    return i
  }
  return -1
}

function findMatch(state: EditorState): SlashMatch | null {
  const sel = state.selection
  if (!sel.empty) return null
  const $head = sel.$head
  const parent = $head.parent
  // 代码块里的 `/` 是字面量，不弹（BlockNote 同一条）。
  if (!$head.depth || !parent.isTextblock || parent.type.spec.code) return null
  if ($head.node($head.depth - 1).type.name !== 'blockContainer') return null
  const text = parent.textBetween(0, $head.parentOffset)
  const at = triggerIndex(text)
  if (at < 0) return null
  const query = text.slice(at + 1)
  // 打了空格就不是在搜块了（Tiptap 的 allowSpaces 默认也是关的）。
  if (/\s/.test(query)) return null
  return { from: $head.start($head.depth) + at, to: sel.from, query }
}

/** 名字 + 别名都过一遍。别名里的空格不参与比较，`dai ban` 和 `daiban` 都能中。 */
function hit(item: SlashItem, query: string): boolean {
  if (query === '') return true
  const q = query.toLowerCase()
  const flat = q.replace(/\s+/g, '')
  return [item.name, ...item.alias].some((h) => {
    const text = h.toLowerCase()
    return text.includes(q) || text.replace(/\s+/g, '').includes(flat)
  })
}

interface SlashGroup {
  readonly label: string
  readonly items: readonly SlashItem[]
}

/** 按组切好、顺手过滤掉搜不到的。query 为空时顶上叠一格「最近使用」（D-0124）。 */
function visibleGroups(query: string): SlashGroup[] {
  const q = query.trim().toLowerCase()
  const groups: SlashGroup[] = []
  if (q === '') {
    const recent = recentItems()
    if (recent.length) groups.push({ label: 'Recently Used', items: recent })
  }
  for (const g of GROUPS) {
    const items = ITEMS.filter((item) => item.group === g.id && hit(item, q))
    if (items.length) groups.push({ label: g.label, items })
  }
  return groups
}

/* ─────────────────────────────── 落块 ─────────────────────────────── */

/** 新块的 id（持久化格式的一部分，架构 §3.1）。editor.ts 那份同名同形 —— 这层不 import 编辑器。 */
function blockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 选中一条：删掉 `/query`，再走 BlockNote 那道分叉 —— **整块只有触发符就就地换型，前面还有字
 * 就在下面插一块新的**（那些字留着）。装不下光标的块（分割线）后面补一个空段落，光标落那儿，
 * 不然点完没地方打字。
 *
 * ★ 自带内容的块（表格）：`content` 那份子节点得现造，且**不能走 `setNodeMarkup`**（它做内容
 *   校验，空段落换成表格会直接抛）——改成 `replaceWith` 换掉那个空段落本身。
 */
function runItem(view: EditorView, match: SlashMatch, item: SlashItem): void {
  const state = view.state
  const schema = state.schema
  const type = schema.nodes[item.block.type] as NodeType | undefined
  const container = schema.nodes.blockContainer
  const paragraph = schema.nodes.paragraph
  if (!type || !container || !paragraph) return
  const block = type.createAndFill(item.block.attrs, item.block.content?.())
  if (!block) return

  const $head = state.selection.$head
  if ($head.depth < 2) return
  const textAfter = $head.parent.textBetween($head.parentOffset, $head.parent.content.size)
  const onlySlash = match.from === $head.start($head.depth) && textAfter === ''
  const tail = block.isTextblock ? null : paragraph.createAndFill()
  if (!block.isTextblock && !tail) return

  const tr = state.tr
  tr.delete(match.from, match.to)

  let start: number
  let tailStart: number | null = null
  // 「子页面」「同步块」回填要知道插到了哪个块里 —— 记下那个 blockContainer 的 id，异步完成后按 id 找回来。
  let hostId = ''
  if (onlySlash) {
    const at = tr.mapping.map($head.before($head.depth))
    if (item.block.content) tr.replaceWith(at, tr.mapping.map($head.after($head.depth)), block)
    else tr.setNodeMarkup(at, type, item.block.attrs)
    start = at
    hostId = String($head.node($head.depth - 1).attrs.id ?? '')
    if (tail) {
      tailStart = at + block.nodeSize
      tr.insert(tailStart, container.create({ id: blockId() }, tail))
    }
  } else {
    const at = tr.mapping.map($head.after($head.depth - 1))
    const freshId = blockId()
    const fresh = container.create({ id: freshId }, block)
    tr.insert(at, fresh)
    start = at + 1
    hostId = freshId
    if (tail) {
      tailStart = at + fresh.nodeSize
      tr.insert(tailStart, container.create({ id: blockId() }, tail))
    }
  }

  // 块内部能落光标（表格的第一格）就进去，否则落到下面那个空段落里。
  const inner = firstTextPos(tr.doc, start, start + block.nodeSize)
  const cursor = inner ?? (tailStart !== null ? tailStart + 2 : start + 1)

  tr.setSelection(TextSelection.near(tr.doc.resolve(cursor), 1))
  tr.scrollIntoView()
  view.dispatch(tr)
  view.focus()

  if (item.page && hostId) void fillSubpage(view, hostId)
  if (item.sync && hostId) void fillSync(view, hostId)
  if (item.template && hostId) openTemplatePicker(view, hostId)
}

/** 本页的 docId —— 编辑区（含祖先）上挂的 `data-doc-id`（`editor.ts` 挂的）。拿不到就空串。 */
function currentDocId(view: EditorView): string {
  let el: HTMLElement | null = view.dom
  while (el) {
    const id = el.dataset.docId
    if (id) return id
    el = el.parentElement
  }
  return ''
}

/**
 * 子页面的两拍：先插入的那张卡片 `docId` 是空的（占位「子页面」），建完文档再回填。
 * 建文档是异步的（走 rpc），所以回填按 blockContainer 的 id 找回位置 —— 期间被撤销 / 删掉就跳过。
 */
async function fillSubpage(view: EditorView, containerId: string): Promise<void> {
  try {
    const docId = await createDoc('', currentDocId(view) || null)
    const at = firstContentPos(view.state.doc, containerId)
    if (at === null) return
    view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { docId }))
  } catch (err) {
    reportError('slash', err)
  }
}

/**
 * 同步块的两拍：先插 `srcId` 空的节点，建完源再回填（跟子页面同一套）。
 * 建源是异步的（走 rpc），按 blockContainer 的 id 找回位置 —— 期间被撤销 / 删掉就跳过。
 */
async function fillSync(view: EditorView, containerId: string): Promise<void> {
  try {
    const srcId = await newSrc()
    const at = firstContentPos(view.state.doc, containerId)
    if (at === null) return
    view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { srcId }))
  } catch (err) {
    reportError('slash', err)
  }
}

/** 按 blockContainer 的 id 找它内容的位置（区块内第一个子节点）—— 子页面卡片 / 同步块节点都在那儿。 */
function firstContentPos(doc: PMNode, containerId: string): number | null {
  if (!containerId) return null
  let at: number | null = null
  doc.descendants((node, pos) => {
    if (at !== null) return false
    if (node.type.name === 'blockContainer' && node.attrs.id === containerId) {
      at = pos + 1
      return false
    }
    return true
  })
  return at
}

/** 块里第一个能落光标的文字位置（绝对 doc 位置）——表格的第一格能，分割线不能（返回 null）。 */
function firstTextPos(doc: PMNode, from: number, to: number): number | null {
  let at: number | null = null
  doc.nodesBetween(from, to, (node, pos) => {
    if (at !== null) return false
    if (node.isTextblock) {
      at = pos + 1
      return false
    }
    return true
  })
  return at
}

/* ─────────────────────── 模板按钮：选文档那一拍 ─────────────────────── */

/** 候选 = 库里的文档元数据。类型从 `allDocs` 反推 —— 这层不 import contract。 */
type Doc = ReturnType<typeof allDocs>[number]

/** 一次最多列几条。 ponytail: 全量线性过滤；几千篇以上再换索引。 */
const PICK_LIMIT = 12

const PICK_NO_MATCH = '没有匹配的页面'

/** 一个 EditorView 一份（再开就关掉上一份）。 */
const pickers = new WeakMap<EditorView, TemplatePicker>()

/**
 * 模板按钮的第二拍：第一拍已经插了个空 `templateButton`，这一拍弹一个选文档的小列表，
 * 选中后按 blockContainer 的 id 找回节点、把 `docId` + `label` 回填（跟 `fillSubpage` 同一套）。
 */
function openTemplatePicker(view: EditorView, containerId: string): void {
  pickers.get(view)?.close()
  const picker = new TemplatePicker(view, view.state.selection.from, (docId) => {
    const at = firstContentPos(view.state.doc, containerId)
    // `label` 留空：按钮上的字永远现查那篇的标题 —— 模板改了名，按钮上的字跟着变。
    if (at !== null) view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { docId }))
    view.focus()
  })
  pickers.set(view, picker)
}

class TemplatePicker {
  private readonly el: HTMLDivElement
  private readonly input: HTMLInputElement
  private readonly list: HTMLDivElement
  private items: Doc[] = []
  private rows: HTMLDivElement[] = []
  private index = 0
  private readonly off: (() => void)[] = []

  constructor(
    private readonly view: EditorView,
    private readonly anchor: number,
    private readonly pick: (docId: string) => void,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'sn-template-pick'
    this.el.setAttribute('role', 'dialog')

    this.input = document.createElement('input')
    this.input.className = 'sn-template-pick-input'
    this.input.type = 'text'
    this.input.placeholder = '选一个模板…'
    this.list = document.createElement('div')
    this.list.className = 'sn-template-pick-list'
    this.el.append(this.input, this.list)
    document.body.appendChild(this.el)

    this.input.addEventListener('input', () => this.paint(this.input.value))
    this.input.addEventListener('keydown', (e) => this.key(e))
    // 点别处关掉（点自己不算）；捕获阶段先跑，判在不在自身里。
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !this.el.contains(e.target)) this.close()
    }
    const reposition = () => this.reposition()
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    this.off.push(() => document.removeEventListener('mousedown', onDown, true))
    this.off.push(() => document.removeEventListener('scroll', reposition, true))
    this.off.push(() => window.removeEventListener('resize', reposition))

    this.paint('')
    this.reposition()
    this.input.focus()
  }

  /** 按标题过滤，按库里的顺序取前 PICK_LIMIT 条。query 空 = 全给。 */
  private candidates(query: string): Doc[] {
    const q = query.trim().toLowerCase()
    const out: Doc[] = []
    for (const meta of allDocs()) {
      if (q && !(meta.title || '').toLowerCase().includes(q)) continue
      out.push(meta)
      if (out.length >= PICK_LIMIT) break
    }
    return out
  }

  private paint(query: string): void {
    this.items = this.candidates(query)
    this.index = 0
    this.rows = []
    const frag = document.createDocumentFragment()
    if (this.items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sn-template-pick-none'
      empty.textContent = PICK_NO_MATCH
      frag.appendChild(empty)
    } else {
      this.items.forEach((meta) => frag.appendChild(this.row(meta, this.rows.length)))
    }
    this.list.replaceChildren(frag)
    this.paintIndex()
  }

  private row(meta: Doc, at: number): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'sn-template-pick-row'
    row.setAttribute('role', 'option')
    const icon = document.createElement('span')
    icon.className = 'sn-template-pick-ico'
    icon.textContent = meta.icon || '📄'
    const title = document.createElement('span')
    title.className = 'sn-template-pick-title'
    title.textContent = meta.title || '无标题'
    row.append(icon, title)
    row.addEventListener('mouseenter', () => {
      this.index = at
      this.paintIndex()
    })
    // mousedown 别让输入框失焦（点行还是能点到的 —— 上面那层 onDown 判过在自身里）。
    row.addEventListener('mousedown', (e) => e.preventDefault())
    row.addEventListener('click', () => this.choose(at))
    this.rows.push(row)
    return row
  }

  private paintIndex(): void {
    this.rows.forEach((row, at) => row.setAttribute('aria-selected', String(at === this.index)))
    this.rows[this.index]?.scrollIntoView({ block: 'nearest' })
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      this.move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      this.move(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      this.choose(this.index)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      this.close()
    }
  }

  private move(step: number): void {
    const n = this.items.length
    if (n === 0) return
    this.index = (this.index + step + n) % n
    this.paintIndex()
  }

  private choose(at: number): void {
    const meta = this.items[at]
    if (!meta) return
    this.close()
    this.pick(meta.id)
  }

  private reposition(): void {
    const pos = Math.min(this.anchor, this.view.state.doc.content.size)
    const at = this.view.coordsAtPos(pos)
    const box = this.el.getBoundingClientRect()
    const left = Math.max(8, Math.min(at.left, window.innerWidth - box.width - 8))
    const below = at.bottom + 4
    const top = below + box.height > window.innerHeight - 8 ? at.top - box.height - 4 : below
    this.el.style.left = `${left}px`
    this.el.style.top = `${Math.max(8, top)}px`
  }

  close(): void {
    for (const fn of this.off) fn()
    this.off.length = 0
    this.el.remove()
    if (pickers.get(this.view) === this) pickers.delete(this.view)
  }
}

/* ─────────────────────────────── 菜单 ─────────────────────────────── */

const key = new PluginKey<SlashState>('sn-slash')

/** 一个 EditorView 一份菜单（并排三栏时各弹各的）。 */
const menus = new WeakMap<EditorView, SlashMenu>()

/** 一条都搜不到时留在菜单里那句。 */
const NO_MATCH = '没有匹配的块'

class SlashMenu {
  private readonly el: HTMLDivElement
  /** 当前可见的条目，**按渲染顺序**（含「最近使用」的克隆）—— 上下键和回车都按这个数组走。 */
  private items: SlashItem[] = []
  private rows: HTMLDivElement[] = []
  private index = 0
  /** 上次渲染的指纹：换了 match 才重建，否则只挪位置（不然每敲一个字滚动位置就跳回顶上）。 */
  private sig = ''
  private match: SlashMatch | null = null
  private composing = false
  private shown = false
  /** Esc 关掉的那条触发符位置 —— 换了触发符才肯再开（D-0124 的「Esc 后留在正文里」一个道理）。 */
  private dismissed = -1
  private readonly off: (() => void)[] = []

  constructor(private readonly view: EditorView) {
    this.el = document.createElement('div')
    this.el.className = 'sn-slash'
    this.el.setAttribute('role', 'listbox')
    this.el.style.display = 'none'
    // 点菜单别把编辑器的焦点抢走（抢走 = blur = 菜单当场收起来，还点不动）。
    this.el.addEventListener('mousedown', (e) => e.preventDefault())
    document.body.appendChild(this.el)

    this.listen(this.view.dom, 'compositionstart', () => {
      this.composing = true
    })
    this.listen(this.view.dom, 'compositionend', () => {
      this.composing = false
      // 提交之后 PM 一般会补一笔事务；万一没有（有些输入法直接改 DOM），这儿兜一次。
      this.sig = ''
      queueMicrotask(() => this.sync())
    })
    // 菜单是 fixed 的：栏里一滚它就跟不上光标了 —— 滚的时候重新算（捕获，滚动事件不冒泡）。
    this.listen(document, 'scroll', () => this.reposition(), true)
    this.listen(window, 'resize', () => this.reposition())
  }

  private listen(target: EventTarget, type: string, fn: EventListener, capture = false): void {
    target.addEventListener(type, fn, capture)
    this.off.push(() => target.removeEventListener(type, fn, capture))
  }

  /** 每笔事务后过一遍：重建 / 挪位置 / 收起来。 */
  sync(): void {
    const match = key.getState(this.view.state)?.match ?? null
    // 组字期间不动：preedit 还没进 PM 的 state，重建只会把上一次的结果闪一下（提交后自会补事务）。
    if (this.composing || this.view.composing) return
    // 触发符没了就把 Esc 那条记忆清掉 —— 不然同一个位置再打一个 `/` 也弹不出来。
    if (!match) {
      this.dismissed = -1
      return this.hide()
    }
    if (match.from === this.dismissed) return this.hide()
    const sig = `${match.from}:${match.to}:${match.query}`
    if (sig === this.sig) return this.reposition()
    this.sig = sig
    this.match = match
    this.index = 0
    this.paint(match)
  }

  private paint(match: SlashMatch): void {
    const groups = visibleGroups(match.query)
    this.items = groups.flatMap((g) => [...g.items])
    this.rows = []
    const frag = document.createDocumentFragment()
    for (const group of groups) {
      const box = document.createElement('div')
      box.className = 'sn-slash-group'
      const label = document.createElement('div')
      label.className = 'sn-slash-label'
      label.textContent = group.label
      box.appendChild(label)
      for (const item of group.items) box.appendChild(this.row(item, this.rows.length))
      frag.appendChild(box)
    }
    if (this.rows.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sn-slash-none'
      empty.textContent = NO_MATCH
      frag.appendChild(empty)
    }
    this.el.replaceChildren(frag)
    this.shown = true
    this.el.style.display = 'block'
    this.paintIndex()
    this.reposition()
  }

  private row(item: SlashItem, at: number): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'sn-slash-item'
    row.setAttribute('role', 'option')
    const icon = document.createElement('span')
    icon.className = 'sn-slash-ico'
    icon.textContent = item.icon
    const name = document.createElement('span')
    name.className = 'sn-slash-name'
    name.textContent = item.name
    const hint = document.createElement('span')
    hint.className = 'sn-slash-hint'
    hint.textContent = item.hint
    row.append(icon, name, hint)
    row.addEventListener('mouseenter', () => {
      this.index = at
      this.paintIndex()
    })
    // 用 click 不用 mousedown：mousedown 被上面 preventDefault 了（保焦点）。
    row.addEventListener('click', () => this.pick(at))
    this.rows.push(row)
    return row
  }

  private paintIndex(): void {
    this.rows.forEach((row, at) => row.setAttribute('aria-selected', String(at === this.index)))
    this.rows[this.index]?.scrollIntoView({ block: 'nearest' })
  }

  private reposition(): void {
    if (!this.shown || !this.match) return
    const at = this.view.coordsAtPos(this.match.from)
    const box = this.el.getBoundingClientRect()
    // 右边/下边顶出去就往回收，下面放不下就翻到光标上面。
    const left = Math.max(8, Math.min(at.left, window.innerWidth - box.width - 8))
    const below = at.bottom + 4
    const top = below + box.height > window.innerHeight - 8 ? at.top - box.height - 4 : below
    this.el.style.left = `${left}px`
    this.el.style.top = `${Math.max(8, top)}px`
  }

  hide(): void {
    if (!this.shown) return
    this.shown = false
    this.sig = ''
    this.match = null
    this.items = []
    this.rows = []
    this.el.style.display = 'none'
  }

  /**
   * 上 / 下 / 回车 / Esc。**没弹菜单、或者正组字，一律不碰** —— 返回 false 让键照常走。
   * 组字那一下尤其不能吞：回车是「确认这个字」，吞了就把拼音当成选块了（D-0126 那条路的另一半）。
   */
  key(event: KeyboardEvent): boolean {
    if (this.composing || this.view.composing || event.isComposing) return false
    if (!this.shown || this.items.length === 0) return false
    switch (event.key) {
      case 'ArrowDown':
        this.move(1)
        return true
      case 'ArrowUp':
        this.move(-1)
        return true
      case 'Enter':
        this.pick(this.index)
        return true
      case 'Escape':
        if (this.match) this.dismissed = this.match.from
        this.hide()
        return true
      default:
        return false
    }
  }

  private move(step: number): void {
    const n = this.items.length
    this.index = (this.index + step + n) % n
    this.paintIndex()
  }

  private pick(at: number): void {
    const item = this.items[at]
    if (!item || !this.match) return
    const match = this.match
    this.hide()
    rememberRecent(item.name)
    runItem(this.view, match, item)
  }

  destroy(): void {
    for (const off of this.off) off()
    this.off.length = 0
    this.el.remove()
  }
}

/* ─────────────────────────────── 插件 ─────────────────────────────── */

export function slashPlugin(): Plugin {
  return new Plugin<SlashState>({
    key,
    state: {
      init: (_config, state) => ({ match: findMatch(state) }),
      // 每笔事务重算：从文档里现读，不用 map 追位置（块被删掉 / 撤销这类事就不用管了）。
      apply: (_tr, _prev, _old, next) => ({ match: findMatch(next) }),
    },
    props: {
      decorations(state) {
        const match = key.getState(state)?.match
        if (!match) return null
        return DecorationSet.create(state.doc, [
          Decoration.inline(match.from, match.to, { class: HIT_CLASS }),
        ])
      },
      handleKeyDown(view, event) {
        return menus.get(view)?.key(event) ?? false
      },
      handleDOMEvents: {
        // 焦点走了（点别处）就收起来；回到编辑器里下一次事务会再弹。
        blur(view) {
          menus.get(view)?.hide()
          return false
        },
      },
    },
    view(editorView) {
      const menu = new SlashMenu(editorView)
      menus.set(editorView, menu)
      return {
        update: () => menu.sync(),
        destroy: () => {
          menu.destroy()
          // 编辑器拆掉时把还开着的「选模板」列表也收了 —— 不然它赖在 body 上。
          pickers.get(editorView)?.close()
          menus.delete(editorView)
        },
      }
    },
  })
}
