/**
 * 「@ 一个范围」的类型和动作（D-0200，`docs/ai-rag.md`）。
 *
 * ★ 检索本身在 Rust（`rag:search`），这里只取结果、拼提示词、做回跳。
 * ★ 范围只在**这一问**有效：发完就清，不带到下一问。
 */
import type { Context } from 'cordis'

import {
  OPEN_DOC,
  type EditorService,
  type RagChunk,
  type RagScope,
  type RagScopeItem,
  type RagTrace,
} from '../../src/kernel/contract'

export type { RagChunk, RagScope, RagScopeItem, RagTrace } from '../../src/kernel/contract'

/** 范围的短标签：路径。 */
export function scopeLabel(scope: RagScope): string {
  return scope.path
}

/** `@` 选择器的数据。30 秒缓存 —— 同一轮里反复开合不必来回问库。 */
let cached: { at: number; items: RagScopeItem[] } | null = null

export async function loadScopes(ctx: Context): Promise<RagScopeItem[]> {
  if (cached && Date.now() - cached.at < 30_000) return cached.items
  const items = await ctx.rpc.call<RagScopeItem[]>('rag:scopes', {})
  cached = { at: Date.now(), items: Array.isArray(items) ? items : [] }
  return cached.items
}

const MERGED_CHUNKS = 8
const MERGED_CHARS = 3_600

/** 一条问题圈了多个范围：各自检索后按分数合成一份，编号重新从 1 排。 */
export function mergeTraces(traces: RagTrace[]): RagTrace | null {
  if (!traces.length) return null
  const withText = traces.filter((t) => t.chunks.length > 0)
  if (!withText.length) return traces[0] ?? null

  const ranked = withText.flatMap((t) => t.chunks).sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const chunks: RagChunk[] = []
  let chars = 0
  for (const chunk of ranked) {
    const key = `${chunk.docId}\u0000${chunk.anchor}`
    if (seen.has(key)) continue
    seen.add(key)
    const cost = chunk.text.length + chunk.title.length + chunk.path.length + 24
    if (chunks.length > 0 && chars + cost > MERGED_CHARS) continue
    chars += cost
    chunks.push({ ...chunk, n: chunks.length + 1 })
    if (chunks.length >= MERGED_CHUNKS) break
  }

  const head = withText[0]
  if (!head) return null
  const scope: RagScope =
    withText.length === 1
      ? head.scope
      : {
          kind: 'dir',
          path: withText.map((t) => scopeLabel(t.scope)).join(' · '),
          title: withText.map((t) => t.scope.title).join(' · '),
        }
  const used = new Map<string, RagTrace['usedDocs'][number]>()
  for (const trace of withText) {
    for (const doc of trace.usedDocs) {
      const prev = used.get(doc.id)
      used.set(doc.id, prev ? { ...prev, chunks: prev.chunks + doc.chunks } : doc)
    }
  }
  return {
    scope,
    query: head.query,
    terms: [...new Set(withText.flatMap((t) => t.terms))].slice(0, 14),
    semantic: withText.some((t) => t.semantic),
    docsTotal: withText.reduce((n, t) => n + t.docsTotal, 0),
    docsScanned: withText.reduce((n, t) => n + t.docsScanned, 0),
    docsHit: withText.reduce((n, t) => n + t.docsHit, 0),
    docsSkipped: withText.reduce((n, t) => n + t.docsSkipped, 0),
    chunksScored: withText.reduce((n, t) => n + t.chunksScored, 0),
    chars,
    tookMs: Math.max(...withText.map((t) => t.tookMs)),
    chunks,
    usedDocs: [...used.values()],
    docScores: withText
      .flatMap((t) => t.docScores)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8),
  }
}

export function searchScope(
  ctx: Context,
  scope: RagScope,
  query: string,
  focusId?: string | null,
): Promise<RagTrace> {
  return ctx.rpc.call<RagTrace>('rag:search', {
    scope,
    query,
    focusId: focusId ?? '',
  })
}

/** 拼成用户消息里那段资料。编号就是正文里的 `[n]`。 */
export function sourcesBlock(trace: RagTrace): string {
  const head = `【检索资料】范围《${scopeLabel(trace.scope)}》`
  const parts = trace.chunks.map((c) => {
    const where = c.heading ? ` · 章节：${c.heading}` : ''
    return `[${c.n}] 《${c.title}》 · ${c.path}${where}\n${c.text}`
  })
  return [head, ...parts].join('\n\n')
}

/** 空态给模型的一句话 —— 让它老实说没找到。 */
export function emptyPrompt(ctx: Context, trace: RagTrace): string {
  const why =
    trace.empty === 'no_docs'
      ? ctx.i18n.t('agent.ragEmptyNoDocs')
      : trace.empty === 'no_projection'
        ? ctx.i18n.t('agent.ragEmptyNoProjection')
        : ctx.i18n.t('agent.ragEmptyNoMatch')
  return `本轮范围是《${scopeLabel(trace.scope)}》，但预检索没有可用的正文：${why}。直接告诉用户，建议换关键词或换范围，不要编造内容。`
}

/** 打开原文并滚到那段。编辑器还没接 `revealText` 时退回 DOM 找块。 */
export function revealChunk(ctx: Context, chunk: RagChunk): void {
  ctx.emit(OPEN_DOC, { id: chunk.docId })
  const editor = ctx.editor as
    | (EditorService & { revealText?: (id: string, anchor: string) => void })
    | undefined
  if (editor && typeof editor.revealText === 'function') {
    editor.revealText(chunk.docId, chunk.anchor)
    return
  }
  domReveal(chunk.anchor)
}

/** 编辑器新口子接线之前的兜底：正文块自带 `sn-block`，按文字前缀找。 */
function domReveal(anchor: string): void {
  const full = anchor.replace(/\s+/g, '')
  // 锚点可能跨块 / 被截断，逐级退到更短的前缀。
  const needles = [32, 24, 16, 8]
    .map((n) => full.slice(0, n))
    .filter((n, i, all) => n.length >= 4 && all.indexOf(n) === i)
  const until = Date.now() + 6000
  const tick = () => {
    for (const needle of needles) {
      for (const el of document.querySelectorAll<HTMLElement>('.sn-block')) {
        if (el.textContent?.replace(/\s+/g, '').includes(needle)) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          el.classList.remove('sn-rag-flash')
          void el.offsetWidth
          el.classList.add('sn-rag-flash')
          window.setTimeout(() => el.classList.remove('sn-rag-flash'), 1400)
          return
        }
      }
    }
    if (Date.now() < until) window.setTimeout(tick, 80)
  }
  window.setTimeout(tick, 40)
}

/** 选择器里一行能不能被 `@` 后面的字命中。 */
export function matchesScope(item: RagScopeItem, q: string): boolean {
  if (q === '') return true
  const needle = q.toLowerCase()
  return item.path.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle)
}
