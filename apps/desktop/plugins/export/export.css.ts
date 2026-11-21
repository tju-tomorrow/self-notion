import { style } from '@vanilla-extract/css'

export const wrap = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  fontSize: 14,
  maxWidth: 520,
})

export const row = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
})

export const title = style({ fontSize: 14, color: 'var(--affine-v2-text-primary, #222)' })

export const hint = style({
  marginTop: 4,
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary, #777)',
})

export const btn = style({
  padding: '6px 14px',
  border: '1px solid var(--sn-line, rgba(0,0,0,.12))',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  ':disabled': { opacity: 0.5, cursor: 'not-allowed' },
})

export const error = style({ fontSize: 12, color: '#e5484d' })
