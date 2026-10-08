/**
 * 编辑器本体 —— 挂载、建 ProseMirror 的 `EditorView`、串插件。`index.ts` 懒 import 它。
 *
 * P1 的范围：schema 全量 + Notion 语义的编辑交互（`commands/`）+ 手柄与拖拽（`plugins/block-handle`）
 * + 斜杠菜单（`plugins/slash`）+ 输入规则与行内工具栏（`plugins/input-rules` / `inline-toolbar`）
 * + 查找替换（`find`）。块级多选的机制在 `plugins/block-selection`。
 */
import { baseKeymap } from 'prosemirror-commands'
import { dropCursor } from 'prosemirror-dropcursor'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, Selection, type Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

import type {
  CommentState,
  CommentTarget,
  DocsService,
  DocMem,
} from '../../src/kernel/contract'
import { filePathOf } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { renderBacklinks, type BacklinksView } from './backlinks'
import { commentApi, type CommentHooks } from './comment'
import { newBlockId, notionKeymap } from './commands'
import { firstTextPos } from './commands/block'
import { metaOf } from './doc-meta'
import { docsBacking, type DocPayload, type DocsBacking } from './doc-source'
import { createFindApi, findPlugin, type FindApi } from './find'
import { nodeViews } from './nodes'
import { outlinePlugin } from './outline'
import { renderPageHead, type PageHead } from './page-head'
import { metaPlugin } from './page-meta'
import { blockHandlePlugin } from './plugins/block-handle'
import { blankDragPlugin } from './plugins/block-selection'
import { inlineToolbarPlugin } from './plugins/inline-toolbar'
import { inputRulesPlugin } from './plugins/input-rules'
import { mentionPlugin } from './plugins/mention'
import { pastePlugin } from './plugins/paste'
import { slashPlugin } from './plugins/slash'
import { tablePlugin } from './plugins/table'
import { sanitizePlugin, stripBad } from './sanitize'
import { schema } from './schema'
import { docFromRaw, docToMarkdown, docToMarkdownFidelity, type SideEntry } from './serializers/markdown'
import { docLinks } from './serializers/links'

/** 落库节流窗口，跟外壳那条一致（CONVENTIONS §4）。 */
const SAVE_MS = 300

export interface EditorHandle {
  unmount(): void
}

/** `index.ts` 装载时接进来的线 —— 编辑器这层不认识 ctx / i18n。 */
export interface EditorWiring {
  /** 落库成功 → 外壳发 `DOC_SAVED`（顶栏据此显示「已保存」）。 */
  saved(docId: string): void
  /** **标题变过**了 → 外壳发 `DOCS_CHANGED`：库里的名字变了，标签条 / 侧栏 / 面包屑要重取。
   *  存盘不广播的话，列表永远停在旧名字上（用户 2026-10-08：「不同步了又」）。 */
  docsChanged(): void
  /** 往评论插件去的两个口子（形状在 `comment.ts`）—— 编辑器这一层不认识 `ctx`。 */
  comment: CommentHooks
  /** 标题输入框的占位（走 i18n）。 */
  untitled: string
  /** 右侧大纲：按钮的 title、空态那句。 */
  outline: string
  outlineEmpty: string
  /** 标题下那行：`创建于 {time}` · `{count} 字`。 */
  createdAt: string
  words: string
}

export interface Live {
  readonly id: string
  readonly view: EditorView
  readonly titleEl: HTMLInputElement
  readonly head: PageHead
  readonly backlinks: BacklinksView
  /** 标题下那行（创建时间 · 字数）—— 它不是 NodeView，得自己摘。 */
  readonly meta: HTMLElement
  dirty: boolean
  /** 重读（`reload`）期间落库闸门关上 —— 手里那份是**恢复前**的状态，落一次就把库盖回去。 */
  muted: boolean
  timer: number | undefined
  /** 外部文件那条路的 side table（每块原文 + 打开时的快照）；库文档是 `null`（D-0142）。 */
  side: Map<string, SideEntry> | null
}

