/**
 * 版本历史 —— 顶栏那颗入口图标 + 右侧滑出的时间线面板。
 *
 * 尺寸照 AFFiNE 的 `components/comment/sidebar/style.css.ts` 和它的 page-info 面板
 * （头 40 高、行内边距 8、字号 13/12），配色一律 `--affine-*` token。
 * ★ 插件不许 import 外壳的样式，所以自己写一份，不引 `src/shell/*.css.ts`。
 */
import { style } from '@vanilla-extract/css'

/* ────────────────────────── 顶栏那一格 ────────────────────────── */

/** 和评论那颗图标同一格（`doc.header.right`）—— 尺寸照抄，两颗挨着看才像一排。 */
export const entryBar = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
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
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const iconButtonOn = style({
  background: 'var(--affine-v2-layer-background-hoverOverlay)',
  color: 'var(--affine-primary-color)',
})

/* ────────────────────────── 面板（覆盖层，不走槽） ────────────────────────── */

/** 透明遮罩：只为「点外面关」。涂黑会把底下的编辑器糊死，而用户正要看它变没变。 */
export const overlay = style({
  position: 'fixed',
  inset: 0,
  zIndex: 900,
  display: 'flex',
  justifyContent: 'flex-end',
})

export const panel = style({
  width: 320,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  borderLeft: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  background: 'var(--affine-v2-layer-background-primary)',
  boxShadow: 'var(--affine-shadow-2)',
})

export const head = style({
  flex: '0 0 auto',
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 8px 0 16px',
})

export const headTitle = style({
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--affine-v2-text-secondary)',
})

export const list = style({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '0 8px 8px',
})

export const empty = style({
  margin: 0,
  padding: '32px 16px',
  fontSize: 13,
  lineHeight: '20px',
  textAlign: 'center',
  color: 'var(--affine-v2-text-tertiary)',
})

export const error = style({
  margin: '8px 4px',
  padding: '6px 8px',
  borderRadius: 6,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-primary)',
  background: 'var(--affine-v2-layer-background-error)',
})

export const foot = style({
  flex: '0 0 auto',
  padding: '8px 16px 12px',
  borderTop: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-tertiary)',
})

/* ────────────────────────── 时间线上的一行 ────────────────────────── */

export const row = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '8px',
  borderRadius: 6,
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

/** 时间线的那个点 —— 最新一个填实，其余的描边（「这条是最近的」一眼可见）。 */
export const dot = style({
  flex: '0 0 8px',
  width: 8,
  height: 8,
  marginTop: 6,
  borderRadius: 4,
  background: 'var(--affine-v2-layer-insideBorder-primary)',
})

export const dotLatest = style({ background: 'var(--affine-primary-color)' })

export const rowMain = style({ flex: '1 1 auto', minWidth: 0 })

export const rowTop = style({ display: 'flex', alignItems: 'center', gap: 6 })

export const time = style({
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--affine-v2-text-primary)',
})

export const badge = style({
  padding: '1px 5px',
  borderRadius: 4,
  background: 'var(--affine-v2-layer-background-secondary)',
  fontSize: 11,
  lineHeight: '15px',
  color: 'var(--affine-v2-text-secondary)',
})

export const label = style({
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-tertiary)',
  wordBreak: 'break-word',
})

export const restore = style({
  flex: '0 0 auto',
  height: 24,
  padding: '0 8px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  opacity: 0.6,
  selectors: {
    '&:hover': {
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
      color: 'var(--affine-primary-color)',
      opacity: 1,
    },
    '&:disabled': { cursor: 'default', opacity: 0.4 },
  },
})
