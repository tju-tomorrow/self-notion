/**
 * 画布页的控制器：工具条 + maxgraph + 读写库（D-0216）。
 *
 * 数据这一侧只有两步：打开时 `doc:open` 拿整篇 JSON，改动防抖后把那一块的 `attrs.xml`
 * 换掉再 `doc:apply` 写回。笔记页没有同时开着（换标签时编辑器已卸载），所以不需要双向同步。
 */
import type { Context } from 'cordis'

import { createDrawioGraph, PALETTE, type DrawioGraph, type SelectionStyle } from '../../src/drawio/engine'
import { drawioTabParts } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import * as s from './page.css'

interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
}

const SAVE_MS = 600

/** ['none', …] 表示去掉这个属性（无填充 / 无边框）。 */
const FILLS: readonly [string, string][] = [
  ['none', '不填充'],
  ['#ffffff', '白色'],
  ['#e2e8f0', '浅灰'],
  ['#fecaca', '浅红'],
  ['#fed7aa', '浅橙'],
  ['#fef08a', '浅黄'],
  ['#bbf7d0', '浅绿'],
  ['#bfdbfe', '浅蓝'],
  ['#ddd6fe', '浅紫'],
]

const STROKES: readonly [string, string][] = [
  ['none', '无边框'],
  ['#0f172a', '黑'],
  ['#64748b', '灰'],
  ['#dc2626', '红'],
  ['#ea580c', '橙'],
  ['#ca8a04', '黄'],
  ['#16a34a', '绿'],
  ['#2563eb', '蓝'],
  ['#7c3aed', '紫'],
]

const WIDTHS = [1, 2, 3] as const
const ARROWS: readonly ['end' | 'both' | 'none', string, string][] = [
  ['end', '→', '单向箭头'],
  ['both', '↔', '双向箭头'],
  ['none', '—', '无箭头'],
]

const color = (v: unknown, fallback: string): string =>
  String(v ?? fallback).trim().toLowerCase()

export class DrawioCanvas {
  private readonly ctx: Context
  private readonly root: HTMLElement
  private readonly docId: string
  private readonly blockId: string

  private host!: HTMLElement
  private statusEl!: HTMLElement
  private undoBtn!: HTMLButtonElement
  private redoBtn!: HTMLButtonElement
  private deleteBtn!: HTMLButtonElement
  private connectBtn!: HTMLButtonElement
  private gridBtn!: HTMLButtonElement
  private zoomEl!: HTMLElement

  private fillBtns: HTMLButtonElement[] = []
  private strokeBtns: HTMLButtonElement[] = []
  private widthBtns: HTMLButtonElement[] = []
  private arrowBtns: HTMLButtonElement[] = []
  private fontBtns: HTMLButtonElement[] = []
  private dashBtn!: HTMLButtonElement
  private fontVal!: HTMLElement
  private styleHint!: HTMLElement

  private json: JsonNode | null = null
  private node: JsonNode | null = null
  private graph: DrawioGraph | null = null
  private offChange: (() => void) | undefined
  private timer: number | undefined
  private menu: HTMLElement | null = null
  private spacePan = false
  private dirty = false
  private disposed = false

  constructor(ctx: Context, tabId: string, root: HTMLElement) {
    this.ctx = ctx
    this.root = root
    const parts = drawioTabParts(tabId)
    this.docId = parts?.docId ?? ''
    this.blockId = parts?.blockId ?? ''
    this.build()
    if (!this.docId || !this.blockId) {
      this.missing('这个标签坏了：找不到源笔记或块')
      return
    }
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    void this.load()
  }

  /* ─────────────────────────── 骨架 ─────────────────────────── */

