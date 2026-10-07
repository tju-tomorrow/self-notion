/**
 * web 版 AI 面板的模块级状态（D-0074）。
 *
 * 「当前是哪一篇」在 `index.ts` 订阅、状态放这里 —— 和 `comment/state.ts` 同一个理由：
 * 面板 / 入口组件的挂载晚于 `OPEN_DOC`，组件自己监听就永远错过那一篇。
 */
import { useSyncExternalStore } from 'react'

export type SiteKey = 'deepseek' | 'chatgpt'

export interface Site {
  label: string
  url: string
}

/** 站点表就是这一处。加一个站点 = 加一行（`SiteKey` 跟着加一个字面量）。 */
export const SITES: Record<SiteKey, Site> = {
  deepseek: { label: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  chatgpt: { label: 'ChatGPT', url: 'https://chatgpt.com/' },
}

export const SITE_ORDER: readonly SiteKey[] = ['deepseek', 'chatgpt']

export interface WebAiState {
  docId: string | null
  /** 面板开着没有。关着的时候 `doc.aside.right` 那一列宽度是 0，子 webview 也被藏起来。 */
  open: boolean
  site: SiteKey
  /**
   * 这一列现在摆的是哪一页：聊天那个网页版，还是**朗读那个页面**（D-0113）。
   * 朗读要看得见自己在念什么（用户：「弹出那个页面也可以 让我盯着看」），两页不能叠在一列里。
   */
  mode: 'chat' | 'voice'
  /** 最近一次注入的结果，面板页脚显示（注入失败时这里写「已复制到剪贴板」）。 */
  status: string
  /** 这次要注入的正文 —— 注入是**异步回执**（Rust `aiweb:inject` 事件），失败了拿它退回剪贴板。 */
  pending: string
}

const EMPTY: WebAiState = { docId: null, open: false, site: 'deepseek', mode: 'chat', status: '', pending: '' }

let state: WebAiState = EMPTY
const subs = new Set<() => void>()

export function getWebAiState(): WebAiState {
  return state
}

export function setWebAiState(patch: Partial<WebAiState>): void {
  state = { ...state, ...patch }
  for (const cb of subs) cb()
}

export function useWebAiState(): WebAiState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => state,
    () => state,
  )
}
