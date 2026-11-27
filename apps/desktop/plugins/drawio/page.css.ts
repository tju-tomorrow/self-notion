/** 画布页（D-0216）。跟编辑器一样不吃 `--affine-*`，颜色写中性值。 */
import { style } from '@vanilla-extract/css'

const LINE = 'rgba(128, 128, 128, .3)'
const HOVER = 'rgba(128, 128, 128, .16)'
const MUTED = 'rgba(128, 128, 128, .85)'
const ACCENT = 'var(--sn-accent, #1e96eb)'

export const page = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  minHeight: 0,
})

export const toolbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: '0 0 auto',
  padding: '6px 10px',
  borderBottom: `1px solid ${LINE}`,
  overflow: 'hidden',
})

export const shapes = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  overflowX: 'auto',
  flex: '0 1 auto',
})

export const tools = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
})

export const toolBtn = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 28,
  height: 28,
  padding: '0 6px',
  border: 'none',
  borderRadius: 7,
  background: 'transparent',
  color: 'inherit',
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
  selectors: {
    '&:hover:not(:disabled)': { background: HOVER },
    '&:disabled': { opacity: .35, cursor: 'default' },
    '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 1 },
  },
})

export const shapeBtn = style({
  fontSize: 16,
})

export const zoom = style({
  minWidth: 42,
  textAlign: 'center',
  fontSize: 12,
  color: MUTED,
  fontVariantNumeric: 'tabular-nums',
})

export const status = style({
  marginLeft: 6,
  flex: '0 0 auto',
  fontSize: 12,
  color: MUTED,
})

export const canvas = style({
  flex: '1 1 auto',
  minHeight: 0,
  position: 'relative',
  overflow: 'hidden',
  outline: 'none',
  // 点阵底，看得见画布边界又不抢图形。
  backgroundImage:
    'radial-gradient(circle, rgba(128, 128, 128, .22) 1px, transparent 1px)',
  backgroundSize: '20px 20px',
})

export const missing = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  color: MUTED,
  fontSize: 14,
})
