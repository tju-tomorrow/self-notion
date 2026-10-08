/**
 * 主题的落盘面。三个键全在 `ctx.settings` 里（Rust 的 meta 表，`plugin-settings` 预热）：
 * 当前是哪个 / 我存过哪些 / 调到一半的草稿。
 *
 * ★ 读的全是 `unknown`：`settings` 不做校验（它的契约里明说不做），所以这里自己守。
 * ★ `theme.draft` 属于**当前这一套**：换主题就清掉 —— 不然「调过夜空的紫」会跟着落到原版上。
 */
import type { Context } from 'cordis'
import { BUILTIN, DEFAULT_ID, builtinById, editBaseOf } from './builtin'
import type { BgPos, BgSize, Draft, Seeds, Theme } from './types'

export const ACTIVE_KEY = 'theme.active'
export const USERS_KEY = 'theme.users'
export const DRAFT_KEY = 'theme.draft'

function isSeeds(v: unknown): v is Seeds {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (['canvas', 'sidebar', 'surface', 'accent', 'text', 'border'] as const).every(
    (k) => typeof s[k] === 'string',
  )
}

function isTheme(v: unknown): v is Theme {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return typeof t.id === 'string' && typeof t.name === 'string'
}

export function users(ctx: Context): Theme[] {
  const raw = ctx.settings.get<unknown>(USERS_KEY)
  if (!Array.isArray(raw)) return []
  // 导入的 JSON 可能被手改过：种子形状不对就丢掉种子（退回原版长相），别把野值写进变量。
  return raw.filter(isTheme).map((t) => ({ ...t, seeds: isSeeds(t.seeds) ? t.seeds : null, user: true }))
}

/** 画廊的顺序：原版打头，然后内置，然后我的。 */
export function listThemes(ctx: Context): Theme[] {
  return [...BUILTIN, ...users(ctx)]
}

export function activeId(ctx: Context): string {
  const raw = ctx.settings.get<unknown>(ACTIVE_KEY)
  return typeof raw === 'string' && raw ? raw : DEFAULT_ID
}

export function activeTheme(ctx: Context): Theme {
  const id = activeId(ctx)
  return builtinById(id) ?? users(ctx).find((t) => t.id === id) ?? builtinById(DEFAULT_ID)!
}

export function setActive(ctx: Context, id: string): void {
  ctx.settings.set(ACTIVE_KEY, id)
  ctx.settings.set(DRAFT_KEY, {})
}

export function draft(ctx: Context): Draft {
  const raw = ctx.settings.get<unknown>(DRAFT_KEY)
  if (typeof raw !== 'object' || raw === null) return {}
  const d = raw as Record<string, unknown>
  const out: Draft = {}
  for (const k of ['canvas', 'sidebar', 'surface', 'accent', 'text', 'border'] as const) {
    if (typeof d[k] === 'string') out[k] = d[k]
  }
  if (typeof d.radius === 'number') out.radius = d.radius
  if (typeof d.bgStrength === 'number') out.bgStrength = d.bgStrength
  if (SIZES.includes(d.bgSize as BgSize)) out.bgSize = d.bgSize as BgSize
  const pos = isPos(d.bgPos)
  if (pos) out.bgPos = pos
  return out
}

const SIZES: readonly BgSize[] = ['cover', 'contain', 'original', 'stretch']

/** 九宫格只认 0 / 50 / 100 —— 手改过的 JSON 不许把野值写进 `background-position`。 */
function isPos(v: unknown): BgPos | null {
  if (typeof v !== 'object' || v === null) return null
  const p = v as Record<string, unknown>
  const ok = (n: unknown): n is 0 | 50 | 100 => n === 0 || n === 50 || n === 100
  return ok(p.x) && ok(p.y) ? { x: p.x, y: p.y } : null
}

export function setDraft(ctx: Context, patch: Draft): void {
  ctx.settings.set(DRAFT_KEY, { ...draft(ctx), ...patch })
}

export function clearDraft(ctx: Context): void {
  ctx.settings.set(DRAFT_KEY, {})
}

/**
 * 界面上真正生效的那一份：当前主题叠上草稿。
 * 原版（`seeds: null`）被调过色之后也有种子了 —— 起点是原版自己那两组值。
 */
export function resolved(ctx: Context): Theme {
  const theme = activeTheme(ctx)
  const d = draft(ctx)
  const base = editBaseOf(theme, ctx.theme.scheme)
  const touched = Object.keys(d).some((k) => k !== 'radius')
  if (!theme.seeds && !touched) return theme
  return {
    ...theme,
    seeds: { ...(theme.seeds ?? base), ...pickSeeds(d) },
    radius: d.radius ?? theme.radius,
    bgStrength: d.bgStrength ?? theme.bgStrength,
    bgSize: d.bgSize ?? theme.bgSize,
    bgPos: d.bgPos ?? theme.bgPos,
  }
}

function pickSeeds(d: Draft): Partial<Seeds> {
  const out: Partial<Seeds> = {}
  for (const k of ['canvas', 'sidebar', 'surface', 'accent', 'text', 'border'] as const) {
    if (d[k] !== undefined) out[k] = d[k]
  }
  return out
}

/** 存一份「我的主题」。当前就是用户主题 → 覆盖它；否则新建。 */
export function saveUser(ctx: Context, patch: { name: string }): Theme {
  const current = activeTheme(ctx)
  const live = resolved(ctx)
  const mine = current.user
  const theme: Theme = {
    id: mine ? current.id : `user:${Date.now().toString(36)}`,
    name: patch.name.trim() || '我的主题',
    scheme: live.scheme,
    seeds: live.seeds,
    radius: live.radius,
    background: live.background,
    bgStrength: live.bgStrength,
    bgSize: live.bgSize,
    bgPos: live.bgPos,
    user: true,
  }
  const rest = users(ctx).filter((t) => t.id !== theme.id)
  ctx.settings.set(USERS_KEY, [...rest, theme])
  ctx.settings.set(ACTIVE_KEY, theme.id)
  ctx.settings.set(DRAFT_KEY, {})
  return theme
}

export function removeUser(ctx: Context, id: string): void {
  ctx.settings.set(
    USERS_KEY,
    users(ctx).filter((t) => t.id !== id),
  )
  if (activeId(ctx) === id) setActive(ctx, DEFAULT_ID)
}

/** 换背景图（`null` = 回到自画那张）。落在**我的主题**上 —— 原版/内置是只读的，先另存一份再写。 */
export function setBackground(ctx: Context, url: string | null): Theme {
  const current = activeTheme(ctx)
  const mine = current.user ? current : saveUser(ctx, { name: current.name + '改' })
  const next: Theme = { ...mine, background: url ?? undefined }
  ctx.settings.set(
    USERS_KEY,
    users(ctx).map((t) => (t.id === next.id ? next : t)),
  )
  return next
}
