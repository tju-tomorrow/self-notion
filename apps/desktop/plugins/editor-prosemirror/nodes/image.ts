/**
 * `image` 的 NodeView —— 真渲染一张图。
 *
 * 字节走 `self-notion://blob/<blobId>`，URL 是**现算的**、不进 JSON（schema 那条注释）；
 * `width` 是像素数，落 inline style（只写属性会被 `max-width:100%` 那把尺子量回去）。
 * 原子节点、没有 contentDOM，选中态交给 PM 默认加的 `.ProseMirror-selectednode`。
 *
 * 点一下放大看 —— 灯箱在 `./lightbox.ts`。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { asString, asWidth } from './attrs'
import { DRAG_SLOP, openLightbox } from './lightbox'

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

  // 拖图片也会走到 click —— 按下的位置记一笔，移动超过 `DRAG_SLOP` 就不当点击。
  let down: { x: number; y: number } | null = null
  img.addEventListener('mousedown', (e) => {
    down = { x: e.clientX, y: e.clientY }
  })
  img.addEventListener('click', (e) => {
    const moved =
      down !== null && (Math.abs(e.clientX - down.x) > DRAG_SLOP || Math.abs(e.clientY - down.y) > DRAG_SLOP)
    down = null
    // 带修饰键的点击是选块（⇧ 扩选 / ⌘ 多选），别抢。
    if (moved || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    // 还没落上 blobId 的占位（`img.src = ''` 会解析成页面自己的 URL，所以读属性不读 `.src`）。
    const src = img.getAttribute('src')
    if (src) openLightbox(src)
  })

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type) return false
      paint(next)
      return true
    },
  }
}
