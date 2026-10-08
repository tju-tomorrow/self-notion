/**
 * `video` / `audio` / `file` 的 NodeView。
 *
 * 字节走 `self-notion://blob/<blobId>`（跟 image 一条路，URL 现算、不进 JSON）；`video`/`audio`
 * 交给 webview 自己拉，`file` 得点一下——**下载走 fetch + object URL**，不让 `href` 直接指向
 * 自定义协议：WKWebView 不认它 `download`，会把整个窗口导航走（图省事的 anchor 在这会翻车）。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { asString } from './attrs'

const BLOB_PREFIX = 'self-notion://blob/'

function makeMediaView(kind: 'video' | 'audio'): NodeViewConstructor {
  return (node) => {
    const dom = document.createElement('div')
    dom.className = `sn-media sn-media-${kind}`

    const el = document.createElement(kind)
    el.className = `sn-${kind}`
    el.controls = true
    el.preload = 'metadata'
    el.draggable = false
    dom.appendChild(el)

    const paint = (n: PMNode) => {
      const blobId = asString(n.attrs.blobId)
      el.src = blobId ? BLOB_PREFIX + blobId : ''
      dom.dataset.empty = String(blobId === '')
    }
    paint(node)

    return {
      dom,
      update: (next) => {
        if (next.type !== node.type) return false
        paint(next)
        return true
      },
      // 控件的点击/拖动得原样到播放器手里 —— PM 一 preventDefault 就打不着播放键了。
      stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
      ignoreMutation: () => true,
    }
  }
}

export const videoView = makeMediaView('video')
export const audioView = makeMediaView('audio')

export const fileView: NodeViewConstructor = (node) => {
  const dom = document.createElement('div')
  dom.className = 'sn-file'

  const link = document.createElement('button')
  link.type = 'button'
  link.className = 'sn-file-link'
  const icon = document.createElement('span')
  icon.className = 'sn-file-icon'
  // 图标跟 inline-toolbar 一个写法（内联 SVG），不引图标库。
  icon.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5.5z"/><path d="M9 1.5V5.5H13"/></svg>'
  const label = document.createElement('span')
  label.className = 'sn-file-name'
  link.append(icon, label)
  dom.appendChild(link)

  let blobId = ''
  let name = ''

  const paint = (n: PMNode) => {
    blobId = asString(n.attrs.blobId)
    name = asString(n.attrs.name) || 'file'
    label.textContent = name
    dom.dataset.empty = String(blobId === '')
  }
  paint(node)

  const download = async () => {
    if (!blobId) return
    try {
      const res = await fetch(BLOB_PREFIX + blobId)
      if (!res.ok) throw new Error(`blob ${res.status}`)
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      // 立刻 revoke 在 WebKit 上会把还没起头的下载掐掉。
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      reportError('editor-prosemirror', err)
    }
  }
  link.addEventListener('click', () => void download())

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type) return false
      paint(next)
      return true
    },
    // 下载按钮的点击得让浏览器收到（PM 别接管），但也不许它顺手挪光标。
    stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
    ignoreMutation: () => true,
  }
}
