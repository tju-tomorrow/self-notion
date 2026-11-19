import { TextSelection, type Command } from 'prosemirror-state'

/**
 * 代码块里的 ⌘A 先选这一块的字，再按一次才选全篇（Notion 的层次）。
 * 别处返回 false，交给 baseKeymap 的 selectAll。
 */
export const selectAllInCode: Command = (state, dispatch) => {
  const { $from } = state.selection
  if (!$from.parent.type.spec.code) return false
  const from = $from.start()
  const to = $from.end()
  if (state.selection.from === from && state.selection.to === to) return false
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
  return true
}
