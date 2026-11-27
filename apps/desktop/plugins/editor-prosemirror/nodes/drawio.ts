/**
 * `drawio` 的 NodeView（D-0216）：只读缩略图，点一下开画布标签。
 *
 * 预览和画布页共用 `src/drawio/engine.ts`；XML 变了就整张重建 —— 画布保存回来时
 * `update` 拿到新的 attrs，这里自然就换了。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { createDrawioGraph, warmDrawio, type DrawioGraph } from '../../../src/drawio/engine'
import { reportError } from '../../../src/kernel/errors'
import { openCanvas } from '../doc-meta'
import { asString } from './attrs'
import './drawio.css'

/** 编辑区根上的 `data-doc-id`（`editor.ts` 挂的）。 */
function docIdOf(el: HTMLElement): string {
  let node: HTMLElement | null = el
  while (node) {
    if (node.dataset.docId) return node.dataset.docId
    node = node.parentElement
  }
  return ''
}

export const drawioView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div')
  dom.className = 'sn-drawio'
  dom.tabIndex = 0
  dom.setAttribute('role', 'button')

  const frame = document.createElement('div')
  frame.className = 'sn-drawio-frame'
  const overlay = document.createElement('div')
  overlay.className = 'sn-drawio-open'
  overlay.textContent = '点击打开画布'
  const empty = document.createElement('div')
  empty.className = 'sn-drawio-empty'
  empty.textContent = '空白画布 · 点击打开'

  dom.append(frame, overlay, empty)

  let xml = ''
  let handle: DrawioGraph | null = null
  let token = 0

  const paint = (n: PMNode): void => {
    const next = asString(n.attrs.xml)
    if (next === xml && handle !== null) return
    xml = next
    token += 1
    const mine = token
    handle?.dispose()
    handle = null
    frame.replaceChildren()
    dom.dataset.empty = String(next.trim() === '')
    if (!next.trim()) return
    void createDrawioGraph(frame, { xml: next, interactive: false })
      .then((g) => {
        if (mine !== token || !dom.isConnected) {
          g.dispose()
          return
        }
        handle = g
      })
      .catch((err: unknown) => reportError('editor-prosemirror', err))
  }

  const open = (): void => {
    const pos = getPos()
    if (pos === undefined) return
    const docId = docIdOf(view.dom)
    if (!docId) return
    const $pos = view.state.doc.resolve(pos)
    let blockId = ''
    for (let d = $pos.depth; d > 0; d -= 1) {
      const n = $pos.node(d)
      if (n.type.name === 'blockContainer') {
        blockId = String(n.attrs.id ?? '')
        break
      }
    }
    if (blockId) openCanvas(docId, blockId)
  }

  dom.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    open()
  })
  dom.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    open()
  })

  const ro = new ResizeObserver(() => {
    handle?.fit()
  })
  ro.observe(frame)

  paint(node)
  // 空块点开时不用再等那 ~1MB 的引擎块。
  if (!xml.trim()) warmDrawio()

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type) return false
      paint(next)
      return true
    },
    stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
    ignoreMutation: () => true,
    destroy: () => {
      token += 1
      ro.disconnect()
      handle?.dispose()
      handle = null
    },
  }
}
