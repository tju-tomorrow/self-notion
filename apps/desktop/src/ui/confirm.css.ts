/**
 * 确认框的样式（D-0070）。跟设置页同一套口径：低饱和、圆角大一点、
 * 颜色尽量走 `--affine-*`（跟着主题亮暗走），拿不到时给兜底值 —— 别让整条声明废掉。
 */
import { globalStyle, style } from '@vanilla-extract/css'
import * as motion from './motion.css'

globalStyle('.sn-confirm-scrim', { zIndex: 1000 })

export const scrim = style([
  motion.fadeIn,
  {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--affine-v2-layer-background-modal, rgba(0,0,0,.35))',
    backdropFilter: 'blur(2px)',
  },
])

export const card = style([
  motion.riseIn,
  {
    width: 340,
    maxWidth: 'calc(100vw - 48px)',
    padding: 20,
    borderRadius: 14,
    background: 'var(--affine-v2-layer-background-overlayPanel, #2a2a2a)',
    border: '1px solid var(--affine-v2-layer-insideBorder-border, rgba(255,255,255,.1))',
    boxShadow: 'var(--affine-overlay-shadow, 0 12px 32px rgba(0,0,0,.4))',
    color: 'var(--affine-v2-text-primary)',
  },
])

export const title = style({
  margin: 0,
  fontSize: 15,
  fontWeight: 600,
  lineHeight: '22px',
})

export const body = style({
  margin: '8px 0 0',
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--affine-v2-text-secondary)',
})

export const actions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 20,
})

const button = style({
  height: 30,
  padding: '0 14px',
  border: 'none',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
})

export const ghost = style([
  button,
  {
    background: 'transparent',
    color: 'var(--affine-v2-text-secondary)',
    selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
  },
])

export const primary = style([
  button,
  {
    background: 'var(--affine-primary-color, #1e96eb)',
    color: '#fff',
    selectors: { '&:hover': { filter: 'brightness(1.08)' } },
  },
])

/** 危险动作：确定键红底 —— 删除类操作要一眼看出来是它。 */
export const danger = style({
  background: '#e5484d',
})
