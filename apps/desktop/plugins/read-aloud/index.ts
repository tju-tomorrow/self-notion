import { createElement } from 'react'
import type { Context } from 'cordis'

import { AGENT_TAB_ID, CLOSE_ALL, OPEN_DOC, SHOW_LIST } from '../../src/kernel/contract'
import { ReadHeader } from './header'
import { currentDoc, setDoc, speakSelection, stop, toggle } from './player'

export const name = 'read-aloud'

export const inject = ['rpc', 'editor', 'settings', 'i18n', 'slot']

export function apply(ctx: Context): void {
  const leave = () => {
    stop(ctx)
    setDoc(null)
  }
  ctx.on(OPEN_DOC, ({ id }) => {
    const next = id === AGENT_TAB_ID ? null : id
    if (next !== currentDoc()) stop(ctx)
    setDoc(next)
  })
  ctx.on(SHOW_LIST, leave)
  ctx.on(CLOSE_ALL, leave)

  ctx.effect(() =>
    ctx.provide('readaloud', {
      speakSelection: (range: { from: number; to: number }) => speakSelection(ctx, range),
      toggle: (id: string | null) => toggle(ctx, id),
    }),
  )

  ctx.effect(() => [ctx.slot.register('doc.header.right', () => createElement(ReadHeader, { ctx }))])
}
