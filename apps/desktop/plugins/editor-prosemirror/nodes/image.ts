/**
 * `image` 的 NodeView —— 真渲染一张图。
 *
 * 字节走 `self-notion://blob/<blobId>`，URL 是**现算的**、不进 JSON（schema 那条注释）；
 * `width` 是像素数，落 inline style（只写属性会被 `max-width:100%` 那把尺子量回去）。
 * 原子节点、没有 contentDOM，选中态交给 PM 默认加的 `.ProseMirror-selectednode`。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { asString, asWidth } from './attrs'

const BLOB_PREFIX = 'self-notion://blob/'

export const imageView: NodeViewConstructor = (node) => {
  const dom = document.createElement('div')
  dom.className = 'sn-image'

  const img = document.createElement('img')
  img.className = 'sn-image-img'
  img.alt = ''
  img.draggable = false

  dom.appendChild(img)

  const paint = (n: PMNode) => {
    const blobId = asString(n.attrs.blobId)
    img.src = blobId ? `${BLOB_PREFIX}${blobId}` : ''
    // 还没有 blobId（占位 / 导入途中）—— 让 CSS 画一块灰底，别露一个破图标。
    dom.dataset.empty = String(blobId === '')
    const width = asWidth(n.attrs.width)
    img.style.width = width === null ? '' : `${width}px`
  }
  paint(node)

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type) return false
      paint(next)
      return true
    },
  }
}
