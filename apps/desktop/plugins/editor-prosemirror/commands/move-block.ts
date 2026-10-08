/**
 * ⌘⇧↑↓：把当前块（或块级多选选中的那几块）在同层里挪一位（架构 §4.5 · notion-parity §3）。
 *
 * ★ 只动**同层**：两端都得落在同一个 `blockGroup` 上。跨层要连祖先一起搬（Notion 是「上移到父块外面」），
 *   那是 Tab / ⇧Tab 的活（`commands/move.ts`）—— 这里认不出同层邻居就返回 false，交回 baseKeymap。
 * ★ 一次 `replaceWith` 换完整段，不拆成删 + 插：中间态会立起一个空 `blockGroup`，
 *   PM 往里补的是 `id: ''` 的块（架构 §2.2 那条派生风险，`move.ts` 同一个理由）。
 */
import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { Command, EditorState } from 'prosemirror-state'

import { BlockSelection } from '../plugins/block-selection'
import { blockAt } from './block'

/** 要挪的那一段：两端位置 + 段里的块 + 光标在自己块里的偏移（块级多选没有光标）。 */
interface Span {
  readonly from: number
  readonly to: number
  readonly blocks: readonly PMNode[]
  readonly caret: number | null
}

function span(state: EditorState): Span | null {
  const sel = state.selection
  if (sel instanceof BlockSelection) {
    if (sel.nodes.length === 0) return null
    return { from: sel.from, to: sel.to, blocks: sel.nodes, caret: null }
  }
  if (sel instanceof NodeSelection && sel.node.type.name === 'blockContainer') {
    return { from: sel.from, to: sel.from + sel.node.nodeSize, blocks: [sel.node], caret: null }
  }
  if (!(sel instanceof TextSelection)) return null
  const head = blockAt(sel.$from)
  const tail = blockAt(sel.$to)
  // 文本选中跨了两个块 —— 那就不是「挪这块」，别猜，让别的键去处理。
  if (!head || !tail || head.pos !== tail.pos) return null
  return { from: head.pos, to: head.pos + head.node.nodeSize, blocks: [head.node], caret: sel.from - head.pos }
}

function move(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const s = span(state)
    if (!s) return false
    const $from = state.doc.resolve(s.from)
    const $to = state.doc.resolve(s.to)
    // 同一个 blockGroup 才是同层：两端的父组起点一致。
    if (
      $from.parent.type.name !== 'blockGroup' ||
      $from.depth !== $to.depth ||
      $from.before($from.depth) !== $to.before($to.depth)
    ) {
      return false
    }
    const neighbor = dir < 0 ? $from.nodeBefore : $to.nodeAfter
    // 到头了（首块往上 / 末块往下）：Notion 是不动，但键得吃掉 —— 漏给浏览器的话 ⌘⇧↑ 会「选中到文首」，
    // 看着像把文档选没了（`indent.ts` 里代码块那条同一个道理）。
    if (!neighbor || neighbor.type.name !== 'blockContainer') return true
    if (!dispatch) return true

    const start = dir < 0 ? s.from - neighbor.nodeSize : s.from
    const end = dir < 0 ? s.to : s.to + neighbor.nodeSize
    const order = dir < 0 ? [...s.blocks, neighbor] : [neighbor, ...s.blocks]
    // 搬完之后那一段的起点（交换的另一半占了前面）。
    const at = dir < 0 ? start : start + neighbor.nodeSize
    const size = s.blocks.reduce((n, block) => n + block.nodeSize, 0)

    const tr = state.tr.replaceWith(start, end, order)
    tr.setSelection(
      s.caret === null
        ? BlockSelection.create(tr.doc, at, at + size)
        : TextSelection.create(tr.doc, at + s.caret),
    )
    dispatch(tr.scrollIntoView())
    return true
  }
}

export const moveBlockUp: Command = move(-1)
export const moveBlockDown: Command = move(1)
