/**
 * 正文纸面的底色 + 磨砂。**只有这一处往 `<html>` 上写变量** —— 设置页只管改 `ctx.settings`，
 * 改完由订阅回到这里重算（同 `shell-doc-header/fonts.ts` 的分工）。
 *
 *   --sn-paper        纸面颜色。跟随主题时**不写**：CSS 那边 `var()` 的兜底是按主题给的，
 *                     写死一个值反而换主题时不跟着走。
 *   --sn-paper-alpha  0..100 的百分比，编辑器那边算成透明度。
 *
 * ★ 消费者只有一个：`editor-prosemirror/editor.css.ts` 里 `.sn-pane-body` 那条背景。
 */
import type { Context } from 'cordis'
import type { ThemeController } from '../../src/theme/tokens'

export const PAPER_KEY = 'appearance.paper'
export const PAPER_ALPHA_KEY = 'appearance.paperAlpha'

/** 跟随主题：纸面就是外壳原来的底色，一点变化都没有。 */
export const FOLLOW_THEME = 'theme'

/** 预设。**每个两份色值** —— 暗色下用浅色那档会直接闪瞎，所以按主题各给一个。 */
export const PAPER_PRESETS = [
  { id: 'white', light: '#ffffff', dark: '#101010' },
  { id: 'sepia', light: '#f7f1e3', dark: '#26221a' },
  { id: 'blue', light: '#eef3f9', dark: '#1a2028' },
  { id: 'green', light: '#eef5ef', dark: '#19211b' },
  { id: 'coral', light: '#fdf1ec', dark: '#2a1f1a' },
] as const

export type PaperPreset = (typeof PAPER_PRESETS)[number]

/** 88%：看得出玻璃，字还读得清。滑到 100 就是完全实心。 */
export const PAPER_ALPHA_DEFAULT = 88

/** 存的是一个字符串：`theme` / 预设 id / `#rrggbb`（自定义取色）。 */
export function paperChoice(ctx: Context): string {
  const raw = ctx.settings.get<string>(PAPER_KEY)
  return typeof raw === 'string' && raw ? raw : FOLLOW_THEME
}

export function paperAlpha(ctx: Context): number {
  const raw = ctx.settings.get<unknown>(PAPER_ALPHA_KEY)
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return PAPER_ALPHA_DEFAULT
  return Math.min(100, Math.max(0, n))
}

export function schemeNow(ctx: Context): 'light' | 'dark' {
  return (ctx.theme as ThemeController).scheme
}

/** 选择 → 实际色值。`theme` 给 null = 交给 CSS 兜底。 */
export function paperHex(choice: string, scheme: 'light' | 'dark'): string | null {
  if (choice === FOLLOW_THEME) return null
  if (choice.startsWith('#')) return choice
  const preset = PAPER_PRESETS.find((p) => p.id === choice)
  return preset ? preset[scheme] : null
}

/** 取色器该显示哪个色 —— 跟随主题时给主题自己那一档。 */
export function paperSwatchValue(ctx: Context, choice: string): string {
  const scheme = schemeNow(ctx)
  return paperHex(choice, scheme) ?? (scheme === 'dark' ? '#1c1c1c' : '#ffffff')
}

export function createPaper(ctx: Context): () => void {
  const root = document.documentElement

  const paint = () => {
    const hex = paperHex(paperChoice(ctx), schemeNow(ctx))
    if (hex === null) root.style.removeProperty('--sn-paper')
    else root.style.setProperty('--sn-paper', hex)
    root.style.setProperty('--sn-paper-alpha', String(paperAlpha(ctx)))
  }

  const offs = [PAPER_KEY, PAPER_ALPHA_KEY].map((key) => ctx.settings.onChange(key, paint))
  // 换主题要重算：预设色是按主题分开的两档。
  const offTheme = ctx.theme.onChange(paint)
  // 预热是异步的，这会儿可能还读到 undefined —— plugin-settings 预热完会 notify 一次，那时再画。
  paint()

  return () => {
    for (const off of offs) off()
    void offTheme()
    // 拔插件把变量收回：留着的话「没改过设置」和「插件不在」就成两种样子了。
    root.style.removeProperty('--sn-paper')
    root.style.removeProperty('--sn-paper-alpha')
  }
}
