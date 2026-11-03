/**
 * `voice:*` rpc 与事件的薄封装（D-0190）。组件只认这里的形状，不碰 Tauri 的原始 payload。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Context } from 'cordis'

export interface VoiceStatus {
  ready: boolean
  bytes: number
  path: string
  downloading: boolean
  received: number
  total: number
  error: string
  model: string
}

interface SessionPayload {
  sessionId: string
}

export interface VoiceHandlers {
  loading: (sessionId: string) => void
  started: (sessionId: string) => void
  level: (sessionId: string, level: number) => void
  partial: (sessionId: string, text: string) => void
  done: (sessionId: string, text: string) => void
  error: (sessionId: string, message: string) => void
  progress: (received: number, total: number) => void
  modelReady: () => void
  modelError: (message: string) => void
}

export function status(ctx: Context): Promise<VoiceStatus> {
  return ctx.rpc.call<VoiceStatus>('voice:status')
}

export function start(ctx: Context, sessionId: string, language: string): Promise<unknown> {
  return ctx.rpc.call('voice:start', { sessionId, language })
}

export function stop(ctx: Context): Promise<unknown> {
  return ctx.rpc.call('voice:stop')
}

export function cancel(ctx: Context): Promise<unknown> {
  return ctx.rpc.call('voice:cancel')
}

export function download(ctx: Context): Promise<unknown> {
  return ctx.rpc.call('voice:download')
}

/** 全部订阅一次，返回逆函数。事件带 `sessionId`，过滤交给调用方（同一刻可能还有旧会话在收尾）。 */
export async function listenVoice(h: VoiceHandlers): Promise<UnlistenFn[]> {
  return Promise.all([
    listen<SessionPayload>('voice:loading', (e) => h.loading(e.payload.sessionId)),
    listen<SessionPayload>('voice:started', (e) => h.started(e.payload.sessionId)),
    listen<SessionPayload & { level: number }>('voice:level', (e) =>
      h.level(e.payload.sessionId, e.payload.level),
    ),
    listen<SessionPayload & { text: string }>('voice:partial', (e) =>
      h.partial(e.payload.sessionId, e.payload.text),
    ),
    listen<SessionPayload & { text: string }>('voice:done', (e) =>
      h.done(e.payload.sessionId, e.payload.text),
    ),
    listen<SessionPayload & { message: string }>('voice:error', (e) =>
      h.error(e.payload.sessionId, e.payload.message),
    ),
    listen<{ received: number; total: number }>('voice:progress', (e) =>
      h.progress(e.payload.received, e.payload.total),
    ),
    listen('voice:model-ready', () => h.modelReady()),
    listen<{ message: string }>('voice:model-error', (e) => h.modelError(e.payload.message)),
  ])
}
