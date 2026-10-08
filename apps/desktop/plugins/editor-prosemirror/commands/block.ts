/**
 * 块几何：结构是 `doc ─ blockGroup ─ blockContainer(blockContent blockGroup?)`（架构 §2.2），
 * 位置都得自己算 —— PM 的默认 helper 不认这层容器。
 */
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model'

export interface BlockRef {
  node: PMNode
  /** 这个 blockContainer 在 resolved pos 里的深度（1 = doc 的 group 下）。 */
  depth: number
  /** 块起点（blockContainer 之前那个位置）。 */
  pos: number
  /** 内容节点（blockContent）——块本身没有一个「可写文本」的说法，文本在它里面。 */
  content: PMNode
}

/** 光标所在的那个块 —— 最近的 blockContainer。 */
export function blockAt($pos: ResolvedPos): BlockRef | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'blockContainer') {
      return { node, depth: d, pos: $pos.before(d), content: node.child(0) }
    }
  }
  return null
}

/** 同一层里紧挨着的上一个兄弟块。本层第一个 → null。 */
export function prevSibling($pos: ResolvedPos, block: BlockRef): { node: PMNode; pos: number } | null {
  const groupDepth = block.depth - 1
  const idx = $pos.index(groupDepth)
  if (idx === 0) return null
  const group = $pos.node(groupDepth)
  let pos = $pos.before(groupDepth) + 1
  for (let i = 0; i < idx - 1; i++) pos += group.child(i).nodeSize
  return { node: group.child(idx - 1), pos }
}

/** 块的子块（blockGroup 里的 blockContainer）。没有 children → 空数组。 */
export function groupChildren(container: PMNode): PMNode[] {
  if (container.childCount < 2) return []
  const group = container.child(1)
  const out: PMNode[] = []
  for (let i = 0; i < group.childCount; i++) out.push(group.child(i))
  return out
}
