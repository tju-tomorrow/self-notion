/**
 * 快插 FAB / sheet 自己的样式。整个组件只在手机上出现，桌面由 `.sn-mobile-insert` 的 display:none 收掉。
 */
import { globalStyle } from '@vanilla-extract/css'

const PANEL = 'var(--affine-background-overlay-panel-color, #ffffff)'
const BORDER = 'var(--affine-border-color, rgba(0, 0, 0, .1))'
const TEXT = 'var(--affine-text-primary-color, #333333)'
const MUTED = 'var(--affine-text-secondary-color, #8a8a8a)'
const ACCENT = 'var(--sn-accent, #1e96eb)'

// 键盘弹起时抬到键盘上方；没键盘时让开底部导航（≈60px）与安全区。
const FAB_BOTTOM = 'calc(max(64px + env(safe-area-inset-bottom), var(--sn-keyboard-inset, 0px)) + 14px)'

globalStyle('.sn-mobile-insert', {
  display: 'none',
  position: 'fixed',
  inset: 0,
  zIndex: 60,
  pointerEvents: 'none',
})
globalStyle('html[data-mobile="1"] .sn-mobile-insert', { display: 'block' })
globalStyle('html .sn-mobile-insert', { '@media': { '(max-width: 720px)': { display: 'block' } } })

globalStyle('.sn-mobile-fab', {
  position: 'absolute',
  right: 16,
  bottom: FAB_BOTTOM,
  width: 52,
  height: 52,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: ACCENT,
  color: '#fff',
  fontSize: 28,
  lineHeight: 1,
  boxShadow: '0 6px 20px rgba(0, 0, 0, .28)',
  cursor: 'pointer',
  pointerEvents: 'auto',
  touchAction: 'manipulation',
})
globalStyle('.sn-mobile-insert[data-on="1"] .sn-mobile-fab', { display: 'none' })

globalStyle('.sn-mobile-scrim', {
  display: 'none',
  position: 'absolute',
  inset: 0,
  background: 'rgba(0, 0, 0, .34)',
  pointerEvents: 'auto',
})
globalStyle('.sn-mobile-insert[data-on="1"] .sn-mobile-scrim', { display: 'block' })

globalStyle('.sn-mobile-sheet', {
  display: 'none',
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 'var(--sn-keyboard-inset, 0px)',
  boxSizing: 'border-box',
  maxHeight: '60dvh',
  overflowY: 'auto',
  padding: '8px 12px calc(12px + env(safe-area-inset-bottom))',
  borderTop: `1px solid ${BORDER}`,
  borderRadius: '16px 16px 0 0',
  background: PANEL,
  color: TEXT,
  boxShadow: '0 -8px 32px rgba(0, 0, 0, .2)',
  pointerEvents: 'auto',
})
globalStyle('.sn-mobile-insert[data-on="1"] .sn-mobile-sheet', { display: 'block' })

globalStyle('.sn-mobile-sheet-title', {
  padding: '6px 4px 10px',
  fontSize: 13,
  color: MUTED,
})

globalStyle('.sn-mobile-grid', {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 8,
})

globalStyle('.sn-mobile-item', {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 68,
  padding: '8px 4px',
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  touchAction: 'manipulation',
})
globalStyle('.sn-mobile-item:active', { background: 'rgba(127, 127, 127, .14)' })

globalStyle('.sn-mobile-item-ico', { fontSize: 20, lineHeight: 1, color: MUTED })
globalStyle('.sn-mobile-item-label', { fontSize: 12 })
