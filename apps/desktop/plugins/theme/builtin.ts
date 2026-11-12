/**
 * 内置主题：原版 + Notion 深色 + 夜空。
 *
 * 原版 `seeds: null` —— 一个变量都不写，就是今天这个样子（D-0145）。
 * 但它在界面上仍要能调色，所以另外给一份 `EDIT_BASE`：那两组值 = AFFiNE 深/浅两档的
 * 画布 / 卡片 / 强调色（实测从 `combined*CssVariables` 抄的，暗色画布那档换成了
 * Notion 的 #191919，D-0171），用户从原版起手调时起点就是原版的颜色，而不是凭空冒出一个紫的。
 */
import { NOTION_CSS } from './notion'
import type { Seeds, Theme } from './types'

/** 空覆盖 = 原版。 */
export const DEFAULT_ID = 'default'
export const NOTION_ID = 'notion'
export const STARRY_ID = 'starry'

export const EDIT_BASE: Readonly<Record<'dark' | 'light', Seeds>> = {
  dark: {
    canvas: '#191919',
    sidebar: '#181818',
    surface: '#252525',
    accent: '#1c9ee4',
    text: '#e6e6e6',
    border: '#414141',
  },
  light: {
    canvas: '#ffffff',
    sidebar: '#fbfbfc',
    surface: '#f5f5f5',
    accent: '#1e96eb',
    text: '#141414',
    border: '#e6e6e6',
  },
}

const DEFAULT_THEME: Theme = {
  id: DEFAULT_ID,
  name: '原版',
  scheme: null,
  seeds: null,
}

/**
 * 截图那套深色 Notion：画布 #191919、侧栏亮一档 #202020、强调色是 Notion 蓝。
 * 没有夜空那张底图（浓度 0）。悬停和侧栏通顶在 `tone` / `css` 里。
 */
const NOTION_THEME: Theme = {
  id: NOTION_ID,
  name: 'Notion',
  scheme: 'dark',
  tone: 'notion',
  seeds: {
    canvas: '#191919',
    sidebar: '#202020',
    surface: '#252525',
    accent: '#2383e2',
    text: '#ffffff',
    border: '#343434',
  },
  radius: 10,
  bgStrength: 0,
  css: NOTION_CSS,
}

/** 用户给的那张图：深靛蓝画布、紫强调、夜里靠窗。 */
const STARRY_THEME: Theme = {
  id: STARRY_ID,
  name: '夜空',
  scheme: 'dark',
  seeds: {
    canvas: '#1a1b2b',
    sidebar: '#171827',
    surface: '#23243f',
    accent: '#7b7ff0',
    text: '#e4e5f2',
    border: '#2e3050',
  },
  radius: 12,
}

export const BUILTIN: readonly Theme[] = [DEFAULT_THEME, NOTION_THEME, STARRY_THEME]

export function builtinById(id: string): Theme | undefined {
  return BUILTIN.find((t) => t.id === id)
}

/** 原版没有种子，调色时拿它当起点。 */
export function editBaseOf(theme: Theme, scheme: 'dark' | 'light'): Seeds {
  return theme.seeds ?? EDIT_BASE[scheme]
}
