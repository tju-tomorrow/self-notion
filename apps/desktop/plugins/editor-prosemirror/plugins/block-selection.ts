/**
 * 块级多选（架构 §4.2）—— PM 原生的 `TextSelection` 是文本级的、`NodeSelection` 只能选一个节点，
 * 「整块蓝框选中一串块」必须自己实现。做法照抄 BlockNote 的 `MultipleNodeSelection`。
 *
 * ★ 一旦 `content()` 是整块 Slice，删 / 复制 / 移动**全部复用原生机制**
 *   （`tr.deleteSelection()` / `view.serializeForClipboard` / node-range replace）—— 这里不手写移动逻辑。
 * ★ 锚点/头落在块与块**之间**（`pos` = 节点前那个位置），不是块内容里：原生机制吃的就是「两端之间
 *   那一整段块」，落在内容里拖动会在原处留下空行。
 */
import { Fragment, Slice } from 'prosemirror-model'
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model'
import { NodeSelection, Plugin, Selection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import type { Mappable } from 'prosemirror-transform'
import type { EditorView } from 'prosemirror-view'

import { reportNote } from '../../../src/kernel/errors'

import './block-selection.css'

/** 块在文档里的落点。`at` = 节点前那个位置；`level` = 它所在那一层（同层才能算一个范围）。 */
export interface BlockHit {
  readonly at: number
  readonly node: PMNode
  readonly level: PMNode
}

/** 按 `id` 找块。**按 id 找而不是按 DOM 位置猜** —— 悬停 / 拖动 / 落点三条路都靠它对齐（架构 §3.1）。 */
export function findBlock(doc: PMNode, id: string): BlockHit | null {
  let hit: BlockHit | null = null
  doc.descendants((node, pos, parent) => {
    if (hit) return false
    if (parent !== null && node.type.name === 'blockContainer' && String(node.attrs.id) === id) {
      hit = { at: pos, node, level: parent }
      return false
    }
    return undefined
  })
  return hit
}

/**
 * 跨块的整块选区。
 *
 * 期望 `$anchor` / `$head` 落在**同一层**的两块之间（第一块之前、最后一块之后）—— 照 BlockNote。
 * 构造时不校验层级：`map()` 之后位置可能落回块内容里，那种情况下 `nodes` 为空，退化成普通选区。
 */
export class BlockSelection extends Selection {
  /** 基类默认 true 会让 PM 把自定义选区当 DOM caret 同步，DOMObserver 随后读回 TextSelection 盖掉它。 */
  visible = false
  readonly nodes: PMNode[]

  constructor($anchor: ResolvedPos, $head: ResolvedPos) {
    super($anchor, $head)
    // 只收 anchor 所在那一层的兄弟 —— 返回 false 就不往匹配到的块里面钻（子树整棵算一个）。
    const level = $anchor.node()
    const nodes: PMNode[] = []
    $anchor.doc.nodesBetween($anchor.pos, $head.pos, (node, _pos, parent) => {
      if (parent !== null && parent.eq(level)) {
        nodes.push(node)
        return false
      }
      return undefined
    })
    this.nodes = nodes
  }

  static create(doc: PMNode, from: number, to = from): BlockSelection {
    return new BlockSelection(doc.resolve(from), doc.resolve(to))
  }

  /** 整块 Slice（openStart/openEnd = 0）—— 原生删除 / 复制 / 落点计算都吃它。 */
  content(): Slice {
    return new Slice(Fragment.from(this.nodes), 0, 0)
  }

  eq(other: Selection): boolean {
    if (!(other instanceof BlockSelection)) return false
    if (this.from !== other.from || this.to !== other.to) return false
    if (this.nodes.length !== other.nodes.length) return false
    return this.nodes.every((node, i) => node.eq(other.nodes[i]))
  }

  map(doc: PMNode, mapping: Mappable): Selection {
    const from = mapping.mapResult(this.from)
    const to = mapping.mapResult(this.to)
    // 一端被整个删掉就退回离另一端最近的普通选区，别留一个指不到东西的块选区。
    if (to.deleted) return Selection.near(doc.resolve(from.pos))
    if (from.deleted) return Selection.near(doc.resolve(to.pos))
    return new BlockSelection(doc.resolve(from.pos), doc.resolve(to.pos))
  }

  toJSON(): { type: string; anchor: number; head: number } {
    return { type: 'block', anchor: this.anchor, head: this.head }
  }

  getBookmark(): BlockBookmark {
    return new BlockBookmark(this.anchor, this.head)
  }
}

/** 基类默认返回 TextBookmark，保存/恢复一次就把块选区降级成文本选区。 */
class BlockBookmark {
  constructor(private readonly anchor: number, private readonly head: number) {}

  map(mapping: Mappable): BlockBookmark {
    return new BlockBookmark(mapping.map(this.anchor), mapping.map(this.head))
  }

  resolve(doc: PMNode): Selection {
    return BlockSelection.create(doc, Math.min(this.anchor, this.head), Math.max(this.anchor, this.head))
  }
}

Selection.jsonID('block', BlockSelection)

/**
 * 把 `fromBlockId`…`toBlockId`（含两端）整块选上。只给一个 id 就是选中那一块。
 * 两个 id 不在同一层时**退回单块** —— 跨层的块范围要算共同祖先，那是 P2 嵌套拖拽的事（架构 §4.1）。
 */
export function selectBlockRange(view: EditorView, fromBlockId: string, toBlockId?: string): void {
  const doc = view.state.doc
  const head = findBlock(doc, fromBlockId)
  if (!head) return
  const tail = toBlockId !== undefined && toBlockId !== fromBlockId ? findBlock(doc, toBlockId) : null

  let from = head.at
  let to = head.at + head.node.nodeSize
  if (tail && tail.level === head.level) {
    from = Math.min(head.at, tail.at)
    to = Math.max(head.at + head.node.nodeSize, tail.at + tail.node.nodeSize)
  }

  view.dispatch(view.state.tr.setSelection(BlockSelection.create(doc, from, to)).scrollIntoView())
}

/**
 * 按住多久才算「长按」→ 起手拖选。
 *
 * ★ 判据是**时间**不是位移（用户：「按道理应该长按拖拽……在我这里很容易触发」）：点一下的时候
 *   手抖几个像素太常见了，拿位移当判据等于「点哪儿都能划出一串块」，还会顺手弹出评论浮条。
 *   250 是手感值：短于它 = 那只是一次点击。
 */
const HOLD_MS = 250
/** 触屏起手拖选的长按与容忍位移；超了就判定为滚动。 */
const TOUCH_HOLD_MS = 400
const TOUCH_SLOP = 8

/** 指针纵坐标底下**最近**的那一块的 id。留白里横向没有意义，只按纵向距离取。 */
function blockIdAt(host: HTMLElement, y: number): string | null {
  let best: { id: string; d: number } | null = null
  for (const el of host.querySelectorAll<HTMLElement>('.sn-block')) {
    const id = el.getAttribute('data-id') ?? ''
    if (id === '') continue
    const r = el.getBoundingClientRect()
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
    if (best === null || d < best.d) best = { id, d }
  }
  return best?.id ?? null
}

/**
 * 从**空白处长按**再拖 → 划过的块一串选上（Notion 那个体验，用户 2026-10-08）。
 * 短于 `HOLD_MS` 的一按一松什么都不做 —— 不然「点一下空白」就会划出一串块。
 *
 * ★ 监听挂在**栏正文那一层**（`.sn-pane-body`）而不是 `view.dom`：版心是居中窄栏，
 *   它左边那条留白**根本不在 `.ProseMirror` 里** —— 挂 view.dom 上，用户圈的那块地方收不到事件。
 * ★ 判据只有一条：落点**不在** `.sn-block` 里。块内（哪怕文字右边那片空）仍旧交回 PM 落光标，
 *   那是 PM 的地盘，不抢。
 */
export function blankDragPlugin(): Plugin {
  /** 拖选会话 + 松手后一拍内，压住 PM 把浏览器 DOM caret 读回 TextSelection 的那次覆盖。 */
  let suppress = false
  return new Plugin({
    filterTransaction: (tr, state) => {
      if (!suppress) return true
      if (!(state.selection instanceof BlockSelection)) return true
      if (!tr.selectionSet || tr.docChanged) return true
      return tr.selection instanceof BlockSelection
    },
    appendTransaction: (trs, oldState, newState) => {
      const tr = trs.find((t) => t.selectionSet)
      if (!tr) return null
      const o = oldState.selection
      const n = newState.selection
      if (!(o instanceof BlockSelection) && !(n instanceof BlockSelection)) return null
      reportNote(
        'blocksel',
        `${o.constructor.name}(${o.from}..${o.to}) -> ${n.constructor.name}(${n.from}..${n.to})` +
          ` steps=${tr.steps.length} doc=${tr.docChanged} pointer=${String(tr.getMeta('pointer') ?? false)}`,
      )
      return null
    },
    view(view) {
      const host = view.dom.parentElement
      if (host === null) return {}
      /** 按下去时指到的那一块 —— 还没算数，长按够了才拿它当锚。 */
      let armed: string | null = null
      let hold = 0
      let anchorId: string | null = null
      let lastId: string | null = null
      /** 触屏会补发兼容鼠标事件，记一下时刻别让它二次触发鼠标那套。 */
      let lastTouchAt = 0

      /** 长按够了 → 起手：先把这一块选上（看得见「起手了」，之后挪到哪扩到哪）。 */
      const begin = (): void => {
        hold = 0
        if (armed === null || anchorId !== null) return
        anchorId = armed
        lastId = armed
        suppress = true
        view.focus()
        selectBlockRange(view, armed)
      }

      const onMove = (e: MouseEvent): void => {
        // 还没长按够时挪动**不算数** —— 那只是「点了一下，手抖了」。
        if (anchorId === null) return
        const id = blockIdAt(host, e.clientY)
        if (id === null || id === lastId) return
        lastId = id
        selectBlockRange(view, anchorId, id)
      }

      const onUp = (): void => {
        if (hold !== 0) clearTimeout(hold)
        hold = 0
        armed = null
        anchorId = null
        lastId = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.setTimeout(() => { suppress = false }, 100)
      }

      const onDown = (e: MouseEvent): void => {
        if (e.button !== 0) return
        if (host.parentElement?.querySelector('.sn-verso')) return
        if (Date.now() - lastTouchAt < 700) return
        const target = e.target
        if (!(target instanceof Element)) return
        // ★ 落点是**控件**（标题那个 input、封面按钮、链接）就不是「空白拖选」。
        //   往下走会 `preventDefault()`，而 mousedown 上那一压会让输入框**永远拿不到焦点**：
        //   点标题点不进去就是它（2026-10-08，探针量出来的：落点是标题、焦点却没动）。
        //   原来只排除 `.sn-block` —— 标题不是块，于是被当成空白。
        if (target.closest('.sn-block, input, textarea, select, button, a') !== null) return
        const id = blockIdAt(host, e.clientY)
        if (id === null) return
        // 压住浏览器那套原生拖选（不压的话拖到一半会连字带块一起花掉）。
        e.preventDefault()
        armed = id
        hold = window.setTimeout(begin, HOLD_MS)
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }

      /* ── 触屏：空白处长按起手拖选。等待期间不挡滚动，长按成立才认领手势。 ── */
      let tArmed: string | null = null
      let tHold = 0
      let tAnchor: string | null = null
      let tLast: string | null = null
      let tPointer = -1
      let tStartX = 0
      let tStartY = 0
      let tDrag = false
      let prevTouchAction = ''

      const beginTouch = (): void => {
        tHold = 0
        if (tArmed === null || tDrag) return
        tDrag = true
        tAnchor = tArmed
        tLast = tArmed
        suppress = true
        host.style.touchAction = 'none'
        selectBlockRange(view, tArmed)
      }

      const endTouch = (): void => {
        if (tHold !== 0) clearTimeout(tHold)
        tHold = 0
        tArmed = null
        tAnchor = null
        tLast = null
        tDrag = false
        if (tPointer !== -1 && host.hasPointerCapture(tPointer)) host.releasePointerCapture(tPointer)
        tPointer = -1
        host.style.touchAction = prevTouchAction
        window.removeEventListener('pointermove', onTouchMove)
        window.removeEventListener('pointerup', onTouchUp)
        window.removeEventListener('pointercancel', onTouchCancel)
        window.removeEventListener('touchmove', onDragTouchMove)
        window.setTimeout(() => { suppress = false }, 100)
      }

      // 手指一挪就判滚动：把长按撤了，别压住页面自己的滚动。
      const onTouchMove = (e: PointerEvent): void => {
        if (e.pointerId !== tPointer) return
        if (!tDrag) {
          if (Math.hypot(e.clientX - tStartX, e.clientY - tStartY) > TOUCH_SLOP) endTouch()
          return
        }
        const id = blockIdAt(host, e.clientY)
        if (id === null || id === tLast || tAnchor === null) return
        tLast = id
        selectBlockRange(view, tAnchor, id)
      }

      // 拖选期间用非被动 touchmove 压住滚动（touch-action 在手势中途改不一定被采纳）。
      const onDragTouchMove = (e: TouchEvent): void => {
        if (tDrag) e.preventDefault()
      }

      const onTouchUp = (e: PointerEvent): void => {
        if (e.pointerId === tPointer) endTouch()
      }
      const onTouchCancel = (e: PointerEvent): void => {
        if (e.pointerId === tPointer) endTouch()
      }

      const onTouchDown = (e: PointerEvent): void => {
        if (e.pointerType === 'mouse' || !e.isPrimary || tPointer !== -1) return
        if (host.parentElement?.querySelector('.sn-verso')) return
        const target = e.target
        if (!(target instanceof Element)) return
        if (target.closest('.sn-block, input, textarea, select, button, a') !== null) return
        const id = blockIdAt(host, e.clientY)
        if (id === null) return
        lastTouchAt = Date.now()
        tArmed = id
        tPointer = e.pointerId
        tStartX = e.clientX
        tStartY = e.clientY
        tDrag = false
        prevTouchAction = host.style.touchAction
        host.setPointerCapture(e.pointerId)
        tHold = window.setTimeout(beginTouch, TOUCH_HOLD_MS)
        window.addEventListener('pointermove', onTouchMove)
        window.addEventListener('pointerup', onTouchUp)
        window.addEventListener('pointercancel', onTouchCancel)
        window.addEventListener('touchmove', onDragTouchMove, { passive: false })
      }

      host.addEventListener('mousedown', onDown)
      host.addEventListener('pointerdown', onTouchDown)
      return {
        destroy: () => {
          host.removeEventListener('mousedown', onDown)
          host.removeEventListener('pointerdown', onTouchDown)
          onUp()
          if (tPointer !== -1) endTouch()
        },
      }
    },
  })
}

/** 当前选中的块 id（顺序即文档顺序）。单块的 `NodeSelection` 也算 —— 两条路都当「选中了这一块」。 */
export function selectedBlockIds(state: EditorState): readonly string[] {
  const sel = state.selection
  if (sel instanceof BlockSelection) return sel.nodes.map((node) => String(node.attrs.id))
  if (sel instanceof NodeSelection && sel.node.type.name === 'blockContainer') {
    return [String(sel.node.attrs.id)]
  }
  return []
}
