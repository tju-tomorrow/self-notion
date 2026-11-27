/**
 * 语音输入（D-0190）。不占槽位：它是一层只在自己需要时出现的浮层。
 *
 * 只在文档页出现 —— 首页 / 助手页没有「当前光标」可以落，画一颗麦克风只会误导。
 */
import { createElement, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from 'cordis'

import { AGENT_TAB_ID, CLOSE_ALL, OPEN_CANVAS, OPEN_DOC, SHOW_LIST } from '../../src/kernel/contract'
import { VoiceBar } from './bar'

export const name = 'voice-input'

// editor：应用草稿；rpc：voice:*；settings：语言偏好；i18n：文案。
export const inject = ['rpc', 'editor', 'settings', 'i18n']

/* 当前打开的是哪一篇。订阅放 `apply()` 里 —— 第一篇文档的 OPEN_DOC 比组件挂载早。 */
let current: string | null = null
const subs = new Set<() => void>()

function setCurrent(id: string | null): void {
  if (id === current) return
  current = id
  for (const cb of subs) cb()
}

function useCurrent(): string | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => current,
    () => current,
  )
}

function VoiceRoot({ ctx }: { ctx: Context }) {
  return createElement(VoiceBar, { ctx, docId: useCurrent() })
}

export function apply(ctx: Context): void {
  ctx.effect(() => [
    // 助手那个虚拟标签不是文档 —— 那里没有正文可落。
    ctx.on(OPEN_DOC, ({ id }) => setCurrent(id === AGENT_TAB_ID ? null : id)),
    // 画布页没有正文可落（D-0216）。
    ctx.on(OPEN_CANVAS, () => setCurrent(null)),
    ctx.on(SHOW_LIST, () => setCurrent(null)),
    ctx.on(CLOSE_ALL, () => setCurrent(null)),
  ])

  ctx.effect(() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(createElement(VoiceRoot, { ctx }))
    return () => {
      root.unmount()
      host.remove()
    }
  })
}
