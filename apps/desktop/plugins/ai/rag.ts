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

export function searchScope(ctx: Context, scope: RagScope, query: string): Promise<RagTrace> {
  return ctx.rpc.call<RagTrace>('rag:search', { scope, query })
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
  const needle = anchor.replace(/\s+/g, '')
  const until = Date.now() + 6000
  const tick = () => {
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