/** 文件模式下不建的那几个 UI（页头 / 反链）拿它顶位 —— 形状对就行，什么都不画。 */
function noopView(): { el: HTMLElement; destroy(): void } {
  return { el: document.createElement('div'), destroy: (): void => {} }
}

let backing: DocsBacking | undefined
let wiring: EditorWiring | undefined

const live = new Map<string, Live>()

export function connectDocs(docs: DocsService, lines: EditorWiring): void {
  backing = docsBacking(docs)
  wiring = lines
  // 评论的 hooks 要从 `ctx.get('comment')` 来 —— 只有 wiring 这一条线能把它们带进来。
  comments = commentApi(() => currentView(), lines.comment)
}

function need(): DocsBacking {
  if (!backing) throw new Error('编辑器还没接上 ctx.docs —— 要先 await ctx.editor.ready()')
  return backing
}

/** 库里还没这一篇时造的空文档 —— 一个空的段落块。 */
function emptyDocJson(): unknown {
  return {
    type: 'doc',
    attrs: { title: '' },
    content: [
      {
        type: 'blockGroup',
        content: [
          { type: 'blockContainer', attrs: { id: newBlockId() }, content: [{ type: 'paragraph' }] },
        ],
      },
    ],
  }
}

/** 库里的字节 → PM 的 doc。坏字节（手改库之类）降级成一篇空的，别让编辑器挂不起来。 */
function parseDoc(raw: string | null): PMNode {
  if (raw !== null) {
    try {
      return schema.nodeFromJSON(JSON.parse(raw))
    } catch (err) {
      reportError('editor-prosemirror', err)
    }
  }
  return schema.nodeFromJSON(emptyDocJson())
}

function buildPlugins(parts: {
  body: HTMLElement
  meta: HTMLElement
  side: HTMLElement | undefined
  docId: string
  file: boolean
}): Plugin[] {
  const plugins: Plugin[] = [
    history(),
    keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
    // ★ 顺序是规矩：`slash` 和 `notionKeymap` 都排在 `baseKeymap` **之前** —— PM 的 handleKeyDown
    //   取「第一个说处理了的」插件。菜单开着时 Enter / ↑↓ 归斜杠；没开就落到 Notion 语义；
    //   再认不出才回 baseKeymap。
    slashPlugin(),
    // `@` 提及（跟斜杠同一套 suggestion，触发符换成 `@`）—— 同样要排在 keymap 之前。
    mentionPlugin(),
    // ★ 表格必须在 notionKeymap **之前**：`tableEditing` 靠 handleKeyDown 接管表格内的方向键和
    //   Backspace（删单元格选区），排在后面会被 notionKeymap 的 backspace 先吃掉。
    tablePlugin(),
    keymap(notionKeymap),
    inputRulesPlugin(),
    // 工具条那颗「评论」→ 把量好的选区交给评论插件（D-0079）。软依赖，没接上就不建那颗按钮。
    // ★ 文件模式**也不建**：锚点按 docId 写进 `comment` 表，而外部文件不进库（D-0140）。
    inlineToolbarPlugin(parts.file ? undefined : (at) => wiring?.comment.selection(at)),
    blockHandlePlugin(),
    // 空白处按住拖动 → 划过的块一串选上（跟手柄的 ⇧ 点是同一套块选区）。
    blankDragPlugin(),
    // 粘贴：只接管「剪贴板里有文件」（图片 / 附件），纯文本 / HTML / 块一律交回 PM。
    pastePlugin(),
    // 拖拽的落点线。不装就没那条线（拖拽本身照样能用）。
    dropCursor({ color: 'var(--sn-accent, #1e96eb)', width: 2 }),
    findPlugin, // 查找命中的高亮（decoration）
    // 标题下那行（创建时间 · 字数）。现算的投影，跟着 doc 变。
    metaPlugin(parts.meta, parts.docId, {
      createdAt: wiring?.createdAt ?? '{time}',
      words: wiring?.words ?? '{count}',
    }),
    // 控制符清洗：那种字符不是任何人写的，是从 DOM 那侧进来的 —— 只守结果（见 sanitize.ts）。
    sanitizePlugin(),
    keymap(baseKeymap),
  ]
  // 右侧大纲那一列。★ 只有走栏位（`view.ts`）挂载时才有这一列；契约里那条 `mount()` 没有。
  if (parts.side) {
    plugins.push(
      outlinePlugin(parts.side, parts.body, {
        label: wiring?.outline ?? '大纲',
        empty: wiring?.outlineEmpty ?? '',
        untitled: wiring?.untitled ?? '',
      }),
    )
  }
  return plugins
}

