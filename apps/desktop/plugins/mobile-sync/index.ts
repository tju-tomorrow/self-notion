/**
 * 「手机版」设置页（D-0195 / D-0198）。只做展示：地址、配对码、根证书。
 * 真正的服务在 Rust（`src-tauri/src/syncing/`），这里不联网、不碰库。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import type {} from '../../src/kernel/contract'
import { MobileSection } from './ui'

export const name = 'mobile-sync'

export const inject = ['rpc', 'slot', 'i18n']

export function apply(ctx: Context) {
  const section = () => createElement(MobileSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('mobile.title')
  ;(section as { group?: string }).group = 'integration'
  ctx.effect(() => ctx.slot.register('settings.section', section))
}
