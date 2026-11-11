//! 侧栏导航项的显隐。六个键各自独立，没存过 = 显示。

import type { Context } from 'cordis'
import { useSyncExternalStore } from 'react'

export const NAV_KEYS = {
  recent: 'sidebar.show.recent',
  favorite: 'sidebar.show.favorite',
  pinned: 'sidebar.show.pinned',
  vfs: 'sidebar.show.vfs',
  inbox: 'sidebar.show.inbox',
  graph: 'sidebar.show.graph',
} as const

export type NavId = keyof typeof NAV_KEYS

const IDS = Object.keys(NAV_KEYS) as NavId[]

/** 只有明确存过 false 才藏；老库 / 首次启动默认全显示。 */
export function isNavVisible(ctx: Context, id: NavId): boolean {
  return ctx.settings.get<boolean>(NAV_KEYS[id]) !== false
}

export function setNavVisible(ctx: Context, id: NavId, on: boolean): void {
  ctx.settings.set(NAV_KEYS[id], on)
}

/** 设置页改一个开关，侧栏要当场跟着变 —— 靠 settings 的 onChange。 */
export function useNavVisible(ctx: Context): Record<NavId, boolean> {
  useSyncExternalStore(
    (cb) => {
      const offs = IDS.map((id) => ctx.settings.onChange(NAV_KEYS[id], cb))
      return () => offs.forEach((off) => off())
    },
    () => IDS.map((id) => (isNavVisible(ctx, id) ? '1' : '0')).join(''),
  )
  return {
    recent: isNavVisible(ctx, 'recent'),
    favorite: isNavVisible(ctx, 'favorite'),
    pinned: isNavVisible(ctx, 'pinned'),
    vfs: isNavVisible(ctx, 'vfs'),
    inbox: isNavVisible(ctx, 'inbox'),
    graph: isNavVisible(ctx, 'graph'),
  }
}
