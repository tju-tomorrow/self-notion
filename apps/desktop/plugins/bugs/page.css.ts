/**
 * bug 现场那一页的样式。同虚拟目录那一页：**只画结构和状态**，不加装饰，
 * 颜色只走 `--affine-*` / `--affine-v2-*`（写错一个字母整条声明作废）。
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
  borderBottom: '1px solid var(--affine-border-color)',
})

export const headTitle = style({ fontSize: 15, fontWeight: 600 })

export const hint = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  color: 'var(--affine-text-secondary-color)',
})

export const btn = style({
  flex: '0 0 auto',
  height: 28,
  padding: '0 12px',
  borderRadius: 6,
  border: '1px solid var(--affine-border-color)',
  background: 'transparent',
  color: 'var(--affine-text-primary-color)',
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: 'var(--affine-hover-color)' },
    '[data-theme="dark"] &:hover': { background: 'rgba(255,255,255,.08)' },
  },
})

export const body = style({ flex: '1 1 auto', display: 'flex', minHeight: 0 })

export const rail = style({
  flex: '0 0 300px',
  minHeight: 0,
  overflowY: 'auto',
  borderRight: '1px solid var(--affine-border-color)',
  padding: 8,
})

export const main = style({ flex: '1 1 auto', minWidth: 0, minHeight: 0, overflow: 'auto' })

const rowBase = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 2,
  width: '100%',
  padding: '8px 10px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: 'var(--affine-text-primary-color)',
  textAlign: 'left' as const,
  cursor: 'pointer',
}

export const row = style({
  ...rowBase,
  selectors: { '&:hover': { background: 'var(--affine-hover-color)' } },
})

export const rowOn = style({
  ...rowBase,
  background: 'var(--affine-hover-color)',
})

export const rowTop = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: 'var(--affine-text-secondary-color)',
})

export const kind = style({
  fontFamily: MONO,
  padding: '1px 5px',
  borderRadius: 4,
  background: 'var(--affine-v2-layer-background-secondary)',
  selectors: { '[data-theme="dark"] &': { background: 'rgba(255,255,255,.08)' } },
})

export const time = style({ flex: 1, textAlign: 'right' })

export const rowTitle = style({ fontSize: 13, lineHeight: 1.4 })

export const rowDetail = style({
  fontSize: 11,
  lineHeight: 1.4,
  color: 'var(--affine-text-secondary-color)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

export const empty = style({
  margin: '24px 12px',
  fontSize: 12,
  color: 'var(--affine-text-secondary-color)',
})

export const pre = style({
  margin: 0,
  padding: '12px 16px',
  fontFamily: MONO,
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: 'pre',
  color: 'var(--affine-text-primary-color)',
})

export const band = style({
  flex: '0 0 auto',
  display: 'flex',
  gap: 8,
  maxHeight: 84,
  padding: '6px 12px',
  borderTop: '1px solid var(--affine-border-color)',
  fontSize: 11,
  color: 'var(--affine-text-secondary-color)',
})

export const bandTitle = style({ flex: '0 0 auto', fontFamily: MONO })

export const bandRows = style({ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' })

export const event = style({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })
