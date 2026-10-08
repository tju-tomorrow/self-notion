/**
 * 前进/后退的历史栈 —— **纯逻辑，不碰 React、不碰 ctx**。
 *
 * 一条记录 = 「主区显示什么」：某一篇文档，或者某一页列表。跟标签条一样是**内部状态**，
 * 不进 `contract.ts`（契约里没有「当前文档」）。
 */
import type { ListGroup } from '../../src/kernel/contract'

export type NavEntry =
  | { readonly kind: 'doc'; readonly id: string }
  | { readonly kind: 'list'; readonly group: ListGroup }

export interface NavSnapshot {
  /** 走过的路，从前到后 */
  readonly entries: readonly NavEntry[]
  /** 现在站在哪一条上 */
  readonly index: number
}

export interface NavStore {
  subscribe(cb: () => void): () => void
  /** 内容不变时返回同一个对象 —— 否则 useSyncExternalStore 会无限重渲染 */
  snapshot(): NavSnapshot
  /** 走了一步新的（用户自己点出来的）。 */
  push(entry: NavEntry): void
  /** 退一步；退不动（已在最前）返回 undefined */
  back(): NavEntry | undefined
  /** 进一步 */
  forward(): NavEntry | undefined
}

/** 无限长的历史没有意义，超过就丢头上那几条。 */
const MAX = 100

function same(a: NavEntry, b: NavEntry): boolean {
  if (a.kind === 'doc' && b.kind === 'doc') return a.id === b.id
  if (a.kind === 'list' && b.kind === 'list') return a.group === b.group
  return false
}

export const EMPTY: NavSnapshot = { entries: [], index: -1 }

export function createNav(initial: NavSnapshot = EMPTY): NavStore {
  let snap = initial
  const subs = new Set<() => void>()

  const commit = (entries: readonly NavEntry[], index: number) => {
    snap = { entries, index }
    subs.forEach((cb) => cb())
  }

  return {
    subscribe(cb) {
      subs.add(cb)
      return () => void subs.delete(cb)
    },

    snapshot: () => snap,

    push(entry) {
      const here = snap.entries[snap.index]
      // 站在同一条上：不算新的一步。编辑器点某一栏、恢复会话都会重发同一条。
      if (here && same(here, entry)) return
      // 从中间往前走：后面那条路作废，从这儿重新开始。
      const kept = snap.entries.slice(0, snap.index + 1)
      kept.push(entry)
      const dropped = Math.max(0, kept.length - MAX)
      commit(dropped ? kept.slice(dropped) : kept, kept.length - 1 - dropped)
    },

    back() {
      if (snap.index <= 0) return undefined
      const index = snap.index - 1
      commit(snap.entries, index)
      return snap.entries[index]
    },

    forward() {
      if (snap.index < 0 || snap.index >= snap.entries.length - 1) return undefined
      const index = snap.index + 1
      commit(snap.entries, index)
      return snap.entries[index]
    },
  }
}
