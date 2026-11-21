/**
 * 表格（P3，D-0135）—— 逻辑全在官方 `prosemirror-tables`，这里只做接线。
 *
 * ★ 接线顺序（重要）：这组插件要排在 `notionKeymap` **之前**。tableEditing 在表格里接管
 *   方向键与 Backspace（删单元格选区），排在后面的话 Notion 那套 backspace 会先吃掉这些键。
 * ★ 列宽拖拽要排在 tableEditing **之前**：边线上的 mousedown 先拿走，不然会被当成划选单元格。
 * ★ Tab / Shift-Tab（下一格 / 上一格）**不在** tableEditing 里 —— 那是 `commands/table.ts` 的
 *   `nextCell` / `prevCell`，绑在 notionKeymap 上；表格外 goToNextCell 返回 false，自然落回缩进。
 */
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import {
  TableMap,
  TableView,
  addColumnAfter,
  addRowAfter,
  columnResizing,
  columnResizingPluginKey,
  deleteColumn,
  deleteRow,
  isInTable,
  mergeCells,
  moveTableColumn,
  moveTableRow,
  selectedRect,
  splitCell,
  tableEditing,
} from 'prosemirror-tables'

import { schema } from '../schema'
import './table.css'

/** 拖到比这更窄就停。跟样式里单元格的下限同一数。 */
const CELL_MIN = 48
/** 还没拖过的列按这个宽算，列多了就超出版心，由外层横向滚动。 */
const CELL_DEFAULT = 120
const HANDLE = 6
/** 触屏列边命中区，比鼠标那条 6px 线宽得多。 */
const TOUCH_EDGE = 20

const isMobile = (): boolean => document.documentElement.getAttribute('data-mobile') === '1'

/** 浮层定位优先取可视视口。 */
function viewport(): { width: number; height: number; top: number; left: number } {
  const v = window.visualViewport
  return v
    ? { width: v.width, height: v.height, top: v.offsetTop, left: v.offsetLeft }
    : { width: window.innerWidth, height: window.innerHeight, top: 0, left: 0 }
}

export function tablePlugin(): Plugin[] {
  return [
    // 先把每列当前像素宽写进 colwidth，再让官方插件只改被拖的那一列——别的列不跟着被挤瘦。
    freezeWidthsPlugin(),
    columnResizing({
      View: SnTableView,
      cellMinWidth: CELL_MIN,
      defaultCellMinWidth: CELL_DEFAULT,
      handleWidth: HANDLE,
    }),
    tableEditing(),
    tableBarPlugin(),
    // 官方 columnResizing 只听 mouse；触屏这条自己按 Pointer Events 改列宽。
    columnResizePointersPlugin(),
  ]
}

