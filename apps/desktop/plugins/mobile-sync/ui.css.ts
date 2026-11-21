import { globalStyle, style } from '@vanilla-extract/css'

export const wrap = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  fontSize: 14,
  maxWidth: 520,
})

export const row = style({ display: 'flex', flexDirection: 'column', gap: 6 })

export const label = style({
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary, #777)',
})

export const value = style({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' })

export const code = style({
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 30,
  letterSpacing: 8,
  fontWeight: 600,
  lineHeight: 1.2,
})

export const url = style({
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 13,
  wordBreak: 'break-all',
})

export const btn = style({
  padding: '5px 10px',
  border: '1px solid var(--sn-line, rgba(0,0,0,.12))',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
})

export const note = style({
  fontSize: 12,
  lineHeight: 1.7,
  color: 'var(--affine-v2-text-secondary, #777)',
})

export const badge = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary, #777)',
})

export const dot = style({
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: '#2ecc71',
  display: 'inline-block',
})

export const dotOff = style({ background: '#bbb' })

/** 二维码：白底圆角容器，旁边是配对网址与提示。 */
export const pairBlock = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
})

export const qr = style({
  flex: '0 0 auto',
  padding: 10,
  background: '#fff',
  borderRadius: 12,
  lineHeight: 0,
})

// 注入的 svg 不认外部 class，按元素量尺寸。
globalStyle(`.${qr} svg`, {
  display: 'block',
  width: 160,
  height: 160,
  maxWidth: '100%',
})

export const pairInfo = style({
  flex: 1,
  minWidth: 200,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
})
