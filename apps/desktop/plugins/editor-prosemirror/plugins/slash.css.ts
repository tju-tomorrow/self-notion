/**
 * 斜杠菜单自己的样式（CONVENTIONS §6.2：插件不 import 外壳的样式）。
 *
 * 颜色走 `--affine-*`：那张表挂在 `<html>` 上（`src/theme/tokens.ts` 写的，跟 BlockSuite 无关），
 * 菜单虽然挂在 `document.body` 下也读得到，深浅色跟着系统走。取不到时退回中性色。
 */
import { globalStyle } from '@vanilla-extract/css'

const PANEL = 'var(--affine-background-overlay-panel-color, #ffffff)'
const BORDER = 'var(--affine-border-color, rgba(0, 0, 0, .1))'
const TEXT = 'var(--affine-text-primary-color, #333333)'
const MUTED = 'var(--affine-text-secondary-color, #8a8a8a)'
const HOVER = 'var(--affine-hover-color, rgba(0, 0, 0, .06))'

globalStyle('.sn-slash', {
  position: 'fixed',
  zIndex: 'var(--affine-z-index-popover, 1000)',
  minWidth: 220,
  maxWidth: 320,
  maxHeight: 320,
  overflowY: 'auto',
  padding: 4,
  border: `1px solid ${BORDER}`,
  borderRadius: 'var(--affine-popover-radius, 8px)',
  background: PANEL,
  boxShadow: 'var(--affine-popover-shadow, 0 4px 16px rgba(0, 0, 0, .16))',
  color: TEXT,
  fontSize: 13,
  lineHeight: 1.4,
  // 菜单是「点一下就走」，选中文字没意义，还会把上下键的滚动带歪。
  userSelect: 'none',
})

globalStyle('.sn-slash-label', {
  padding: '6px 8px 2px',
  fontSize: 11,
  color: MUTED,
})

globalStyle('.sn-slash-item', {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 8px',
  borderRadius: 6,
  cursor: 'pointer',
})

globalStyle('.sn-slash-item[aria-selected="true"]', { background: HOVER })

globalStyle('.sn-slash-ico', {
  flex: '0 0 20px',
  width: 20,
  textAlign: 'center',
  color: MUTED,
})

globalStyle('.sn-slash-name', {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

globalStyle('.sn-slash-hint', {
  flex: '0 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 11,
  color: MUTED,
})

globalStyle('.sn-slash-none', { padding: '6px 8px', color: MUTED })

// 触发符到光标那段：让人看清菜单绑在哪几个字上（只上底色，不动字形，免得看着像选区）。
globalStyle('.sn-slash-hit', { background: HOVER, borderRadius: 2 })
