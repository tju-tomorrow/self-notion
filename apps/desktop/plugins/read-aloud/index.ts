import { createElement } from 'react'
import type { Context } from 'cordis'
import { listen } from '@tauri-apps/api/event'

import { AGENT_TAB_ID, CLOSE_ALL, OPEN_DOC, SHOW_LIST } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { ReadHeader } from './header'
import {
  currentDoc,
  deliverAudio,
  onSpoken,
  prime,
  setDoc,
  speakSelection,
  speakText,
  spokenNow,
  stop,
  toggle,
} from './player'

export const name = 'read-aloud'

export const inject = ['rpc', 'editor', 'settings', 'i18n', 'slot']

export function apply(ctx: Context): void {
  void ctx.rpc.call('read:warm').catch(() => {})
  ctx.effect(() => {
    let dead = false
    let off: (() => void) | null = null
    void listen<{ ticket?: number; audio?: string; err?: string }>('read:audio', (event) => {
      deliverAudio(event.payload)
    })
      .then((un) => {
        if (dead) un()
        else off = un
      })
      .catch((err: unknown) => reportError('read', err))
    return () => {
      dead = true
      off?.()
    }
  })

  const leave = () => {
    stop(ctx)
    setDoc(null)
  }
  ctx.on(OPEN_DOC, ({ id }) => {
    const next = id === AGENT_TAB_ID ? null : id
    if (next !== currentDoc()) stop(ctx)
    setDoc(next)
    if (next) prime(ctx, next)
  })
  ctx.on(SHOW_LIST, leave)
  ctx.on(CLOSE_ALL, leave)

  ctx.effect(() =>
    ctx.provide('readaloud', {
      speakSelection: (range: { from: number; to: number }) => speakSelection(ctx, range),
      toggle: (id: string | null) => toggle(ctx, id),
      speakText: (text: string) => speakText(ctx, text),
      spoken: () => spokenNow(),
      subscribe: (cb: () => void) => onSpoken(cb),
    }),
  )

  ctx.effect(() => [ctx.slot.register('doc.header.right', () => createElement(ReadHeader, { ctx }))])
}
