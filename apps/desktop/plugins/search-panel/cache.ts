/**
 * 搜索面板的数据缓存 —— **模块级**，开关面板不丢。
 *
 * ★ 面板是按「随手开关」用的（⌘K / 侧栏那行），每次打开都空一下再跳出来，
 *   比没有面板还难受。所以三份东西攒在这儿：文档清单、按查询串的命中、按 id 的正文。
 *   打开的那一瞬间列表**已经在**了，网不网络都不影响。
 *
 * 失效只有一条路径：`DOCS_CHANGED`（别处改名 / 删 / 导入）→ 整片丢掉重取。
 * 订阅用 `subscribe` + `useSyncExternalStore`，视图只读不写，写只发生在这一层。
 */
import type { Context } from 'cordis'
import type { DocMeta, DocText, SearchHit } from '../../src/kernel/contract'

/** 空查询时列最近多少篇。 */
export const RECENT_LIMIT = 40
/** 一次搜索给多少条 —— 和 `search:query` 的 limit 同一个数。 */
export const SEARCH_LIMIT = 30
/** 命中缓存的条数上限（按查询串），超了丢最旧的。 */
const HITS_MAX = 40
/** 正文缓存的条数上限（按文档），超了丢最旧的。 */
const BODIES_MAX = 60

let docs: DocMeta[] | null = null
let docsLoading: Promise<DocMeta[]> | null = null

const hits = new Map<string, SearchHit[]>()
const hitsLoading = new Map<string, Promise<SearchHit[]>>()
const bodies = new Map<string, string>()
const bodiesLoading = new Map<string, Promise<string>>()

const subs = new Set<() => void>()
let rev = 0

/** `useSyncExternalStore` 的快照：**只认这个数**，内容变化全走读函数。 */
export function getRev(): number {
  return rev
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

function bump() {
  rev++
  subs.forEach((cb) => cb())
}

/** 有上限的 Map：写满了先丢最旧的一条（Map 的迭代顺序 = 插入顺序）。 */
function put<T>(map: Map<string, T>, key: string, value: T, max: number) {
  map.delete(key)
  map.set(key, value)
  while (map.size > max) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

export function peekDocs(): DocMeta[] | null {
  return docs
}

/** 拉全量文档清单（`doc:list` 本来就一次给全，和首页/侧栏同源）。在飞的时候只发一条。 */
export function ensureDocs(ctx: Context): Promise<DocMeta[]> {
  if (docs) return Promise.resolve(docs)
  if (docsLoading) return docsLoading
  docsLoading = ctx.rpc
    .call<DocMeta[]>('doc:list', { includeTrashed: true })
    .then((rows) => {
      docs = rows
      bump()
      return rows
    })
    .finally(() => {
      docsLoading = null
    })
  return docsLoading
}

export function peekSearch(q: string): SearchHit[] | undefined {
  return hits.get(q)
}

/** 搜一次。命中的结果按查询串留着 —— 退格再打回同一个词时不该再问一次 Rust。
 *  同一个查询串在飞的时候也只发一条（面板会因为别处的缓存变动重跑 effect）。 */
export function search(ctx: Context, q: string): Promise<SearchHit[]> {
  const cached = hits.get(q)
  if (cached) return Promise.resolve(cached)
  const flying = hitsLoading.get(q)
  if (flying) return flying
  const p = ctx.rpc
    .call<SearchHit[]>('search:query', { q, limit: SEARCH_LIMIT })
    .then((rows) => {
      put(hits, q, rows, HITS_MAX)
      bump()
      return rows
    })
    .finally(() => hitsLoading.delete(q))
  hitsLoading.set(q, p)
  return p
}

export function peekBody(id: string): string | undefined {
  return bodies.get(id)
}

/** 一篇的投影正文。同一篇在飞时只发一条（上下键划过好几十行就是这个场景）。 */
export function body(ctx: Context, id: string): Promise<string> {
  const cached = bodies.get(id)
  if (cached !== undefined) return Promise.resolve(cached)
  const flying = bodiesLoading.get(id)
  if (flying) return flying
  const p = ctx.rpc
    .call<DocText>('doc:text', { id })
    .then((r) => {
      put(bodies, id, r.md, BODIES_MAX)
      bump()
      return r.md
    })
    .finally(() => bodiesLoading.delete(id))
  bodiesLoading.set(id, p)
  return p
}

/** 全丢（`DOCS_CHANGED` 一到、或插件卸载）。正文也跟着丢：改名会落库，正文会变。 */
export function invalidate() {
  docs = null
  docsLoading = null
  hits.clear()
  hitsLoading.clear()
  bodies.clear()
  bump()
}
