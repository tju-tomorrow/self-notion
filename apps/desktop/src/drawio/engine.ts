/**
 * drawio 画布的共享引擎（D-0216）：预览块和画布页都走这里。
 *
 * `@maxgraph/core` 只在第一次真正要画图时才动态装载 —— 冷启动和普通笔记不为它付费。
 * 读写的是 drawio 兼容的 `<mxGraphModel>`：读用 maxgraph 的 `Codec`（它注册了 mx 别名），
 * 写自己序列化（maxgraph 自己的编码输出 `<GraphDataModel>`，drawio 不认）。
 */
import type {
  AbstractCanvas2D,
  Cell,
  FitPlugin,
  Graph,
  PanningHandler,
  SelectionHandler,
  UndoableEdit,
} from '@maxgraph/core'
import '@maxgraph/core/css/common.css'

type Max = typeof import('@maxgraph/core')

const GRID = 10

let pending: Promise<Max> | undefined

function lib(): Promise<Max> {
  pending ??= import('@maxgraph/core').then((m) => {
    m.registerModelCodecs()
    installShapes(m)
    return m
  })
  return pending
}

/** maxgraph 自带图形只覆盖最基础的一撮，这几个是画流程图/架构图绕不开的。 */
function installShapes(m: Max): void {
  const { AbstractPathShape, ShapeRegistry } = m
  if (ShapeRegistry.get('parallelogram')) return

  class ParallelogramShape extends AbstractPathShape {
    redrawPath(c: AbstractCanvas2D, _x: number, _y: number, w: number, h: number): void {
      c.moveTo(0.22 * w, 0)
      c.lineTo(w, 0)
      c.lineTo(0.78 * w, h)
      c.lineTo(0, h)
      c.close()
    }
  }

  class DocumentShape extends AbstractPathShape {
    redrawPath(c: AbstractCanvas2D, _x: number, _y: number, w: number, h: number): void {
      c.moveTo(0, 0)
      c.lineTo(w, 0)
      c.lineTo(w, 0.86 * h)
      c.quadTo(0.75 * w, h, 0.5 * w, 0.92 * h)
      c.quadTo(0.25 * w, 0.84 * h, 0, 0.9 * h)
      c.close()
    }
  }

  class NoteShape extends AbstractPathShape {
    redrawPath(c: AbstractCanvas2D, _x: number, _y: number, w: number, h: number): void {
      c.moveTo(0, 0)
      c.lineTo(0.78 * w, 0)
      c.lineTo(w, 0.22 * h)
      c.lineTo(w, h)
      c.lineTo(0, h)
      c.close()
    }
  }

  class CardShape extends AbstractPathShape {
    redrawPath(c: AbstractCanvas2D, _x: number, _y: number, w: number, h: number): void {
      c.moveTo(0, 0.16 * h)
      c.lineTo(0.16 * w, 0)
      c.lineTo(w, 0)
      c.lineTo(w, h)
      c.lineTo(0, h)
      c.close()
    }
  }

  class BlockArrowShape extends AbstractPathShape {
    redrawPath(c: AbstractCanvas2D, _x: number, _y: number, w: number, h: number): void {
      c.moveTo(0, 0.28 * h)
      c.lineTo(0.62 * w, 0.28 * h)
      c.lineTo(0.62 * w, 0)
      c.lineTo(w, 0.5 * h)
      c.lineTo(0.62 * w, h)
      c.lineTo(0.62 * w, 0.72 * h)
      c.lineTo(0, 0.72 * h)
      c.close()
    }
  }

  ShapeRegistry.add('parallelogram', ParallelogramShape)
  ShapeRegistry.add('document', DocumentShape)
  ShapeRegistry.add('note', NoteShape)
  ShapeRegistry.add('card', CardShape)
  ShapeRegistry.add('blockArrow', BlockArrowShape)
}

/** 先把引擎块拉下来 —— 空画布没有预览可画，但点开时要它已经在手里。 */
export function warmDrawio(): void {
  void lib()
}

export interface PaletteShape {
  readonly id: string
  readonly label: string
  /** 工具条上的短字形 —— 不为几个图标引图标库。 */
  readonly glyph: string
  readonly style: Record<string, unknown>
  readonly size: [number, number]
}

export interface PaletteGroup {
  readonly label: string
  readonly items: readonly PaletteShape[]
}

const wrap = { whiteSpace: 'wrap' }

