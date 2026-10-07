/**
 * web 版 AI 面板（D-0074）—— 把 deepseek / chatgpt 的**网页版**装进笔记右侧一列，
 * 选中的正文 / 整篇一键填进它的输入框（只填不发送，自己按回车）。
 *
 * 为什么是原生子 webview 而不是 iframe：两家都发 `X-Frame-Options: DENY`，我们自己的 CSP
 * 又是 `default-src 'self'` —— iframe 两条都过不去。子 webview 由 Rust 侧建（`src/aiweb.rs`），
 * 这里只负责「什么时候开、摆在哪、往里塞什么字」。
 *
 * **常驻**（用户 2026-10-07：「一次登录就可以，长时间保活、永久保活」）：收起面板只是
 * `aiweb:hide`，登录和当前对话都留着；cookie 在 WKWebView 的持久存储里，重启也在。
 *
 * 「当前是哪一篇」在这里订阅、状态放模块级 —— 和 `comment/index.ts` 同一个理由：
 * 面板 / 入口组件的挂载晚于 `OPEN_DOC`，组件自己监听就永远错过那一篇。
 */
import { createElement } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { Context } from 'cordis'
import { CLOSE_ALL, OPEN_DOC, SHOW_LIST, type OpenDocEvent } from '../../src/kernel/contract'
import { ask, enterDoc, fallbackToClipboard, leaveDoc, sentText } from './actions'
import { setWebAiState } from './state'
import { deliverVoice } from './voice'
import { WebAiEntry, WebAiHeader, WebAiPanel } from './ui'

export const name = 'ai-web'

// rpc：aiweb:* 命令 + doc:text；editor：读当前选区；slot：顶栏那一格和右侧那一列；
// i18n：页脚和 toast 的文案。
export const inject = ['rpc', 'editor', 'slot', 'i18n']

/** Rust `aiweb:inject` 回执的形状（`src/aiweb.rs` 里那段脚本的返回值）。 */
interface InjectResult {
  ok: boolean
  how: string
  err?: string
}

function parse(payload: string): InjectResult | null {
  try {
    return JSON.parse(payload) as InjectResult
  } catch {
    return null
  }
}

export function apply(ctx: Context) {
  ctx.on(OPEN_DOC, ({ id }: OpenDocEvent) => enterDoc(id))
  ctx.on(CLOSE_ALL, () => leaveDoc(ctx))
  ctx.on(SHOW_LIST, () => leaveDoc(ctx))

  ctx.effect(() => {
    let off: (() => void) | null = null
    let dead = false
    void listen<string>('aiweb:inject', (e) => {
      const r = parse(e.payload)
      if (r?.ok) {
        setWebAiState({ status: ctx.i18n.t('webai.filled', { how: r.how }) })
        return
      }
      // 注入没落上：退回剪贴板，别让用户白点一下（浏览器插件被逼着只能这么做，我们只是兜底）。
      setWebAiState({ status: ctx.i18n.t('webai.failed') })
      void fallbackToClipboard(sentText())
    }).then((un) => {
      if (dead) un()
      else off = un
    })
    return () => {
      dead = true
      off?.()
    }
  })

  // 朗读那一步的回执（D-0081）：一次推一步，回执从 `aiweb:voice` 回来。
  ctx.effect(() => {
    let off: (() => void) | null = null
    let dead = false
    void listen<string>('aiweb:voice', (e) => deliverVoice(e.payload)).then((un) => {
      if (dead) un()
      else off = un
    })
    return () => {
      dead = true
      off?.()
    }
  })

  // 软依赖的另一端：编辑器工具条上那颗「问 AI」走这儿（`ctx.get('webai').askSelection`），
  // 不必 import 这个插件的内部（D-0052）。
  ctx.effect(() =>
    ctx.provide('webai', {
      // 工具条上那颗「问 AI」点了（D-0079）。跟原来那颗浮出按钮做的是同一件事：
      // 把这段字填进面板的输入框，只填不发。
      askSelection: (text: string) => ask(ctx, text),
    }),
  )

  ctx.effect(() => [
    // 网页版 AI 那颗在动作区**最左端**（用户点名，D-0096）；朗读那颗留在右边和评论入口并排。
    ctx.slot.register('doc.header.leading', () => createElement(WebAiEntry, { ctx })),
    ctx.slot.register('doc.header.right', () => createElement(WebAiHeader, { ctx })),
    ctx.slot.register('doc.aside.right', () => createElement(WebAiPanel, { ctx })),
  ])
}