  private build(): void {
    this.root.replaceChildren()
    const page = document.createElement('div')
    page.className = s.page

    const bar = document.createElement('div')
    bar.className = s.toolbar

    const shapes = document.createElement('div')
    shapes.className = s.shapes
    PALETTE.forEach((group, gi) => {
      if (gi > 0) {
        const sep = document.createElement('span')
        sep.className = s.sep
        shapes.appendChild(sep)
      }
      const label = document.createElement('span')
      label.className = s.groupLabel
      label.textContent = group.label
      const box = document.createElement('span')
      box.className = s.shapeGroup
      for (const shape of group.items) {
        const b = this.button(shape.glyph, shape.label, () => this.graph?.insert(shape))
        b.classList.add(s.shapeBtn)
        box.appendChild(b)
      }
      shapes.append(label, box)
    })

    const tools = document.createElement('div')
    tools.className = s.tools
    this.connectBtn = this.button('↗', '把选中的两个图形连起来', () => {
      if (this.graph?.connectSelected()) this.refresh()
    })
    this.deleteBtn = this.button('⌫', '删除选中', () => {
      this.graph?.removeSelected()
      this.refresh()
    })
    this.undoBtn = this.button('↶', '撤销', () => {
      this.graph?.undo()
      this.refresh()
    })
    this.redoBtn = this.button('↷', '重做', () => {
      this.graph?.redo()
      this.refresh()
    })
    this.gridBtn = this.button('▦', '显示网格', () => {
      const graph = this.graph
      if (!graph) return
      graph.setGridVisible(!graph.gridVisible())
      this.refresh()
    })
    const out = this.button('−', '缩小', () => {
      this.graph?.zoomOut()
      this.refresh()
    })
    this.zoomEl = document.createElement('span')
    this.zoomEl.className = s.zoom
    this.zoomEl.textContent = '100%'
    this.zoomEl.title = '实际大小'
    this.zoomEl.addEventListener('click', () => {
      this.graph?.actualSize()
      this.refresh()
    })
    const into = this.button('＋', '放大', () => {
      this.graph?.zoomIn()
      this.refresh()
    })
    const fit = this.button('⤢', '适应画布', () => {
      this.graph?.fit()
      this.refresh()
    })
    tools.append(this.connectBtn, this.deleteBtn, this.undoBtn, this.redoBtn, this.gridBtn, out, this.zoomEl, into, fit)

    this.statusEl = document.createElement('span')
    this.statusEl.className = s.status
    this.statusEl.textContent = '载入中…'

    tools.style.marginLeft = 'auto'
    bar.append(shapes, tools, this.statusEl)

    const styleBar = this.buildStyleBar()

    this.host = document.createElement('div')
    this.host.className = s.canvas
    this.host.tabIndex = 0
    this.host.addEventListener('contextmenu', this.onContextMenu)
    this.host.addEventListener('mouseup', () => this.refresh())
    this.host.addEventListener('keyup', () => this.refresh())

    page.append(bar, styleBar, this.host)
    this.root.appendChild(page)
  }

  private buildStyleBar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = s.styleBar