/** @param side 栏右侧那一列（大纲）。不给就没有大纲 —— 契约 `mount()` 那条口子给不出这一列。 */
export async function mountEditor(el: HTMLElement, docId: string, side?: HTMLElement): Promise<EditorHandle> {
  const handle = await need().hydrate(docId)
  // `raw` 非空 = 外部文件那条路：**自己解析**（顺带建 side table），保存时走保真序列化（D-0142）。
  const raw = handle.raw
  const parsed = raw !== undefined ? docFromRaw(raw) : null
  const file = parsed !== null
  const doc = parsed ? parsed.doc : parseDoc(handle.content)

  dispose(live.get(docId))
  el.replaceChildren()
  // 面包屑块要知道「本页是谁」——它从 `view.dom` 往上找这个属性（每栏的 `el` 各带各的，
  // 多栏并存时比一个「当前文档」的全局更准）。
  el.dataset.docId = docId

  // 页头（封面 + 图标）在标题之上。图标只读（改它走外壳的 ⋯ 菜单），封面归编辑器。
  // ★ 文件模式整块不出现：封面 / 图标是**文档级**的，markdown 里没有它们，写进去也是丢（D-0140）。
  let view: EditorView | undefined
  const head: PageHead = file
    ? noopView()
    : renderPageHead(
        docId,
        () => String(doc.attrs.cover ?? ''),
        (blobId) => view?.dispatch(view.state.tr.setDocAttribute('cover', blobId)),
      )
  if (!file) el.appendChild(head.el)

  /**
   * ★ 库里有名字、正文里还没有 → **以库为准**（跟 `applyTitle` 同一条规矩，D-0073）。
   *
   * 少了这一句就是真事（2026-10-08 实撞）：改名只写库（`doc:rename`），正文顶上那个标题一直空着
   * 显示占位符；**下一次落库把空标题又写回库**（`store/docs.rs` 的 reindex 照写空串），
   * 库里的名字就没了 —— 而存盘不发 `DOCS_CHANGED`，界面靠内存还挂着旧名字，
   * 看着就是「标签叫 Agent题目、正文写着未命名」这种两处不一致。
   * 原来只有 `DOCS_CHANGED` 那一刻会灌（`applyTitle`），**打开一篇早就改过名的文档时没人灌**。
   */
  const libraryTitle = file ? '' : stripBad((metaOf(docId)?.title ?? '').trim())
  const adoptTitle = String(doc.attrs.title ?? '') ? '' : libraryTitle

  // 标题是 doc 的 attr、不进 block 树（架构 §3.3）—— P0 用一个输入框读写它。
  const titleEl = document.createElement('input')
  titleEl.type = 'text'
  titleEl.className = 'sn-pm-title'
  titleEl.placeholder = wiring?.untitled ?? ''
  if (file) {
    // 文件模式标题 = 磁盘上的文件名，**键进去改名 v1 不做**（改名 = 换路径 = 换标签 id）—— 只读、也不回写库。
    titleEl.readOnly = true
    titleEl.value = filePathOf(docId)?.split('/').pop() ?? ''
  } else {
    // 库里那份也可能是干净的旧值 + 正文里混进来的控制符（老版本写的 / 别处灌的），进框之前先清。
    titleEl.value = stripBad(String(doc.attrs.title ?? '')) || adoptTitle
  }
  el.appendChild(titleEl)

  // 标题下那行（创建时间 · 字数，图 3）。★ 必须在建 view **之前** append —— ProseMirror 是把自己
  // 的 DOM 追加到 `el` 末尾的，晚一步这行就跑到正文下面去了。
  const metaEl = document.createElement('div')
  metaEl.className = 'sn-page-meta'
  el.appendChild(metaEl)

  view = new EditorView(el, {
    state: EditorState.create({ doc, plugins: buildPlugins({ body: el, meta: metaEl, side, docId, file }) }),
    nodeViews,
    dispatchTransaction(tr) {
      view!.updateState(view!.state.apply(tr))
      if (tr.docChanged) markDirty(docId)
    },
  })

  // 采用的那一份得真的进 doc：落库送的是 `doc.attrs.title`，只改输入框的话下一次落库还是空串。
  if (adoptTitle) view.dispatch(view.state.tr.setDocAttribute('title', adoptTitle))

  // 正文之后：反向链接（谁提到了这一篇）。**现算**的，不进 doc。
  // ★ 文件模式不取（`link:backlinks` 是按库里的 docId 算的，外部文件不进图谱，D-0140）。
  const backlinks = file ? noopView() : renderBacklinks(docId)
  if (!file) el.appendChild(backlinks.el)

  const rec: Live = {
    id: docId,
    view,
    titleEl,
    head,
    backlinks,
    meta: metaEl,
    dirty: false,
    muted: false,
    timer: undefined,
    side: parsed ? parsed.side : null,
  }
  live.set(docId, rec)

  // 文件模式不回写标题（只读，见上）—— 库文档才双向同步。
  if (!file) {
    /**
     * 标题是 `input`、不归 PM 管：`sanitize.ts` 只清得掉**模型**那一份，清不掉这个框里的字
     * —— 缺字方框就留在框里（正文不显示，是因为 PM 拿清过的模型重绘了它）。
     * 所以这儿也清一遍、**并写回框里**：显示的、落库的、光标前的那三份得同时是清过的那份。
     */
    const syncTitle = (midComposition: boolean): void => {
      const raw = titleEl.value
      const clean = stripBad(raw)
      // 输入法合成中不改框里的值 —— 改写 `value` 会打断输入法，等合完那一下再清。
      if (clean !== raw && !midComposition) {
        const caret = stripBad(raw.slice(0, titleEl.selectionStart ?? raw.length)).length
        titleEl.value = clean
        titleEl.setSelectionRange(caret, caret)
      }
      view.dispatch(view.state.tr.setDocAttribute('title', clean))
    }
    titleEl.addEventListener('input', (e) => syncTitle((e as InputEvent).isComposing))
    titleEl.addEventListener('compositionend', () => syncTitle(false))
  }

  // 标题里按 ⏎ → 落到正文第一行（Notion 的规矩）。★ 标题是个 `input`、不归 PM 管，
  //   PM 收不到它的 keydown —— 不自己接这一下就什么都不发生。
  titleEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const doc = view.state.doc
    // 整篇第一个能落光标的文字位置；一个都没有（满篇分割线那种）就落在第一块前面。
    const at = firstTextPos(doc, 0, doc.content.size) ?? 1
    view.dispatch(view.state.tr.setSelection(Selection.near(doc.resolve(at), 1)).scrollIntoView())
    view.focus()
  })

  return {
    unmount: () => dispose(live.get(docId)),
  }
}

