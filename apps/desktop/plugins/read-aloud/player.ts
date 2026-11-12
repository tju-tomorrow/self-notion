/**
 * Edge 朗读。一句一句合成、一句一句划上。同一句落在本机，再听不请求。
 */
import { useSyncExternalStore } from 'react'
import type { Context } from 'cordis'

import { reportError } from '../../src/kernel/errors'
import { toast } from '../../src/ui/toast'

export const VOICE_KEY = 'read.voice'
export const RATE_KEY = 'read.rate'

export const VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊' },
  { id: 'zh-CN-XiaohanNeural', name: '晓涵' },
  { id: 'zh-CN-XiaochenNeural', name: '晓辰' },
  { id: 'zh-CN-XiaomoNeural', name: '晓墨' },
  { id: 'zh-CN-YunxiNeural', name: '云希' },
  { id: 'zh-CN-YunyangNeural', name: '云扬' },
  { id: 'zh-CN-YunfengNeural', name: '云枫' },
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
let output: HTMLAudioElement | null = null
let finishPlay: (() => void) | null = null

/** 点下去这一下先把声音通道打开。合成要等网络，等完再 play 会被浏览器当成自动播放。 */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

function arm(): void {
  if (!output) output = new Audio()
  output.src = SILENT
  void output.play().catch(() => {})
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
  output?.pause()
  finishPlay?.()
  return mine
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
    for (const span of spans) {
      if (gen !== mine) return
      ctx.editor.paintRead(id, span)
      const { voice, rate } = prefs(ctx)
      const out = await ctx.rpc.call<{ audio: string }>('read:speak', {
        text: span.text,
        voice,
        rate,
      })
      if (gen !== mine) return
      await play(out.audio, mine)
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

function play(b64: string, mine: number): Promise<void> {
  return new Promise((resolve) => {
    if (gen !== mine) {
      resolve()
      return
    }
    const node = output ?? new Audio()
    output = node
    const bin = atob(b64)
    const raw = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i)
    const url = URL.createObjectURL(new Blob([raw], { type: 'audio/mpeg' }))
    node.pause()
    node.src = url
    const finish = () => {
      URL.revokeObjectURL(url)
      if (finishPlay === finish) finishPlay = null
      resolve()
    }
    finishPlay = finish
    node.onended = finish
    node.onerror = finish
    void node.play().catch(() => finish())
  })
}
