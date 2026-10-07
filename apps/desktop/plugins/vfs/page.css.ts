/**
 * 虚拟目录那一页的样式。**只画结构和状态**，不加装饰（用户 2026-10-07）：
 * 层级靠 `tree` 那种连接线，长短靠大小那一列，颜色只走 `--affine-*` / `--affine-v2-*`
 * （写错一个字母整条声明作废）。
 */
import { style } from '@vanilla-extract/css'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

export const page = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  // 外壳的 `main` 是透的（正文纸面吃窗口磨砂）—— 这一页不是正文，自己补底色。
  background: 'var(--affine-v2-layer-background-primary)',
  selectors: { '[data-theme="dark"] &': { background: '#1c1c1c' } },
})

export const header = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  height: 52,
  padding: '0 20px',
})

export const title = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: 0,
  fontFamily: MONO,
  fontSize: 15,
  lineHeight: '22px',
  fontWeight: 600,
  color: 'var(--affine-v2-text-primary)',
})

export const hint = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

export const searchBox = style({
  display: 'flex',
  alignItems: 'center',
  flex: '0 0 240px',
  height: 30,
  padding: '0 10px',
  borderRadius: 6,
  background: 'var(--affine-v2-layer-background-secondary)',
  selectors: { '&:focus-within': { boxShadow: '0 0 0 1px var(--affine-primary-color)' } },
})

export const search = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: MONO,
  fontSize: 13,
  outline: 'none',
  selectors: { '&::placeholder': { color: 'var(--affine-v2-text-tertiary)' } },
})

/** 工具栏那两颗按钮（展开三层 / 收起）。 */
export const tool = style({
  flex: '0 0 auto',
  height: 30,
  padding: '0 10px',
  border: 'none',
  borderRadius: 6,
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: MONO,
  fontSize: 12,
  cursor: 'pointer',
  selectors: { '&:hover': { color: 'var(--affine-v2-text-primary)' } },
})

export const body = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  borderTop: '1px solid var(--affine-v2-layer-background-secondary)',
})

/** 左边那棵树。底色压一档，跟右边读出来的正文分开。 */
export const tree = style({
  flex: '0 0 360px',
  minHeight: 0,
  overflowY: 'auto',
  padding: '10px 6px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  background: 'var(--affine-v2-layer-background-secondary)',
  borderRight: '1px solid var(--affine-v2-layer-background-hoverOverlay)',
})

/** 筛名字那一格（只筛已经画出来的行）。 */
export const filter = style({
  margin: '0 8px 8px',
  padding: '4px 6px',
  border: 'none',
  borderRadius: 4,
  background: 'var(--affine-v2-layer-background-primary)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: MONO,
  fontSize: 12,
  outline: 'none',
  selectors: {
    '&::placeholder': { color: 'var(--affine-v2-text-tertiary)' },
    '&:focus': { boxShadow: '0 0 0 1px var(--affine-primary-color)' },
  },
})

export const row = style({
  display: 'flex',
  alignItems: 'center',
  minHeight: 22,
  padding: '0 8px',
  border: 'none',
  borderRadius: 3,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: MONO,
  fontSize: 12.5,
  lineHeight: '18px',
  textAlign: 'left',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const rowOn = style({ background: 'var(--affine-v2-layer-background-hoverOverlay)' })

/** `├─ ` / `│  ` 这些连接线。**空白要留住** —— 所以 `pre`。 */
export const branch = style({
  color: 'var(--affine-v2-text-tertiary)',
  whiteSpace: 'pre',
})

/** 目录跟 `ls` 一样上色（这边用主题色代替它的蓝）。 */
export const dir = style({ color: 'var(--affine-primary-color)' })

export const name = style({ whiteSpace: 'pre' })

/** 大小那一列，靠右。 */
export const sizeCol = style({
  marginLeft: 'auto',
  paddingLeft: 16,
  color: 'var(--affine-v2-text-tertiary)',
  fontSize: 11,
})

export const hit = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '4px 8px',
  border: 'none',
  borderRadius: 3,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: MONO,
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const hitPath = style({ color: 'var(--affine-primary-color)' })
export const hitText = style({
  color: 'var(--affine-v2-text-tertiary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

export const pane = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
})

export const paneHead = style({
  flex: '0 0 auto',
  height: 32,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
  borderBottom: '1px solid var(--affine-v2-layer-background-secondary)',
})

export const panePath = style({ color: 'var(--affine-v2-text-secondary)' })
export const paneMeta = style({ color: 'var(--affine-v2-text-tertiary)' })

/** 栏头右端那颗 L1 / L2 切换。 */
export const paneBtn = style({
  marginLeft: 'auto',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--affine-primary-color)',
  fontFamily: MONO,
  fontSize: 12,
  cursor: 'pointer',
  selectors: { '&:hover': { textDecoration: 'underline' } },
})

export const text = style({
  flex: 1,
  minHeight: 0,
  margin: 0,
  overflow: 'auto',
  padding: '12px 16px 24px',
  fontFamily: MONO,
  fontSize: 12,
  lineHeight: '18px',
  whiteSpace: 'pre-wrap',
  color: 'var(--affine-v2-text-secondary)',
})

export const error = style({
  margin: 0,
  padding: '6px 8px',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-error-color)',
})

/** 空态 / 没搜到 —— 灰字，不是错。 */
export const note = style({
  margin: 0,
  padding: '6px 8px',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})
