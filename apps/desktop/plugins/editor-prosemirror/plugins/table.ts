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
        // 放手柄槽右侧：左边已经被块手柄占了（表格第一行两个会叠在一起）。
        rowGrip.style.left = `${Math.min(tableRect.right + 2, window.innerWidth - 18)}px`
        rowGrip.style.top = `${rowRect.top + rowRect.height / 2 - 8}px`
        colGrip.hidden = false
        colGrip.style.left = `${cellRect.left + cellRect.width / 2 - 8}px`
        colGrip.style.top = `${tableRect.top - 14}px`
      }

      const hide = (): void => {
        hover = null
        rowGrip.hidden = colGrip.hidden = true
      }

      const onHover = (e: MouseEvent): void => {
        if (drag) return
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

      const startDrag = (kind: 'row' | 'col') => (e: MouseEvent): void => {
        if (!hover) return
        const pos = tablePosOf(hover.table)
        if (pos === null) return
        e.preventDefault()
        drag = { kind, table: hover.table, from: kind === 'row' ? hover.row : hover.col, pos }
        const onMove = (ev: MouseEvent): void => {
          if (!drag) return
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
        const onUp = (ev: MouseEvent): void => {
          const current = drag
          drag = null
          line.hidden = true
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          if (!current) return
          const index = indexAt(current.table, current.kind, ev.clientX, ev.clientY)
          if (index === null || index === current.from) return
          const state = view.state
          const target = current.kind === 'row' ? Math.min(index, tableHeight(current.table) - 1) : Math.min(index, tableWidth(current.table) - 1)
          if (current.kind === 'row') moveTableRow({ from: current.from, to: target, pos: current.pos, select: false })(state, view.dispatch)
          else moveTableColumn({ from: current.from, to: target, pos: current.pos, select: false })(state, view.dispatch)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }

      rowGrip.addEventListener('mousedown', startDrag('row'))
      colGrip.addEventListener('mousedown', startDrag('col'))
      document.addEventListener('mousemove', onHover, true)
      document.addEventListener('scroll', hide, true)

      const sync = (): void => {
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
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          bar.hidden = true
          return
        }
        bar.hidden = false
        const width = bar.getBoundingClientRect().width
        const top = rect.top >= 30 ? rect.top - 28 : rect.bottom + 4
        bar.style.left = `${Math.max(4, Math.min(rect.right - width, window.innerWidth - width - 4))}px`
        bar.style.top = `${Math.max(4, top)}px`
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
          document.removeEventListener('scroll', hide, true)
          bar.remove()
          rowGrip.remove()
          colGrip.remove()
          line.remove()
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
