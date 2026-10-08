/**
 * web 版 AI 面板的动作：开关面板、切站点、把正文注入网页版的输入框。
 *
 * 三条纪律：
 *   - **只注入，不发送** —— 用户自己按回车（D-0074）。所以这里永远不点发送按钮。
 *   - **常驻**：关面板是 `aiweb:hide`（藏起来），**不是** `close` —— 登录和当前对话都留着。
 *   - 注入是异步回执：`aiweb:inject` 命令立刻返回，结果从 `aiweb:inject` 事件回来
 *     （见 `index.ts`）。失败了就拿 `pending` 退回剪贴板，别让用户白点一下。
 */
import type { Context } from 'cordis'
import { reportError, reportNote } from '../../src/kernel/errors'
import { copyText } from '../../src/ui/clipboard'
import { toast } from '../../src/ui/toast'
import { SITES, setWebAiState, type SiteKey } from './state'
import { stopSpeak } from './voice'

/** 最后一次送出去的那段正文 —— 注入失败时拿它退回剪贴板（回执是异步的，那时 state 里已经翻篇了）。 */
let lastSent = ''

export function sentText(): string {
  return lastSent
}

/** 进入一篇文档。**面板不关** —— 连着问几篇是常态。 */
export function enterDoc(docId: string): void {
  setWebAiState({ docId })
}

/** 离开文档页（回首页 / 切列表）。面板收起、两个子 webview 都收起来（登录留着）。
 *  朗读**顺手按停** —— 那一页的顶栏跟着没了，不按停就没地方停。 */
export function leaveDoc(ctx: Context): void {
  stopSpeak(ctx)
  setWebAiState({ docId: null, open: false, mode: 'chat', status: '', pending: '' })
  void ctx.rpc.call('aiweb:hide').catch((e) => reportError('aiweb', e))
  void ctx.rpc.call('aiweb:voice-hide').catch((e) => reportError('aiweb', e))
}

export function openPanel(): void {
  reportNote('webai', '面板：开')
  setWebAiState({ open: true, mode: 'chat', status: '' })
}

export function closePanel(ctx: Context): void {
  reportNote('webai', '面板：关')
  setWebAiState({ open: false })
  // 聊天那个只是藏；朗读那个**挪回窗口外**（不是藏）—— 声音接着放（用户：「关闭不丢声音」）。
  void ctx.rpc.call('aiweb:hide').catch((e) => reportError('aiweb', e))
  void ctx.rpc.call('aiweb:voice-hide').catch((e) => reportError('aiweb', e))
}

/** 把这一列切到朗读那个页面（朗读开始时调）。 */
export function showVoicePage(): void {
  setWebAiState({ open: true, mode: 'voice' })
}

export function setSite(site: SiteKey): void {
  // 面板开着时，组件那个量尺寸的 effect 会带新 URL 再 `aiweb:show` 一次，Rust 那边换站点就导航。
  setWebAiState({ site, status: '' })
}

/**
 * 把一段正文送进网页版的输入框。面板没开就先开。
 * **注入不在这里发** —— 面板要先把子 webview 摆出来（见 `ui.tsx`），这里只把正文放上。
 *
 * ★ 只有**用户自己选中**那段会走这里（正文里浮出的「问 AI」）。顶栏那颗按钮**什么都不送**：
 *   整篇塞过去等于替用户写好了问题，而且面板空着也能用 —— 自己说想干什么更顺
 *   （用户 2026-10-07：「没必要整篇送去网页版 ai，就算是空的也要可以打开网页版」）。
 */
export function ask(ctx: Context, text: string): void {
  const body = text.trim()
  if (body === '') return
  lastSent = body
  setWebAiState({ open: true, status: '', pending: body })
}

/** 注入失败时的退路 —— 浏览器插件被逼着只能这么做，我们只是拿它兜底。 */
export async function fallbackToClipboard(body: string): Promise<void> {
  try {
    await copyText(body)
    toast({ text: '没找到输入框，正文已复制 —— 到面板里 ⌘V 粘贴' })
  } catch (err) {
    reportError('aiweb', err)
  }
}

/** 把面板当前那一页丢给系统默认浏览器。URL 由 Rust 从子 webview 现拿（Rust `aiweb::open_external`）。 */
export async function openInBrowser(ctx: Context): Promise<void> {
  try {
    await ctx.rpc.call('aiweb:open-external')
  } catch (err) {
    reportError('aiweb', err)
  }
}

export function siteUrl(key: SiteKey): string {
  return SITES[key].url
}
