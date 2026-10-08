/**
 * 主题的形状。**主题是数据，不是代码** —— 内置几套和用户存的是同一个类型，
 * 所以「用户自定义」不需要第二套机制（`docs/theme.md` §2.3，D-0146）。
 */

/** 6 个种子色。全套 70 个变量由它们派生（`expand.ts`），用户调的就是这 6 个。 */
export interface Seeds {
  /** 画布 / 正文纸面底 */
  canvas: string
  /** 侧栏（比画布略深一档） */
  sidebar: string
  /** 卡片、面板、菜单、代码块 */
  surface: string
  /** 强调色：主按钮、链接、焦点、选中态的染色来源 */
  accent: string
  /** 正文色；次要 / 占位 / 禁用都由它和 canvas 混出来 */
  text: string
  /** 描边 */
  border: string
}

/** 背景尺寸，直接对上 CSS 的 `background-size`（`stretch` 是 `100% 100%`）。 */
export type BgSize = 'cover' | 'contain' | 'original' | 'stretch'

/** 背景位置，九宫格 —— 两个 0 / 50 / 100 就够表达，存的就是 `background-position` 的百分比。 */
export interface BgPos {
  x: 0 | 50 | 100
  y: 0 | 50 | 100
}

export interface Theme {
  id: string
  name: string
  /** `null` = 跟随明暗（「原版」就是它）。带值 = 只有这一档画得出来。 */
  scheme: 'dark' | 'light' | null
  /** `null` = 一个变量都不写。这就是「原版」。 */
  seeds: Seeds | null
  radius?: number
  /** 背景图，`url("self-notion://blob/<id>")`（图存在 blob 里，D-0159）。缺 = 用 `art.ts` 自画的夜空。 */
  background?: string
  /** 背景浓度 0..100（用户看的那个数）。缺 = `BG_STRENGTH_DEFAULT`。 */
  bgStrength?: number
  /** 缺 = `cover` */
  bgSize?: BgSize
  /** 缺 = `{ x: 50, y: 0 }`（顶部居中）—— 竖构图的角色图，脸通常在顶上。 */
  bgPos?: BgPos
  /** 附加表里再补的规则（变量表达不了的） */
  css?: string
  /** 用户存的，不是内置的 */
  user?: boolean
}

/** 草稿：调到一半的种子 + 圆角 + 背景（浓度 / 尺寸 / 位置），落在 `theme.draft` 里，重启还在。 */
export type Draft = Partial<Seeds> & {
  radius?: number
  bgStrength?: number
  bgSize?: BgSize
  bgPos?: BgPos
}
