/** ⌘D：把选中的块（或光标所在那一块）复制一份接在后面。新块必须换 id（架构 §3.1）。 */
import { Fragment } from 'prosemirror-model'
import type { Node as PMNode } from 'prosemirror-model'
import type { Command } from 'prosemirror-state'

import { BlockSelection } from '../plugins/block-selection'
import { blockAt } from './block'
import { newBlockId } from './id'

function reid(node: PMNode): PMNode {
  if (node.isText) return node
  const kids: PMNode[] = []
  node.forEach((child) => kids.push(child.type.name === 'blockContainer' ? reid(child) : child))
  const attrs = node.type.name === 'blockContainer' ? { ...node.attrs, id: newBlockId() } : node.attrs
  return node.type.create(attrs, kids.length ? Fragment.fromArray(kids) : undefined, node.marks)
}

export const duplicateBlock: Command = (state, dispatch) => {
  const sel = state.selection
  let to: number
  let blocks: readonly PMNode[]
  if (sel instanceof BlockSelection) {
    to = sel.to
    blocks = sel.nodes
  } else {
    const block = blockAt(sel.$from)
    if (!block) return false
    to = block.pos + block.node.nodeSize
    blocks = [block.node]
  }
  if (blocks.length === 0) return false
  if (!dispatch) return true

  const fresh = blocks.map(reid)
  const size = fresh.reduce((n, node) => n + node.nodeSize, 0)
  const tr = state.tr.insert(to, fresh)
  tr.setSelection(BlockSelection.create(tr.doc, to, to + size))
  dispatch(tr.scrollIntoView())
  return true
}
