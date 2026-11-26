/**
 * Backspace 行首（架构 §4.5）：
 *   嵌套里 → 先出一层嵌套（Notion 就是这样，得按到位才能降级）；
 *   顶层   → 标题一次并进上一块；列表 / 引用 / toggle 先降到段落，再按才并进上一块。
 * 光标不在行首、或者不是折叠选区 → 交回 baseKeymap（选东西删、删原子块那些）。
 */
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import type { Command, EditorState, Transaction } from 'prosemirror-state'

import { schema } from '../schema'
import { groupChildren, prevSibling, blockAt, type BlockRef } from './block'
import { newBlockId } from './id'
import { liftOut } from './move'

/** 插进来会自带一个空段落垫底的原子块。 */
const MEDIA = new Set(['image', 'video', 'audio', 'file'])

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

/** 光标在**第一个顶层块**的最开头 —— 再退就该进页面标题了。 */
export function atDocStart(state: EditorState): boolean {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || !sel.empty) return false
  const $pos = sel.$from
  if ($pos.parentOffset !== 0) return false
  const block = blockAt($pos)
  if (!block || block.depth < 2) return false
  // 只有「doc > blockGroup > blockContainer」那一层算顶层；嵌套里的行首由 liftOut 管。
  if (block.depth !== 2) return false
  return prevSibling($pos, block) === null
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
    // 行首退格一次就并进上一块 —— 逐级降（h3→h2→h1→段落）要按四次才消失（用户 2026-11-19）。
    if (mergeUp(state, dispatch, $pos, block)) return true
    if (dispatch) dispatch(state.tr.setNodeMarkup(block.pos + 1, schema.nodes.paragraph))
    return true
  }

  if (DEGRADE_TO_PARAGRAPH.has(name)) {
    if (dispatch) dispatch(state.tr.setNodeMarkup(block.pos + 1, schema.nodes.paragraph))
    return true
  }

  if (name === 'paragraph') {
    const prev = prevSibling($pos, block)
    // 上一块是原子块（分割线 / 图片 / 媒体）→ 直接删掉它。交给 baseKeymap 会把它包成父块，
    // 于是同一个 Backspace 只会「缩进去 / 退出来」来回跳，那块永远删不掉。
    // subpage 是能打开的文章卡片，不是装饰块：退格删掉当前空段落、光标向上选中它。
    if (prev && prev.node.child(0).isAtom) {
      const atom = prev.node.child(0).type.name
      if (atom === 'subpage') {
        if (dispatch) {
          const tr = state.tr.delete(block.pos, block.pos + block.node.nodeSize)
          tr.setSelection(NodeSelection.create(tr.doc, prev.pos))
          dispatch(tr)
        }
        return true
      }
      // 图片 / 媒体下面的空段落只是垫脚石：删它，别删上面的块。
      // 删完若图片成了文末，再补一个空段落（跟 trailing-block 的常驻空块一致）。
      if (MEDIA.has(atom) && block.content.content.size === 0) {
        if (dispatch) {
          const tr = state.tr.delete(block.pos, block.pos + block.node.nodeSize)
          const at = prev.pos + prev.node.nodeSize
          if (at >= tr.doc.content.size - 1) {
            const para = schema.nodes.paragraph.createAndFill()
            if (para) {
              tr.insert(at, schema.nodes.blockContainer.create({ id: newBlockId() }, para))
              tr.setSelection(TextSelection.create(tr.doc, at + 2))
            }
          } else {
            tr.setSelection(TextSelection.near(tr.doc.resolve(at), 1))
          }
          dispatch(tr)
        }
        return true
      }
      if (dispatch) {
        const tr = state.tr.delete(prev.pos, prev.pos + prev.node.nodeSize)
        tr.setSelection(TextSelection.create(tr.doc, state.selection.from - prev.node.nodeSize))
        dispatch(tr)
      }
      return true
    }
    return mergeUp(state, dispatch, $pos, block)
  }
  return false
}
