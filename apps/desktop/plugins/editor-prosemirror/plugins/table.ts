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
import type { EditorView } from 'prosemirror-view'
import {
  TableMap,
  TableView,
  columnResizing,
  columnResizingPluginKey,
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
  ]
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
