/**
 * 版本插件的模块级状态 —— 顶栏入口 / 时间线面板 / 定时打点三处共用一份。
 *
 * 订阅放插件层（`index.ts`）、组件只读这里，理由同 `comment/state.ts`：
 * 组件的挂载晚于 `OPEN_DOC`，组件自己监听就永远错过那一篇。
 */
import { useSyncExternalStore } from 'react'
import type { VersionMeta } from '../../src/kernel/contract'

export interface VersionUiState {
  /** 现在盯着的哪一篇。null = 没打开文档 —— 那时候顶栏那颗图标也不该在。 */
  docId: string | null
  open: boolean
  /** 新到旧（Rust 那边就按 `at DESC` 排好了）。 */
  versions: VersionMeta[]
  /** 恢复正在跑：按钮全禁，别让用户连点两下写两份。 */
  busy: boolean
  error: string
}

const EMPTY: VersionUiState = { docId: null, open: false, versions: [], busy: false, error: '' }

let state: VersionUiState = EMPTY
const subs = new Set<() => void>()

export function getVersionState(): VersionUiState {
  return state
}

export function setVersionState(patch: Partial<VersionUiState>): void {
  state = { ...state, ...patch }
  for (const cb of subs) cb()
}

export function useVersionState(): VersionUiState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => state,
    () => state,
  )
}