/** 程序员常用的一小撮，按用途分组；复杂 stencil 库下一轮再说。 */
export const PALETTE: readonly PaletteGroup[] = [
  {
    label: '基础',
    items: [
      { id: 'rect', label: '矩形', glyph: '▭', style: wrap, size: [120, 60] },
      { id: 'rounded', label: '圆角', glyph: '▢', style: { ...wrap, rounded: true }, size: [120, 60] },
      { id: 'ellipse', label: '椭圆', glyph: '◯', style: { ...wrap, shape: 'ellipse' }, size: [100, 100] },
      { id: 'terminator', label: '开始/结束', glyph: '◎', style: { ...wrap, shape: 'doubleEllipse' }, size: [110, 60] },
      { id: 'triangle', label: '三角', glyph: '△', style: { ...wrap, shape: 'triangle' }, size: [90, 80] },
      { id: 'hexagon', label: '六边形', glyph: '⬡', style: { ...wrap, shape: 'hexagon' }, size: [120, 80] },
      { id: 'rhombus', label: '判断', glyph: '◇', style: { ...wrap, shape: 'rhombus' }, size: [130, 80] },
      { id: 'blockArrow', label: '箭头', glyph: '➜', style: { ...wrap, shape: 'blockArrow' }, size: [120, 60] },
    ],
  },
  {
    label: '文档与数据',
    items: [
      { id: 'parallelogram', label: '输入/输出', glyph: '▱', style: { ...wrap, shape: 'parallelogram' }, size: [130, 60] },
      { id: 'document', label: '文档', glyph: '▤', style: { ...wrap, shape: 'document' }, size: [120, 80] },
      { id: 'note', label: '便签', glyph: '▨', style: { ...wrap, shape: 'note' }, size: [110, 80] },
      { id: 'card', label: '卡片', glyph: '▣', style: { ...wrap, shape: 'card' }, size: [120, 70] },
      { id: 'cylinder', label: '数据库', glyph: '⛁', style: { ...wrap, shape: 'cylinder' }, size: [100, 90] },
      { id: 'cloud', label: '云', glyph: '☁', style: { ...wrap, shape: 'cloud' }, size: [130, 80] },
    ],
  },
  {
    label: '结构',
    items: [
      { id: 'actor', label: '角色', glyph: '☺', style: { ...wrap, shape: 'actor' }, size: [70, 110] },
      { id: 'swimlane', label: '泳道', glyph: '⛶', style: { ...wrap, shape: 'swimlane', startSize: 24 }, size: [220, 140] },
      { id: 'uml', label: '类框', glyph: '▥', style: { ...wrap, shape: 'swimlane', startSize: 26, fontStyle: 1 }, size: [180, 120] },
      { id: 'text', label: '文本', glyph: 'T', style: { ...wrap, shape: 'label', strokeColor: 'none', fillColor: 'none' }, size: [120, 40] },
    ],
  },
]

/** 新连线：正交折线 + 经典箭头。 */
const EDGE_STYLE = {
  edgeStyle: 'orthogonalEdgeStyle',
  rounded: true,
  endArrow: 'classic',
}

export interface SelectionStyle {
  count: number
  vertex: boolean
  edge: boolean
  style: Record<string, unknown>
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
  insert(shape: PaletteShape, at?: { x: number; y: number }): void
  connectSelected(): boolean
  removeSelected(): void
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  selectionCount(): number
  styleState(): SelectionStyle
  setFill(color: string): void
  setStroke(color: string): void
  setStrokeWidth(width: number): void
  setDashed(on: boolean): void
  setFontSize(size: number): void
  setArrows(mode: 'end' | 'both' | 'none'): void
  copySelection(): boolean
  cutSelection(): boolean
  paste(): boolean
  duplicate(): boolean
  hasClipboard(): boolean
  bringToFront(): void
  sendToBack(): void
  editLabel(): boolean
  selectAll(): void
  clearSelection(): void
  setGridVisible(visible: boolean): void
  gridVisible(): boolean
  setSpacePan(active: boolean): void
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

  // 中性底：白底 + 石板灰边，跟界面的浅色/深色都不打架（画布本身是白纸）。
  const sheet = graph.getStylesheet()
  const dv = sheet.getDefaultVertexStyle()
  if (dv) {
    sheet.putDefaultVertexStyle({ ...dv, fillColor: '#ffffff', strokeColor: '#475569', fontColor: '#0f172a' })
  }
  const de = sheet.getDefaultEdgeStyle()
  if (de) sheet.putDefaultEdgeStyle({ ...de, strokeColor: '#475569', fontColor: '#334155' })

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

  graph.setGridSize(GRID)
  if (interactive) {
    const selection = graph.getPlugin<SelectionHandler>('SelectionHandler')
    if (selection) selection.guidesEnabled = true
  }

  /* ─────────────────────────── 点阵网格 ─────────────────────────── */

  let showGrid = interactive
  const paintGrid = (): void => {
    if (!showGrid) return
    const view = graph.getView()
    const step = GRID * view.scale
    if (step < 6) {
      container.style.backgroundImage = 'none'
      return
    }
    container.style.backgroundImage =
      'radial-gradient(circle, rgba(100, 116, 139, .45) 1px, transparent 1.3px)'
    container.style.backgroundSize = `${step}px ${step}px`
    container.style.backgroundPosition = `${view.translate.x}px ${view.translate.y}px`
  }
  if (interactive) {
    const view = graph.getView()
    view.addListener(m.InternalEvent.SCALE, paintGrid)
    view.addListener(m.InternalEvent.TRANSLATE, paintGrid)
    view.addListener(m.InternalEvent.SCALE_AND_TRANSLATE, paintGrid)
    paintGrid()
  }

