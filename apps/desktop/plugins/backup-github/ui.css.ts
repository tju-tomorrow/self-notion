/** 联网动作（拉仓库列表）的转圈。网络往返期间**必须有反馈** —— 面板空着不动，看着就是卡死。 */
import { keyframes, style } from '@vanilla-extract/css'

const spin = keyframes({ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } })

export const spinner = style({
  display: 'inline-block',
  width: 12,
  height: 12,
  border: '2px solid var(--affine-v2-text-secondary, rgba(255, 255, 255, .3))',
  borderTopColor: 'var(--affine-primary-color, #1e96eb)',
  borderRadius: '50%',
  animation: `${spin} .7s linear infinite`,
})

export const loading = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary)',
})