/** 光标进表格时浮出来的那排按钮（Notion 的表格上沿那一条）。 */
function tableBarPlugin(): Plugin {
  return new Plugin({
    view(view) {
      const bar = document.createElement('div')
      bar.className = 'sn-table-bar'
      bar.hidden = true
      const moveCurrent = (kind: 'row' | 'col', delta: number): void => {
        const state = view.state
        if (!isInTable(state)) return
        const rect = selectedRect(state)
        if (kind === 'row') {
          const from = rect.top
          const to = from + delta
          if (to < 0 || to >= rect.map.height) return
          moveTableRow({ from, to })(state, view.dispatch)
        } else {
          const from = rect.left
          const to = from + delta
          if (to < 0 || to >= rect.map.width) return
          moveTableColumn({ from, to })(state, view.dispatch)
        }
      }
      const btn = (label: string, run: () => void): void => {
        const el = document.createElement('button')
        el.type = 'button'
        el.textContent = label
        el.className = 'sn-table-bar-btn'
        el.addEventListener('mousedown', (e) => e.preventDefault())
        el.addEventListener('click', () => {
          run()
          view.focus()
          sync()
        })
        bar.appendChild(el)
      }
      btn('+ 行', () => addRowAfter(view.state, view.dispatch))
      btn('+ 列', () => addColumnAfter(view.state, view.dispatch))
      btn('删行', () => deleteRow(view.state, view.dispatch))
      btn('删列', () => deleteColumn(view.state, view.dispatch))
      btn('合并', () => mergeCells(view.state, view.dispatch))
      btn('拆分', () => splitCell(view.state, view.dispatch))
      // 行 / 列重排（Notion 是拖，这里先给按钮）。
      btn('行↑', () => moveCurrent('row', -1))
      btn('行↓', () => moveCurrent('row', 1))
      btn('列←', () => moveCurrent('col', -1))
      btn('列→', () => moveCurrent('col', 1))
      btn('删除表格', () => {
        const at = tablePos(view.state)
        if (at === null) return
        const node = view.state.doc.nodeAt(at)
        if (node) view.dispatch(view.state.tr.delete(at, at + node.nodeSize))
      })
      document.body.appendChild(bar)

      /* ── 行 / 列拖动手柄 ─────────────────────────────────────────────── */
      const rowGrip = document.createElement('div')
      rowGrip.className = 'sn-table-grip sn-table-grip-row'
      rowGrip.hidden = true
      const colGrip = document.createElement('div')
      colGrip.className = 'sn-table-grip sn-table-grip-col'
      colGrip.hidden = true
      const line = document.createElement('div')
      line.className = 'sn-table-drop'
      line.hidden = true
      document.body.append(rowGrip, colGrip, line)

      interface Hover {
        table: HTMLTableElement
        row: number
        col: number
      }
      let hover: Hover | null = null
      let drag: { kind: 'row' | 'col'; table: HTMLTableElement; from: number; pos: number } | null = null

      const place = (): void => {
        if (!hover) {
          rowGrip.hidden = colGrip.hidden = true
          return
        }
        const rowEl = hover.table.rows[hover.row]
        const cellEl = rowEl?.cells[Math.min(hover.col, rowEl.cells.length - 1)]
        if (!rowEl || !cellEl) return
        const tableRect = hover.table.getBoundingClientRect()
        const rowRect = rowEl.getBoundingClientRect()
        const cellRect = cellEl.getBoundingClientRect()
        rowGrip.hidden = false
        const vp = viewport()
        const half = isMobile() ? 14 : 8
        // 放手柄槽右侧：左边已经被块手柄占了（表格第一行两个会叠在一起）。
        rowGrip.style.left = `${Math.min(tableRect.right + 2, vp.left + vp.width - (isMobile() ? half * 2 : 18))}px`
        rowGrip.style.top = `${rowRect.top + rowRect.height / 2 - half}px`
        colGrip.hidden = false
        colGrip.style.left = `${cellRect.left + cellRect.width / 2 - half}px`
        colGrip.style.top = `${tableRect.top - (isMobile() ? half * 2 - 2 : 14)}px`
      }

      const hide = (): void => {
        hover = null
        rowGrip.hidden = colGrip.hidden = true
      }

      const onHover = (e: MouseEvent): void => {
        if (drag || isMobile()) return
        const target = e.target
        if (!(target instanceof Element)) return hide()
        if (rowGrip.contains(target) || colGrip.contains(target)) return
        const table = target.closest('table')
        if (!(table instanceof HTMLTableElement) || !view.dom.contains(table)) return hide()
        const rowEl = target.closest('tr')
        const cellEl = target.closest('td, th')
        if (!(rowEl instanceof HTMLTableRowElement) || !(cellEl instanceof HTMLTableCellElement)) return hide()
        hover = {
          table,
          row: rowEl.sectionRowIndex,
          col: cellEl.cellIndex,
        }
        place()
      }

      // 手机没有 hover：光标落在表里就常显手柄，跟着选区那格摆；离开表就收起。
      const placeFromSelection = (): void => {
        if (drag) return
        const node = view.domAtPos(view.state.selection.$from.pos).node
        const el = node instanceof Element ? node : node.parentElement
        const cellEl = el?.closest('td, th')
        const rowEl = cellEl?.closest('tr')
        const table = cellEl?.closest('table')
        if (
          !(cellEl instanceof HTMLTableCellElement) ||
          !(rowEl instanceof HTMLTableRowElement) ||
          !(table instanceof HTMLTableElement) ||
          !view.dom.contains(table)
        ) {
          hover = null
          rowGrip.hidden = colGrip.hidden = true
          return
        }
        hover = { table, row: rowEl.sectionRowIndex, col: cellEl.cellIndex }
        place()
      }

      const tablePosOf = (table: HTMLTableElement): number | null => {
        let found: number | null = null
        view.state.doc.descendants((node, pos) => {
          if (found !== null) return false
          if (node.type.name !== 'table') return undefined
          const dom = view.nodeDOM(pos)
          if (dom instanceof HTMLElement && (dom === table || dom.contains(table))) {
            found = pos
            return false
          }
          return undefined
        })
        return found
      }

      const startDrag = (kind: 'row' | 'col') => (e: PointerEvent): void => {
        if (!hover) return
        const pos = tablePosOf(hover.table)
        if (pos === null) return
        e.preventDefault()
        const grip = e.currentTarget
        if (grip instanceof HTMLElement) grip.setPointerCapture(e.pointerId)
        drag = { kind, table: hover.table, from: kind === 'row' ? hover.row : hover.col, pos }
        const onMove = (ev: PointerEvent): void => {
          if (!drag || ev.pointerId !== e.pointerId) return
          const rect = drag.table.getBoundingClientRect()
          const index = indexAt(drag.table, drag.kind, ev.clientX, ev.clientY)
          if (index === null) {
            line.hidden = true
            return
          }
          line.hidden = false
          if (drag.kind === 'row') {
            const rowRect = drag.table.rows[index]?.getBoundingClientRect()
            if (!rowRect) return
            line.style.left = `${rect.left}px`
            line.style.width = `${rect.width}px`
            line.style.height = '2px'
            line.style.top = `${ev.clientY > rowRect.top + rowRect.height / 2 ? rowRect.bottom : rowRect.top}px`
          } else {
            const cellRect = drag.table.rows[0]?.cells[Math.min(index, (drag.table.rows[0]?.cells.length ?? 1) - 1)]?.getBoundingClientRect()
            if (!cellRect) return
            line.style.top = `${rect.top}px`
            line.style.height = `${rect.height}px`
            line.style.width = '2px'
            line.style.left = `${ev.clientX > cellRect.left + cellRect.width / 2 ? cellRect.right : cellRect.left}px`
          }
        }
        const cleanup = (): void => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onCancel)
        }
        const onUp = (ev: PointerEvent): void => {
          if (ev.pointerId !== e.pointerId) return
          const current = drag
          drag = null
          line.hidden = true
          cleanup()
          if (!current) return
          const index = indexAt(current.table, current.kind, ev.clientX, ev.clientY)
          if (index === null || index === current.from) return
          const state = view.state
          const target = current.kind === 'row' ? Math.min(index, tableHeight(current.table) - 1) : Math.min(index, tableWidth(current.table) - 1)
          if (current.kind === 'row') moveTableRow({ from: current.from, to: target, pos: current.pos, select: false })(state, view.dispatch)
          else moveTableColumn({ from: current.from, to: target, pos: current.pos, select: false })(state, view.dispatch)
        }
        const onCancel = (ev: PointerEvent): void => {
          if (ev.pointerId !== e.pointerId) return
          drag = null
          line.hidden = true
          cleanup()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onCancel)
      }

      rowGrip.addEventListener('pointerdown', startDrag('row'))
      colGrip.addEventListener('pointerdown', startDrag('col'))
      document.addEventListener('mousemove', onHover, true)
      // 手机靠 sync/placeFromSelection 维持常显，桌面才在滚动时收起 hover 手柄。
      const onScrollHide = (): void => { if (!isMobile()) hide() }
      document.addEventListener('scroll', onScrollHide, true)

      const sync = (): void => {
        if (isMobile()) placeFromSelection()
        const at = tablePos(view.state)
        if (at === null) {
          bar.hidden = true
          return
        }
        const dom = view.nodeDOM(at)
        if (!(dom instanceof HTMLElement)) {
          bar.hidden = true
          return
        }
        const rect = dom.getBoundingClientRect()
        const vp = viewport()
        const bottom = vp.top + vp.height
        if (rect.bottom < vp.top || rect.top > bottom) {
          bar.hidden = true
          return
        }
        bar.hidden = false
        const width = bar.getBoundingClientRect().width
        const top = rect.top >= vp.top + 30 ? rect.top - 28 : rect.bottom + 4
        bar.style.left = `${Math.max(vp.left + 4, Math.min(rect.right - width, vp.left + vp.width - width - 4))}px`
        bar.style.top = `${Math.max(vp.top + 4, top)}px`
      }
      sync()
      const onScroll = (): void => sync()
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', onScroll)
      return {
        update: sync,
        destroy: () => {
          window.removeEventListener('scroll', onScroll, true)
          window.removeEventListener('resize', onScroll)
          document.removeEventListener('mousemove', onHover, true)
          document.removeEventListener('scroll', onScrollHide, true)
          bar.remove()
          rowGrip.remove()
          colGrip.remove()
          line.remove()
        },
      }
    },
  })
}

