/**
 * 知识图谱那一页的样式。只画结构（顶部一行控件 + 整块画布），配色一律 `--affine-*` token。
 * ★ 插件不许 import 外壳样式，所以自己写一份，不引 `src/shell/*.css.ts`。
 * ★ canvas 里的颜色另走 `ctx.theme.tokens`（`./graph.ts`），那儿的 `var()` 取不到。
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

export const field = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

export const fieldLabel = style({ flex: '0 0 auto' })

export const select = style({
  maxWidth: 200,
  height: 28,
  padding: '0 6px',
  border: '1px solid var(--affine-border-color)',
  borderRadius: 6,
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: MONO,
  fontSize: 12,
  cursor: 'pointer',
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

export const legend = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
})

export const legendItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary)',
})

export const dot = style({
  width: 9,
  height: 9,
  borderRadius: '50%',
  background: 'var(--affine-primary-color)',
  selectors: {
    '&[data-kind="entity"]': { background: 'var(--affine-palette-line-orange)' },
    '&[data-kind="topic"]': { background: 'var(--affine-palette-line-green)' },
  },
})

export const error = style({
  margin: 0,
  padding: '6px 20px',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-error-color)',
  borderBottom: '1px solid var(--affine-v2-layer-background-secondary)',
})

export const stage = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
})

export const canvas = style({
  display: 'block',
  width: '100%',
  height: '100%',
  touchAction: 'none',
})

export const note = style({
  position: 'absolute',
  inset: 0,
  margin: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})
