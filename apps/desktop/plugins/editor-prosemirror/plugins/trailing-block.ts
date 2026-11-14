/** 文末常驻一个空段落 —— 点正文下面的空白总有地方落光标（用户 2026-11-14）。 */
import { Plugin } from 'prosemirror-state'
import type { Node as PMNode, Schema } from 'prosemirror-model'
import { newBlockId } from '../commands/id'

export function isTrailingEmpty(node: PMNode | null | undefined): boolean {
  if (node == null || node.type.name !== 'blockContainer') return false
  const content = node.firstChild
  return content != null && content.type.name === 'paragraph' && content.content.size === 0
}

function emptyBlock(schema: Schema): PMNode {
  return schema.nodes.blockContainer.create({ id: newBlockId() }, schema.nodes.paragraph.create())
}

/** 末尾没有空段落就补一个；不用改就原样返回。 */
export function withTrailingEmpty(doc: PMNode): PMNode {
  const group = doc.firstChild
  if (group == null || group.type.name !== 'blockGroup') return doc
  if (isTrailingEmpty(group.lastChild)) return doc
  const next = group.copy(group.content.addToEnd(emptyBlock(doc.type.schema)))
  return doc.copy(doc.content.replaceChild(0, next))
}

/** 内容该插在哪儿：尾部空段落前面，别把它顶到新内容下面。 */
export function bodyEnd(doc: PMNode): number {
  const last = doc.firstChild?.lastChild
  if (isTrailingEmpty(last)) return doc.content.size - 1 - last!.nodeSize
  return doc.content.size - 1
}

export function trailingBlockPlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, next) {
      if (!trs.some((tr) => tr.docChanged)) return null
      const group = next.doc.firstChild
      if (group == null || group.type.name !== 'blockGroup') return null
      if (isTrailingEmpty(group.lastChild)) return null
      return next.tr.insert(next.doc.content.size - 1, emptyBlock(next.schema))
    },
  })
}
