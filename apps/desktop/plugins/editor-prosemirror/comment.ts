/**
 * 评论的**编辑器这一侧**（机制）—— UI 和库都在评论插件那边（D-0067，全文见 `docs/comment.md`）。
 *
 * ★ 契约要的六个方法都在这儿，`editor.ts` 只是转一道（它不认识「当前是哪篇」之外的上下文）。
 * ★ 锚点从旧版的「delta 属性」改成 **`comment` mark**（架构 §3.2）—— 砍了 Yjs 就没有 delta 了。
 * ★ 高亮**不是** mark 画出来的：mark 只挂 id（锚点），黄色底色是 decoration 现算的 ——
 *   「解决没有」一变得重画，不用动正文，也就不进撤销栈。
 * ★ 往评论插件那边只开两个口子（`CommentHooks`）—— 这一层不认识 ctx；点高亮回传走的也是它。
 */
import type { Mark, Node as PMNode } from 'prosemirror-model'
import { Plugin, TextSelection, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'

import type {
  BlockAnchorInfo,
  CommentState,
  CommentTarget,
  TextAnchorInfo,
} from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { findBlock, selectedBlockIds } from './plugins/block-selection'
import { schema } from './schema'
import './comment.css'

export interface CommentApi {
  textSelection(): TextAnchorInfo | null
  blockSelection(): BlockAnchorInfo | null
  addAnchor(id: string, at: CommentTarget): void
  removeAnchor(id: string): void
  reveal(id: string): void
  setStates(states: readonly CommentState[]): void
}

/**
 * 编辑器这一侧往评论插件去的两个口子 —— 接线在 `editor.ts`（`ctx.get('comment')`，这一层不认识 ctx）。
 * 形状照评论插件 `provide('comment', ...)` 的 `open` / `onSelection`。
 */
export interface CommentHooks {
  /** 点了正文里的评论高亮 → 打开面板。 */
  open(id: string): void
  /** 工具条那颗「评论」点了 → 把量好的文字选区交出去（`TextAnchorInfo` 去掉 `rect` 的那几个字段）。 */
  selection(at: { blockId: string; index: number; length: number; quote: string }): void
}

/** 原文截断 —— 库里那一列也是 200（`docs/comment.md` §四）。 */
const QUOTE_MAX = 200
/** 「点一条评论闪一下」持续多久。 */
const FLASH_MS = 1600
/** 冷启动时栏是**异步**挂上的：视图还没进 `live` 就短促重试，别把第一次的高亮丢了。 */
const RETRY_MS = 100
const RETRY_MAX = 40

/** 一条评论解决没有。评论插件每次列表变化推一次 —— 高亮只给未解决的。 */
let resolved = new Map<string, boolean>()
/** 正在闪的那条（面板里点了一条评论）。 */
let flash: string | null = null
/** 回传口子（点高亮 → 开面板）—— `commentApi` 装载时接上，点的时候才读。 */
let hooks: CommentHooks | undefined

/* ────────────────────────────── mark 上的 id ────────────────────────────── */

function idsOf(node: PMNode): string[] {
  const mark = schema.marks.comment.isInSet(node.marks)
  const raw = mark ? String(mark.attrs.ids ?? '') : ''
  return raw ? raw.split(',').filter(Boolean) : []
}

const markOf = (ids: readonly string[]): Mark => schema.marks.comment.create({ ids: ids.join(',') })

/* ────────────────────────────── 块与位置 ────────────────────────────── */

/** 块的内容节点（`blockContainer` 的第一个孩子）—— 是 `blockGroup` 就是「这个块没内容」。 */
function contentOf(node: PMNode): PMNode | null {
  const first = node.firstChild as PMNode | null
  return first && first.type.name !== 'blockGroup' ? first : null
}

/**
 * 位置落在哪个块里。内容从 `pos + 2` 起（`blockContainer` 那层 +1、内容节点那层 +1）——
 * 跟 `find.ts` 的 `base` 同一套算式。
 */
function blockOf(doc: PMNode, pos: number): { id: string; pos: number; content: PMNode | null } | null {
  const $pos = doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name !== 'blockContainer') continue
    return { id: String(node.attrs.id ?? ''), pos: $pos.before(d), content: contentOf(node) }
  }
  return null
}

/** 某个块的内容区间 `[起, 止)`（文档位置）。 */
function contentRange(hit: { pos: number; content: PMNode | null }): { from: number; to: number } | null {
  if (!hit.content) return null
  return { from: hit.pos + 2, to: hit.pos + hit.content.nodeSize }
}

const quoteOf = (doc: PMNode, from: number, to: number): string =>
  doc.textBetween(from, to, ' ').trim().slice(0, QUOTE_MAX)

