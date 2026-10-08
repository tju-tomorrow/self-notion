/**
 * 表格的编辑命令（P3，D-0135）—— 增删行列 / 合并拆分全是官方 `prosemirror-tables` 现成的，
 * 这里只补两条**分派**：Tab / Shift-Tab 表格里走去下一格、表格外落回缩进（架构 §4.5 的那对键没被顶掉）。
 */
import { TextSelection, type Command } from 'prosemirror-state'
import { addRow, goToNextCell, isInTable, selectedRect } from 'prosemirror-tables'

import { indent, outdent } from './indent'

/**
 * Tab：表格里下一格；**已经是最后一格就补一行**再进新行第一格（Notion 同款）——
 * 不然 goToNextCell 返回 false，键漏给浏览器会把焦点移走。表格外落回缩进。
 */
export const nextCell: Command = (state, dispatch, view) => {
  if (!isInTable(state)) return indent(state, dispatch, view)
  if (goToNextCell(1)(state, dispatch, view)) return true
  if (!dispatch) return true
  // 新行插在表格末尾；光标进它第一格的第一段（行 +1 → 格 +1 → 段 +1）。
  const rect = selectedRect(state)
  const tr = state.tr
  addRow(tr, rect, rect.map.height)
  tr.setSelection(TextSelection.near(tr.doc.resolve(rect.tableStart + rect.table.content.size + 3), 1))
  tr.scrollIntoView()
  dispatch(tr)
  return true
}

/** Shift-Tab：上一格；已经在第一格就吃掉这个键（同样别把焦点漏出去）。表格外落回反缩进。 */
export const prevCell: Command = (state, dispatch, view) => {
  if (!isInTable(state)) return outdent(state, dispatch, view)
  goToNextCell(-1)(state, dispatch, view)
  return true
}

// 结构性命令：全都在「不在表格」时返回 false，绑在全局也误伤不了正文。
export {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  mergeCells,
  splitCell,
} from 'prosemirror-tables'
