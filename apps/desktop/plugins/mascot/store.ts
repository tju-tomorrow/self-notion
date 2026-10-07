/**
 * 宠物这一摊的读写收口：**选的是哪只**（侧栏底部展示、设置页换）+ **在笔记里怎么动**
 * （跟着鼠标 / 自己乱逛 / 不出来）。两处消费读的是同一个键，所以设置页一改，别处立刻跟着变。
 */
import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import { PETS, PET_KEY, petById, type Pet } from './roster'

/** 笔记里那只的行为。默认跟着鼠标走（用户要的默认值）。 */
export type PetMode = 'follow' | 'roam' | 'off'

export const MODE_KEY = 'mascot.mode'

export const MODES: readonly PetMode[] = ['follow', 'roam', 'off']

export const DEFAULT_MODE: PetMode = 'follow'

export function petNow(ctx: Context): Pet {
  return petById(ctx.settings.get<string>(PET_KEY) ?? PETS[0].id)
}

export function modeNow(ctx: Context): PetMode {
  const saved = ctx.settings.get<PetMode>(MODE_KEY)
  return saved && MODES.includes(saved) ? saved : DEFAULT_MODE
}

/** 注意 `ctx.settings` 的预热是异步的：装载时可能读到 undefined。
 *  预热完 plugin-settings 会 notify 一次，订上就补回来了。 */
export function usePet(ctx: Context): Pet {
  return useSetting(ctx, PET_KEY, petNow)
}

export function usePetMode(ctx: Context): PetMode {
  return useSetting(ctx, MODE_KEY, modeNow)
}

export function choosePet(ctx: Context, id: string): void {
  ctx.settings.set(PET_KEY, id)
}

export function chooseMode(ctx: Context, mode: PetMode): void {
  ctx.settings.set(MODE_KEY, mode)
}

function useSetting<T>(ctx: Context, key: string, read: (ctx: Context) => T): T {
  const [, setTick] = useState(0)
  useEffect(() => ctx.settings.onChange(key, () => setTick((n) => n + 1)), [ctx, key])
  return read(ctx)
}
