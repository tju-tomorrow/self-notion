/**
 * 查找替换 —— 行为照抄 `editor-blocksuite/editor.ts` 里那组（块内、不分大小写的字面匹配），
 * 实现换成 ProseMirror。
 *
 * ★ 命中只在**单个块内**找（旧实现也是块内 `indexOf`，不跨块）—— 所以 `Match` 带块 id。
 * ★ 高亮走 decoration（PM 的正路），绝不往正文里写标记。
 * ★ 替换**可撤销**（旧版 BlockSuite 时代用 `withoutHistory` 挡了历史，PM 里不挡 —— 误点全部替换要能 ⌘Z 回来）。
 */
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'

/** 一处命中。`from`/`to` 是**文档位置**（PM 的寻址方式），`before`/`after` 是命中前后的上下文。 */
export interface Match {
  blockId: string
  from: number
  to: number
  before: string
  after: string
}

export interface FindApi {
  search(query: string): Promise<Match[]>
  focus(match: Match): Promise<void>
  replace(match: Match, text: string): Promise<void>
  replaceAll(query: string, text: string): Promise<number>
}

/** 上下文取多长（给面板/日志看，不影响匹配本身）。 */
const CONTEXT = 20

/** 当前文档里所有匹配。只读，不碰正文。 */
export function findMatches(doc: PMNode, query: string): Match[] {
  if (query === '') return []
  const needle = query.toLowerCase()
  const out: Match[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer') return true
    const text = node.firstChild?.textContent ?? ''
    if (text === '') return true
    const id = String(node.attrs.id ?? '')
    // 内容起点：blockContainer 的内容从 pos+1 起，它的第一个孩子 blockContent 的内容再从 +1 起。
    const base = pos + 2
    const hay = text.toLowerCase()
    let at = hay.indexOf(needle)
    while (at >= 0) {
      out.push({
        blockId: id,
        from: base + at,
        to: base + at + query.length,
        before: text.slice(Math.max(0, at - CONTEXT), at),
        after: text.slice(at + query.length, at + query.length + CONTEXT),
      })
      at = hay.indexOf(needle, at + needle.length)
    }
    return true
  })
  return out
}

/* ─────────────────────────── 高亮（decoration） ─────────────────────────── */

interface FindState {
  matches: readonly Match[]
  active: number
}

const findKey = new PluginKey<FindState>('snFind')

/**
 * 挂到视图上的高亮插件。插件状态就是「命中表 + 当前第几处」，decoration 是算出来的 ——
 * 文档一动（替换/打字）就把命中作废，免得拿旧偏移去画。
 */
export const findPlugin = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ matches: [], active: -1 }),
    apply(tr, prev) {
      const meta = tr.getMeta(findKey) as FindState | undefined
      if (meta) return meta
      if (tr.docChanged) return { matches: [], active: -1 }
      return prev
    },
  },
  props: {
    decorations(state) {
      const cur = findKey.getState(state)
      if (!cur || cur.matches.length === 0) return null
      const doc = state.doc
      const decos: Decoration[] = []
      cur.matches.forEach((m, i) => {
        if (m.from < 0 || m.from >= m.to || m.to > doc.content.size) return
        decos.push(
          Decoration.inline(m.from, m.to, { class: i === cur.active ? 'sn-find-active' : 'sn-find-hit' }),
        )
      })
      return DecorationSet.create(doc, decos)
    },
  },
})

/**
 * 把插件补进视图。`reconfigure` **保留**已有插件的 state（含撤销栈），只 init 新的那个 ——
 * 所以这里补插件不会把 undo 清掉。
 */
function ensure(view: EditorView): void {
  if (findKey.getState(view.state)) return
  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, findPlugin] }))
}

function paint(view: EditorView, matches: readonly Match[], active: number): void {
  ensure(view)
  view.dispatch(view.state.tr.setMeta(findKey, { matches, active }))
}

/** 推一组命中给视图（`active` 那处画成当前）。空表 = 清掉高亮。 */
export function setMatches(view: EditorView, matches: readonly Match[], active = 0): void {
  if (matches.length === 0 && !findKey.getState(view.state)) return
  paint(view, matches, matches.length === 0 ? -1 : active)
}

/** 跳到一处命中：把它选上 + 滚到视野里，并标成「当前」。 */
export function focusMatch(view: EditorView, m: Match): void {
  const doc = view.state.doc
  if (m.from < 0 || m.from >= m.to || m.to > doc.content.size) return
  const cur = findKey.getState(view.state)?.matches ?? []
  const idx = cur.findIndex((x) => x.from === m.from && x.to === m.to)
  const matches = idx >= 0 ? cur : [m]
  ensure(view)
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(doc, m.from, m.to))
      .setMeta(findKey, { matches, active: idx >= 0 ? idx : 0 })
      .scrollIntoView(),
  )
  view.focus()
}

/** 位置还在原来那个块里吗 —— 文档被改过就别照旧偏移下手，免得替错地方。 */
function sameBlock(doc: PMNode, m: Match): boolean {
  const $pos = doc.resolve(m.from)
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'blockContainer') return String(node.attrs.id ?? '') === m.blockId
  }
  return false
}

/** 替换一处。替换之后同一篇里的偏移会变，调用方要重新 `findMatches`。 */
export function replaceMatch(view: EditorView, m: Match, text: string): void {
  const doc = view.state.doc
  if (m.from < 0 || m.from >= m.to || m.to > doc.content.size) return
  if (!sameBlock(doc, m)) return
  view.dispatch(view.state.tr.insertText(text, m.from, m.to))
}

/** 全部替换。**从后往前**改 —— 前面的替换不会挪动后面那些匹配的偏移。一次事务落定。 */
export function replaceAllMatches(view: EditorView, query: string, text: string): number {
  const found = findMatches(view.state.doc, query)
  if (found.length === 0) return 0
  const tr = view.state.tr
  for (let i = found.length - 1; i >= 0; i--) {
    const m = found[i]
    if (m) tr.insertText(text, m.from, m.to)
  }
  view.dispatch(tr)
  return found.length
}

/**
 * 把手头的活编辑器接到面板要的那组接口上。`getView` 每次调用都重新要一次视图 ——
 * 换文档 / 换栏时拿到的是当下那一个，不用在 api 里存引用。
 */
export function createFindApi(getView: () => EditorView | null): FindApi {
  return {
    async search(query) {
      const view = getView()
      if (!view) return []
      const found = findMatches(view.state.doc, query)
      setMatches(view, found, 0)
      return found
    },
    async focus(match) {
      const view = getView()
      if (view) focusMatch(view, match)
    },
    async replace(match, text) {
      const view = getView()
      if (view) replaceMatch(view, match, text)
    },
    async replaceAll(query, text) {
      const view = getView()
      return view ? replaceAllMatches(view, query, text) : 0
    },
  }
}
