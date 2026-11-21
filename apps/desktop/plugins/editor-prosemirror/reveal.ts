/**
 * 引用回到原文：找到含那段文字的第一个块，滚过去闪一下（D-0200）。
 *
 * ★ 文档可能刚被 `OPEN_DOC` 叫起来，视图还没挂 —— 所以先记着，60ms 一轮等到超时。
 * ★ 只认文本前缀，不认块 id：检索读的是 Markdown 投影，块 id 不在那条路上。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

const FLASH = 'sn-rag-flash'
const FLASH_MS = 1400
const WAIT_MS = 6000

/** `editor.ts` 用它把活文档接进来 —— 不反向 import，免得两个模块绕成环。 */
type LiveView = { readonly id: string; readonly view: EditorView }
let views: () => readonly LiveView[] = () => []

export function setRevealViews(get: () => readonly LiveView[]): void {
  views = get
}

let pending: { docId: string; anchor: string; until: number } | null = null
let timer = 0

export function revealText(docId: string, anchor: string): void {
  if (anchor.trim() === '') return
  pending = { docId, anchor, until: Date.now() + WAIT_MS }
  window.clearTimeout(timer)
  timer = window.setTimeout(step, 0)
}

function step(): void {
  timer = 0
  const job = pending
  if (!job) return
  if (Date.now() > job.until) {
    pending = null
    return
  }
  const view = views().find((doc) => doc.id === job.docId)?.view
  const pos = view ? findAnchor(view.state.doc, job.anchor) : -1
  if (view && pos >= 0) {
    pending = null
    paint(view.nodeDOM(pos))
    return
  }
  timer = window.setTimeout(step, 60)
}

function findAnchor(doc: PMNode, anchor: string): number {
  const full = flat(anchor)
  // 锚点可能被截断或跨块，逐级退到更短的前缀。
  const needles = [32, 24, 16, 8]
    .map((n) => full.slice(0, n))
    .filter((n, i, all) => n.length >= 4 && all.indexOf(n) === i)
  let found = -1
  doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name !== 'blockContainer') return undefined
    const text = flat(node.textContent)
    if (needles.some((needle) => text.includes(needle))) {
      found = pos
      return false
    }
    return undefined
  })
  return found
}

function paint(node: globalThis.Node | null): void {
  const el = node instanceof HTMLElement ? node : node?.parentElement
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.remove(FLASH)
  // 重排一下，连点同一处也能重新播动画。
  void el.offsetWidth
  el.classList.add(FLASH)
  window.setTimeout(() => el.classList.remove(FLASH), FLASH_MS)
}

function flat(text: string): string {
  return text.replace(/\s+/g, '')
}