    const group = (labelText: string): HTMLElement => {
      const el = document.createElement('div')
      el.className = s.styleGroup
      const label = document.createElement('span')
      label.className = s.styleLabel
      label.textContent = labelText
      el.appendChild(label)
      return el
    }
    const swatch = (value: string, title: string, run: () => void): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = s.swatch
      b.title = title
      b.dataset.color = value
      if (value === 'none') b.classList.add(s.swatchNone)
      else b.style.background = value
      b.addEventListener('click', () => {
        run()
        this.refresh()
      })
      return b
    }

    const fill = group('填充')
    for (const [value, title] of FILLS) {
      const b = swatch(value, title, () => this.graph?.setFill(value))
      this.fillBtns.push(b)
      fill.appendChild(b)
    }

    const stroke = group('边框')
    for (const [value, title] of STROKES) {
      const b = swatch(value, title, () => this.graph?.setStroke(value))
      this.strokeBtns.push(b)
      stroke.appendChild(b)
    }

    const width = group('粗细')
    for (const w of WIDTHS) {
      const b = this.button(String(w), `线宽 ${w}`, () => {
        this.graph?.setStrokeWidth(w)
        this.refresh()
      })
      this.widthBtns.push(b)
      width.appendChild(b)
    }
    this.dashBtn = this.button('┄', '虚线', () => {
      const graph = this.graph
      if (!graph) return
      graph.setDashed(!graph.styleState().style.dashed)
      this.refresh()
    })
    width.appendChild(this.dashBtn)

    const font = group('字号')
    const smaller = this.button('−', '缩小字号', () => this.shiftFont(-1))
    this.fontVal = document.createElement('span')
    this.fontVal.className = s.styleVal
    this.fontVal.textContent = '11'
    const bigger = this.button('＋', '放大字号', () => this.shiftFont(1))
    this.fontBtns.push(smaller, bigger)
    font.append(smaller, this.fontVal, bigger)

    const arrows = group('箭头')
    for (const [mode, glyph, title] of ARROWS) {
      const b = this.button(glyph, title, () => {
        this.graph?.setArrows(mode)
        this.refresh()
      })
      this.arrowBtns.push(b)
      arrows.appendChild(b)
    }

    const sep = (): HTMLElement => {
      const el = document.createElement('span')
      el.className = s.sep
      return el
    }

    this.styleHint = document.createElement('span')
    this.styleHint.className = s.styleHint
    this.styleHint.textContent = '选中图形后可改样式'

    bar.append(fill, sep(), stroke, sep(), width, sep(), font, sep(), arrows, this.styleHint)
    return bar
  }

  private button(glyph: string, title: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = s.toolBtn
    b.textContent = glyph
    b.title = title
    b.addEventListener('click', run)
    return b
  }

  private shiftFont(delta: number): void {
    const graph = this.graph
    if (!graph) return
    const current = Number(graph.styleState().style.fontSize ?? 11)
    graph.setFontSize(Math.min(48, Math.max(8, current + delta)))
    this.refresh()
  }

  private missing(text: string): void {
    this.setStatus('打不开')
    const box = document.createElement('div')
    box.className = s.missing
    box.textContent = text
    this.root.replaceChildren(box)
  }

  /* ─────────────────────────── 加载 / 保存 ─────────────────────────── */

  private async load(): Promise<void> {
    try {
      const h = await this.ctx.rpc.call<{
        content: string | null
        doc: { title: string; deletedAt: number | null }
      }>('doc:open', { id: this.docId })
      if (this.disposed) return
      if (h.doc?.deletedAt) return this.missing('这篇笔记在回收站里')
      if (!h.content) return this.missing('找不到这篇笔记')

      this.json = JSON.parse(h.content) as JsonNode
      const block = this.findBlock()
      const node = block?.content?.find((n) => n.type === 'drawio') ?? null
      if (!block || !node) return this.missing('这个画布已经不在原来的笔记里了')
      this.node = node

      const xml = typeof node.attrs?.xml === 'string' ? node.attrs.xml : ''
      const graph = await createDrawioGraph(this.host, { xml, interactive: true })
      if (this.disposed) {
        graph.dispose()
        return
      }
      this.graph = graph
      // 拖动时 mxGraph 每挪一步就发一次 change —— 这里只重置保存防抖，别碰 DOM；
      // 按钮状态在 mouseup / keyup 时刷新一次就够。
      this.offChange = graph.onChange(() => this.schedule())
      this.refresh()
      this.setStatus('已保存')
      this.host.focus()
    } catch (err) {
      reportError('drawio', err)
      this.missing('打不开这个画布，原因已经写进 errors.log')
    }
  }

  private findBlock(): JsonNode | null {
    const group = this.json?.content?.find((n) => n.type === 'blockGroup')
    return group?.content?.find((n) => n.type === 'blockContainer' && n.attrs?.id === this.blockId) ?? null
  }

  private setStatus(text: string): void {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text
  }

  private schedule(): void {
    this.dirty = true
    this.setStatus('保存中…')
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.save(), SAVE_MS)
  }

  private async save(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const graph = this.graph
    if (!graph || !this.node) return
    // 先同步取出 XML 再 await —— 卸载时图已经拆了也还能拿到这一段。
    const xml = graph.serialize()
    this.node.attrs = { ...this.node.attrs, xml }
    const content = JSON.stringify(this.json)
    this.dirty = false
    try {
      // 不带 title / md：少了 reindex（FTS 重建），画布每存一次不该重灌一遍全文索引。
      await this.ctx.rpc.call('doc:apply', { id: this.docId, content, origin: 'user' })
      if (!this.disposed) this.setStatus('已保存')
    } catch (err) {
      this.dirty = true
      if (!this.disposed) this.setStatus('保存失败')
      reportError('drawio', err)
    }
  }

  private refresh(): void {
    const graph = this.graph
    const st: SelectionStyle = graph?.styleState() ?? { count: 0, vertex: false, edge: false, style: {} }
    this.connectBtn.disabled = st.count !== 2
    this.deleteBtn.disabled = st.count === 0
    this.undoBtn.disabled = !(graph?.canUndo() ?? false)
    this.redoBtn.disabled = !(graph?.canRedo() ?? false)
    this.zoomEl.textContent = `${Math.round((graph?.scale() ?? 1) * 100)}%`

    const grid = graph?.gridVisible() ?? false
    this.gridBtn.classList.toggle(s.toolOn, grid)
    this.gridBtn.setAttribute('aria-pressed', String(grid))

    const noCells = st.count === 0
    const noVertex = noCells || !st.vertex
    const noEdge = noCells || !st.edge
    for (const b of this.fillBtns) b.disabled = noVertex
    for (const b of this.strokeBtns) b.disabled = noCells
    for (const b of this.widthBtns) b.disabled = noCells
    for (const b of this.fontBtns) b.disabled = noCells
    for (const b of this.arrowBtns) b.disabled = noEdge
    this.dashBtn.disabled = noCells
    this.styleHint.style.display = noCells ? '' : 'none'

    const fill = color(st.style.fillColor, '#ffffff')
    const stroke = color(st.style.strokeColor, '#475569')
    for (const b of this.fillBtns) b.classList.toggle(s.swatchOn, b.dataset.color === fill)
    for (const b of this.strokeBtns) b.classList.toggle(s.swatchOn, b.dataset.color === stroke)

    const width = Number(st.style.strokeWidth ?? 1)
    WIDTHS.forEach((w, i) => this.widthBtns[i]?.classList.toggle(s.toolOn, w === width))
    this.dashBtn.classList.toggle(s.toolOn, st.style.dashed === true)
    this.fontVal.textContent = String(Number(st.style.fontSize ?? 11))

    const end = color(st.style.endArrow, 'classic') !== 'none'
    const start = color(st.style.startArrow, 'none') !== 'none'
    const mode = end && start ? 'both' : end ? 'end' : 'none'
    ARROWS.forEach(([m], i) => this.arrowBtns[i]?.classList.toggle(s.toolOn, m === mode && !noEdge))
  }

  /* ─────────────────────────── 右键菜单 ─────────────────────────── */

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    const graph = this.graph
    if (!graph) return
    const rect = this.host.getBoundingClientRect()
    // getCellAt 吃的是容器内的屏幕坐标（它拿 state 的屏幕位置去比）。
    const cell = graph.graph.getCellAt(e.clientX - rect.left, e.clientY - rect.top)
    if (cell) {
      if (!graph.graph.isCellSelected(cell)) graph.graph.setSelectionCell(cell)
    } else {
      graph.clearSelection()
    }
    this.refresh()
    this.openMenu(e.clientX, e.clientY)
  }

  private openMenu(x: number, y: number): void {
    this.closeMenu()
    const graph = this.graph
    if (!graph) return
    const menu = document.createElement('div')
    menu.className = s.menu

    const add = (label: string, run: () => void, disabled = false): void => {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = s.menuItem
      item.textContent = label
      item.disabled = disabled
      item.addEventListener('click', () => {
        this.closeMenu()
        run()
        this.refresh()
      })
      menu.appendChild(item)
    }
    const sep = (): void => {
      const el = document.createElement('div')
      el.className = s.menuSep
      menu.appendChild(el)
    }

    const count = graph.selectionCount()
    add('编辑文字', () => void graph.editLabel(), count !== 1)
    sep()
    add('复制', () => void graph.copySelection(), count === 0)
    add('剪切', () => void graph.cutSelection(), count === 0)
    add('粘贴', () => void graph.paste(), !graph.hasClipboard())
    add('创建副本', () => void graph.duplicate(), count === 0)
    add('删除', () => graph.removeSelected(), count === 0)
    sep()
    add('置顶', () => graph.bringToFront(), count === 0)
    add('置底', () => graph.sendToBack(), count === 0)

    document.body.appendChild(menu)
    const r = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - r.height - 8))}px`
    this.menu = menu
    // 捕获阶段关：点画布 / 点别处都收起，点菜单本身不关。
    setTimeout(() => document.addEventListener('mousedown', this.onDocDown, true), 0)
  }

  private readonly onDocDown = (e: MouseEvent): void => {
    if (this.menu && e.target instanceof Node && this.menu.contains(e.target)) return
    this.closeMenu()
  }

  private closeMenu(): void {
    document.removeEventListener('mousedown', this.onDocDown, true)
    this.menu?.remove()
    this.menu = null
  }

  /* ─────────────────────────── 键盘 ─────────────────────────── */

  private readonly onKey = (e: KeyboardEvent): void => {
    const t = e.target
    if (t instanceof HTMLElement) {
      if (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
    }
    const graph = this.graph
    if (!graph) return
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    if (e.code === 'Space') {
      e.preventDefault()
      this.setSpace(true)
      return
    }
    if (e.key === 'Escape') {
      if (this.menu) this.closeMenu()
      else graph.clearSelection()
      this.refresh()
      return
    }
    if (mod && key === 'z') {
      e.preventDefault()
      if (e.shiftKey) graph.redo()
      else graph.undo()
      this.refresh()
      return
    }
    if (mod && key === 'y') {
      e.preventDefault()
      graph.redo()
      this.refresh()
      return
    }
    if (mod && key === 'a') {
      e.preventDefault()
      graph.selectAll()
      this.refresh()
      return
    }
    if (mod && key === 'c') {
      e.preventDefault()
      if (graph.copySelection()) this.setStatus('已复制')
      return
    }
    if (mod && key === 'x') {
      e.preventDefault()
      if (graph.cutSelection()) {
        this.setStatus('已剪切')
        this.refresh()
      }
      return
    }
    if (mod && key === 'v') {
      e.preventDefault()
      if (graph.paste()) this.refresh()
      return
    }
    if (mod && key === 'd') {
      e.preventDefault()
      if (graph.duplicate()) this.refresh()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      graph.removeSelected()
      this.refresh()
    }
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.setSpace(false)
  }

  private readonly onBlur = (): void => this.setSpace(false)

  private setSpace(on: boolean): void {
    if (this.spacePan === on) return
    this.spacePan = on
    this.graph?.setSpacePan(on)
  }

  dispose(): void {
    this.disposed = true
    this.closeMenu()
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.dirty) void this.save()
    this.offChange?.()
    this.offChange = undefined
    this.graph?.dispose()
    this.graph = null
  }
}
