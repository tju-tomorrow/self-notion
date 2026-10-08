import { style } from '@vanilla-extract/css'

/** 两个按钮挨着排（`gap: 0`）—— 分开一点就看着像两颗不相干的图标了。 */
export const group = style({ display: 'flex', alignItems: 'center', gap: 0 })

export const button = style({
  flex: '0 0 28px',
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
    '&:hover:not(:disabled)': {
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
    },
    // 到头了（没得退/没得进）就点不动 —— 亮着却点了没反应是最糟的状态。
    '&:disabled': { opacity: 0.35, cursor: 'default' },
  },
})
