/**
 * 朗读（D-0081）：整篇正文丢给一个**看不见的**网页版 DeepSeek，让它原样复述一遍，
 * 再自动点它那条回复下面那颗「朗读」。
 *
 * 为什么借网页版：本机没有 TTS，这家的朗读最自然，而且不用配任何密钥 —— 代价是它只念
 * **它自己写出来的字**。所以要它「原封不动输出下面这段」，念的就是笔记本身。
 *
 * 三条纪律（都是 Rust 那侧 `aiweb.rs` 的 `VOICE_JS` 配合的）：
 *   - **一次推一步**：`aiweb:voice-tick` 只做当前这一格（送 / 等 / 点），回执走 `aiweb:voice`
 *     事件。wry 不等 Promise，等待只能靠这边定时再来一次。
 *   - **用户看不见那个 webview**：它摆在窗口外。收起 ≠ 销毁，登录和会话都留着。
 *   - 失败要说清失败在哪一步（没登录 / 没找到按钮 / 没写完），不然用户只能干等。
 */
import { useSyncExternalStore } from 'react'
import type { Context } from 'cordis'
import type { DocText } from '../../src/kernel/contract'
import { reportError, reportNote } from '../../src/kernel/errors'
import { toast } from '../../src/ui/toast'
import { setWebAiState } from './state'

/** Rust `VOICE_JS` 那段的返回值（形状由它决定，改那边记得改这里）。
 *  `booting` 不是页面回的，是 Rust 自己发的（那个 webview 刚建、页面还没就绪）。 */
export interface VoiceStep {
  stage:
    | 'idle'
    | 'booting'
    | 'sent'
    | 'waiting'
    | 'generating'
    | 'ready'
    | 'clicked'
    | 'stopped'
    | 'fail'
  why?: string
  len?: number
  same?: boolean
  how?: string
  n?: number
  url?: string
  title?: string
  /** 页面里还有东西在响吗（`audio` / `speechSynthesis`）。按钮没了也要能知道在放（D-0112）。 */
  playing?: boolean
  buttons?: { tag: string; hay: string; hit: boolean }[]
}

/** 推进的节奏。等模型写完是几十秒的事，所以给得宽松，超时就停。 */
const TICK_MS = 1200
const TICK_TIMEOUT_MS = 8000
const GIVE_UP_MS = 180_000
/** 点了朗读之后等它出声的宽限：过了还没响就当这家没念（不是干等）。 */
const CLICK_GRACE_MS = 15_000

/** 提示词就这一句。多说一个字都可能被它念出来，所以格外短。 */
function prompt(body: string): string {
  return `请把下面这段文字原封不动地输出一遍，不要改写、不要增删、不要加任何前后说明：\n\n${body}`
}

/* ────────────────────────── 状态（顶栏那颗按钮要跟着变） ────────────────────────── */

export type VoicePhase = 'idle' | 'running'

let phase: VoicePhase = 'idle'
const subs = new Set<() => void>()

function setPhase(next: VoicePhase): void {
  phase = next
  for (const cb of subs) cb()
}

export function useVoicePhase(): VoicePhase {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => phase,
    () => phase,
  )
}

/* ────────────────────────── 回执：Rust 的事件塞进来 ────────────────────────── */

let waiter: ((step: VoiceStep) => void) | null = null

/** `index.ts` 把 `aiweb:voice` 事件接到这儿。 */
export function deliverVoice(raw: string): void {
  let step: VoiceStep
  try {
    step = JSON.parse(raw) as VoiceStep
  } catch {
    step = { stage: 'fail', why: 'bad-json' }
  }
  const w = waiter
  waiter = null
  w?.(step)
}

function tick(ctx: Context, text: string): Promise<VoiceStep> {
  return new Promise<VoiceStep>((resolve, reject) => {
    const done = (step: VoiceStep) => resolve(step)
    waiter = done
    setTimeout(() => {
      if (waiter === done) {
        waiter = null
        done({ stage: 'fail', why: 'no-receipt' })
      }
    }, TICK_TIMEOUT_MS)
    ctx.rpc
      .call('aiweb:voice-tick', { text })
      .catch((err) => {
        if (waiter === done) waiter = null
        reject(err)
      })
  })
}

/* ────────────────────────── 入口 ────────────────────────── */

/** 正在读的那一轮的编号。用户再点一次 = 编号加一，旧那一轮自己退出。 */
let round = 0

/** 顶栏那颗按钮：读着的时候点是「停」，没读的时候点是「读这篇」。 */
export function toggleSpeak(ctx: Context, docId: string | null): void {
  if (phase === 'running') {
    stopSpeak(ctx)
    return
  }
  if (docId === null) return
  // 朗读那个页面摆到右边给人看（用户：「弹出那个页面也可以 让我盯着看」）。
  // 关掉它只把它挪回窗口外 —— 声音接着放（D-0113）。
  setWebAiState({ open: true, mode: 'voice' })
  const mine = ++round
  setPhase('running')
  void run(ctx, docId, mine).finally(() => {
    if (round === mine) setPhase('idle')
  })
}

