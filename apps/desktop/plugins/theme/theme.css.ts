/**
 * 主题那一段自己的样式：**只有画廊那几张卡片**。其余全用 `src/ui/settings` 那套控件
 * （`Group` / `Row` / `Field` / `Button` / `Note`）—— 设置页的控件各插件各写一套就漂了。
 */
import { style } from '@vanilla-extract/css'

const ACCENT = 'var(--sn-accent, var(--affine-primary-color, #1e96eb))'
const BORDER = 'var(--affine-v2-layer-insideBorder-border, rgba(255,255,255,.09))'

export const gallery = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(138px, 1fr))',
  gap: 12,
  width: '100%',
})

export const card = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-text-primary)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 1 },
  },
})

export const cardOn = style({ borderColor: ACCENT, boxShadow: `0 0 0 2px ${ACCENT}` })

/** 卡片上的删除键。**常显**（不只在 hover 时）—— 这一轮的教训就是"能看见 ≠ 存在"：
 *  藏起来的控件等于没有（D-0152 / D-0154）。 */
export const cardDel = style({
  position: 'absolute',
  top: 5,
  right: 5,
  width: 22,
  height: 22,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 6,
  background: 'var(--affine-v2-layer-background-overlayPanel)',
  color: 'var(--affine-v2-text-secondary)',
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
  opacity: 0.55,
  selectors: {
    '&:hover': {
      opacity: 1,
      color: 'var(--affine-error-color, #e5484d)',
      background: 'var(--affine-v2-layer-background-error)',
    },
  },
})

/** 迷你预览：一块画布 + 一条侧栏 + 一颗强调色点 + 一根文字线。图上是什么色就是什么色。 */
export const preview = style({
  height: 52,
  borderRadius: 6,
  position: 'relative',
  overflow: 'hidden',
  border: `1px solid ${BORDER}`,
})

export const previewBar = style({ position: 'absolute', inset: '0 auto 0 0', width: 22 })
export const previewDot = style({
  position: 'absolute',
  right: 8,
  top: 8,
  width: 14,
  height: 14,
  borderRadius: '50%',
})
export const previewLine = style({
  position: 'absolute',
  left: 32,
  top: 14,
  height: 5,
  width: '46%',
  borderRadius: 3,
})
export const previewLine2 = style({
  position: 'absolute',
  left: 32,
  top: 26,
  height: 5,
  width: '30%',
  borderRadius: 3,
  opacity: 0.6,
})

export const name = style({ fontSize: 13, lineHeight: 1.3 })

export const fileBtn = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 26,
  padding: '0 10px',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--affine-v2-text-primary)',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const picks = style({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' })

/** 滑块右边那个百分比（浓度）。 */
export const pct = style({
  width: 38,
  textAlign: 'right',
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary)',
  fontVariantNumeric: 'tabular-nums',
})

/** 九宫格位置控件：每个格子里一个小点靠向它代表的那一边。 */
export const posGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 24px)',
  gap: 4,
})

export const posCell = style({
  width: 24,
  height: 24,
  padding: 2,
  display: 'flex',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  background: 'transparent',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const posCellOn = style({
  borderColor: ACCENT,
  background: 'color-mix(in srgb, var(--sn-accent, #1e96eb) 22%, transparent)',
})

export const posDot = style({
  width: 6,
  height: 6,
  borderRadius: 2,
  background: 'var(--affine-v2-icon-secondary, #a8a8c6)',
})
