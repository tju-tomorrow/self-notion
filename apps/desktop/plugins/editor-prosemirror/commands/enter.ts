/**
 * Enter（架构 §4.5）：拆块 / 列表续同类块 / toggle 续出子块。
 * 不能用 PM 的 `splitBlock`：它在我们这层 schema 上直接返回 false（blockContainer 的 contentMatch
 * 接不住一个新的 blockContent），而 `tr.split` 会拆出两个带**同一个 id** 的 blockContainer —— id 是持久化格式（§3.1）。
 */
import type { Attrs, Node as PMNode, NodeType } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { Command } from 'prosemirror-state'

import { schema } from '../schema'
import { blockAt } from './block'
import { newBlockId } from './id'
import { liftOut } from './move'

/** 回车续出来的下一块是什么：列表 / 待办续同类；标题 / 引用只当一行，落到段落。 */
function continuation(content: PMNode): { type: NodeType; attrs: Attrs | null } {
  const name = content.type.name
  if (name === 'bulletedListItem' || name === 'numberedListItem') return { type: content.type, attrs: null }
  // 待办续出来的新块一定是没勾的
  if (name === 'todoItem') return { type: content.type, attrs: { checked: false } }
  return { type: schema.nodes.paragraph, attrs: null }
}

export const enter: Command = (state, dispatch) => {
  if (!(state.selection instanceof TextSelection)) return false
  const { $from, $to, empty } = state.selection
  const block = blockAt($from)
  if (!block || block.depth < 2) return false
  if ($from.depth !== block.depth + 1) return false
  const tail = blockAt($to)
  if (!tail || tail.pos !== block.pos) return false // 跨块选区不拆

  const content = block.content
  // 原子块（分割线 / 图片）交给 baseKeymap 的 createParagraphNear；代码块里回车＝换行，也交给它。
  if (!content.isTextblock || content.type.name === 'codeBlock') return false

  const name = content.type.name
  const from = $from.pos
  const contentStart = block.pos + 2 // 内容内部第一个位置
  const contentEnd = block.pos + content.nodeSize // 内容内部最后一个位置
  const rest = content.content.cut((empty ? from : $to.pos) - contentStart)

  // 空列表项回车：再续就是一个空条目，出去比续强 —— 嵌套里先反缩进，顶层降级成段落。
  if ((name === 'bulletedListItem' || name === 'numberedListItem' || name === 'todoItem') && content.content.size === 0) {
    if (!dispatch) return true
    const lifted = liftOut(state, $from, block)
    dispatch(lifted ?? state.tr.setNodeMarkup(block.pos + 1, schema.nodes.paragraph))
    return true
  }

  if (!dispatch) return true
  const tr = state.tr

  if (name === 'toggle') {
    // toggle 里回车续的是它的**子块**（架构 §4.5）
    tr.delete(from, contentEnd)
    const child = schema.nodes.blockContainer.create(
      { id: newBlockId() },
      schema.nodes.paragraph.create(null, rest),
    )
    const group = block.node.childCount > 1
    tr.insert(group ? from + 2 : from + 1, group ? child : schema.nodes.blockGroup.create(null, child))
    tr.setSelection(TextSelection.create(tr.doc, from + 4))
    dispatch(tr)
    return true
  }

  const cut = contentEnd - from
  const cont = continuation(content)
  tr.delete(from, contentEnd)
  const fresh = schema.nodes.blockContainer.create({ id: newBlockId() }, cont.type.create(cont.attrs, rest))
  // 当前块删掉一截后，新块落在它后面
  const insertPos = block.pos + block.node.nodeSize - cut
  tr.insert(insertPos, fresh)
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 2))
  dispatch(tr)
  return true
}
