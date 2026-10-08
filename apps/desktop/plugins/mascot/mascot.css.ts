/** 侧栏底部那格宠物 + 设置页里换形象那一段的样式。气泡是**浮**在上面的（绝对定位）——
 *  放文档流里的话，冒一句话会把上面那截可滚区顶矮 26 像素，整条侧栏跟着跳。 */
import { keyframes, style } from '@vanilla-extract/css'

/** 冒出来时往上弹一下，收尾带一点过冲 —— 像素小人从下面蹦上来的感觉就靠它。 */
const pop = keyframes({
  '0%': { transform: 'translateY(10px) scale(0.7)', opacity: 0 },
  '60%': { transform: 'translateY(-2px) scale(1.06)', opacity: 1 },
  '100%': { transform: 'translateY(0) scale(1)', opacity: 1 },
})

export const foot = style({ position: 'relative', flex: '0 0 auto', padding: '2px 10px 12px' })

/** 点上会说话的小人。**只有它自己**，不套药丸底、不带名字（用户：「也不用那个背景，
 *  就展示那个宠物就可以」）—— 所以宽度收到内容大小，别用一个整行的隐形按钮骗手感。 */
export const stage = style({
  display: 'inline-flex',
  alignItems: 'center',
  padding: 4,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  selectors: { '&:active': { transform: 'scale(0.97)' } },
})

export const canvas = style({
  display: 'block',
  // 不做这行，放大后的方块之间会有缝
  imageRendering: 'pixelated',
  animation: `${pop} 460ms cubic-bezier(0.34, 1.56, 0.64, 1) both`,
})

export const bubble = style({
  position: 'absolute',
  left: 10,
  right: 10,
  bottom: 'calc(100% - 4px)',
  zIndex: 5,
  padding: '5px 9px',
  borderRadius: 10,
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--affine-v2-text-primary)',
  background: 'var(--affine-v2-layer-background-primary)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.18)',
  animation: `${pop} 240ms ease-out both`,
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
