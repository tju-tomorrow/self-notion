/**
 * 整理建议收件箱的样式。只画结构和状态（用户 2026-10-07：「不要装饰，不要没作用的」）：
 * 一行一件事，右端两颗按钮，配色一律 `--affine-*` / `--affine-v2-*` token。
 * ★ 插件不许 import 外壳样式，所以自己写一份，不引 `src/shell/*.css.ts`。
 */
import { style } from '@vanilla-extract/css'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

export const page = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  // 外壳的 `main` 是透的 —— 这一页不是正文，自己补底色。
  background: 'var(--affine-v2-layer-background-primary)',
  selectors: { '[data-theme="dark"] &': { background: '#191919' } },
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

export const count = style({
  flex: '0 0 auto',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary)',
})

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
  selectors: {
    '&:hover': { color: 'var(--affine-v2-text-primary)' },
    '&:disabled': { opacity: 0.45, cursor: 'default' },
  },
})

/** 「全部采纳」是这一页的主要动作。 */
export const toolPrimary = style({
  background: 'var(--affine-primary-color)',
  color: '#fff',
  selectors: { '&:hover': { color: '#fff' } },
})

export const error = style({
  margin: 0,
  padding: '6px 20px',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-error-color)',
  borderBottom: '1px solid var(--affine-v2-layer-background-secondary)',
})

export const empty = style({
  margin: 0,
  padding: '40px 20px',
  fontFamily: MONO,
  fontSize: 12,
  lineHeight: '18px',
  textAlign: 'center',
  color: 'var(--affine-v2-text-tertiary)',
})

export const list = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '4px 12px 24px',
  borderTop: '1px solid var(--affine-v2-layer-background-secondary)',
})

export const group = style({ marginTop: 12 })

export const groupHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: '0.04em',
  color: 'var(--affine-v2-text-tertiary)',
})

export const groupBar = style({
  width: 3,
  height: 12,
  borderRadius: 2,
  background: 'var(--affine-primary-color)',
})

export const groupN = style({ color: 'var(--affine-v2-text-tertiary)' })

export const row = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '8px',
  borderRadius: 6,
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const rowMain = style({ flex: 1, minWidth: 0 })

export const forLine = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

export const docLink = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  border: 'none',
  padding: 0,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': { color: 'var(--affine-primary-color)', textDecoration: 'underline' },
  },
})

export const what = style({
  marginTop: 2,
  fontFamily: MONO,
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--affine-v2-text-primary)',
  wordBreak: 'break-word',
})

export const reason = style({
  marginTop: 2,
  fontFamily: MONO,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-tertiary)',
  wordBreak: 'break-word',
})

export const actions = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
})

export const act = style({
  height: 26,
  padding: '0 10px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: MONO,
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    '&:disabled': { cursor: 'default', opacity: 0.4 },
  },
})

export const actAccept = style({
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-primary-color)',
  selectors: {
    '&:hover': { background: 'var(--affine-primary-color)', color: '#fff' },
  },
})
