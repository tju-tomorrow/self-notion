/** 快捷键换块类型（⌘⇧7/8/9 那些）：选区碰到的块全换，已经全是这个类型就退回段落。 */
import type { Attrs, Node as PMNode, NodeType } from 'prosemirror-model'
import type { Command } from 'prosemirror-state'

import { schema } from '../schema'

export function toggleBlock(type: NodeType, attrs: Attrs | null = null): Command {
  return (state, dispatch) => {
    const targets: { pos: number; node: PMNode }[] = []
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
      if (node.type.name !== 'blockContainer') return
      const content = node.firstChild
      if (!content?.isTextblock) return
      targets.push({ pos: pos + 1, node: content })
    })
    const usable = targets.filter((t) => type.name !== 'codeBlock' || onlyText(t.node))
    if (usable.length === 0) return false
    if (!dispatch) return true

    const off = usable.every((t) => t.node.type === type)
    const tr = state.tr
    for (const target of usable) {
      tr.setNodeMarkup(
        target.pos,
        off ? schema.nodes.paragraph : type,
        off ? null : attrs,
      )
    }
    dispatch(tr)
    return true
  }
}

function onlyText(node: PMNode): boolean {
  let plain = true
  node.forEach((child) => {
    if (!child.isText) plain = false
  })
  return plain
}
