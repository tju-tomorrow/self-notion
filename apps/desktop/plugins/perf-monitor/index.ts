/**
 * 卡死监控的前端半边：量事件循环延迟、每 2s 给 Rust 报一次心跳。
 *
 * 判死在 Rust 的独立线程里（主线程卡住时这边什么都不响）；这里只负责把
 * 「JS 侧到底卡了多久」带过去。窗口隐藏 / 失焦时不记 lag —— WebKit 会把定时器节流，
 * 那不是卡（`ai-web/ui.tsx` 踩过这个坑）。
 */
import type { Context } from 'cordis'
import {
  OPEN_DOC,
  SPLIT_VIEW,
  type DocMem,
  type OpenDocEvent,
  type SplitViewEvent,
} from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { takeSlow } from '../../src/kernel/rpc-timing'

export const name = 'perf-monitor'
export const inject = ['rpc']

const TICK_MS = 1_000
const BEAT_TICKS = 2
const STATS_MS = 30_000
const MAX_DOCS = 5

export function apply(ctx: Context) {
  ctx.effect(() => {
    let doc = ''
    let panes = 1
    let seq = 0
    let lag = 0
    let maxLag = 0
    let longTasks = 0
    let worstLong = 0
    let slept = 0
    let ticks = 0
    let stats: DocMem[] = []
    let statsAt = 0
    let expected = performance.now() + TICK_MS
    let lastWall = Date.now()
    let lastPerf = performance.now()
    let reported = 0

    const offDoc = ctx.on(OPEN_DOC, ({ id }: OpenDocEvent) => void (doc = id))
    const offSplit = ctx.on(SPLIT_VIEW, ({ panes: n }: SplitViewEvent) => void (panes = n))

    let observer: PerformanceObserver | undefined
    try {
      if (
        typeof PerformanceObserver !== 'undefined' &&
        PerformanceObserver.supportedEntryTypes?.includes('longtask')
      ) {
        observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            longTasks++
            if (e.duration > worstLong) worstLong = e.duration
          }
        })
        observer.observe({ entryTypes: ['longtask'] })
      }
    } catch {
      // WebKit 不一定有 longtask —— 以 1s 定时器的 lag 为主。
    }

    const reset = () => {
      expected = performance.now() + TICK_MS
      lastWall = Date.now()
      lastPerf = performance.now()
    }

    const beat = () => {
      const p = performance.now()
      if (p - statsAt >= STATS_MS) {
        statsAt = p
        stats = (ctx.get('mem')?.stats() ?? []).slice(0, MAX_DOCS)
      }
      const slow = takeSlow()
      const worst = slow.length ? slow.reduce((a, b) => (b.ms > a.ms ? b : a)) : undefined
      const payload = {
        seq: ++seq,
        lag,
        maxLag,
        longTasks,
        worstLong: Math.round(worstLong),
        slept,
        hidden: document.visibilityState === 'hidden',
        focused: document.hasFocus(),
        doc,
        panes,
        stats,
        rtt: worst
          ? { method: worst.method, ms: Math.round(worst.ms), n: slow.length }
          : undefined,
      }
      lag = 0
      maxLag = 0
      longTasks = 0
      worstLong = 0
      slept = 0
      void ctx.rpc.call('perf:beat', payload).catch((err: unknown) => {
        const now = Date.now()
        if (now - reported < 60_000) return
        reported = now
        reportError('perf', err)
      })
    }

    const tick = () => {
      const p = performance.now()
      const w = Date.now()
      const wallGap = w - lastWall
      const perfGap = p - lastPerf
      lastWall = w
      lastPerf = p
      // 墙钟走了、单调钟没走 = 系统睡了，不是 JS 卡住。
      if (wallGap - perfGap > 2_000) {
        slept = Math.round(wallGap - perfGap)
        reset()
        return
      }
      const late = p - expected
      expected = p + TICK_MS
      if (late < 0) return
      if (document.visibilityState === 'hidden' || !document.hasFocus()) return
      lag = Math.round(late)
      if (lag > maxLag) maxLag = lag
    }

    const timer = setInterval(() => {
      tick()
      if (++ticks % BEAT_TICKS === 0) beat()
    }, TICK_MS)

    const wake = () => {
      reset()
      beat()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      observer?.disconnect()
      offDoc()
      offSplit()
    }
  })
}
