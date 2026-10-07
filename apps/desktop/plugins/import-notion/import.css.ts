/**
 * 「从 Notion 导入」那一节的样式。配色一律走 `--affine-*` token（CONVENTIONS §3）。
 */
import { style } from '@vanilla-extract/css'

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '16px 0',
  borderTop: '1px solid var(--affine-border-color)',
})

export const title = style({
  margin: 0,
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--affine-text-primary-color)',
})

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
})

export const button = style({
  padding: '5px 14px',
  fontSize: 13,
  borderRadius: 6,
  border: '1px solid var(--affine-border-color)',
  background: 'var(--affine-background-primary-color)',
  color: 'var(--affine-text-primary-color)',
  cursor: 'pointer',
  selectors: {
    '&:disabled': { opacity: 0.5, cursor: 'default' },
  },
})

export const primary = style({
  fontWeight: 600,
  borderColor: 'var(--affine-text-primary-color)',
})

export const hint = style({
  fontSize: 12,
  lineHeight: 1.6,
  color: 'var(--affine-text-secondary-color)',
})

export const note = style({
  fontSize: 12,
  color: 'var(--affine-text-primary-color)',
})

export const error = style({
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--affine-text-primary-color)',
})

/** 真 input 藏起来，点的是上面那颗按钮 —— webview 的选文件框由 input 自己弹。 */
export const hidden = style({
  display: 'none',
})
