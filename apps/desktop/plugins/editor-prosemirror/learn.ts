/**
 * 编辑器侧的学习指标（D-0193）。
 * 打开次数在挂上时 +1；时长只在窗口可见时累加；深度是视口底边到过的最深位置。
 */
import { FAMILIARITY, type LearnRow } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'

export { FAMILIARITY }

type Call = (method: `${string}:${string}`, args: Record<string, unknown>) => Promise<unknown>

let call: Call | null = null
const subs = new Set<(row: LearnRow) => void>()
const latest = new Map<string, LearnRow>()

export function setLearnRpc(fn: Call): void {
  call = fn
}

export function subscribeLearn(cb: (row: LearnRow) => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}

function publish(row: LearnRow): void {
  latest.set(row.docId, row)
  for (const cb of subs) cb(row)
}

/** 读和「刚打开 +1」会叠在一起。读的途中如果已经有更新的写入，用写入那份。 */
export async function fetchLearn(id: string): Promise<LearnRow | null> {
  if (!call) return null
  const before = latest.get(id)
  const row = (await call('learn:get', { id })) as LearnRow
  const after = latest.get(id)
  if (after && after !== before) return after
  if (before && fresher(before, row)) return before
  latest.set(id, row)
  return row
}

function fresher(a: LearnRow, b: LearnRow): boolean {
  if (a.opens !== b.opens) return a.opens > b.opens
  if (a.readMs !== b.readMs) return a.readMs > b.readMs
  return a.depth > b.depth
}

export async function setFamiliarity(id: string, level: number | null): Promise<LearnRow> {
  if (!call) throw new Error('learn rpc 还没接上')
  const row = (await call('learn:familiarity', { id, level })) as LearnRow
  publish(row)
  return row
}

/** 这篇编辑器活着的期间记账。`signal` 中止时把没刷出去的时长写掉。 */
export function startLearn(docId: string, content: HTMLElement, signal: AbortSignal): void {
  if (!call || signal.aborted) return
  const rpc = call
  void rpc('learn:opened', { id: docId })
    .then((row) => publish(row as LearnRow))
    .catch((err) => reportError('learn', err))

  const scroller = scrollerOf(content)
  let depth = 0
  let pending = 0
  let last = performance.now()
  let sent = false

  const sample = (): void => {
    const now = performance.now()
    if (document.visibilityState === 'visible') pending += now - last
    last = now
    depth = Math.max(depth, measure(scroller))
  }

  const flush = (): void => {
    sample()
    const addMs = Math.round(pending)
    pending = 0
    if (!sent && addMs < 400 && depth === 0) return
    sent = true
    void rpc('learn:progress', { id: docId, addMs, depth })
      .then((row) => publish(row as LearnRow))
      .catch((err) => reportError('learn', err))
  }

  const timer = setInterval(flush, 15_000)
  scroller.addEventListener('scroll', sample, { passive: true, signal })
  document.addEventListener('visibilitychange', sample, { signal })
  signal.addEventListener('abort', () => {
    clearInterval(timer)
    flush()
  })
  requestAnimationFrame(sample)
}

function scrollerOf(el: HTMLElement): HTMLElement {
  const parent = el.parentElement
  if (parent && scrolls(parent)) return parent
  if (scrolls(el)) return el
  return parent ?? el
}

function scrolls(el: HTMLElement): boolean {
  const oy = getComputedStyle(el).overflowY
  return oy === 'auto' || oy === 'scroll'
}

/** 一屏装得下 = 已经看到底。还没布局出来（高度接近 0）先记 0，别误记成读完。 */
function measure(scroller: HTMLElement): number {
  const height = scroller.scrollHeight
  if (height < 8) return 0
  if (height <= scroller.clientHeight + 1) return 100
  const bottom = scroller.scrollTop + scroller.clientHeight
  return Math.max(0, Math.min(100, Math.round((bottom / height) * 100)))
}
