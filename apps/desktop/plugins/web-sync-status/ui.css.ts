import { style } from '@vanilla-extract/css'

export const wrap = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  fontSize: 14,
  maxWidth: 520,
})

export const row = style({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 16,
})

export const label = style({ fontSize: 12, color: 'var(--affine-v2-text-secondary, #777)' })

export const value = style({ fontSize: 13, wordBreak: 'break-all', textAlign: 'right' })

export const status = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary, #777)',
})

export const hint = style({
  fontSize: 12,
  lineHeight: 1.6,
  color: 'var(--affine-v2-text-secondary, #777)',
})

export const dotBtn = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 6px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
})

export const dotLabel = style({ whiteSpace: 'nowrap' })

export const btn = style({
  alignSelf: 'flex-start',
  padding: '6px 14px',
  border: '1px solid var(--sn-line, rgba(0,0,0,.12))',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  ':disabled': { opacity: 0.5, cursor: 'not-allowed' },
})

export const dot = style({
  width: 7,
  height: 7,
  borderRadius: '50%',
  display: 'inline-block',
  flexShrink: 0,
  background: '#bbb',
})

export const dotOk = style({ background: '#2ecc71' })
export const dotSyncing = style({ background: '#f5a623' })
export const dotError = style({ background: '#e5484d' })
export const dotOff = style({ background: '#bbb' })
