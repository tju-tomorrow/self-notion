/**
 * `subpage` 的 NodeView —— 子页面卡片：现读目标页的标题 / 图标，点一下打开它。
 *
 * ★ 卡片上的字是**别的文档**的（走 `doc-meta.ts`），本节点只存一个 `docId`。所以挂载 /
 *   attrs 变化 / `doc:list` 换了（`subscribe`）三种时机重画 —— 别处改了目标页标题能跟上。
 */
import type { NodeViewConstructor } from 'prosemirror-view'

import { metaOf, openDoc, subscribe } from '../doc-meta'
import { asString } from './attrs'

/** 目标页没设图标时的兜底（内联 SVG，不引图标库，跟 file 那个一个写法）。 */
const DOC_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5z"/><path d="M9 1.5V5.5H13"/></svg>'

export const subpageView: NodeViewConstructor = (node) => {
  const dom = document.createElement('div')
  dom.className = 'sn-subpage'

  const icon = document.createElement('span')
  icon.className = 'sn-subpage-icon'
  const title = document.createElement('span')
  title.className = 'sn-subpage-title'
  dom.append(icon, title)

  let n = node
  let docId = ''

  const paint = () => {
    docId = asString(n.attrs.docId)
    dom.dataset.docId = docId
    const meta = docId ? metaOf(docId) : undefined
    // 没 docId = 还没长好的新卡片；拿不到 meta = 目标页不在库里（删了）。都降级，别抛。
    dom.dataset.empty = String(meta === undefined)
    if (meta?.icon) icon.textContent = meta.icon
    else icon.innerHTML = DOC_ICON
    title.textContent = !docId ? '子页面' : meta ? meta.title || '无标题' : '已删除的页面'
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
    // 整张卡片归我们管（atom 没有可编辑内容），PM 别接管它的点击 / 变更。
    stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
    ignoreMutation: () => true,
    destroy: off,
  }
}
