/**
 * 块手柄 `+` / `⋮⋮` + 拖拽（架构 §4.1）。
 *
 * ★ **不手写移动逻辑**：`dragstart` 里只把选区摆好、`view.dragging` 挂上，删 + 插交给 PM 的 drop handler；
 *   落点线交给已装好的 `prosemirror-dropcursor`（那个插件读的就是 `view.dragging.slice`）。
 * ★ 同级前后拖整条路走 PM 原生（上面那条）。**嵌套**不行：PM 的 `dropPoint` 只会落在已有 `blockGroup` 里，
 *   想嵌进一个还没孩子的块（Notion 最常见的那个动作）它造不出那个组。所以只有这一种落点我们自己接管
 *   （`handleDrop` + 上面那条蓝线）；其余落点照旧返回 false 让 PM 走。
 * ★ 浮层自己算定位：「鼠标下这块的 rect 往左挪一格」就够了，不用引 floating-ui。
 */
import type { Fragment, Node as PMNode, Slice } from 'prosemirror-model'
import { Plugin, PluginKey, Selection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'

import { groupChildren } from '../commands/block'
import { schema } from '../schema'
import { BlockSelection, findBlock, selectBlockRange, selectedBlockIds } from './block-selection'
import './block-handle.css'

/** 左边给手柄留的那条槽，跟 `block-handle.css.ts` 里那个数必须一样。 */
const GUTTER = 40
/** 每层缩进量 —— 跟 `editor.css.ts` 那条嵌套规则（`paddingLeft: 64` = 40 + 24）是**同一个数**，一起改。 */
const INDENT = 24

/** 一次嵌套落点：嵌进哪个块（文档位置），以及那条线画在哪（视口坐标）。 */
interface NestedTarget {
  readonly parentPos: number
  readonly top: number
  readonly left: number
  readonly right: number
}

export const blockHandleKey = new PluginKey('blockHandle')

/** 与 `editor.ts` 的 `blockId()` 同一套形状（那边没导出，三行不引线）。 */
function newBlockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** 选中的块画一层蓝框。PM 只给 `NodeSelection` 加 class，自定义选区得自己来（架构 §4.2）。 */
function selectionDecos(state: EditorState): DecorationSet {
  const ids = selectedBlockIds(state)
  if (ids.length === 0) return DecorationSet.empty
  const want = new Set(ids)
  const decos: Decoration[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'blockContainer' && want.has(String(node.attrs.id))) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'sn-block-selected' }))
    }
  })
  return DecorationSet.create(state.doc, decos)
}

class BlockHandle {
  private readonly dom: HTMLDivElement
  private readonly addBtn: HTMLButtonElement
  /** 拖的那个是 `div` 不是 `button` —— `<button draggable>` 在个别浏览器上起不了拖。 */
  private readonly dragBtn: HTMLDivElement
  /** 鼠标现在压着哪一块。 */
  private hover: { id: string; el: HTMLElement } | null = null
  /** 拖行 / ⇧ 点手柄时的参照块 —— 范围选择要有个起点。 */
  private anchorId: string | null = null
  private ghost: HTMLElement | null = null
  /** 这次拖的是哪几块（嵌套落点要拿它挡「嵌进自己」）。 */
  private dragIds: readonly string[] = []
  /** 嵌套落点的那条缩进线。 */
  private readonly line: HTMLDivElement
  private nested: NestedTarget | null = null
  /** 我们是否把 `dropCursor` 那条线藏起来了（还原时只认自己藏的那一次）。 */
  private cursorMuted = false

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement('div')
    this.dom.className = 'sn-block-handle'
    this.dom.hidden = true
    this.addBtn = makeButton('+')
    this.dragBtn = document.createElement('div')
    this.dragBtn.className = 'sn-block-btn sn-block-drag'
    this.dragBtn.textContent = '⋮⋮'
    this.dragBtn.draggable = true
    this.dom.append(this.addBtn, this.dragBtn)
    this.line = document.createElement('div')
    this.line.className = 'sn-drop-indent'
    this.line.hidden = true
    // 浮层挂在 <body> 上、position: fixed：编辑器那一层 DOM 一变（PM 会重建块）它不会被拆掉。
    document.body.append(this.dom, this.line)

