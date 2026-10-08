/**
 * `breadcrumb` 的 NodeView —— 「祖页 / 父页 / 本页」的路径，点前面的跳过去。
 *
 * ★ 路径**不在文档里**：祖先是谁住在库里的 `parent_id`（`doc-meta.ts` 的 `metaOf`），砖块自己
 *   一个字节都不存（atom）。本页是谁 —— 从编辑区根元素上的 `data-doc-id` 往上找（`editor.ts` 挂）。
 * ★ 拖动层级 / 改标题后靠 `subscribe` 重数（`doc:list` 一换就叫）。
 */
import type { EditorView, NodeViewConstructor } from 'prosemirror-view'

import { metaOf, openDoc, subscribe } from '../doc-meta'

interface Crumb {
  id: string
  title: string
}

/** 本页的 docId —— 编辑区（含祖先）上挂的 `data-doc-id`；拿不到就空串（降级成不渲染）。 */
function currentDocId(view: EditorView): string {
  let el: HTMLElement | null = view.dom
  while (el) {
    const id = el.dataset.docId
    if (id) return id
    el = el.parentElement
  }
  return ''
}

/** 「本页 → 父 → 祖」数到根，再反过来才是「祖 / 父 / 本页」。防环：父子互指时靠 seen 断掉。 */
function trail(currentId: string, currentTitle: string): Crumb[] {
  const out: Crumb[] = []
  const seen = new Set<string>()
  let cur = currentId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const meta = metaOf(cur)
    if (!meta) {
      // 本页不在列表里（理论上不会）/ 祖先被删了 —— 用已知标题收尾，别再往上数。
      out.push({ id: cur, title: cur === currentId ? currentTitle || '无标题' : '已删除的页面' })
      break
    }
    out.push({ id: meta.id, title: meta.title || '无标题' })
    cur = meta.parentId ?? ''
  }
  return out.reverse()
}

export const breadcrumbView: NodeViewConstructor = (_node, view) => {
  const dom = document.createElement('div')
  dom.className = 'sn-breadcrumb'

  const render = () => {
    const items = trail(currentDocId(view), String(view.state.doc.attrs.title ?? ''))
    dom.replaceChildren()
    items.forEach((item, index) => {
      if (index) {
        const sep = document.createElement('span')
        sep.className = 'sn-crumb-sep'
        sep.textContent = '/'
        dom.appendChild(sep)
      }
      // 本页不点（已经在看了，再点一次只会重挂一遍）。
      const last = index === items.length - 1
      if (last) {
        const me = document.createElement('span')
        me.className = 'sn-crumb sn-crumb-me'
        me.textContent = item.title
        dom.appendChild(me)
        return
      }
      const link = document.createElement('button')
      link.type = 'button'
      link.className = 'sn-crumb'
      link.textContent = item.title
      link.addEventListener('click', () => openDoc(item.id))
      dom.appendChild(link)
    })
  }
  render()
  const off = subscribe(render)

  return {
    dom,
    // 没有 attrs 的 atom：本节点不会变，PM 不会叫 update。留着只是接口自洽。
    update: () => false,
    stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
    ignoreMutation: () => true,
    destroy: off,
  }
}