/** 屏幕上的矩形（浮出按钮靠它定位）—— 用 PM 的坐标算，不依赖 DOM 选区。 */
function rectOf(view: EditorView, from: number, to: number): DOMRect {
  const a = view.coordsAtPos(from)
  const b = view.coordsAtPos(to)
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  return new DOMRect(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top)
}

/* ────────────────────────────── 读选区 ────────────────────────────── */

/** 当前文字选区的**位置信息**（没有 `rect`）—— 行内工具栏那颗「评论」按钮也用它，
 *  免得换算逻辑在两处各写一份、慢慢漂开。 */
export function selectionAnchor(
  state: EditorState,
): { blockId: string; index: number; length: number; quote: string } | null {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || sel.empty) return null
  const hit = blockOf(state.doc, sel.from)
  if (!hit) return null
  const range = contentRange(hit)
  if (!range || sel.from < range.from) return null
  const to = Math.min(sel.to, range.to)
  const length = to - sel.from
  if (length <= 0) return null
  return {
    blockId: hit.id,
    index: sel.from - range.from,
    length,
    quote: quoteOf(state.doc, sel.from, to),
  }
}

/** 当前文字选区。光标（没选中东西）→ null；跨块时**只取第一块**那段（`docs/comment.md` §六.6）。 */
function textSelection(view: EditorView): TextAnchorInfo | null {
  const at = selectionAnchor(view.state)
  if (!at) return null
  return { ...at, rect: rectOf(view, view.state.selection.from, view.state.selection.from + at.length) }
}

/** 当前块选区（点拖拽手柄 / 拖过一串块选中的那些）→ 拿第一块。图片 / 表格这类没法选文字的靠它。 */
function blockSelection(view: EditorView): BlockAnchorInfo | null {
  const id = selectedBlockIds(view.state)[0]
  if (!id) return null
  const hit = findBlock(view.state.doc, id)
  if (!hit) return null
  const content = contentOf(hit.node)
  const dom = view.nodeDOM(hit.at)
  return {
    blockId: id,
    quote: content ? content.textContent.trim().slice(0, QUOTE_MAX) : '',
    // 量不到就给个空的 DOMRect —— 浮出按钮那边自己会因此不显示（`bubble.tsx` 的 `usable`）。
    rect: dom instanceof HTMLElement ? dom.getBoundingClientRect() : new DOMRect(),
  }
}

/* ────────────────────────────── 锚点 ────────────────────────────── */

/**
 * 给一段范围打上锚点。按文本节点**分段**求并集再逐段写 —— PM 同一 mark 类型在同一位置互相排斥，
 * 整把写会盖掉这一句里别的评论 id（旧 delta 实现同款理由，`docs/comment.md` §三）。
 */
function addAnchor(view: EditorView, id: string, at: CommentTarget): void {
  // 块级锚点只活在库里（契约 / `docs/comment.md` 都这么定）—— 正文里不写。
  if (at.kind === 'block') return
  const hit = findBlock(view.state.doc, at.blockId)
  if (!hit) return
  const range = contentRange({ pos: hit.at, content: contentOf(hit.node) })
  if (!range) return
  const from = range.from + Math.max(0, at.index)
  const to = Math.min(range.to, from + Math.max(0, at.length))
  if (to <= from) return

  const tr = view.state.tr
  let touched = false
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return
    const start = Math.max(pos, from)
    const end = Math.min(pos + node.nodeSize, to)
    if (end <= start) return
    const ids = idsOf(node)
    if (ids.includes(id)) return
    tr.addMark(start, end, markOf([...ids, id]))
    touched = true
  })
  if (!touched) return
  // 打锚点不该进撤销栈：⌘Z 该回退用户自己的输入，不是回退一个评论高亮（旧实现也是 withoutHistory）。
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

/** 擦掉某条评论在正文里的**所有**锚点。 */
function removeAnchor(view: EditorView, id: string): void {
  const tr = view.state.tr
  let touched = false
  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const ids = idsOf(node)
    if (!ids.includes(id)) return
    const rest = ids.filter((x) => x !== id)
    if (rest.length) tr.addMark(pos, pos + node.nodeSize, markOf(rest))
    else tr.removeMark(pos, pos + node.nodeSize, schema.marks.comment)
    touched = true
  })
  if (!touched) return
  tr.setMeta('addToHistory', false)
  view.dispatch(tr)
}

/** 某条评论在正文里的第一个锚点位置（没有 → -1）。页面级 / 块级评论在这里天然是 -1。 */
function firstAnchor(doc: PMNode, id: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.isText && idsOf(node).includes(id)) {
      found = pos
      return false
    }
    return undefined
  })
  return found
}

