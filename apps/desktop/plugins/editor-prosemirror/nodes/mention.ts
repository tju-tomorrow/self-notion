/**
 * `mention` 的 NodeView —— 行内原子，显示 `@` + 目标页标题，点一下打开它。
 *
 * ★ 跟子页面卡片一样：标题是别的文档的，挂载 / attrs 变化 / `doc:list` 换了时重读。
 */
import type { NodeViewConstructor } from 'prosemirror-view'

import { metaOf, openDoc, subscribe } from '../doc-meta'
import { asString } from './attrs'

export const mentionView: NodeViewConstructor = (node) => {
  const dom = document.createElement('span')
  dom.className = 'sn-mention'

  let n = node
  let docId = ''

  const paint = () => {
    docId = asString(n.attrs.docId)
    dom.dataset.docId = docId
    const meta = docId ? metaOf(docId) : undefined
    dom.dataset.empty = String(meta === undefined)
    dom.textContent = `@${!docId ? '页面' : meta ? meta.title || '无标题' : '已删除的页面'}`
  }
  paint()
  const off = subscribe(paint)

  dom.addEventListener('click', () => {
    if (docId) openDoc(docId)
  })

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type) return false
      n = next
      paint()
      return true
    },
    // 原子没有可编辑内容，点击归我们（打开目标页），PM 别接管。
    stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
    ignoreMutation: () => true,
    destroy: off,
  }
}
