/**
 * 朗读划线。只是 decoration，不写进正文。
 */
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'

interface Mark {
  from: number
  to: number
}

const readKey = new PluginKey<Mark | null>('sn-read')

export const readPlugin = new Plugin<Mark | null>({
  key: readKey,
  state: {
    init: () => null,
    apply(tr, prev) {
      const meta = tr.getMeta(readKey) as Mark | 'off' | undefined
      if (meta === 'off') return null
      if (meta) return meta
      if (!prev || !tr.docChanged) return prev
      const from = tr.mapping.map(prev.from)
      const to = tr.mapping.map(prev.to)
      return from < to ? { from, to } : null
    },
  },
  props: {
    decorations(state) {
      const cur = readKey.getState(state)
      if (!cur) return null
      const doc = state.doc
      if (cur.from < 0 || cur.from >= cur.to || cur.to > doc.content.size) return null
      return DecorationSet.create(doc, [
        Decoration.inline(cur.from, cur.to, { class: 'sn-read-now' }),
      ])
    },
  },
})

function insideText(view: EditorView, from: number, to: number): boolean {
  try {
    const a = view.state.doc.resolve(from)
    const b = view.state.doc.resolve(to)
    return a.parent === b.parent && a.parent.isTextblock
  } catch {
    return false
  }
}

/** 划上，或擦掉。位置跨出文字节点就擦掉，免得 decoration 抛。 */
export function paintRead(view: EditorView, range: { from: number; to: number } | null): void {
  const doc = view.state.doc
  const ok =
    range !== null &&
    range.from < range.to &&
    range.to <= doc.content.size &&
    insideText(view, range.from, range.to)
  const mark: Mark | 'off' = ok && range ? { from: range.from, to: range.to } : 'off'
  view.dispatch(view.state.tr.setMeta(readKey, mark).setMeta('addToHistory', false))
  if (mark === 'off') return
  const coords = view.coordsAtPos(mark.from)
  const scroller = view.dom.closest('.sn-pane-body')
  const box = (scroller ?? view.dom).getBoundingClientRect()
  if (coords.top >= box.top + 64 && coords.bottom <= box.bottom - 64) return
  const dom = view.domAtPos(mark.from).node
  const el = dom instanceof Element ? dom : dom.parentElement
  el?.scrollIntoView({ block: 'nearest' })
}

export interface ReadSpan {
  from: number
  to: number
  text: string
}

const BREAK = /[。！？!?；;\n]/
const WORD = /[\p{L}\p{N}]/u
/** 一句的上限。再长 Edge 照样收，但划线要跟着走，不能一整段才动一次。 */
const MAX = 180

/** 把范围内的正文切成能单独念的句子。跨不出一个文字块，划线才画得上。 */
export function collectSpans(doc: PMNode, from: number, to: number): ReadSpan[] {
  const out: ReadSpan[] = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return
    let acc = ''
    let accFrom = 0
    const flush = (end: number) => {
      const raw = acc
      acc = ''
      if (!raw) return
      const lead = raw.length - raw.trimStart().length
      const trail = raw.length - raw.trimEnd().length
      const text = raw.slice(lead, raw.length - trail)
      if (!WORD.test(text)) return
      const a = accFrom + lead
      const b = end - trail
      if (a < b) out.push({ from: a, to: b, text })
    }
    let cursor = pos + 1
    node.forEach((child) => {
      const childFrom = cursor
      cursor += child.nodeSize
      if (!child.isText) {
        flush(childFrom)
        return
      }
      const text = child.text ?? ''
      const lo = Math.max(0, from - childFrom)
      const hi = Math.min(text.length, to - childFrom)
      for (let i = lo; i < hi; i++) {
        const ch = text[i] ?? ''
        if (!acc) accFrom = childFrom + i
        acc += ch
        if (BREAK.test(ch) || acc.length >= MAX) flush(childFrom + i + 1)
      }
    })
    flush(Math.min(to, pos + node.nodeSize - 1))
    return false
  })
  return out
}
