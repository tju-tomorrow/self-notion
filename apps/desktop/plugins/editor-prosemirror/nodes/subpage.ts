/**
 * `subpage` 的 NodeView —— 子页面卡片：现读目标页的标题 / 图标，点一下打开它。
 *
 * ★ 卡片上的字是**别的文档**的（走 `doc-meta.ts`），本节点只存一个 `docId`。所以挂载 /
 *   attrs 变化 / `doc:list` 换了（`subscribe`）三种时机重画 —— 别处改了目标页标题能跟上。
 */
import type { NodeViewConstructor } from 'prosemirror-view'

import { metaOf, openDoc, subscribe } from '../doc-meta'
import { asString } from './attrs'

/** 目标页没设图标时的兜底：Notion 那张「带两行字的竖长页」，比正文大一号（内联 SVG，不引图标库）。 */
const DOC_ICON =
  '<svg viewBox="0 0 16 20" width="18" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 1.5H9L14.5 7v9.5A2 2 0 0 1 12.5 18.5h-9A2 2 0 0 1 1.5 16.5v-13A2 2 0 0 1 3.5 1.5z"/><path d="M9 1.5V7h5.5"/><path d="M4.5 12h7M4.5 14.8h6.5"/></svg>'

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
