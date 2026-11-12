/**
 * Edge 朗读。后面两句提前合成，这一句播完就能接上。同一句落在本机，再听不请求。
 */
import { useSyncExternalStore } from 'react'
import type { Context } from 'cordis'

import { reportError } from '../../src/kernel/errors'
import { toast } from '../../src/ui/toast'

export const VOICE_KEY = 'read.voice'
export const RATE_KEY = 'read.rate'

// 每条都用中文句子合成过、文件里有声音。下架的名字服务会连上，但不给音频。
export const VOICE_GROUPS = ['mandarin', 'dialect', 'yue', 'tw', 'multi'] as const

export const VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓', group: 'mandarin', hint: 'read.hint.f-warm' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊', group: 'mandarin', hint: 'read.hint.f-bright' },
  { id: 'zh-CN-XiaoxuanNeural', name: '晓萱', group: 'mandarin', hint: 'read.hint.f-lively' },
  { id: 'zh-CN-YunxiNeural', name: '云希', group: 'mandarin', hint: 'read.hint.m-bright' },
  { id: 'zh-CN-YunxiaNeural', name: '云夏', group: 'mandarin', hint: 'read.hint.m-kind' },
  { id: 'zh-CN-YunjianNeural', name: '云健', group: 'mandarin', hint: 'read.hint.m-deep' },
  { id: 'zh-CN-YunyangNeural', name: '云扬', group: 'mandarin', hint: 'read.hint.m-calm' },
  { id: 'zh-CN-liaoning-XiaobeiNeural', name: '晓北', group: 'dialect', hint: 'read.hint.liaoning' },
  { id: 'zh-CN-shaanxi-XiaoniNeural', name: '晓妮', group: 'dialect', hint: 'read.hint.shaanxi' },
  { id: 'zh-HK-HiuGaaiNeural', name: '晓佳', group: 'yue', hint: 'read.hint.f-clear' },
  { id: 'zh-HK-HiuMaanNeural', name: '晓曼', group: 'yue', hint: 'read.hint.f-upbeat' },
  { id: 'zh-HK-WanLungNeural', name: '云龙', group: 'yue', hint: 'read.hint.m-calm' },
  { id: 'zh-TW-HsiaoChenNeural', name: '晓臻', group: 'tw', hint: 'read.hint.f-soft' },
  { id: 'zh-TW-HsiaoYuNeural', name: '晓雨', group: 'tw', hint: 'read.hint.f-clear' },
  { id: 'zh-TW-YunJheNeural', name: '云哲', group: 'tw', hint: 'read.hint.m-gentle' },
  { id: 'en-US-AvaMultilingualNeural', name: 'Ava', group: 'multi', hint: 'read.hint.f-en' },
  { id: 'en-US-EmmaMultilingualNeural', name: 'Emma', group: 'multi', hint: 'read.hint.f-en' },
  { id: 'en-US-AndrewMultilingualNeural', name: 'Andrew', group: 'multi', hint: 'read.hint.m-en' },
  { id: 'en-US-BrianMultilingualNeural', name: 'Brian', group: 'multi', hint: 'read.hint.m-en' },
  { id: 'en-AU-WilliamMultilingualNeural', name: 'William', group: 'multi', hint: 'read.hint.m-en' },
  { id: 'de-DE-SeraphinaMultilingualNeural', name: 'Seraphina', group: 'multi', hint: 'read.hint.f-de' },
  { id: 'de-DE-FlorianMultilingualNeural', name: 'Florian', group: 'multi', hint: 'read.hint.m-de' },
  { id: 'fr-FR-VivienneMultilingualNeural', name: 'Vivienne', group: 'multi', hint: 'read.hint.f-fr' },
  { id: 'fr-FR-RemyMultilingualNeural', name: 'Rémy', group: 'multi', hint: 'read.hint.m-fr' },
  { id: 'it-IT-GiuseppeMultilingualNeural', name: 'Giuseppe', group: 'multi', hint: 'read.hint.m-it' },
  { id: 'ko-KR-HyunsuMultilingualNeural', name: 'Hyunsu', group: 'multi', hint: 'read.hint.m-ko' },
  { id: 'pt-BR-ThalitaMultilingualNeural', name: 'Thalita', group: 'multi', hint: 'read.hint.f-pt' },
] as const

