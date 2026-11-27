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

export const shapeGroup = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  flex: '0 0 auto',
})

export const groupLabel = style({
  margin: '0 2px 0 6px',
  fontSize: 11,
  color: MUTED,
  whiteSpace: 'nowrap',
})

export const sep = style({
  flex: '0 0 auto',
  width: 1,
  height: 16,
  margin: '0 4px',
  background: LINE,
})

export const tools = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  flex: '0 0 auto',
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

export const toolOn = style({
  background: 'rgba(30, 150, 235, .14)',
  color: ACCENT,
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
  cursor: 'pointer',
})

export const status = style({
  marginLeft: 6,
  flex: '0 0 auto',
  fontSize: 12,
  color: MUTED,
})

/* ── 第二行：选中图形后改样式 ── */

export const styleBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  flex: '0 0 auto',
  minHeight: 34,
  padding: '3px 10px',
  borderBottom: `1px solid ${LINE}`,
  overflowX: 'auto',
})

export const styleGroup = style({
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  flex: '0 0 auto',
})

export const styleLabel = style({
  marginRight: 2,
  fontSize: 12,
  color: MUTED,
  whiteSpace: 'nowrap',
})

export const styleVal = style({
  minWidth: 22,
  textAlign: 'center',
  fontSize: 12,
  color: MUTED,
  fontVariantNumeric: 'tabular-nums',
})

export const styleHint = style({
  marginLeft: 'auto',
  paddingLeft: 10,
  fontSize: 12,
  color: MUTED,
  whiteSpace: 'nowrap',
})

export const swatch = style({
  width: 16,
  height: 16,
  padding: 0,
  borderRadius: 999,
  border: '1px solid rgba(0, 0, 0, .28)',
  cursor: 'pointer',
  selectors: {
    '&:hover:not(:disabled)': { transform: 'scale(1.15)' },
    '&:disabled': { opacity: .3, cursor: 'default' },
    '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 1 },
  },
})

export const swatchOn = style({
  boxShadow: `0 0 0 2px ${ACCENT}`,
})

export const swatchNone = style({
  background:
    'linear-gradient(to top right, transparent calc(50% - 1px), #9ca3af calc(50% - 1px), #9ca3af calc(50% + 1px), transparent calc(50% + 1px)), #fff',
})

/* 拖图形时的跟随影子（只给 setDragImage 拍快照用，画在屏幕外）。 */
export const dragGhost = style({
  position: 'fixed',
  left: -200,
  top: -200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 52,
  height: 36,
  border: '1px solid #475569',
  borderRadius: 7,
  background: '#fff',
  color: '#475569',
  fontSize: 22,
  lineHeight: 1,
  pointerEvents: 'none',
})

/* ── 双击空白处弹出的图形选择器 ── */

export const picker = style({
  position: 'fixed',
  zIndex: 1000,
  width: 340,
  padding: 8,
  borderRadius: 12,
  border: '1px solid rgba(128, 128, 128, .3)',
  background: '#fff',
  boxShadow: '0 12px 32px rgba(0, 0, 0, .2)',
  selectors: {
    '[data-theme="dark"] &': { background: '#222', borderColor: 'rgba(255, 255, 255, .16)' },
  },
})

export const pickerHead = style({
  margin: '2px 4px 6px',
  fontSize: 12,
  color: MUTED,
})

export const pickerLabel = style({
  margin: '6px 4px 4px',
  fontSize: 11,
  color: MUTED,
})

export const pickerGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: 4,
})

export const pickerItem = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  height: 54,
  minWidth: 0,
  padding: '0 2px',
  border: '1px solid transparent',
  borderRadius: 8,
  background: 'transparent',
  color: 'inherit',
  cursor: 'grab',
  selectors: {
    '&:hover': { background: HOVER },
    '&:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: 1 },
  },
})

export const pickerGlyph = style({
  fontSize: 17,
  lineHeight: 1,
})

export const pickerName = style({
  maxWidth: '100%',
  overflow: 'hidden',
  fontSize: 10,
  color: MUTED,
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
})

/* ── 右键菜单 ── */

export const menu = style({
  position: 'fixed',
  zIndex: 1000,
  minWidth: 150,
  padding: 4,
  borderRadius: 9,
  border: '1px solid rgba(128, 128, 128, .3)',
  background: '#fff',
  boxShadow: '0 10px 28px rgba(0, 0, 0, .18)',
  selectors: {
    '[data-theme="dark"] &': { background: '#222', borderColor: 'rgba(255, 255, 255, .16)' },
  },
})

export const menuItem = style({
  display: 'block',
  width: '100%',
  padding: '6px 12px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover:not(:disabled)': { background: HOVER },
    '&:disabled': { opacity: .4, cursor: 'default' },
  },
})

export const menuSep = style({
  height: 1,
  margin: '4px 6px',
  background: LINE,
})

export const canvas = style({
  flex: '1 1 auto',
  minHeight: 0,
  position: 'relative',
  overflow: 'hidden',
  outline: 'none',
  // 画布是白纸：图形的默认字色写在引擎里，不跟主题走。
  background: '#fff',
  // 拖图形时只重画这一格，别让整页跟着重排。
  contain: 'layout paint',
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
