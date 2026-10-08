/**
 * 纸面那两行控件的样式：一排色块 + 一根磨砂滑块。
 * 色块是**圆形色票**（照着取色器的样子），选中的套一圈强调色。
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
  // 白色色票压在浅色设置页上，没这圈内阴影就看不见边
  boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.12)',
  cursor: 'pointer',
  selectors: { '&:hover': { transform: 'scale(1.08)' } },
})

/** 跟随主题：深浅两半，比一个灰块说得清楚。 */
export const swatchTheme = style({
  background: 'linear-gradient(135deg, #ffffff 50%, #141414 50%)',
})

export const swatchOn = style({
  boxShadow: `inset 0 0 0 0.5px rgba(0,0,0,.12), 0 0 0 2px ${ACCENT}`,
})

/** 自定义取色：就是原生的 `<input type="color">`，把外壳剥掉只剩那个色井。 */
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

export const slider = style({
  width: 140,
  accentColor: ACCENT,
})

export const pct = style({
  width: 38,
  textAlign: 'right',
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary)',
  fontVariantNumeric: 'tabular-nums',
})
