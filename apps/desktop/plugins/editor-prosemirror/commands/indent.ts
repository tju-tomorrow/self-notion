/** Tab / Shift-Tab：缩进 = 移进上一个兄弟块的 children，反缩进 = 移出来落到父块后面（架构 §4.5）。 */
import { TextSelection } from 'prosemirror-state'
import type { Command, EditorState, Transaction } from 'prosemirror-state'

import { blockAt } from './block'
import { indentInto, liftOut } from './move'

/** 代码块里 Tab 是缩进符，不是嵌套；但键必须吃掉，返回 false 会让浏览器把焦点挪走。 */
function indentInCode(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined): boolean {
  if (dispatch) dispatch(state.tr.insertText('  ', state.selection.from, state.selection.to))
  return true
}

/** 反缩进：删光标左边最多两个空格；一个都没有也要吃掉这个键。 */
function unindentInCode(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  contentStart: number,
): boolean {
  if (state.selection.empty) {
    const before = state.doc.textBetween(contentStart, state.selection.from, '\n')
    const spaces = before.endsWith('  ') ? 2 : before.endsWith(' ') ? 1 : 0
    if (spaces > 0 && dispatch) dispatch(state.tr.delete(state.selection.from - spaces, state.selection.from))
  }
  return true
}

export const indent: Command = (state, dispatch) => {
  if (!(state.selection instanceof TextSelection)) return false
  const $pos = state.selection.$from
  const block = blockAt($pos)
  if (!block || $pos.depth !== block.depth + 1) return false
  if (block.content.type.name === 'codeBlock') return indentInCode(state, dispatch)

  const tr = indentInto(state, $pos, block)
  if (!tr) return false
  if (dispatch) dispatch(tr)
  return true
}

export const outdent: Command = (state, dispatch) => {
  if (!(state.selection instanceof TextSelection)) return false
  const $pos = state.selection.$from
  const block = blockAt($pos)
  if (!block || $pos.depth !== block.depth + 1) return false
  if (block.content.type.name === 'codeBlock') return unindentInCode(state, dispatch, block.pos + 2)

  const tr = liftOut(state, $pos, block)
  if (!tr) return false
  if (dispatch) dispatch(tr)
  return true
}
