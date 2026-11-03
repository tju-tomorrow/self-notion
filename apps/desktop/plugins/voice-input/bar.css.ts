/**
 * 语音条（D-0190）。形态照 Codex 那种底部输入条：玻璃、圆角、不挡正文。
 * 颜色只走 `--affine-*` token（插件不 import 外壳的样式）。
 */
import { keyframes, style } from '@vanilla-extract/css'

const rise = keyframes({
  from: { opacity: 0, transform: 'translate(-50%, 10px) scale(.985)' },
  to: { opacity: 1, transform: 'translate(-50%, 0) scale(1)' },
})

const spin = keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
})

/** 空闲态：右下角一颗低对比麦克风。刻意不放在正文中间。 */
export const mic = style({
  position: 'fixed',
  right: 22,
  bottom: 18,
  zIndex: 950,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  padding: 0,
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 18,
  background: 'color-mix(in srgb, var(--affine-v2-layer-background-secondary) 82%, transparent)',
  color: 'var(--affine-v2-text-secondary)',
  boxShadow: '0 4px 14px rgba(0, 0, 0, .10)',
  backdropFilter: 'blur(18px)',
  cursor: 'pointer',
  opacity: 0.45,
  transition: 'opacity .18s ease, transform .18s ease',
  selectors: {
    '&:hover': { opacity: 0.95, transform: 'translateY(-1px)' },
  },
})

export const bar = style({
  position: 'fixed',
  left: '50%',
  bottom: 22,
  zIndex: 950,
  width: 'min(720px, calc(100vw - 120px))',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 14px 9px',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 20,
  background: 'color-mix(in srgb, var(--affine-v2-layer-background-secondary) 88%, transparent)',
  boxShadow: '0 18px 50px rgba(0, 0, 0, .18), 0 2px 10px rgba(0, 0, 0, .08)',
  backdropFilter: 'blur(26px) saturate(1.35)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  animation: `${rise} .18s ease-out`,
})

export const top = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
})

/** 录音中的那排竖条 —— 亮度跟真实输入电平走，不做假动画。 */
export const wave = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  width: 26,
  height: 24,
  paddingTop: 1,
})

export const waveBar = style({
  width: 2.5,
  height: 18,
  borderRadius: 2,
  background: 'var(--affine-primary-color)',
  transformOrigin: 'center',
  transition: 'transform .12s ease-out',
})

/** 草稿态：不再录音，就别再闪红点。 */
export const dotIdle = style({
  flex: '0 0 auto',
  width: 7,
  height: 7,
  marginTop: 8,
  borderRadius: 4,
  background: 'var(--affine-v2-text-tertiary)',
  opacity: 0.5,
})

export const draft = style({
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 24,
  maxHeight: 168,
  padding: '2px 0',
  border: 'none',
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 15,
  lineHeight: 1.55,
  selectors: {
    '&::placeholder': { color: 'var(--affine-v2-text-tertiary)' },
  },
})

export const actions = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  paddingTop: 1,
})

export const iconButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  padding: 0,
  border: 'none',
  borderRadius: 15,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
  },
})

export const stopButton = style([
  iconButton,
  {
    background: 'var(--affine-v2-text-primary)',
    color: 'var(--affine-v2-layer-background-secondary)',
    selectors: {
      '&:hover': { background: 'var(--affine-v2-text-primary)', opacity: 0.85 },
    },
  },
])

export const primary = style({
  height: 30,
  padding: '0 13px',
  border: 'none',
  borderRadius: 15,
  background: 'var(--affine-primary-color)',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1,
  cursor: 'pointer',
  selectors: {
    '&:disabled': { opacity: 0.38, cursor: 'default' },
  },
})

export const lang = style({
  height: 26,
  padding: '0 10px',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 13,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
  selectors: {
    '&:disabled': { opacity: 0.45, cursor: 'default' },
    '&:hover:not(:disabled)': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
  },
})

export const status = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 2px',
  minHeight: 14,
  color: 'var(--affine-v2-text-tertiary)',
  fontSize: 11.5,
  lineHeight: '14px',
})

export const errorText = style({ color: '#d05050' })

export const spinner = style({
  display: 'inline-block',
  width: 11,
  height: 11,
  marginRight: 6,
  border: '1.5px solid var(--affine-v2-layer-background-hoverOverlay)',
  borderTopColor: 'var(--affine-primary-color)',
  borderRadius: 6,
  animation: `${spin} .8s linear infinite`,
  verticalAlign: '-1px',
})

export const download = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '2px 2px 0',
})

export const downloadTitle = style({ fontSize: 13.5, fontWeight: 500 })

export const downloadDesc = style({
  color: 'var(--affine-v2-text-tertiary)',
  fontSize: 12,
})

export const track = style({
  height: 4,
  borderRadius: 2,
  background: 'var(--affine-v2-layer-background-hoverOverlay)',
  overflow: 'hidden',
})

export const fill = style({
  height: '100%',
  borderRadius: 2,
  background: 'var(--affine-primary-color)',
  transition: 'width .2s linear',
})
