/**
 * 内存监控的模块级状态（D-0088）—— 菜单栏那个数字和设置页那段读的是同一份。
 *
 * ★ 只有**一个**时钟：轮询在 `index.ts`，状态落在这儿、谁要谁订。设置页自己另开一个定时器
 *   就会和托盘那份对不上（两个数字在屏幕上打架，比只有一个更糟）。
 */
import { useSyncExternalStore } from 'react'
import type { DocMem } from '../../src/kernel/contract'

/** Rust `mem::ProcMem`。 */
export interface ProcMem {
  pid: number
  name: string
  bytes: number
}

/** Rust `mem::MemSnap`。 */
export interface MemSnap {
  total: number
  own: number
  webkit: number
  /** false = 没拿到 responsibility API，WebKit 那组是按进程名归的，可能混了别的 app 的。 */
  certain: boolean
  procs: ProcMem[]
}

export interface MemUiState extends MemSnap {
  docs: DocMem[]
  /** 最后一次量到的时间（0 = 还没量过）。 */
  at: number
  /** 轮询 / 取数失败的那句话。空串 = 正常。 */
  error: string
}

const EMPTY: MemUiState = {
  total: 0,
  own: 0,
  webkit: 0,
  certain: true,
  procs: [],
  docs: [],
  at: 0,
  error: '',
}

let state: MemUiState = EMPTY
const subs = new Set<() => void>()

export function getMemState(): MemUiState {
  return state
}

export function setMemState(patch: Partial<MemUiState>): void {
  state = { ...state, ...patch }
  for (const cb of subs) cb()
}

export function useMemState(): MemUiState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => state,
    () => state,
  )
}

/** 菜单栏上那个串 —— 越短越好，它会一直占着那一格。 */
export function shortBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  const mb = n / 1024 / 1024
  return mb < 1000 ? `${Math.round(mb)}MB` : `${(mb / 1024).toFixed(1)}GB`
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  const mb = n / 1024 / 1024
  if (mb < 1) return `${Math.round(n / 1024)} KB`
  if (mb < 1000) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}