/**
 * 触屏列宽拖拽。官方 columnResizing 只挂 mouse，这里用 Pointer Events 自己改 colwidth；
 * 拖动过程只动 <col> 的 DOM 宽度，松手才提交一次事务，避免一步一个历史记录。
 */
function columnResizePointersPlugin(): Plugin {
  return new Plugin({
    view(view) {
      let drag: {
        pointerId: number
        startX: number
        startWidth: number
        startWidthLive: number
        cell: number
      } | null = null

      const edgeCell = (x: number, y: number): { cell: number; width: number } | null => {
        const el = document.elementFromPoint(x, y)
        if (!(el instanceof Element)) return null
        const cellEl = el.closest('td, th')
        if (!(cellEl instanceof HTMLTableCellElement) || !view.dom.contains(cellEl)) return null
        const rect = cellEl.getBoundingClientRect()
        if (x < rect.left || rect.right - x > TOUCH_EDGE) return null
        const found = view.posAtCoords({ left: x, top: y })
        if (!found) return null
        const $pos = view.state.doc.resolve(found.pos)
        for (let d = $pos.depth - 1; d > 0; d--) {
          if ($pos.node(d).type.name === 'table_row') return { cell: $pos.before(d + 1), width: rect.width }
        }
        return null
      }

      const colIndexOf = (cell: number): { table: PMNode; map: TableMap; start: number; col: number } | null => {
        const $cell = view.state.doc.resolve(cell)
        const table = $cell.node(-1)
        if (table.type !== schema.nodes.table) return null
        const map = TableMap.get(table)
        const start = $cell.start(-1)
        const span = ($cell.nodeAfter?.attrs.colspan as number) ?? 1
        return { table, map, start, col: map.colCount($cell.pos - start) + span - 1 }
      }

      // 拖动时只改 colgroup，跟手不写文档。
      const preview = (cell: number, width: number): void => {
        const hit = colIndexOf(cell)
        if (!hit) return
        const $cell = view.state.doc.resolve(cell)
        const wrap = view.nodeDOM($cell.before(-1))
        const tableEl = wrap instanceof HTMLElement ? wrap.querySelector('table') : null
        const group = tableEl?.querySelector('colgroup')
        if (!(tableEl instanceof HTMLTableElement) || !group) return
        let total = 0
        for (let i = 0; i < hit.map.width; i++) {
          const colEl = group.children[i]
          const cur = colEl instanceof HTMLElement ? parseFloat(colEl.style.width) : NaN
          const base = Number.isFinite(cur) && cur > 0 ? cur : CELL_DEFAULT
          const w = i === hit.col ? width : base
          if (colEl instanceof HTMLElement) colEl.style.width = `${w}px`
          total += w
        }
        tableEl.style.width = `${total}px`
      }

      const commit = (cell: number, width: number): void => {
        const hit = colIndexOf(cell)
        if (!hit) return
        const { table, map, start, col } = hit
        const tr = view.state.tr
        for (let row = 0; row < map.height; row++) {
          const idx = row * map.width + col
          if (row && map.map[idx] === map.map[idx - map.width]) continue
          const pos = map.map[idx]
          const node = table.nodeAt(pos)
          if (!node) continue
          const span = node.attrs.colspan as number
          const index = span === 1 ? 0 : col - map.colCount(pos)
          const colwidth = (node.attrs.colwidth as number[] | null)?.slice() ?? Array.from({ length: span }, () => CELL_DEFAULT)
          if (colwidth[index] === width) continue
          colwidth[index] = width
          tr.setNodeMarkup(start + pos, undefined, { ...node.attrs, colwidth })
        }
        if (tr.docChanged) view.dispatch(tr)
      }

      const blockScroll = (e: TouchEvent): void => {
        if (drag) e.preventDefault()
      }
      const cleanup = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('touchmove', blockScroll)
      }
      const onMove = (e: PointerEvent): void => {
        if (!drag || e.pointerId !== drag.pointerId) return
        e.preventDefault()
        const w = Math.max(CELL_MIN, Math.round(drag.startWidth + e.clientX - drag.startX))
        preview(drag.cell, w)
        drag.startWidthLive = w
      }
      const onUp = (e: PointerEvent): void => {
        if (!drag || e.pointerId !== drag.pointerId) return
        const current = drag
        drag = null
        cleanup()
        commit(current.cell, current.startWidthLive)
      }
      const onCancel = (e: PointerEvent): void => {
        if (!drag || e.pointerId !== drag.pointerId) return
        drag = null
        cleanup()
      }
      const onDown = (e: PointerEvent): void => {
        if (e.pointerType === 'mouse' || !e.isPrimary || drag) return
        const hit = edgeCell(e.clientX, e.clientY)
        if (!hit) return
        e.preventDefault()
        freezeColumnWidths(view, hit.cell)
        const node = view.state.doc.nodeAt(hit.cell)
        const span = (node?.attrs.colspan as number) ?? 1
        const cw = node?.attrs.colwidth as number[] | null
        const startWidth = cw?.length ? cw[cw.length - 1] : Math.max(CELL_MIN, hit.width / span)
        drag = { pointerId: e.pointerId, startX: e.clientX, startWidth, startWidthLive: startWidth, cell: hit.cell }
        view.dom.setPointerCapture(e.pointerId)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onCancel)
        window.addEventListener('touchmove', blockScroll, { passive: false })
      }
      view.dom.addEventListener('pointerdown', onDown)
      return {
        destroy: () => {
          view.dom.removeEventListener('pointerdown', onDown)
          cleanup()
          drag = null
        },
      }
    },
  })
}

