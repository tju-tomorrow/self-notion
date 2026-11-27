/**
 * drawio 画布页（D-0216）。
 *
 * 笔记里的 `drawio` 块点开时发 `OPEN_CANVAS`，标签条加一个 `sn:drawio:<docId>:<blockId>`
 * 的虚拟标签，外壳把主区整块交给 `main.drawio`。
 */
import { createElement, useSyncExternalStore } from 'react'
import type { Context } from 'cordis'

import { OPEN_CANVAS, drawioTabId } from '../../src/kernel/contract'
import { DrawioPage } from './page'

export const name = 'drawio'

export const inject = ['slot', 'rpc', 'i18n']

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

function Page({ ctx }: { ctx: Context }) {
  return createElement(DrawioPage, { ctx, id: useCurrent() })
}

export function apply(ctx: Context): void {
  ctx.effect(() => [
    ctx.on(OPEN_CANVAS, ({ docId, blockId }) => setCurrent(drawioTabId(docId, blockId))),
    ctx.slot.register('main.drawio', () => createElement(Page, { ctx })),
  ])
}
