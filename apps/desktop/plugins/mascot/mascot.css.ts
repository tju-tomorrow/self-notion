/** 宠物画布 + 设置页里换形象那一段的样式。 */
import { keyframes, style } from '@vanilla-extract/css'

/** 冒出来时往上弹一下，收尾带一点过冲。 */
const pop = keyframes({
  '0%': { transform: 'translateY(10px) scale(0.7)', opacity: 0 },
  '60%': { transform: 'translateY(-2px) scale(1.06)', opacity: 1 },
  '100%': { transform: 'translateY(0) scale(1)', opacity: 1 },
})

export const canvas = style({
  display: 'block',
  // 不做这行，放大后的方块之间会有缝
  imageRendering: 'pixelated',
  animation: `${pop} 460ms cubic-bezier(0.34, 1.56, 0.64, 1) both`,
})

/* ── 设置页那一段 ── */

export const section = style({ display: 'flex', flexDirection: 'column', gap: 22 })

export const choices = style({ display: 'flex', flexWrap: 'wrap', gap: 6 })

export const choice = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px 4px 4px',
  border: '1px solid transparent',
  borderRadius: 10,
  background: 'var(--affine-v2-layer-background-secondary, rgba(0, 0, 0, 0.04))',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover': { borderColor: 'var(--affine-v2-layer-insideBorder-border)' },
  },
})

export const choiceOn = style({
  borderColor: 'var(--affine-primary-color, #1e96eb)',
  background: 'color-mix(in srgb, var(--affine-primary-color, #1e96eb) 12%, transparent)',
})

export const choiceCanvas = style({
  display: 'block',
  imageRendering: 'pixelated',
})

export const choiceName = style({
  fontSize: 12,
  color: 'var(--affine-v2-text-primary)',
})
