/**
 * `image` 的 NodeView —— 真渲染一张图，加右下角拖宽、对齐按钮和图注。
 *
 * 字节走 `self-notion://blob/<blobId>`，URL 是**现算的**、不进 JSON（schema 那条注释）；
 * `width` 是像素数，落 inline style（只写属性会被 `max-width:100%` 那把尺子量回去）。
 * 原子节点、没有 contentDOM，选中态交给 PM 默认加的 `.ProseMirror-selectednode`。
 *
 * 点一下放大看 —— 灯箱在 `./lightbox.ts`。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { blobUrl } from '../../../src/platform/blob-url'
import { selectBlockRange } from '../plugins/block-selection'
import { asString, asWidth } from './attrs'
import { openLightbox } from './lightbox'

const MIN_WIDTH = 40

export const imageView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div')
  dom.className = 'sn-image'

  const bar = document.createElement('div')
  bar.className = 'sn-image-bar'
  bar.contentEditable = 'false'

  const shell = document.createElement('div')
  shell.className = 'sn-image-shell'

  const img = document.createElement('img')
  img.className = 'sn-image-img'
  img.alt = ''
  img.draggable = false

  const grip = document.createElement('span')
  grip.className = 'sn-image-grip'
  grip.contentEditable = 'false'

  const caption = document.createElement('input')
  caption.className = 'sn-image-caption'
  caption.type = 'text'
  caption.placeholder = '添加说明'
  caption.contentEditable = 'false'
  caption.tabIndex = -1

  shell.append(img, grip)
  dom.append(bar, shell, caption)

  const currentNode = (): PMNode | null => {
    const pos = getPos()
    if (pos === undefined) return null
    return view.state.doc.nodeAt(pos)
  }

  const setAttr = (patch: Record<string, unknown>): void => {
    const pos = getPos()
    const cur = currentNode()
    if (pos === undefined || !cur) return
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, ...patch }))
  }

  const paint = (n: PMNode) => {
    const blobId = asString(n.attrs.blobId)
    img.src = blobId ? blobUrl(blobId) : ''
    // 还没有 blobId（占位 / 导入途中）—— 让 CSS 画一块灰底，别露一个破图标。
    dom.dataset.empty = String(blobId === '')
    const width = asWidth(n.attrs.width)
    img.style.width = width === null ? '' : `${width}px`
    dom.dataset.align = asString(n.attrs.align) || 'left'
    if (document.activeElement !== caption) caption.value = asString(n.attrs.caption)
  }
  paint(node)

  for (const [align, title] of [
    ['left', '左对齐'],
    ['center', '居中'],
    ['right', '右对齐'],
  ] as const) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'sn-image-align'
    btn.title = title
    btn.textContent = align === 'left' ? '⇤' : align === 'center' ? '↔' : '⇥'
    btn.addEventListener('mousedown', (e) => e.preventDefault())
    btn.addEventListener('click', () => setAttr({ align }))
    bar.appendChild(btn)
  }

  // 拖右下角改宽度。拖动过程只改 DOM，松手才写回属性（不然一步一个历史记录）。
  let drag: { x: number; width: number } | null = null
  const onMove = (e: MouseEvent): void => {
    if (!drag) return
    const width = Math.max(MIN_WIDTH, Math.round(drag.width + e.clientX - drag.x))
    img.style.width = `${width}px`
  }
  const onUp = (): void => {
    if (!drag) return
    const width = Math.round(img.getBoundingClientRect().width)
    drag = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    if (width >= MIN_WIDTH) setAttr({ width })
  }
  grip.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    drag = { x: e.clientX, width: img.getBoundingClientRect().width }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })

  // 图注：失焦 / 回车时落库。
  const commitCaption = (): void => {
    const text = caption.value.trim()
    if (text !== asString(currentNode()?.attrs.caption)) setAttr({ caption: text })
  }
  caption.addEventListener('blur', commitCaption)
  caption.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Escape') caption.blur()
    if (e.key === 'Enter') {
      e.preventDefault()
      caption.blur()
    }
  })

  // 图片首先是个块：单击选中它（能 Tab 缩进 / 用块手柄），双击才放大。
  img.addEventListener('click', (e) => {
    // 带修饰键的点击是 PM 原生那套（⌘ 多选 / ⇧ 扩选），别抢。
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const pos = getPos()
    if (pos === undefined) return
    const $pos = view.state.doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d -= 1) {
      const node = $pos.node(d)
      if (node.type.name !== 'blockContainer') continue
      e.preventDefault()
      selectBlockRange(view, String(node.attrs.id))
      view.focus()
      return
    }
  })

  img.addEventListener('dblclick', (e) => {
    // 还没落上 blobId 的占位（`img.src = ''` 会解析成页面自己的 URL，所以读属性不读 `.src`）。
    const src = img.getAttribute('src')
    if (!src) return
    e.preventDefault()
    openLightbox(src)
  })

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type) return false
      paint(next)
      return true
    },
    destroy: () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    },
  }
}