function dispose(rec: Live | undefined): void {
  if (!rec) return
  live.delete(rec.id)
  if (rec.timer !== undefined) clearTimeout(rec.timer)
  rec.head.destroy()
  rec.backlinks.destroy()
  rec.view.destroy()
  rec.titleEl.remove()
  sentTitle.delete(rec.id)
  rec.meta.remove()
}

/** 判据（`diagnose.ts`）要看的那几样 —— 只暴露这些，`titleEl` / 定时器那些不外传。 */
export interface LiveDoc {
  readonly id: string
  readonly view: EditorView
  readonly dirty: boolean
  readonly muted: boolean
}

/** 活文档一览 —— 判据要看「谁开着、谁还没落库」。 */
export function liveDocs(): readonly LiveDoc[] {
  return [...live.values()].map((rec) => ({
    id: rec.id,
    view: rec.view,
    dirty: rec.dirty,
    muted: rec.muted,
  }))
}

/**
 * 库里的名字**改到正文顶上那个大标题**（旧插件的 `applyTitle`）。
 *
 * ★ 为什么必须有：标题两边各有一份（`documents.title` 是给侧栏 / 搜索看的，`doc.attrs.title`
 *   是正文顶上那个可编辑的）。别的入口（侧栏重命名 / 导入 / 助手）改的是**库里那份** ——
 *   不同步回来，下一次落库就把新名字用旧的那份盖回去。
 */
