/**
 * `todoItem` 的 NodeView —— 可点的勾选框 + 正文。
 *
 * ★ 勾选框是 `dom` 里的**部件**，在 `contentDOM` 之外：非内容元素必须自带
 *   `contenteditable="false"`，否则会变成正文的一部分（PM 只在**没有** contentDOM 时才自动加）。
 * ★ 正文容器 `contentDOM` 必须真的在 DOM 里 —— 少了它打字打不进去（架构 §2.3）。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { asBool } from './attrs'

export const todoItemView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div')
  dom.className = 'sn-todo'

  const box = document.createElement('span')
  box.className = 'sn-todo-box'
  box.contentEditable = 'false'
  box.setAttribute('role', 'checkbox')
  const tick = document.createElement('span')
  tick.textContent = '✓'
  box.appendChild(tick)

  const text = document.createElement('div')
  text.className = 'sn-todo-text'

  dom.append(box, text)

  // 读 state 里的那个节点、不读闭包 —— 连点两下时闭包里那份是旧的。
  const flip = () => {
    const pos = getPos()
    if (pos === undefined) return
    const cur = view.state.doc.nodeAt(pos)
    if (!cur) return
    view.dispatch(
      view.state.tr.setNodeMarkup(pos, undefined, { checked: !asBool(cur.attrs.checked) }),
    )
  }

  // mousedown 先拦一下：不然点方块会把焦点从编辑器抢走、还会拖出一段 DOM 选区。
  const onDown = (e: MouseEvent) => e.preventDefault()
  const onBoxClick = () => flip()
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return
    // ★ 不拦的话 baseKeymap 的 `Mod-Enter`（exitCode）会先看到它。
    e.preventDefault()
    e.stopPropagation()
    flip()
  }

  box.addEventListener('mousedown', onDown)
  box.addEventListener('click', onBoxClick)
  dom.addEventListener('keydown', onKey)

  const paint = (n: PMNode) => {
    const checked = asBool(n.attrs.checked)
    dom.dataset.checked = String(checked)
    box.setAttribute('aria-checked', String(checked))
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
    // 方块上的事件别让编辑器接管：点它**不**该移动光标，也不该改选区。
    stopEvent: (e) => e.target instanceof Node && box.contains(e.target),
    // 只读 contentDOM 里的变化；方块自己的 data-* 是我们画的，别让编辑器去重解析。
    ignoreMutation: (mut) => mut.type !== 'selection' && !text.contains(mut.target),
    destroy: () => {
      box.removeEventListener('mousedown', onDown)
      box.removeEventListener('click', onBoxClick)
      dom.removeEventListener('keydown', onKey)
    },
  }
}
