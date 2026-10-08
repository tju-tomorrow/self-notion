/**
 * `columnList` / `column` 的 NodeView —— P2 只做基础渲染（并排几列、看得见边界）。
 *
 * ★ `column` 有内容（`blockGroup`），**`contentDOM` 必须是真在 DOM 里的那个元素**，否则打不进字；
 *   而且不许重排 / 过滤子节点（架构 §2.3）。列宽拖拽 / 列尾回车 / 跨列拖拽留后面。
 * ★ 外框（`.sn-columns` / `.sn-column`）和内容容器（`-inner` / `-body`）分开：flex 挂在内容容器上，
 *   外框只负责边距和边界，PM 摆子节点的位置才不会跟布局打架。
 */
import type { NodeViewConstructor } from 'prosemirror-view'

export const columnListView: NodeViewConstructor = () => {
  const dom = document.createElement('div')
  dom.className = 'sn-columns'
  const inner = document.createElement('div')
  inner.className = 'sn-columns-inner'
  dom.appendChild(inner)
  return { dom, contentDOM: inner }
}

export const columnView: NodeViewConstructor = () => {
  const dom = document.createElement('div')
  dom.className = 'sn-column'
  const body = document.createElement('div')
  body.className = 'sn-column-body'
  dom.appendChild(body)
  return { dom, contentDOM: body }
}