export const DEFAULT_VOICE = VOICES[0].id

export const RATES = [
  { value: 0.85, key: 'read.rate.slow' },
  { value: 1, key: 'read.rate.normal' },
  { value: 1.15, key: 'read.rate.brisk' },
  { value: 1.35, key: 'read.rate.fast' },
] as const

type Phase = 'idle' | 'running'

let phase: Phase = 'idle'
let docId: string | null = null
let painted: string | null = null
let gen = 0
let primed = 0
let audioCtx: AudioContext | null = null
let source: AudioBufferSourceNode | null = null
let finishPlay: (() => void) | null = null

type AudioMsg = { audio?: string; err?: string }
const waiters = new Map<number, (payload: AudioMsg) => void>()
const early = new Map<number, AudioMsg>()

export function deliverAudio(payload: AudioMsg & { ticket?: number }): void {
  if (typeof payload.ticket !== 'number') return
  const fn = waiters.get(payload.ticket)
  if (fn) {
    waiters.delete(payload.ticket)
    fn(payload)
    return
  }
  if (early.size > 8) early.clear()
  early.set(payload.ticket, payload)
}

/** 必须在点击那一下打开。WKWebView 里 `new Audio().play()` 会既不响也不结束，按钮就停在「停止朗读」。 */
function arm(): void {
  if (!audioCtx || audioCtx.state === 'closed') audioCtx = new AudioContext()
  void audioCtx.resume()
}

const phaseSubs = new Set<() => void>()
const docSubs = new Set<() => void>()

function setPhase(next: Phase): void {
  if (phase === next) return
  phase = next
  for (const cb of phaseSubs) cb()
}

export function useReading(): boolean {
  return (
    useSyncExternalStore(
      (cb) => {
        phaseSubs.add(cb)
        return () => void phaseSubs.delete(cb)
      },
      () => phase,
      () => phase,
    ) === 'running'
  )
}

export function setDoc(id: string | null): void {
  if (id === docId) return
  docId = id
  for (const cb of docSubs) cb()
}

export function currentDoc(): string | null {
  return docId
}

export function useDocId(): string | null {
  return useSyncExternalStore(
    (cb) => {
      docSubs.add(cb)
      return () => void docSubs.delete(cb)
    },
    () => docId,
    () => docId,
  )
}

export function prefs(ctx: Context): { voice: string; rate: number } {
  const voice = ctx.settings.get<string>(VOICE_KEY)
  const rate = ctx.settings.get<number>(RATE_KEY)
  return {
    voice: VOICES.some((item) => item.id === voice) ? (voice as string) : DEFAULT_VOICE,
    rate: typeof rate === 'number' && Number.isFinite(rate) ? rate : 1,
  }
}

export function voiceName(id: string): string {
  return VOICES.find((item) => item.id === id)?.name ?? VOICES[0].name
}

function interrupt(): number {
  const mine = ++gen
  const node = source
  source = null
  if (node) {
    try {
      node.stop()
    } catch {
      // 已经停过
    }
  }
  finishPlay?.()
  const pending = [...waiters.values()]
  waiters.clear()
  early.clear()
  for (const fn of pending) fn({})
  return mine
}