/**
 * 停：让页面把声音按下去，顶栏那颗收回「朗读这篇」。
 *
 * ★ 离开文档页（回首页 / 切列表）也走它：那时顶栏连按钮都没了，不按停就**没地方停**。
 */
export function stopSpeak(ctx: Context): void {
  if (phase !== 'running') return
  round++
  setPhase('idle')
  void ctx.rpc.call('aiweb:voice-tick', { text: '' }).catch((e) => reportError('voice', e))
}

async function run(ctx: Context, docId: string, mine: number): Promise<void> {
  // 「读这篇」读的是**用户眼前这篇活文档**（D-0110）。库里的投影是给看不见这篇的人用的副本
  // —— 慢一拍、还可能没抄上（导入把投影写成空就是那种）；活文档拿不到才回库读。
  let body = (ctx.editor.text(docId) ?? '').trim()
  if (body === '') {
    try {
      body = (await ctx.rpc.call<DocText>('doc:text', { id: docId })).md.trim()
    } catch (err) {
      reportError('voice', err)
      toast({ text: ctx.i18n.t('voice.empty'), tone: 'error' })
      return
    }
  }
  if (body === '') {
    toast({ text: ctx.i18n.t('voice.empty') })
    return
  }

  toast({ text: ctx.i18n.t('voice.sending') })

  // ★ 从没见过面的时候它就是登录页 —— 让用户知道该去哪儿登一次，别以为坏了。
  let step: VoiceStep
  try {
    step = await send(ctx, prompt(body), mine)
  } catch (err) {
    reportError('voice', err)
    toast({ text: ctx.i18n.t('voice.broken'), tone: 'error' })
    return
  }
  if (step.stage === 'fail') return explain(ctx, step)

  const started = Date.now()
  let clickedAt = 0
  let sawPlaying = false
  while (round === mine) {
    if (step.stage === 'fail') return explain(ctx, step)
    if (step.stage === 'clicked') {
      toast({ text: ctx.i18n.t('voice.playing') })
      clickedAt = Date.now()
    }
    if (step.playing) sawPlaying = true
    // ★ 读完了 / 被停了：顶栏那颗回到「朗读这篇」（D-0112）。不靠那颗按钮，靠声音本身。
    if (clickedAt !== 0 && sawPlaying && !step.playing) return
    // 点了却没出声（这家可能把 TTS 关了）—— 别让用户盯着一个永远转的图标。
    if (clickedAt !== 0 && !sawPlaying && Date.now() - clickedAt > CLICK_GRACE_MS) return
    if (Date.now() - started > GIVE_UP_MS) {
      toast({ text: ctx.i18n.t('voice.timeout'), tone: 'error' })
      return
    }
    await new Promise((r) => setTimeout(r, TICK_MS))
    if (round !== mine) return
    try {
      step = await tick(ctx, '')
    } catch (err) {
      reportError('voice', err)
      toast({ text: ctx.i18n.t('voice.broken'), tone: 'error' })
      return
    }
  }
}

/**
 * 把正文送进去。
 *
 * ★ 朗读那个 webview 是**点的时候才建**的，头几拍它还在加载 —— 那几拍 `eval` 会被 wry 丢掉，
 *   回执永远不来（用户 2026-10-07 那次就是）。所以 `booting` 不算失败，等一拍**重发**。
 */
async function send(ctx: Context, text: string, mine: number): Promise<VoiceStep> {
  const started = Date.now()
  for (;;) {
    const step = await tick(ctx, text)
    if (step.stage !== 'booting' || round !== mine) return step
    if (Date.now() - started > GIVE_UP_MS) return { stage: 'fail', why: 'not-ready' }
    await new Promise((r) => setTimeout(r, TICK_MS))
    if (round !== mine) return { stage: 'fail', why: 'stopped' }
  }
}

function explain(ctx: Context, step: VoiceStep): void {
  // 候选按钮全记进 errors.log（`pnpm logs`）—— 选择器失效时照着真实 DOM 调匹配规则。
  if (step.buttons) reportNote('voice', JSON.stringify(step.buttons))
  reportNote('voice', `fail: ${step.why} url=${step.url ?? ''} title=${step.title ?? ''}`)
  // ★ 原因要分清：以前全说成「没找到按钮」，把人误到「网页版改版了」上去（D-0111）。
  const key =
    step.why === 'no-input'
      ? 'voice.noInput'
      : step.why === 'no-receipt' || step.why === 'not-ready'
        ? 'voice.notReady'
        : step.why === 'no-answer'
          ? 'voice.noReply'
          : 'voice.noButton'
  toast({ text: ctx.i18n.t(key), tone: 'error' })
}
