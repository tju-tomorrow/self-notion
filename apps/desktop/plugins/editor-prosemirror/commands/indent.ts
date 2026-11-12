/** Tab / Shift-Tab：缩进 = 移进上一个兄弟块的 children，反缩进 = 移出来落到父块后面（架构 §4.5）。 */
import type { ResolvedPos } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { Command, EditorState, Transaction } from 'prosemirror-state'

import { findBlock, selectedBlockIds } from '../plugins/block-selection'
import { blockAt, type BlockRef } from './block'
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

/**
 * 拿光标 / 块选区所在的那个块。整块被选中时（图片这种原子块）光标不在正文里，
 * 从块起点 +1 解出一个等价的 `ResolvedPos`，`indentInto` / `liftOut` 两边就能共用一套。
 */
function targetBlock(state: EditorState): { $pos: ResolvedPos; block: BlockRef } | null {
  const sel = state.selection
  if (sel instanceof TextSelection) {
    const $pos = sel.$from
    const block = blockAt($pos)
    if (!block || $pos.depth !== block.depth + 1) return null
    return { $pos, block }
  }
  const ids = selectedBlockIds(state)
  if (ids.length !== 1) return null
  const hit = findBlock(state.doc, ids[0])
  const content = hit?.node.firstChild
  if (!hit || !content) return null
  const $pos = state.doc.resolve(hit.at + 1)
  return { $pos, block: { node: hit.node, depth: $pos.depth, pos: hit.at, content } }
}

export const indent: Command = (state, dispatch) => {
  // 多块一起选的缩进先不做，但要吃掉 Tab（不然焦点被浏览器挪走）。
  if (!(state.selection instanceof TextSelection) && selectedBlockIds(state).length > 1) return true
  const target = targetBlock(state)
  if (!target) return false
  const { $pos, block } = target
  if (block.content.type.name === 'codeBlock') return indentInCode(state, dispatch)

  const tr = indentInto(state, $pos, block)
  // 第一个块 / 没有上一个兄弟：什么也不做，但 Tab 要吃掉（别把焦点挪出编辑器）。
  if (!tr) return true
  if (dispatch) dispatch(tr)
  return true
}

export const outdent: Command = (state, dispatch) => {
  if (!(state.selection instanceof TextSelection) && selectedBlockIds(state).length > 1) return true
  const target = targetBlock(state)
  if (!target) return false
  const { $pos, block } = target
  if (block.content.type.name === 'codeBlock') return unindentInCode(state, dispatch, block.pos + 2)

  const tr = liftOut(state, $pos, block)
  if (!tr) return true
  if (dispatch) dispatch(tr)
  return true
}