/** 打开文档时把开头两句写进缓存，点下去就能出声。 */
export function prime(ctx: Context, id: string): void {
  const mine = ++primed
  void (async () => {
    try {
      await ctx.editor.ready()
    } catch {
      return
    }
    for (let i = 0; i < 20; i++) {
      if (primed !== mine || currentDoc() !== id) return
      const spans = ctx.editor.readSpans(id)
      if (spans && spans.length > 0) {
        const { voice, rate } = prefs(ctx)
        for (const span of spans.slice(0, 2)) {
          void ctx.rpc.call('read:speak', { text: span.text, voice, rate, stash: true }).catch(() => {})
        }
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })()
}

export function stop(ctx: Context): void {
  interrupt()
  const id = painted
  painted = null
  if (id) ctx.editor.paintRead(id, null)
  setPhase('idle')
}

export function toggle(ctx: Context, id: string | null): void {
  if (phase === 'running') {
    stop(ctx)
    return
  }
  if (!id) return
  void run(ctx, id)
}

export function speakSelection(ctx: Context, range: { from: number; to: number }): void {
  if (!docId) return
  void run(ctx, docId, range)
}

async function run(
  ctx: Context,
  id: string,
  range?: { from: number; to: number },
): Promise<void> {
  primed++
  const mine = interrupt()
  arm()
  setPhase('running')
  painted = id
  try {
    await ctx.editor.ready()
    if (gen !== mine) return
    const spans = ctx.editor.readSpans(id, range) ?? []
    if (spans.length === 0) {
      toast({ text: ctx.i18n.t('voice.empty') })
      return
    }
    const ready: Array<Promise<AudioBuffer | null>> = []
    const queued = new Set<number>()
    const pull = (index: number) => {
      const span = spans[index]
      if (!span || queued.has(index)) return
      queued.add(index)
      const { voice, rate } = prefs(ctx)
      const task = prepare(ctx, span.text, voice, rate, mine)
      void task.catch(() => {})
      ready[index] = task
    }
    // 这一句出声时，后面两句已经在合成。
    pull(0)
    pull(1)
    for (let i = 0; i < spans.length; i++) {
      if (gen !== mine) return
      const buf = await ready[i]
      if (!buf || gen !== mine) return
      pull(i + 2)
      ctx.editor.paintRead(id, spans[i])
      await playBuffer(buf, mine)
    }
  } catch (err) {
    if (gen === mine) reportError('read', err)
  } finally {
    if (gen === mine) {
      ctx.editor.paintRead(id, null)
      painted = null
      setPhase('idle')
    }
  }
}

function prepare(
  ctx: Context,
  text: string,
  voice: string,
  rate: number,
  mine: number,
): Promise<AudioBuffer | null> {
  return ctx.rpc
    .call<{ audio?: string; ticket?: number }>('read:speak', { text, voice, rate })
    .then(async (out) => {
      if (gen !== mine || !audioCtx) return null
      const b64 = out.audio ?? (typeof out.ticket === 'number' ? await waitTicket(out.ticket, mine) : null)
      if (!b64 || gen !== mine || !audioCtx) return null
      const buf = await audioCtx.decodeAudioData(bytesOf(b64))
      if (gen !== mine) return null
      return buf
    })
}

function waitTicket(ticket: number, mine: number): Promise<string | null> {
  const hit = early.get(ticket)
  if (hit) {
    early.delete(ticket)
    return settleAudio(hit, mine)
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      waiters.delete(ticket)
      if (gen === mine) reject(new Error('朗读没出声'))
      else resolve(null)
    }, 20_000)
    waiters.set(ticket, (payload) => {
      window.clearTimeout(timer)
      if (gen !== mine) {
        resolve(null)
        return
      }
      settleAudio(payload, mine).then(resolve, reject)
    })
  })
}

function settleAudio(payload: AudioMsg, mine: number): Promise<string | null> {
  if (gen !== mine) return Promise.resolve(null)
  if (payload.err) return Promise.reject(new Error(payload.err))
  if (payload.audio) return Promise.resolve(payload.audio)
  return Promise.reject(new Error('朗读没有出声'))
}

function bytesOf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const raw = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i)
  // decodeAudioData 会吃掉这块内存。
  return raw.buffer.slice(0)
}

function playBuffer(buf: AudioBuffer, mine: number): Promise<void> {
  const ctx = audioCtx
  if (!ctx) return Promise.reject(new Error('朗读没打开声音'))
  return ctx.resume().then(() => {
    if (gen !== mine) return
    if (ctx.state !== 'running') throw new Error('声音被系统拦住了')
    return new Promise<void>((resolve, reject) => {
      const node = ctx.createBufferSource()
      node.buffer = buf
      node.connect(ctx.destination)
      let settled = false
      const finish = (err?: unknown) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        if (source === node) source = null
        if (finishPlay === finish) finishPlay = null
        if (err) {
          try {
            node.stop()
          } catch {
            // 已经停过
          }
          reject(err)
        } else resolve()
      }
      // 时钟停住时 onended 永远不来，不能再干等。
      const timer = window.setTimeout(() => finish(new Error('朗读没出声')), (buf.duration + 3) * 1000)
      finishPlay = () => finish()
      node.onended = () => finish()
      source = node
      try {
        node.start()
      } catch (err) {
        finish(err)
      }
    })
  })
}