function scrollTo(view: EditorView, pos: number): void {
  const at = view.domAtPos(pos)
  const el = at.node.nodeType === Node.ELEMENT_NODE ? (at.node as HTMLElement) : at.node.parentElement
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/** 滚到某条评论的锚点并闪一下（面板里点一条评论）。锚点不在正文里就什么都不做。 */
function reveal(view: EditorView, id: string): void {
  const pos = firstAnchor(view.state.doc, id)
  if (pos < 0) return
  flash = id
  repaint(view)
  scrollTo(view, pos)
  const target = view
  window.setTimeout(() => {
    // 又闪了别的一条 → 这一趟作废（`flash` 已经换人了）。
    if (flash !== id) return
    flash = null
    // 这一篇可能已经关了 —— 视图没了就没东西可闪。
    if (target.dom.isConnected) repaint(target)
  }, FLASH_MS)
}

/* ────────────────────────────── 高亮（decoration）────────────────────────────── */

const commentPlugin = new Plugin({
  props: {
    decorations(state) {
      // 没有评论、也没在闪 → 一次整篇扫描都省了（这是绝大多数文档）。
      if (resolved.size === 0 && flash === null) return null
      const decos: Decoration[] = []
      state.doc.descendants((node, pos) => {
        if (!node.isText) return
        const ids = idsOf(node)
        if (ids.length === 0) return
        const active = flash !== null && ids.includes(flash)
        // 高亮只给未解决的；正在闪的那条无论解决没有都画一下。
        const unresolved = ids.some((id) => resolved.get(id) === false)
        if (!active && !unresolved) return
        // 这条装饰点了要回传是**哪一条**评论（PM 会把 data-* 落到包文字的 span 上）。
        const tag = active ? flash : (ids.find((id) => resolved.get(id) === false) ?? ids[ids.length - 1])
        decos.push(
          Decoration.inline(pos, pos + node.nodeSize, {
            class: active ? 'sn-comment-active' : 'sn-comment-unresolved',
            'data-comment-id': tag ?? '',
          }),
        )
      })
      return decos.length ? DecorationSet.create(state.doc, decos) : null
    },
  },
  // 点高亮 → 回传给评论插件。捕获阶段挂，视图销毁时插件自己会调 `destroy` 摘掉（PM 的 PluginView）。
  view(view) {
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const id = target.closest('[data-comment-id]')?.getAttribute('data-comment-id')
      if (id) hooks?.open(id)
    }
    view.dom.addEventListener('click', onClick, true)
    return { destroy: () => view.dom.removeEventListener('click', onClick, true) }
  },
})

/**
 * 把高亮插件补进视图。`reconfigure` **保留**已有插件的 state（含撤销栈），只 init 新的那个
 * —— 跟 `find.ts` 的 `ensure` 同一套（这个文件不许改 `editor.ts` 的插件清单）。
 */
function ensure(view: EditorView): void {
  if (view.state.plugins.includes(commentPlugin)) return
  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, commentPlugin] }))
}

/** 空事务：内容没动，只为让 decoration 重算一遍（`resolved` / `flash` 是文档外的状态）。 */
function repaint(view: EditorView): void {
  ensure(view)
  view.dispatch(view.state.tr)
}

/**
 * @param currentView 取「现在在编辑哪个 view」—— 多栏时取当前那一栏，没开文档时 null。
 * @param next 往评论插件回传的口子（`open` / `selection`）—— 接线在 `editor.ts`，没接上就点不动。
 */
export function commentApi(currentView: () => EditorView | null, next?: CommentHooks): CommentApi {
  hooks = next
  let retryTimer: number | undefined
  let attempts = 0

  /** 把「解决没有」推到视图上；视图还没挂上就短促重试几次（挂载是异步的）。 */
  const repaintCurrent = (): void => {
    const view = currentView()
    if (!view) {
      if (attempts++ < RETRY_MAX && retryTimer === undefined) {
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined
          repaintCurrent()
        }, RETRY_MS)
      }
      return
    }
    attempts = 0
    repaint(view)
  }

  const use = (fn: (view: EditorView) => void): void => {
    try {
      const view = currentView()
      if (view) fn(view)
    } catch (err) {
      reportError('comment', err)
    }
  }

  return {
    textSelection: () => {
      try {
        const view = currentView()
        return view ? textSelection(view) : null
      } catch (err) {
        reportError('comment', err)
        return null
      }
    },
    blockSelection: () => {
      try {
        const view = currentView()
        return view ? blockSelection(view) : null
      } catch (err) {
        reportError('comment', err)
        return null
      }
    },
    addAnchor: (id, at) => use((view) => addAnchor(view, id, at)),
    removeAnchor: (id) => use((view) => removeAnchor(view, id)),
    reveal: (id) => use((view) => reveal(view, id)),
    setStates: (states) => {
      try {
        resolved = new Map(states.map((s) => [s.id, s.resolved]))
        repaintCurrent()
      } catch (err) {
        reportError('comment', err)
      }
    },
  }
}
