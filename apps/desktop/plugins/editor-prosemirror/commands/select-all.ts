import { TextSelection, type Command } from 'prosemirror-state'

/**
 * 文字块里的 ⌘A 先选这一块的字，再按一次才选全篇（Notion 的层次）。
 * 表格单元格里的段落不归这条 —— 那层有自己的选区语义。
 */
export const selectAllInBlock: Command = (state, dispatch) => {
  const { $from } = state.selection
  if (!$from.parent.isTextblock || $from.depth < 2) return false
  if ($from.node($from.depth - 1).type.name !== 'blockContainer') return false
  const from = $from.start()
  const to = $from.end()
  if (state.selection.from === from && state.selection.to === to) return false
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
  return true
}
