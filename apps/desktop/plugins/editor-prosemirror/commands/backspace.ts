/**
 * Backspace 行首（架构 §4.5）：
 *   嵌套里 → 先出一层嵌套（Notion 就是这样，得按到位才能降级）；
 *   顶层   → 降级（h3→h2→h1→段落→出列表 / 引用 / toggle），降到段落再按才并进上一块。
 * 光标不在行首、或者不是折叠选区 → 交回 baseKeymap（选东西删、删原子块那些）。
 */
import type { Attrs, Node as PMNode, ResolvedPos } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { Command, EditorState, Transaction } from 'prosemirror-state'

import { schema } from '../schema'
import { groupChildren, prevSibling, blockAt, type BlockRef } from './block'
import { liftOut } from './move'

const DEGRADE_TO_PARAGRAPH = new Set([
  'quote',
  'callout',
  'bulletedListItem',
  'numberedListItem',
  'todoItem',
  'toggle',
])

/** 并进上一块：文字接到上一块末尾，自己的 children 挂到上一块底下。上一块是原子块 → 不动。 */
function mergeUp(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  $pos: ResolvedPos,
  block: BlockRef,
): boolean {
  const prev = prevSibling($pos, block)
  if (!prev) return false
  const prevContent = prev.node.child(0)
  if (!prevContent.isTextblock || !block.content.isTextblock) return false
  if (!dispatch) return true

  const merged = prevContent.type.create(prevContent.attrs, prevContent.content.append(block.content.content))
  const kids: PMNode[] = [merged]
  const inherited = [...groupChildren(prev.node), ...groupChildren(block.node)]
  if (inherited.length) kids.push(schema.nodes.blockGroup.create(null, inherited))

  const tr = state.tr.replaceWith(
    prev.pos,
    prev.pos + prev.node.nodeSize + block.node.nodeSize,
    schema.nodes.blockContainer.create(prev.node.attrs, kids),
  )
  // 光标停在两段文字的结合处
  tr.setSelection(TextSelection.create(tr.doc, prev.pos + prevContent.nodeSize))
  dispatch(tr)
  return true
}

export const backspace: Command = (state, dispatch) => {
  if (!(state.selection instanceof TextSelection) || !state.selection.empty) return false
  const $pos = state.selection.$from
  const block = blockAt($pos)
  if (!block || block.depth < 2) return false
  if ($pos.depth !== block.depth + 1 || $pos.parentOffset !== 0) return false

  // 嵌套里行首退格先出一层（顶层出不去，liftOut 自己返回 null，落到下面那条链）。
  const lifted = liftOut(state, $pos, block)
  if (lifted) {
    if (dispatch) dispatch(lifted)
    return true
  }

  const name = block.content.type.name

  if (name === 'heading') {
    const level = Number(block.content.attrs.level)
    if (level > 1) {
      const attrs: Attrs = { ...block.content.attrs, level: level - 1 }
      if (dispatch) dispatch(state.tr.setNodeMarkup(block.pos + 1, undefined, attrs))
      return true
    }
    if (dispatch) dispatch(state.tr.setNodeMarkup(block.pos + 1, schema.nodes.paragraph))
    return true
  }

  if (DEGRADE_TO_PARAGRAPH.has(name)) {
    if (dispatch) dispatch(state.tr.setNodeMarkup(block.pos + 1, schema.nodes.paragraph))
    return true
  }

  if (name === 'paragraph') return mergeUp(state, dispatch, $pos, block)
  return false
}