    this.addBtn.addEventListener('mousedown', (e) => e.preventDefault())
    this.addBtn.addEventListener('click', this.insertBelow)
    this.dragBtn.addEventListener('click', this.onHandleClick)
    this.dragBtn.addEventListener('dragstart', this.onDragStart)
    this.dragBtn.addEventListener('dragend', this.onDragEnd)
    document.addEventListener('mousemove', this.onMouseMove, true)
    document.addEventListener('scroll', this.hide, true)
    // 挂在 document 的冒泡段：`dropCursor` 的监听在 `view.dom`，冒泡到这里时它已经画完了 ——
    // 我们要在它之后把线让开 / 摆正。挂 view.dom 上会反着来。
    document.addEventListener('dragover', this.onDragOver)
  }

  /** 块被删掉之后手柄得自己消失（PM 不会通知我们）。 */
  update(view: EditorView): void {
    if (this.dom.hidden || !this.hover) return
    if (!findBlock(view.state.doc, this.hover.id)) this.hide()
  }

  destroy(): void {
    document.removeEventListener('mousemove', this.onMouseMove, true)
    document.removeEventListener('scroll', this.hide, true)
    document.removeEventListener('dragover', this.onDragOver)
    this.clearGhost()
    this.hideLine()
    this.dom.remove()
    this.line.remove()
    // 拖到编辑器外面松手时 PM 收不到 drop，`dragging` 就留在那儿了。
    this.view.dragging = null
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return
    const target = e.target
    if (!(target instanceof Element)) return
    // 鼠标压在手柄自己身上时别动它 —— 一动就刚好从指尖底下溜走。
    if (this.dom.contains(target)) return
    if (!this.view.dom.contains(target)) return this.hide()

    const el = target.closest('.sn-block')
    if (!(el instanceof HTMLElement) || !this.view.dom.contains(el)) return this.hide()
    const id = el.getAttribute('data-id') ?? ''
    if (id === '') return this.hide()

    if (!this.hover || this.hover.id !== id || this.hover.el !== el) this.hover = { id, el }
    this.place()
  }

  private place(): void {
    const hover = this.hover
    if (!hover || !hover.el.isConnected) return this.hide()
    const rect = hover.el.getBoundingClientRect()
    const host = this.view.dom.getBoundingClientRect()
    // 滚出编辑区就别赖在边上 —— 手柄的好处是「指着哪块就是哪块」。
    if (rect.bottom < host.top || rect.top > host.bottom) return this.hide()
    this.dom.hidden = false
    // 手柄站在**版心左侧的留白**里（`left = 块左缘 - GUTTER`）—— 不占正文的宽度，
    // 正文的文字和标题一样从版心左缘开始。窗口极窄时它会被 4px 兜住、贴到窗口左边（还能用）。
    this.dom.style.left = `${Math.max(4, rect.left - GUTTER + 1)}px`
    this.dom.style.top = `${Math.max(host.top + 1, rect.top + 1)}px`
  }

  private hide = (): void => {
    this.hover = null
    this.dom.hidden = true
  }

  /** 点手柄 = 选中这块；⇧ 点 = 从上一块选到这块（块级多选靠它）。 */
  private onHandleClick = (e: MouseEvent): void => {
    const hover = this.hover
    if (!hover) return
    if (e.shiftKey && this.anchorId !== null && this.anchorId !== hover.id) {
      selectBlockRange(this.view, this.anchorId, hover.id)
    } else {
      this.anchorId = hover.id
      selectBlockRange(this.view, hover.id)
    }
    this.view.focus()
  }

  /** `+`：在这块（含它的子树）下面插一个空段落块，光标落进去。 */
  private insertBelow = (): void => {
    const hover = this.hover
    if (!hover) return
    const hit = findBlock(this.view.state.doc, hover.id)
    if (!hit) return
    const { schema } = this.view.state
    const at = hit.at + hit.node.nodeSize
    const block = schema.nodes.blockContainer.create(
      { id: newBlockId() },
      schema.nodes.paragraph.create(),
    )
    const tr = this.view.state.tr.insert(at, block)
    tr.setSelection(Selection.near(tr.doc.resolve(at + 2)))
    this.view.dispatch(tr.scrollIntoView())
    this.view.focus()
  }

  private onDragStart = (e: DragEvent): void => {
    const hover = this.hover
    const dt = e.dataTransfer
    if (!hover || !dt) return

    // 多选态下拖的是**整组**；不然先把这个块选上再拖（两处都是 `content()` 那条整块 Slice）。
    const ids = selectedBlockIds(this.view.state)
    const dragging = ids.includes(hover.id) ? ids : [hover.id]
    if (!ids.includes(hover.id)) selectBlockRange(this.view, hover.id)

    const sel = this.view.state.selection
    if (!(sel instanceof BlockSelection)) return
    const slice = sel.content()
    const { dom, text } = this.view.serializeForClipboard(slice)

    dt.clearData()
    dt.setData('text/html', dom.innerHTML)
    dt.setData('text/plain', text)
    dt.effectAllowed = 'copyMove'
    this.setGhost(dt, dragging)
    this.dragIds = dragging
    // 删 + 插全交给 PM 的 drop handler；它只吃 slice，我们别自己动文档。
    this.view.dragging = { slice, move: true }
  }

  private onDragEnd = (): void => {
    this.clearGhost()
    this.dragIds = []
    this.hideLine()
    this.view.dragging = null
  }

  /**
   * 拖拽经过时算落点。**只有「嵌进某块」这一种我们自己画线**（理由见文件头）；
   * 其余情况把线收掉，让 `dropCursor` 那条照旧画它的同级线。
   */
  private onDragOver = (e: DragEvent): void => {
    const target = this.nestedAt(e)
    this.nested = target
    if (target) this.showLine(target)
    else this.hideLine()
  }

  /**
   * 算出「这一下会嵌进哪个父块的哪个位置」。认两条迹象（照 Notion）：
   *  ① 指针在某个块的**文字左缘**再往右一档 = 想缩进；② 在上半 / 下半决定嵌它前面那个还是它自己。
   * 认不出（没往右挪、或者那个位置会嵌进自己）就返回 null = 同级，交回 PM。
   */
  private nestedAt(e: DragEvent): NestedTarget | null {
    // 只有「我们自己起的这次拖」算 —— 从别的窗口 / 文件拖进来不该走这条路。
    if (!this.view.dragging || this.dragIds.length === 0) return null
    const host = e.target instanceof Element ? e.target.closest('.sn-block') : null
    if (!(host instanceof HTMLElement) || !this.view.dom.contains(host)) return null
    const id = host.getAttribute('data-id') ?? ''
    const hit = id === '' ? null : findBlock(this.view.state.doc, id)
    if (!hit) return null

    const rect = host.getBoundingClientRect()
    if (e.clientX < rect.left + GUTTER + INDENT) return null
    const after = e.clientY > rect.top + rect.height / 2

    // 落线下面那一块才是「父块」：下半 → 嵌进它；上半 → 嵌进它前面那个兄弟。
    let parentPos = hit.at
    let parentEl = host
    if (!after) {
      const $pos = this.view.state.doc.resolve(hit.at)
      const idx = $pos.index()
      if (idx === 0) return null
      const prev = $pos.parent.child(idx - 1)
      parentPos = hit.at - prev.nodeSize
      const el = this.view.dom.querySelector(`.sn-block[data-id="${String(prev.attrs.id ?? '')}"]`)
      if (!(el instanceof HTMLElement)) return null
      parentEl = el
    }
    if (this.taken(parentPos)) return null

    // 线的左缘＝将来嵌进去那一层会缩到的位置：父块左缘 + 手柄槽 + 一格（跟 `editor.css.ts` 同一个 24）。
    return {
      parentPos,
      top: after ? rect.bottom : rect.top,
      left: parentEl.getBoundingClientRect().left + GUTTER + INDENT,
      right: rect.right,
    }
  }

  /** 这个位置是不是就在这次拖的块（或它的子树）里面 —— 是的话不能嵌。
   *  右端取开区间：紧挨在被拖块**后面**的那一块是合法的父块（「往上挪一格再嵌进去」）。 */
  private taken(pos: number): boolean {
    for (const id of this.dragIds) {
      const block = findBlock(this.view.state.doc, id)
      if (block && pos >= block.at && pos < block.at + block.node.nodeSize) return true
    }
    return false
  }

  private showLine(target: NestedTarget): void {
    this.line.hidden = false
    this.line.style.left = `${target.left}px`
    this.line.style.top = `${target.top - 1}px`
    this.line.style.width = `${Math.max(8, target.right - target.left)}px`
    // 嵌套落点是我们自己这条线，得把 `dropCursor` 那条让开，不然两条叠在一起。
    this.muteDropCursor(true)
  }

  private hideLine(): void {
    this.nested = null
    this.line.hidden = true
    // 只有我们让开过才去还原 —— 三栏并存时每个 view 都有监听，别人别去动我们藏掉的那条。
    if (this.cursorMuted) this.muteDropCursor(false)
  }

  /** 藏 / 放 `dropCursor` 画的那条线（它的元素挂在本 view 的 offsetParent 下）。 */
  private muteDropCursor(muted: boolean): void {
    this.cursorMuted = muted
    const host = this.view.dom.offsetParent ?? document.body
    const el = host.querySelector('.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline')
    if (el instanceof HTMLElement) el.style.display = muted ? 'none' : ''
  }

  /**
   * 落点：把这次拖的块（slice 里那几棵）接成目标块的**最后一个孩子**。
   * 这里才动手 —— 只有「目标还没有 blockGroup」是 PM 的 `dropPoint` 够不着的地方（造不出那个组）。
   * 删源照旧走 `deleteSelection()`（跟 PM 的 drop handler 同一招），落点靠 mapping 追。
   */
  dropNested(event: DragEvent, slice: Slice, moved: boolean): boolean {
    const target = this.nestedAt(event)
    if (!target || this.nested === null) return false
    const incoming = children(slice.content)
    if (incoming.length === 0) return false

    const tr = this.view.state.tr
    // 删源要真删得掉：选区这一刻还得是那串块（其实必有），不然我们会把块**复制**一份而不是搬走。
    if (moved) {
      if (!(this.view.state.selection instanceof BlockSelection)) return false
      tr.deleteSelection()
    }
    const at = tr.mapping.map(target.parentPos)
    const parent = tr.doc.nodeAt(at)
    if (!parent || parent.type.name !== 'blockContainer') return false

    const group = schema.nodes.blockGroup.create(null, [...groupChildren(parent), ...incoming])
    const nested = schema.nodes.blockContainer.create(parent.attrs, [parent.child(0), group])
    tr.replaceWith(at, at + parent.nodeSize, nested)

    const start = at + 1 + parent.child(0).nodeSize + 1
    const size = incoming.reduce((n, node) => n + node.nodeSize, 0)
    tr.setSelection(BlockSelection.create(tr.doc, start, start + size))
    this.view.dispatch(tr.scrollIntoView())
    return true
  }

  /** 拖动时跟着鼠标的那张缩略图。浏览器只认挂着 DOM 上的元素，所以先塞进 body 再拿掉。 */
  private setGhost(dt: DataTransfer, ids: readonly string[]): void {
    this.clearGhost()
    const wrap = document.createElement('div')
    wrap.className = 'sn-drag-ghost'
    for (const id of ids) {
      const el = this.view.dom.querySelector(`.sn-block[data-id="${id}"]`)
      if (el) wrap.appendChild(el.cloneNode(true))
    }
    if (wrap.childElementCount === 0) return
    document.body.appendChild(wrap)
    this.ghost = wrap
    const first = wrap.firstElementChild as HTMLElement | null
    if (first) wrap.style.width = `${first.getBoundingClientRect().width}px`
    dt.setDragImage(wrap, 0, 0)
  }

  private clearGhost(): void {
    this.ghost?.remove()
    this.ghost = null
  }
}

function makeButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'sn-block-btn'
  btn.textContent = label
  return btn
}

/** Fragment 的顶层孩子（slice 里那几棵子树）。 */
function children(fragment: Fragment): PMNode[] {
  const out: PMNode[] = []
  for (let i = 0; i < fragment.childCount; i++) out.push(fragment.child(i))
  return out
}

export function blockHandlePlugin(): Plugin {
  // 一个 view 一个插件实例 —— 三个窗口并存时别互相串（`editor.ts` 最多保活 3 个 view）。
  const holder: { handle: BlockHandle | null } = { handle: null }
  return new Plugin({
    key: blockHandleKey,
    view: (view) => {
      const handle = new BlockHandle(view)
      holder.handle = handle
      return handle
    },
    props: {
      decorations: (state) => selectionDecos(state),
      // 只有「嵌套落点」这一件事回来接管；返回 false 就走 PM 原生的 drop（含删源 + 落点）。
      handleDrop: (_view, event, slice, moved) =>
        holder.handle === null ? false : holder.handle.dropNested(event, slice, moved),
      // 块选区的「复制」得自己写：⌘C 走的是浏览器原生 DOM 选区，而 PM 的选区在我们手里（架构 §4.2）。
      handleDOMEvents: {
        copy: (view, event) => {
          const sel = view.state.selection
          if (!(sel instanceof BlockSelection)) return false
          const { dom, text } = view.serializeForClipboard(sel.content())
          event.clipboardData?.setData('text/html', dom.innerHTML)
          event.clipboardData?.setData('text/plain', text)
          event.preventDefault()
          return true
        },
      },
    },
  })
}
