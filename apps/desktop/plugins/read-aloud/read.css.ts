import { style } from '@vanilla-extract/css'

export const bar = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  paddingRight: 4,
})

export const iconButton = style({
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-icon-primary)',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    '&:disabled': { opacity: 0.35, cursor: 'default' },
  },
})

export const nameButton = style({
  height: 28,
  maxWidth: 96,
  padding: '0 6px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    '&:disabled': { opacity: 0.35, cursor: 'default' },
  },
})

export const menu = style({
  position: 'fixed',
  zIndex: 80,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  width: 240,
  padding: 6,
  border: '0.5px solid var(--sn-line, rgba(0, 0, 0, .1))',
  borderRadius: 8,
  background: 'var(--sn-panel, #fff)',
  boxShadow: 'var(--affine-popover-shadow, 0 4px 16px rgba(0, 0, 0, .16))',
})

export const find = style({
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  height: 28,
  margin: 0,
  padding: '0 8px',
  border: 'none',
  borderRadius: 6,
  background: 'var(--affine-v2-layer-background-hoverOverlay)',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  outline: 'none',
  selectors: {
    '&::placeholder': { color: 'var(--affine-v2-text-tertiary)' },
  },
})

export const list = style({
  maxHeight: 'min(280px, calc(100vh - 168px))',
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
})

export const group = style({
  padding: '8px 8px 2px',
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--affine-v2-text-tertiary)',
  selectors: {
    'div:first-child > &': { paddingTop: 4 },
  },
})

export const row = style({
  boxSizing: 'border-box',
  width: '100%',
  margin: 0,
  padding: '5px 8px',
  display: 'flex',
  alignItems: 'baseline',
  gap: 12,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  cursor: 'pointer',
  textAlign: 'left',
  selectors: {
    '&:hover, &[data-cursor="true"]': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
  },
})

export const rowName = style({
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: {
    '[data-on="true"] &': { color: 'var(--sn-accent, #1e96eb)' },
  },
})

export const rowHint = style({
  flex: '0 0 auto',
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--affine-v2-text-tertiary)',
})

export const empty = style({
  padding: '12px 8px',
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

export const label = style({
  padding: '2px 8px 0',
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--affine-v2-text-tertiary)',
})

export const chips = style({
  display: 'flex',
  gap: 2,
  padding: '0 2px',
})

export const chip = style({
  flex: '1 1 0',
  minWidth: 0,
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: 'var(--sn-hover, rgba(0, 0, 0, .06))' },
    '&[data-on="true"]': {
      background: 'var(--sn-hover, rgba(0, 0, 0, .06))',
      color: 'var(--sn-accent, #1e96eb)',
    },
  },
})
