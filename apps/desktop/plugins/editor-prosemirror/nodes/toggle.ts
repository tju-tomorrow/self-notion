/**
 * `toggle` 的 NodeView —— 可点的折叠箭头 + 标题行。
 *
 * ★ 折叠的是**子块**，而子块不在这个节点里：它们挂在同一个 `blockContainer` 里的下一个
 *   `blockGroup`（架构 §2.2）。父 NodeView 不许重排 / 过滤子节点（§2.3），所以隐藏交给
 *   CSS 的相邻兄弟选择器（`nodes.css.ts` 里那条 `.sn-toggle[data-open="false"] + div`），
 *   这里只负责把 `open` 写回 attr。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { asBool } from './attrs'

export const toggleView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div')
  dom.className = 'sn-toggle'

  const arrow = document.createElement('span')
  arrow.className = 'sn-toggle-arrow'
  arrow.contentEditable = 'false'
  arrow.setAttribute('role', 'button')
  arrow.textContent = '▸'

  const text = document.createElement('div')
  text.className = 'sn-toggle-text'

  dom.append(arrow, text)

  const flip = () => {
    const pos = getPos()
    if (pos === undefined) return
    const cur = view.state.doc.nodeAt(pos)
    if (!cur) return
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { open: !asBool(cur.attrs.open) }),
    )
  }

  const onDown = (e: MouseEvent) => e.preventDefault()
  arrow.addEventListener('mousedown', onDown)
  arrow.addEventListener('click', flip)

  const paint = (n: PMNode) => {
    const open = asBool(n.attrs.open)
    dom.dataset.open = String(open)
    arrow.setAttribute('aria-expanded', String(open))
  }
  paint(node)

  return {
    dom,
    contentDOM: text,
    update: (next) => {
      if (next.type !== node.type) return false
      paint(next)
      return true
    },
    stopEvent: (e) => e.target instanceof Node && arrow.contains(e.target),
    ignoreMutation: (mut) => mut.type !== 'selection' && !text.contains(mut.target),
    destroy: () => {
      arrow.removeEventListener('mousedown', onDown)
      arrow.removeEventListener('click', flip)
    },
  }
}