/** 指针落在第几行 / 第几列（不在表里 → null）。列按第一行的 cellIndex 算，跨列时落在起始列。 */
function indexAt(table: HTMLTableElement, kind: 'row' | 'col', x: number, y: number): number | null {
  const rect = table.getBoundingClientRect()
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null
  if (kind === 'row') {
    for (let i = 0; i < table.rows.length; i += 1) {
      const r = table.rows[i].getBoundingClientRect()
      if (y >= r.top && y <= r.bottom) return i
    }
    return null
  }
  const first = table.rows[0]
  if (!first) return null
  for (let i = 0; i < first.cells.length; i += 1) {
    const c = first.cells[i].getBoundingClientRect()
    if (x >= c.left && x <= c.right) return first.cells[i].cellIndex
  }
  return null
}

const tableHeight = (table: HTMLTableElement): number => table.rows.length

const tableWidth = (table: HTMLTableElement): number => {
  let width = 0
  for (const row of Array.from(table.rows)) {
    let n = 0
    for (const cell of Array.from(row.cells)) n += cell.colSpan
    width = Math.max(width, n)
  }
  return width
}

/** 光标所在表格节点的位置（不在表格里 → null）。 */
function tablePos(state: EditorState): number | null {
  const $from = state.selection.$from
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === 'table') return $from.before(d)
  }
  return null
}

