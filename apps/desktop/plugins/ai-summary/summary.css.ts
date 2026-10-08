/**
 * 总结那颗按钮 + 浮层的样式。
 *
 * 配色一律 `--affine-*` / `--affine-v2-*` token（写错一个字母不是报错，是整条声明作废）。
 * ★ 插件不许 import 外壳的样式，所以这里自己写一份。
 */
import { style } from '@vanilla-extract/css'

/* ────────────────────────── 顶栏那颗按钮 ────────────────────────── */

/** 一颗胶囊：图标 + 一句话。没总结时是灰的，有总结才是「有东西可看」的样子。 */
export const chip = style({
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  height: 26,
  maxWidth: 280,
  padding: '0 10px 0 8px',
  border: '0.5px solid transparent',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 12,
  lineHeight: '16px',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
      color: 'var(--affine-v2-text-primary)',
    },
  },
})

/** 已经有总结了 —— 抬一档，让人知道点进去有东西。 */
export const chipHas = style({
  color: 'var(--affine-v2-text-primary)',
  background: 'var(--affine-v2-layer-background-secondary)',
})

/** 浮层开着。 */
export const chipOn = style({
  color: 'var(--affine-primary-color)',
  border: '0.5px solid var(--affine-primary-color)',
  background: 'transparent',
})

export const chipIcon = style({
  display: 'flex',
  alignItems: 'center',
  color: 'var(--affine-primary-color)',
})

export const chipText = style({
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
})

/* ────────────────────────── 浮层 ────────────────────────── */

/** portal 到 body，位置由 JS 按按钮算出来（顶栏那行是 `overflow: hidden` 的）。 */
export const pop = style({
  position: 'fixed',
  zIndex: 950,
  padding: 14,
  borderRadius: 10,
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  background: 'var(--affine-v2-layer-background-primary)',
  boxShadow: 'var(--affine-shadow-2)',
  color: 'var(--affine-v2-text-primary)',
})

export const popLabel = style({
  marginBottom: 4,
  fontSize: 11,
  letterSpacing: 0.4,
  color: 'var(--affine-v2-text-tertiary)',
})

export const popLine = style({
  margin: '0 0 12px',
  fontSize: 15,
  fontWeight: 500,
  lineHeight: '22px',
})

export const popPara = style({
  margin: 0,
  fontSize: 13,
  lineHeight: '21px',
  color: 'var(--affine-v2-text-secondary)',
})

/** 实体那一栏的小标题，跟上面两栏拉开一点。 */
export const popLabelHead = style({
  margin: '12px 0 4px',
  fontSize: 11,
  letterSpacing: 0.4,
  color: 'var(--affine-v2-text-tertiary)',
})

/** 实体：一排小胶囊。 */
export const tags = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
})

export const tag = style({
  padding: '2px 8px',
  borderRadius: 999,
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-text-secondary)',
  fontSize: 12,
  lineHeight: '18px',
  wordBreak: 'break-word',
})

export const stale = style({
  margin: '10px 0 0',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-primary-color)',
})

export const note = style({
  margin: 0,
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--affine-v2-text-tertiary)',
})

export const error = style({
  margin: '10px 0 0',
  padding: '6px 8px',
  borderRadius: 6,
  fontSize: 12,
  lineHeight: '18px',
  background: 'var(--affine-v2-layer-background-error)',
})

export const popFoot = style({
  display: 'flex',
  gap: 8,
  marginTop: 12,
})

export const action = style({
  height: 26,
  padding: '0 10px',
  border: 'none',
  borderRadius: 6,
  background: 'var(--affine-v2-button-secondary)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    '&:disabled': { cursor: 'default', opacity: 0.5 },
  },
})