export function applyTitle(id: string, title: string): void {
  const rec = live.get(id)
  if (!rec || rec.muted) return
  const mine = String(rec.view.state.doc.attrs.title ?? '')
  /**
   * ★ **空的不覆盖非空**：库里空、正文里有 —— 这是「刚打进去还没落库」（落库有 300ms 防抖），
   *   不是「用户把名字删了」。这会儿照写，用户看到的就是**打完字自己没了**，也就是
   *   「编辑不了标题」（2026-10-08 实撞）。用户真想清空时两边都是空的，这条不拦。
   */
  if (!title && mine) return
  // 库里那份也过一遍：别处（导入 / 助手 / 手改过的库）灌进来的控制符，不该从这儿回到框里。
  const clean = stripBad(title)
  if (mine === clean) return
  rec.titleEl.value = clean
  rec.view.dispatch(rec.view.state.tr.setDocAttribute('title', clean))
}

/** 丢掉某一篇手里的活编辑器（`reload` 前先丢，再照库里那份重建到同一栏）。 */
export function dropDoc(id: string): void {
  dispose(live.get(id))
}

/** 落库闸门：重读期间关掉，免得把**恢复前**的状态写回库里。 */
export function muteDoc(id: string): void {
  const rec = live.get(id)
  if (rec) rec.muted = true
}

export function unmuteDoc(id: string): void {
  const rec = live.get(id)
  if (rec) rec.muted = false
}

/** 已经落过库的标题。存盘时不比一下，就没法知道"这次是不是改了名字"。 */
const sentTitle = new Map<string, string>()

function markDirty(docId: string): void {
  const rec = live.get(docId)
  if (!rec || rec.muted) return
  rec.dirty = true
  // 节流（不是防抖）：一窗一次，期间再怎么敲都只挪到窗末那一次。
  if (rec.timer === undefined) {
    rec.timer = window.setTimeout(() => {
      rec.timer = undefined
      void flushDoc(docId)
    }, SAVE_MS)
  }
}

function project(rec: Live): DocPayload {
  const doc = rec.view.state.doc
  const title = String(doc.attrs.title ?? '')
  if (rec.side) {
    // 外部文件：写回**整篇保真 markdown**（未被碰过的块写原文），`content` 恒 null（契约 DocHandle 注释）。
    // 出链不通（D-0140）—— 给空数组，别让它进链接图谱。
    return { id: rec.id, content: null, title, md: docToMarkdownFidelity(doc, rec.side), links: [] }
  }
  return {
    id: rec.id,
    content: JSON.stringify(doc.toJSON()),
    title,
    // 一份投影三处复用（D-0085）：`md` 喂 FTS / 摘要，`links`（出链）喂链接图谱。
    md: docToMarkdown(doc),
    links: docLinks(doc),
  }
}

