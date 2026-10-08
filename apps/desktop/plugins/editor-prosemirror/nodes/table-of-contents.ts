/**
 * `tableOfContents` 的 NodeView —— 从 `view.state.doc` 现算，**不落库内容**（节点是 atom，没有 attrs）。
 *
 * ★ 刷新靠盯 DOM：PM 只在**本节点**变化时调 `update`，目录吃的却是别处（标题）的变化。
 *   而任何能改到目录的编辑必然动到 DOM（改字 → characterData，换块 / 改 level → 元素被换掉），
 *   所以 `MutationObserver` 盯着 `view.dom` 就够，rAF 合并一帧内的多次抖动。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

interface Entry {
  pos: number
  level: number
  text: string
}

function headings(doc: PMNode): Entry[] {
  const out: Entry[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    // 标题只有行内内容，不必再往下走。
    out.push({ pos, level: Number(node.attrs.level) || 1, text: node.textContent })
    return false
  })
  return out
}

export const tableOfContentsView: NodeViewConstructor = (_node, view) => {
  const dom = document.createElement('div')
  dom.className = 'sn-toc'
  const list = document.createElement('div')
  list.className = 'sn-toc-list'
  dom.appendChild(list)

  const jump = (pos: number) => {
    const el = view.nodeDOM(pos)
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  // 内容没变就别重建 DOM —— 否则观察者会被自己惊动、空转。
  let last: string | null = null
  const render = () => {
    const items = headings(view.state.doc)
    const key = items.map((i) => `${i.level}:${i.pos}:${i.text}`).join('\n')
    if (key === last) return
    last = key
    list.replaceChildren()
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sn-toc-empty'
      empty.textContent = '目录为空'
      list.appendChild(empty)
      return
    }
    for (const item of items) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'sn-toc-item'
      row.dataset.level = String(item.level)
      row.textContent = item.text || '无标题'
      row.addEventListener('click', () => jump(item.pos))
      list.appendChild(row)
    }
  }

  let raf = 0
  const observer = new MutationObserver((records) => {
    if (records.every((r) => dom.contains(r.target))) return
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      render()
    })
  })
  observer.observe(view.dom, { childList: true, subtree: true, characterData: true })
  render()

  return {
    dom,
    stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
    ignoreMutation: () => true,
    destroy: () => {
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
    },
  }
}