  /* ─────────────────────────── 选中 / 样式 / 剪贴板 ─────────────────────────── */

  const selected = (): Cell[] => graph.getSelectionCells()

  const styleState = (): SelectionStyle => {
    const cells = selected()
    const first = cells[0]
    return {
      count: cells.length,
      vertex: cells.some((c) => c.isVertex()),
      edge: cells.some((c) => c.isEdge()),
      style: first ? (graph.getCurrentCellStyle(first, true) as Record<string, unknown>) : {},
    }
  }

  const apply = (key: 'fillColor' | 'strokeColor', value: string, verticesOnly: boolean): void => {
    const cells = selected().filter((c) => !verticesOnly || c.isVertex())
    if (cells.length) graph.setCellStyles(key, value, cells)
  }

  let clip: Cell[] = []
  let pastes = 0

  const viewCenter = (): { x: number; y: number } => {
    const view = graph.getView()
    return {
      x: (container.clientWidth / 2 - view.translate.x) / view.scale,
      y: (container.clientHeight / 2 - view.translate.y) / view.scale,
    }
  }

  const insert = (shape: PaletteShape, at?: { x: number; y: number }): void => {
    const [w, h] = shape.size
    const c = at ?? viewCenter()
    const drift = at ? 0 : (seq++ % 6) * GRID * 2
    graph.batchUpdate(() => {
      const cell = graph.insertVertex({
        value: '',
        position: [Math.round((c.x - w / 2 + drift) / GRID) * GRID, Math.round((c.y - h / 2 + drift) / GRID) * GRID],
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
      const cells = selected().filter((c) => c.isVertex())
      if (cells.length !== 2) return false
      graph.batchUpdate(() => {
        const edge = graph.insertEdge({ value: '', source: cells[0]!, target: cells[1]!, style: { ...EDGE_STYLE } })
        graph.setSelectionCell(edge)
      })
      return true
    },
    removeSelected: () => graph.removeCells(selected()),
    undo: () => undo.undo(),
    redo: () => undo.redo(),
    canUndo: () => undo.canUndo(),
    canRedo: () => undo.canRedo(),
    selectionCount: () => selected().length,
    styleState,
    setFill: (color) => apply('fillColor', color, true),
    setStroke: (color) => apply('strokeColor', color, false),
    setStrokeWidth: (width) => {
      const cells = selected()
      if (cells.length) graph.setCellStyles('strokeWidth', width, cells)
    },
    setDashed: (on) => {
      const cells = selected()
      if (cells.length) graph.setCellStyles('dashed', on, cells)
    },
    setFontSize: (size) => {
      const cells = selected()
      if (cells.length) graph.setCellStyles('fontSize', size, cells)
    },
    setArrows: (mode) => {
      const cells = selected().filter((c) => c.isEdge())
      if (!cells.length) return
      graph.setCellStyles('endArrow', mode === 'none' ? 'none' : 'classic', cells)
      graph.setCellStyles('startArrow', mode === 'both' ? 'classic' : 'none', cells)
    },
    copySelection: () => {
      const cells = selected()
      if (!cells.length) return false
      clip = graph.cloneCells(cells)
      pastes = 0
      return clip.length > 0
    },
    cutSelection: () => {
      const cells = selected()
      if (!cells.length) return false
      clip = graph.cloneCells(cells)
      pastes = 0
      graph.removeCells(cells)
      return true
    },
    paste: () => {
      if (!clip.length) return false
      pastes += 1
      const cells = graph.moveCells(clip, GRID * 2 * pastes, GRID * 2 * pastes, true)
      graph.setSelectionCells(cells)
      return true
    },
    duplicate: () => {
      const cells = selected()
      if (!cells.length) return false
      const added = graph.moveCells(cells, GRID * 2, GRID * 2, true)
      graph.setSelectionCells(added)
      return true
    },
    hasClipboard: () => clip.length > 0,
    bringToFront: () => graph.orderCells(false, selected()),
    sendToBack: () => graph.orderCells(true, selected()),
    editLabel: () => {
      const cell = selected()[0]
      if (!cell) return false
      graph.startEditingAtCell(cell)
      return true
    },
    selectAll: () => graph.selectAll(),
    clearSelection: () => graph.clearSelection(),
    setGridVisible: (visible) => {
      showGrid = visible
      if (!visible) container.style.backgroundImage = 'none'
      else paintGrid()
    },
    gridVisible: () => showGrid,
    setSpacePan: (active) => {
      const panning = graph.getPlugin<PanningHandler>('PanningHandler')
      if (panning) panning.ignoreCell = active
      container.style.cursor = active ? 'grab' : ''
    },
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
