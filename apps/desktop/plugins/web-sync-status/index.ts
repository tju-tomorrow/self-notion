import { createElement } from 'react'
import type { Context } from 'cordis'
import type {} from '../../src/kernel/contract'
import {
  getSyncSnapshot,
  startSyncPolling,
  subscribeSync,
  SyncDot,
  SyncSection,
} from './ui'

export const name = 'web-sync-status'

export const inject = ['rpc', 'slot', 'i18n']

export function apply(ctx: Context) {
  ctx.effect(() => startSyncPolling(ctx))

  const dot = () => createElement(SyncDot, { ctx })
  const section = () => createElement(SyncSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('sync.title')
  ;(section as { group?: string }).group = 'integration'

  ctx.effect(() => {
    let offDot: (() => void) | null = null
    let offSection: (() => void) | null = null
    let stopped = false
    // 桌面端没有 sync:status，整段不挂进槽，导航里也不留一个空项。
    const sync = () => {
      if (stopped) return
      const want = getSyncSnapshot().available
      if (want && offDot === null) {
        offDot = ctx.slot.register('doc.header.right', dot)
        offSection = ctx.slot.register('settings.section', section)
      } else if (!want && offDot !== null) {
        offDot()
        offDot = null
        offSection?.()
        offSection = null
      }
    }
    sync()
    const stop = subscribeSync(sync)
    return () => {
      stopped = true
      stop()
      offDot?.()
      offSection?.()
    }
  })
}