/** 攒着的改动立刻落库，不等那 300ms。没开着 / 没装载过就什么都不做。 */
export async function flushDoc(docId: string): Promise<void> {
  const rec = live.get(docId)
  if (!rec) return
  if (rec.timer !== undefined) {
    clearTimeout(rec.timer)
    rec.timer = undefined
  }
  if (!rec.dirty || rec.muted) return
  rec.dirty = false
  try {
    const payload = project(rec)
    await need().flush(payload)
    // 名字变了要广播 —— 库里的 title 跟着 doc:apply 走了（D-0073），
    // 但标签条 / 侧栏 / 面包屑读的是 `doc:list` 那份缓存，不重取就永远停在旧名字。
    if (sentTitle.get(docId) !== payload.title) {
      const first = !sentTitle.has(docId)
      sentTitle.set(docId, payload.title)
      // 第一次落库不算"改名"（那只是这篇刚建出来），别为此多刷一次列表。
      if (!first) wiring?.docsChanged()
    }
    wiring?.saved(docId)
  } catch (err) {
    // 落库失败不能吞：内容还在活文档里，留着脏标记下次再试。
    rec.dirty = true
    reportError('editor-prosemirror', err)
  }
}

/** 关窗口 / 拔插件前，把每一篇攒着的改动都落完。 */
export async function flushAll(): Promise<void> {
  await Promise.all([...live.keys()].map((id) => flushDoc(id)))
}

/** 当前活编辑器（取第一篇开着的）—— 查找面板要一个「现在在编辑哪个 view」的口子。 */
export function currentView(): EditorView | null {
  return live.values().next().value?.view ?? null
}

/** 查找面板要的 API —— 给它一个「取当前活编辑器」的口子。 */
export function findApiForCurrentView(): FindApi {
  return createFindApi(() => currentView())
}

/** 活文档的正文（纯文本）。没打开过 → null。 */
export function liveText(id: string): string | null {
  const rec = live.get(id)
  if (!rec) return null
  const doc = rec.view.state.doc
  return doc.textBetween(0, doc.content.size, '\n')
}

/** 内存监控（D-0088 / 架构 §8）。`bytes` 的含义换了：从「Y.Doc 编码字节」变成「doc JSON 字节数」。 */
export function memoryStats(): DocMem[] {
  const out: DocMem[] = []
  for (const rec of live.values()) {
    const doc = rec.view.state.doc
    let blocks = 0
    doc.descendants((node) => {
      if (node.type.name === 'blockContainer') blocks++
    })
    out.push({
      id: rec.id,
      title: String(doc.attrs.title ?? ''),
      bytes: JSON.stringify(doc.toJSON()).length,
      blocks,
      chars: doc.textContent.length,
    })
  }
  return out
}

export function schemaOf(): unknown {
  return schema
}

/** 契约 `docFromMarkdown`：markdown → 整篇 doc JSON。解析器在 serializers 那一侧。 */
export { docFromMarkdown } from './serializers/markdown'

/* ── 评论（D-0067）：机制在 `comment.ts`（架构 §3.2：锚点是 `comment` mark），这里只转一道。 ── */

/** 评论那一套。`connectDocs` 时会按 wiring 重建一次（hooks 要拿到评论插件）。 */
let comments = commentApi(() => currentView())

export const commentTextSelection = () => comments.textSelection()
export const commentBlockSelection = () => comments.blockSelection()
export const addCommentAnchor = (id: string, at: CommentTarget) => comments.addAnchor(id, at)
export const removeCommentAnchor = (id: string) => comments.removeAnchor(id)
export const revealCommentAnchor = (id: string) => comments.reveal(id)
export const pushCommentStates = (list: readonly CommentState[]) => comments.setStates(list)
