/**
 * drawio 画布的共享引擎（D-0216）：预览块和画布页都走这里。
 *
 * `@maxgraph/core` 只在第一次真正要画图时才动态装载 —— 冷启动和普通笔记不为它付费。
 * 读写的是 drawio 兼容的 `<mxGraphModel>`：读用 maxgraph 的 `Codec`（它注册了 mx 别名），
 * 写自己序列化（maxgraph 自己的编码输出 `<GraphDataModel>`，drawio 不认）。
 */
import type { Cell, FitPlugin, Graph, UndoableEdit } from '@maxgraph/core'
import '@maxgraph/core/css/common.css'

type Max = typeof import('@maxgraph/core')

let pending: Promise<Max> | undefined

function lib(): Promise<Max> {
  pending ??= import('@maxgraph/core').then((m) => {
    m.registerModelCodecs()
    return m
  })
  return pending
}

export interface PaletteShape {
  readonly id: string
  readonly label: string
  /** 工具条上的短字形 —— 不为几个图标引图标库。 */
  readonly glyph: string
  readonly style: Record<string, unknown>
  readonly size: [number, number]
}

/** 程序员常用的一小撮。maxGraph 默认注册的图形就这些，复杂 stencil 库下一轮再说。 */
export const PALETTE: readonly PaletteShape[] = [
  { id: 'rect', label: '矩形', glyph: '▭', style: { whiteSpace: 'wrap', html: 1 }, size: [120, 60] },
  { id: 'rounded', label: '圆角', glyph: '▢', style: { rounded: true, whiteSpace: 'wrap', html: 1 }, size: [120, 60] },
  { id: 'ellipse', label: '椭圆', glyph: '◯', style: { shape: 'ellipse', whiteSpace: 'wrap', html: 1 }, size: [100, 100] },
  { id: 'rhombus', label: '判断', glyph: '◇', style: { shape: 'rhombus', whiteSpace: 'wrap', html: 1 }, size: [130, 80] },
  { id: 'cylinder', label: '数据库', glyph: '⛁', style: { shape: 'cylinder', whiteSpace: 'wrap', html: 1 }, size: [100, 90] },
  { id: 'cloud', label: '云', glyph: '☁', style: { shape: 'cloud', whiteSpace: 'wrap', html: 1 }, size: [130, 80] },
  { id: 'hexagon', label: '六边形', glyph: '⬡', style: { shape: 'hexagon', whiteSpace: 'wrap', html: 1 }, size: [120, 80] },
  { id: 'triangle', label: '三角', glyph: '△', style: { shape: 'triangle', whiteSpace: 'wrap', html: 1 }, size: [90, 80] },
  { id: 'actor', label: '角色', glyph: '☺', style: { shape: 'actor', whiteSpace: 'wrap', html: 1 }, size: [70, 110] },
  { id: 'text', label: '文本', glyph: 'T', style: { shape: 'label', strokeColor: 'none', fillColor: 'none', whiteSpace: 'wrap', html: 1 }, size: [120, 40] },
]

/** 新连线：正交折线 + 经典箭头。 */
const EDGE_STYLE = {
  edgeStyle: 'orthogonalEdgeStyle',
  rounded: true,
  html: 1,
  endArrow: 'classic',
}

export interface DrawioGraph {
  graph: Graph
  /** 画布内容转成 drawio XML。 */
  serialize(): string
  fit(): void
  zoomIn(): void
  zoomOut(): void
  actualSize(): void
  scale(): number
  insert(shape: PaletteShape): void
  connectSelected(): boolean
  removeSelected(): void
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  selectionCount(): number
  onChange(cb: () => void): () => void
  dispose(): void
}

export interface CreateOptions {
  xml?: string
  interactive?: boolean
}

