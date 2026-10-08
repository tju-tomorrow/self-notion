/**
 * 缩进 / 反缩进 —— 都是「把 blockContainer 整棵子树搬个位置」，用一次 `replaceWith` 做完。
 * 分成 delete + insert 两步会在中间留下空的 blockGroup，PM 会往里补一个 `id: ''` 的块（架构 §2.2 那条派生风险）。
 */
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorState, Transaction } from 'prosemirror-state'

import { schema } from '../schema'
import { groupChildren, prevSibling, type BlockRef } from './block'

/** 移进上一个兄弟块的 children。没有上一个兄弟 → null。 */
export function indentInto(state: EditorState, $pos: ResolvedPos, block: BlockRef): Transaction | null {
  const prev = prevSibling($pos, block)
  if (!prev) return null

  const prevContent = prev.node.child(0)
  const prevGroup = prev.node.childCount > 1 ? prev.node.child(1) : undefined
  const nested = schema.nodes.blockContainer.create(prev.node.attrs, [
    prevContent,
    schema.nodes.blockGroup.create(null, [...groupChildren(prev.node), block.node]),
  ])

  const tr = state.tr.replaceWith(prev.pos, prev.pos + prev.node.nodeSize + block.node.nodeSize, nested)
  // 光标跟着块走：块在新位置里相对自己起点的偏移不变，光标也是。
  const movedStart = prev.pos + 1 + prevContent.nodeSize + 1 + (prevGroup ? prevGroup.nodeSize - 2 : 0)
  tr.setSelection(TextSelection.create(tr.doc, movedStart + (state.selection.from - block.pos)))
  return tr
}

/** 移出父块的 children，落到父块后面（同级）。已经在最外层 → null。 */
export function liftOut(state: EditorState, $pos: ResolvedPos, block: BlockRef): Transaction | null {
  if (block.depth < 3) return null
  const parentDepth = block.depth - 2
  const parent = $pos.node(parentDepth)
  if (parent.type.name !== 'blockContainer') return null
  const group = parent.childCount > 1 ? parent.child(1) : undefined
  if (!group) return null

  const rest: PMNode[] = []
  const idx = $pos.index(block.depth - 1)
  for (let i = 0; i < group.childCount; i++) if (i !== idx) rest.push(group.child(i))

  const parentPos = $pos.before(parentDepth)
  const kids: PMNode[] = [parent.child(0)]
  // blockGroup 不能空（schema 里是 blockContainer+）—— 最后一个孩子搬走就把整层收掉。
  if (rest.length) kids.push(schema.nodes.blockGroup.create(null, rest))
  const lifted = schema.nodes.blockContainer.create(parent.attrs, kids)

  const tr = state.tr.replaceWith(parentPos, parentPos + parent.nodeSize, [lifted, block.node])
  tr.setSelection(TextSelection.create(tr.doc, parentPos + lifted.nodeSize + (state.selection.from - block.pos)))
  return tr
}
