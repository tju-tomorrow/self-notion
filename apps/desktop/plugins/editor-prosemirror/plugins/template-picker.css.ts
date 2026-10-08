/** 「选模板」小列表的样式（slash.ts 里那两拍用的）—— 自己一份，不 import 外壳的（CONVENTIONS §6.2）。
 *  颜色走 `--affine-*`（挂在 `<html>` 上），取不到退回中性色。 */
import { globalStyle } from '@vanilla-extract/css'

const PANEL = 'var(--affine-background-overlay-panel-color, #ffffff)'
const BORDER = 'var(--affine-border-color, rgba(0, 0, 0, .1))'
const TEXT = 'var(--affine-text-primary-color, #333333)'
const MUTED = 'var(--affine-text-secondary-color, #8a8a8a)'
const HOVER = 'var(--affine-hover-color, rgba(0, 0, 0, .06))'

globalStyle('.sn-template-pick', {
  position: 'fixed',
  zIndex: 'var(--affine-z-index-popover, 1000)',
  width: 240,
  maxHeight: 320,
  display: 'flex',
  flexDirection: 'column',
  padding: 6,
  border: `1px solid ${BORDER}`,
  borderRadius: 'var(--affine-popover-radius, 8px)',
  background: PANEL,
  boxShadow: 'var(--affine-popover-shadow, 0 4px 16px rgba(0, 0, 0, .16))',
  color: TEXT,
  fontSize: 13,
})

globalStyle('.sn-template-pick-input', {
  width: '100%',
  boxSizing: 'border-box',
  marginBottom: 4,
  padding: '5px 8px',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  outline: 'none',
})

globalStyle('.sn-template-pick-list', { overflowY: 'auto' })

globalStyle('.sn-template-pick-row', {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 8px',
  borderRadius: 6,
  cursor: 'pointer',
})

globalStyle('.sn-template-pick-row[aria-selected="true"]', { background: HOVER })

globalStyle('.sn-template-pick-ico', { flex: '0 0 18px', textAlign: 'center' })

globalStyle('.sn-template-pick-title', {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

globalStyle('.sn-template-pick-none', { padding: '6px 8px', color: MUTED })