export async function createDrawioGraph(
  container: HTMLElement,
  opts: CreateOptions = {},
): Promise<DrawioGraph> {
  const m = await lib()
  const interactive = opts.interactive === true
  const graph = new m.Graph(
    container,
    undefined,
    interactive ? [...m.getDefaultPlugins(), m.RubberBandHandler] : [m.FitPlugin],
  )
  graph.setTooltips(false)
  graph.setPanning(interactive)
  if (!interactive) graph.setEnabled(false)

  const model = graph.getDataModel()
  const xml = opts.xml?.trim() ?? ''
  if (xml) {
    try {
      const doc = new DOMParser().parseFromString(xml, 'text/xml')
      if (doc.documentElement.nodeName !== 'parsererror') {
        new m.Codec(doc).decode(doc.documentElement, model)
      }
    } catch {
      // XML 坏了就当空画布：预览块不该因为一段坏数据整块消失。
    }
  }

  let seq = 0
  const changes = new Set<() => void>()
  const emitChange = (): void => {
    for (const cb of changes) cb()
  }

  const undo = new m.UndoManager()
  const record = (_sender: unknown, evt: { getProperty(name: string): unknown }): void => {
    const edit = evt.getProperty('edit')
    if (edit) undo.undoableEditHappened(edit as UndoableEdit)
  }
  if (interactive) {
    model.addListener(m.InternalEvent.UNDO, record)
    graph.getView().addListener(m.InternalEvent.UNDO, record)
  }
  model.addListener(m.InternalEvent.CHANGE, emitChange)

  const hasCells = (): boolean => {
    const root = model.getRoot()
    if (!root) return false
    const layer = root.getChildAt(0)
    return layer != null && layer.getChildCount() > 0
  }

  const fit = (): void => {
    if (!hasCells()) return
    graph.getPlugin<FitPlugin>('fit')?.fitCenter({ margin: 16 })
  }

  if (!interactive) fit()

  const viewCenter = (): { x: number; y: number } => {
    const view = graph.getView()
    return {
      x: (container.clientWidth / 2 - view.translate.x) / view.scale,
      y: (container.clientHeight / 2 - view.translate.y) / view.scale,
    }
  }

  const insert = (shape: PaletteShape): void => {
    const [w, h] = shape.size
    const c = viewCenter()
    const drift = (seq++ % 6) * 18
    graph.batchUpdate(() => {
      const cell = graph.insertVertex({
        value: '',
        position: [c.x - w / 2 + drift, c.y - h / 2 + drift],
        size: [w, h],
        style: { ...shape.style },
      })
      graph.setSelectionCell(cell)
    })
  }

  return {
    graph,
    serialize: () => graphToXml(graph),
    fit,
    zoomIn: () => graph.zoomIn(),
    zoomOut: () => graph.zoomOut(),
    actualSize: () => graph.zoomActual(),
    scale: () => graph.getView().scale,
    insert,
    connectSelected: () => {
      const cells = graph.getSelectionCells().filter((c) => c.isVertex())
      if (cells.length !== 2) return false
      graph.batchUpdate(() => {
        const edge = graph.insertEdge({ value: '', source: cells[0]!, target: cells[1]!, style: { ...EDGE_STYLE } })
        graph.setSelectionCell(edge)
      })
      return true
    },
    removeSelected: () => graph.removeCells(graph.getSelectionCells()),
    undo: () => undo.undo(),
    redo: () => undo.redo(),
    canUndo: () => undo.canUndo(),
    canRedo: () => undo.canRedo(),
    selectionCount: () => graph.getSelectionCells().length,
    onChange: (cb) => {
      changes.add(cb)
      return () => void changes.delete(cb)
    },
    dispose: () => {
      for (const cb of changes) changes.delete(cb)
      try {
        graph.destroy()
      } catch {
        // 已经拆过就什么都不做。
      }
      container.replaceChildren()
    },
  }
}

/* ─────────────────────────── XML ─────────────────────────── */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const num = (v: number): string => String(Math.round(v * 100) / 100)

function styleOf(style: unknown): string {
  if (typeof style === 'string') return style
  if (style == null || typeof style !== 'object') return ''
  const out: string[] = []
  for (const [key, value] of Object.entries(style as Record<string, unknown>)) {
    if (key === 'baseStyleNames') continue
    if (value == null || value === '') continue
    if (typeof value === 'object') continue
    out.push(`${key}=${value === true ? 1 : value === false ? 0 : String(value)}`)
  }
  return out.join(';')
}

function geometryXml(cell: Cell): string {
  const g = cell.geometry
  if (!g) return ''
  const attrs: string[] = []
  const inner: string[] = []
  if (g.relative) {
    attrs.push('relative="1"')
  } else if (cell.isVertex()) {
    attrs.push(`x="${num(g.x)}"`, `y="${num(g.y)}"`, `width="${num(g.width)}"`, `height="${num(g.height)}"`)
  }
  if (g.offset) attrs.push(`offset="${num(g.offset.x)}"`)
  if (g.sourcePoint) {
    inner.push(`<mxPoint x="${num(g.sourcePoint.x)}" y="${num(g.sourcePoint.y)}" as="sourcePoint" />`)
  }
  if (g.targetPoint) {
    inner.push(`<mxPoint x="${num(g.targetPoint.x)}" y="${num(g.targetPoint.y)}" as="targetPoint" />`)
  }
  const points = g.points ?? []
  if (points.length) {
    inner.push(
      `<Array as="points">${points.map((p) => `<mxPoint x="${num(p.x)}" y="${num(p.y)}" />`).join('')}</Array>`,
    )
  }
  attrs.push('as="geometry"')
  const head = `<mxGeometry ${attrs.join(' ')}`
  return inner.length ? `${head}>${inner.join('')}</mxGeometry>` : `${head} />`
}

function cellXml(cell: Cell, root: boolean): string {
  const attrs: string[] = []
  const id = cell.getId()
  if (id) attrs.push(`id="${esc(id)}"`)
  if (!root) {
    const parent = cell.getParent()
    if (parent && parent !== cell) attrs.push(`parent="${esc(parent.getId() ?? '')}"`)
  }
  const value = cell.getValue()
  if (typeof value === 'string' && value !== '') attrs.push(`value="${esc(value)}"`)
  const style = styleOf(cell.getStyle())
  if (style) attrs.push(`style="${esc(style)}"`)
  if (cell.isVertex()) attrs.push('vertex="1"')
  if (cell.isEdge()) attrs.push('edge="1"')
  const source = cell.source?.getId()
  if (source) attrs.push(`source="${esc(source)}"`)
  const target = cell.target?.getId()
  if (target) attrs.push(`target="${esc(target)}"`)
  const geo = geometryXml(cell)
  return geo ? `<mxCell ${attrs.join(' ')}>${geo}</mxCell>` : `<mxCell ${attrs.join(' ')} />`
}

export function graphToXml(graph: Graph): string {
  const model = graph.getDataModel()
  const root = model.getRoot()
  if (!root) return ''
  const out: string[] = []
  const visit = (cell: Cell, isRoot: boolean): void => {
    out.push(cellXml(cell, isRoot))
    for (let i = 0; i < cell.getChildCount(); i += 1) visit(cell.getChildAt(i), false)
  }
  visit(root, true)
  return `<mxGraphModel><root>${out.join('')}</root></mxGraphModel>`
}
