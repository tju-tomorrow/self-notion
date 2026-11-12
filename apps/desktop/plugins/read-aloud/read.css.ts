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
  padding: '0 6px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    '&:disabled': { opacity: 0.35, cursor: 'default' },
  },
})

export const menu = style({
  position: 'fixed',
  zIndex: 80,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: 220,
  padding: 8,
  border: '0.5px solid var(--sn-line, rgba(0, 0, 0, .1))',
  borderRadius: 8,
  background: 'var(--sn-panel, #fff)',
  boxShadow: '0 6px 24px rgba(0, 0, 0, .16)',
})

export const label = style({
  fontSize: 11,
  color: 'var(--affine-v2-text-tertiary)',
})

export const chips = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
})

export const chip = style({
  height: 26,
  padding: '0 8px',
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
