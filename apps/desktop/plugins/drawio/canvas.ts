/**
 * 画布页的控制器：工具条 + maxgraph + 读写库（D-0216）。
 *
 * 数据这一侧只有两步：打开时 `doc:open` 拿整篇 JSON，改动防抖后把那一块的 `attrs.xml`
 * 换掉再 `doc:apply` 写回。笔记页没有同时开着（换标签时编辑器已卸载），所以不需要双向同步。
 */
import type { Context } from 'cordis'

import { createDrawioGraph, PALETTE, type DrawioGraph } from '../../src/drawio/engine'
import { drawioTabParts } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import * as s from './page.css'

interface JsonNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JsonNode[]
}

const SAVE_MS = 600

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
  private zoomEl!: HTMLElement

  private json: JsonNode | null = null
  private node: JsonNode | null = null
  private title = ''
  private graph: DrawioGraph | null = null
  private offChange: (() => void) | undefined
  private timer: number | undefined
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
    for (const shape of PALETTE) {
      const b = this.button(shape.glyph, shape.label, () => this.graph?.insert(shape))
      b.classList.add(s.shapeBtn)
      shapes.appendChild(b)
    }

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
    const out = this.button('−', '缩小', () => {
      this.graph?.zoomOut()
      this.refresh()
    })
    this.zoomEl = document.createElement('span')
    this.zoomEl.className = s.zoom
    this.zoomEl.textContent = '100%'
    const into = this.button('＋', '放大', () => {
      this.graph?.zoomIn()
      this.refresh()
    })
    const fit = this.button('⤢', '适应画布', () => {
      this.graph?.fit()
      this.refresh()
    })
    tools.append(this.connectBtn, this.deleteBtn, this.undoBtn, this.redoBtn, out, this.zoomEl, into, fit)

    this.statusEl = document.createElement('span')
    this.statusEl.className = s.status
    this.statusEl.textContent = '载入中…'

    tools.style.marginLeft = 'auto'
    bar.append(shapes, tools, this.statusEl)

    this.host = document.createElement('div')
    this.host.className = s.canvas
    this.host.tabIndex = 0
    this.host.addEventListener('contextmenu', (e) => e.preventDefault())
    this.host.addEventListener('mouseup', () => this.refresh())
    this.host.addEventListener('keyup', () => this.refresh())

    page.append(bar, this.host)
    this.root.appendChild(page)
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

  private missing(text: string): void {
    this.statusEl.textContent = '打不开'
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
      this.title = h.doc?.title ?? ''
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
      this.offChange = graph.onChange(() => {
        this.schedule()
        this.refresh()
      })
      this.refresh()
      this.statusEl.textContent = '已保存'
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

  private schedule(): void {
    this.dirty = true
    this.statusEl.textContent = '保存中…'
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
    const title = this.title
    this.dirty = false
    try {
      await this.ctx.rpc.call('doc:apply', { id: this.docId, content, title, origin: 'user' })
      if (!this.disposed) this.statusEl.textContent = '已保存'
    } catch (err) {
      this.dirty = true
      if (!this.disposed) this.statusEl.textContent = '保存失败'
      reportError('drawio', err)
    }
  }

  private refresh(): void {
    const graph = this.graph
    const selected = graph?.selectionCount() ?? 0
    this.connectBtn.disabled = selected !== 2
    this.deleteBtn.disabled = selected === 0
    this.undoBtn.disabled = !(graph?.canUndo() ?? false)
    this.redoBtn.disabled = !(graph?.canRedo() ?? false)
    this.zoomEl.textContent = `${Math.round((graph?.scale() ?? 1) * 100)}%`
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
      graph.graph.selectAll()
      this.refresh()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      graph.removeSelected()
      this.refresh()
      return
    }
    if (e.key === 'Escape') {
      graph.graph.clearSelection()
      this.refresh()
    }
  }

  dispose(): void {
    this.disposed = true
    window.removeEventListener('keydown', this.onKey)
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
