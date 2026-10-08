/**
 * 总结插件的模块级状态 —— 顶栏那颗按钮和浮层共用一份。
 *
 * ★ **存盘的是 Rust**（`doc_summary` 表，D-0075）：这边只是把 `ai:summary` 读回来的东西
 *   摆上去，**不自己缓存** —— 两处各存一份就是两处会漂。
 * ★ 「当前是哪一篇」在**插件层**订阅（`index.ts`）：组件的挂载晚于 `OPEN_DOC`，
 *   组件自己监听就永远错过那一篇（同 `shell-doc-header` / `comment`）。
 */
import type { AiSummary } from '../../src/kernel/contract'
import { useSyncExternalStore } from 'react'

/** 一篇的总结 —— 类型源在契约里（`contract.ts` 的 `AiSummary`），这里只换个短名字。 */
type DocSummary = AiSummary

export interface SummaryUiState {
  /** 现在盯着的哪一篇。null = 没开文档 —— 那时候顶栏那颗按钮也不该在。 */
  docId: string | null
  open: boolean
  busy: boolean
  error: string
  /** null = 这篇还没生成过总结。 */
  data: DocSummary | null
}

const EMPTY: SummaryUiState = { docId: null, open: false, busy: false, error: '', data: null }

let state: SummaryUiState = EMPTY
const subs = new Set<() => void>()

export function getSummaryState(): SummaryUiState {
  return state
}

export function setSummaryState(patch: Partial<SummaryUiState>): void {
  state = { ...state, ...patch }
  for (const cb of subs) cb()
}

export function useSummaryState(): SummaryUiState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => state,
    () => state,
  )
}

/** `ai:summary` 的返回 —— 没生成过是 `null`。 */
export type StoredSummary = DocSummary | null
