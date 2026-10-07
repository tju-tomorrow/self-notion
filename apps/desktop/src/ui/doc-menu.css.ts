/**
 * 文档行右键菜单的样子。数值照首页那个 ⋯ 浮层（`plugins/home/home.css.ts`）抄，
 * 免得同一个应用里两个菜单长得不一样。
 */
import { style } from '@vanilla-extract/css'

/** portal 到 body，所以坐标由 JS 给（`position: fixed`）—— 留在滚动容器里会被 overflow 裁掉。 */
export const menu = style({
  position: 'fixed',
  zIndex: 30,
  minWidth: 200,
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  borderRadius: 8,
  background: 'var(--affine-v2-layer-background-primary)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  boxShadow: 'var(--affine-menu-shadow)',
})

export const label = style({
  padding: '4px 8px 0',
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary)',
})

export const item = style({
  height: 28,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const itemIcon = style({ flex: '0 0 20px', display: 'flex' })

export const itemLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** 原地改名的输入框。外面那圈边框是「正在改」的唯一提示，别去掉。 */
export const renameInput = style({
  flex: 1,
  minWidth: 0,
  padding: '0 2px',
  border: '1px solid var(--affine-primary-color)',
  borderRadius: 3,
  background: 'var(--affine-v2-layer-background-primary)',
  color: 'var(--affine-v2-text-primary)',
  font: 'inherit',
})

/** 行右端那句小提示（标签行用它显示「已加上的标签」，空的就显示「添加标签」）。 */
export const itemHint = style({
  flex: '0 0 auto',
  marginLeft: 'auto',
  maxWidth: 112,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

/* ───────────────── 标签那一页（菜单里点「标签」进来，`src/ui/tags.tsx`） ───────────────── */

export const tagPanel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '4px 8px 6px',
})

export const tagChips = style({ display: 'flex', flexWrap: 'wrap', gap: 4 })

export const tagChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: '1px 2px 1px 6px',
  borderRadius: 4,
  fontSize: 12,
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-text-primary)',
})

export const tagChipX = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 14,
  height: 14,
  padding: 0,
  border: 'none',
  borderRadius: 3,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
      color: 'var(--affine-v2-text-primary)',
    },
  },
})

/** 输入框：整行宽，不用再跟谁抢宽度，占位提示想写多长写多长。 */
export const tagInput = style({
  width: '100%',
  height: 24,
  padding: '0 6px',
  appearance: 'none',
  border: '1px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 4,
  outline: 'none',
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-text-primary)',
  caretColor: 'var(--affine-primary-color)',
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: '22px',
  selectors: {
    '&::placeholder': { color: 'var(--affine-v2-text-secondary)' },
    '&:focus': { borderColor: 'var(--affine-primary-color)' },
  },
})

export const tagHint = style({ fontSize: 12, color: 'var(--affine-v2-text-tertiary)' })
