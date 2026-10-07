/**
 * 「光标」设置页那排色票的样式 —— 和正文纸面那排同一套（圆形色票 + 原生取色井）。
 * 单独一个文件是为了让 `settings.tsx` 保持轻：不去 import 编辑器那一坨样式。
 */
import { style } from '@vanilla-extract/css'

const ACCENT = 'var(--sn-accent, var(--affine-primary-color, #1e96eb))'
const BORDER = 'var(--affine-v2-layer-insideBorder-border, rgba(255,255,255,.09))'

export const swatches = style({ display: 'flex', alignItems: 'center', gap: 8 })

export const swatch = style({
  width: 22,
  height: 22,
  padding: 0,
  borderRadius: '50%',
  border: `1px solid ${BORDER}`,
  boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.12)',
  cursor: 'pointer',
  selectors: { '&:hover': { transform: 'scale(1.08)' } },
})

/** 跟随主题：深浅两半。 */
export const swatchTheme = style({
  background: 'linear-gradient(135deg, #ffffff 50%, #141414 50%)',
})

export const swatchOn = style({
  boxShadow: `inset 0 0 0 0.5px rgba(0,0,0,.12), 0 0 0 2px ${ACCENT}`,
})

export const colorWell = style({
  width: 22,
  height: 22,
  padding: 0,
  border: `1px solid ${BORDER}`,
  borderRadius: '50%',
  background: 'none',
  cursor: 'pointer',
  appearance: 'none',
  WebkitAppearance: 'none',
  selectors: {
    '&::-webkit-color-swatch-wrapper': { padding: 0 },
    '&::-webkit-color-swatch': { border: 'none', borderRadius: '50%' },
  },
})