/** 官方 TableView 自己造 `<table>`，不走 schema 的 toDOM，类名得在这儿补。 */
class SnTableView extends TableView {
  constructor(node: PMNode, defaultCellMinWidth: number, _view: EditorView) {
    super(node, defaultCellMinWidth)
    this.dom.classList.add('sn-table-wrap')
    this.table.classList.add('sn-table')
  }
}

function freezeWidthsPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(view) {
          const handle = columnResizingPluginKey.getState(view.state)?.activeHandle ?? -1
          if (handle < 0) return false
          freezeColumnWidths(view, handle)
          return false
        },
      },
    },
  })
}

/** 把当前各列的像素宽记到每一格的 colwidth 上。已经记过的不写。 */
function freezeColumnWidths(view: EditorView, handle: number): void {
  const $cell = view.state.doc.resolve(handle)
  const table = $cell.node(-1)
  if (table.type !== schema.nodes.table) return
  const map = TableMap.get(table)
  const start = $cell.start(-1)
  const wrap = view.nodeDOM($cell.before(-1))
  const tableEl = wrap instanceof HTMLElement ? wrap.querySelector('table') : null
  const firstRow = tableEl?.querySelector('tr')
  if (!tableEl || !firstRow) return

  const widths: number[] = []
  for (const cell of firstRow.children) {
    if (!(cell instanceof HTMLElement)) continue
    const span = Number(cell.getAttribute('colspan') || '1')
    const each = Math.max(CELL_MIN, Math.round(cell.offsetWidth / span))
    for (let i = 0; i < span; i++) widths.push(each)
  }
  if (widths.length < map.width) return
  // 边框折叠会让各格 offsetWidth 之和略大于表格本身，按表格实宽收回去，避免一按手柄就冒出滚动条。
  const sum = widths.reduce((a, b) => a + b, 0)
  const fit = tableEl.clientWidth
  if (sum > fit + 1 && fit > 0) {
    const scale = fit / sum
    for (let i = 0; i < widths.length; i++) widths[i] = Math.max(CELL_MIN, Math.round(widths[i] * scale))
  }

  const tr = view.state.tr
  const seen = new Set<number>()
  for (let i = 0; i < map.map.length; i++) {
    const rel = map.map[i]
    if (rel == null || seen.has(rel)) continue
    seen.add(rel)
    const cell = table.nodeAt(rel)
    if (!cell) continue
    const span = cell.attrs.colspan as number
    const col = map.colCount(rel)
    const next = Array.from({ length: span }, (_, j) => widths[col + j] ?? CELL_DEFAULT)
    const prev = cell.attrs.colwidth as number[] | null
    if (prev && prev.length === next.length && prev.every((w, j) => w === next[j])) continue
    tr.setNodeMarkup(start + rel, undefined, { ...cell.attrs, colwidth: next })
  }
  if (tr.docChanged) view.dispatch(tr)
}

/** 3×3 空表的行 —— 每格一个空段落（cellContent 是 `blockContent+`，空单元格建不出来）。 */
export function emptyTableRows(rows = 3, cols = 3): readonly PMNode[] {
  const cell = () => schema.nodes.table_cell.create(null, [schema.nodes.paragraph.create()])
  const row = () => schema.nodes.table_row.create(null, Array.from({ length: cols }, cell))
  return Array.from({ length: rows }, row)
}
