/**
 * 外部文件那一页的样式。**只画结构和状态**（用户 2026-10-07：「不要装饰，不要没作用的」）：
 * 层级靠连接线，长短靠大小那一列，颜色一律走 `--affine-*` / `--affine-v2-*` token。
 */
import { style } from '@vanilla-extract/css'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

export const page = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  // 外壳的 `main` 是透的（正文纸面吃窗口磨砂）—— 这一页不是正文，自己补底色。
  background: 'var(--affine-v2-layer-background-primary)',
  selectors: { '[data-theme="dark"] &': { background: '#1c1c1c' } },
})

export const header = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  height: 52,
  padding: '0 20px',
})

export const title = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: 0,
  fontFamily: MONO,
  fontSize: 15,
  lineHeight: '22px',
  fontWeight: 600,
  color: 'var(--affine-v2-text-primary)',
})

export const hint = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

export const tool = style({
  flex: '0 0 auto',
  height: 30,
  padding: '0 10px',
  border: 'none',
  borderRadius: 6,
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: MONO,
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': { color: 'var(--affine-v2-text-primary)' },
    '&:disabled': { opacity: 0.45, cursor: 'default' },
  },
})

/** 「添加文件夹」是这一页的主要动作（一个根都没挂时它是唯一能做的事）。 */
export const toolPrimary = style({
  background: 'var(--affine-primary-color)',
  color: '#fff',
  selectors: { '&:hover': { color: '#fff' } },
})

export const body = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  borderTop: '1px solid var(--affine-v2-layer-background-secondary)',
})

/** 左边那棵树。底色压一档，跟右边的事实栏分开。 */
export const tree = style({
  flex: '0 0 380px',
  minHeight: 0,
  overflowY: 'auto',
  padding: '10px 6px 24px',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--affine-v2-layer-background-secondary)',
  borderRight: '1px solid var(--affine-v2-layer-background-hoverOverlay)',
})

/** 「新建 md」那一行：先说**建在哪**，再让填名字 —— 不然建完不知道进哪个文件夹了。 */
export const createBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: '0 8px 8px',
})

export const createWhere = style({
  flex: '0 0 auto',
  maxWidth: 140,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: MONO,
  fontSize: 11,
  color: 'var(--affine-v2-text-tertiary)',
})

export const input = style({
  flex: 1,
  minWidth: 0,
  padding: '4px 6px',
  border: 'none',
  borderRadius: 4,
  background: 'var(--affine-v2-layer-background-primary)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: MONO,
  fontSize: 12,
  outline: 'none',
  selectors: {
    '&::placeholder': { color: 'var(--affine-v2-text-tertiary)' },
    '&:focus': { boxShadow: '0 0 0 1px var(--affine-primary-color)' },
  },
})

export const row = style({
  display: 'flex',
  alignItems: 'center',
  minHeight: 24,
  padding: '0 8px',
  border: 'none',
  borderRadius: 3,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: MONO,
  fontSize: 12.5,
  lineHeight: '18px',
  textAlign: 'left',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const rowOn = style({ background: 'var(--affine-v2-layer-background-hoverOverlay)' })

/** `├─ `/`│  ` 这些连接线。**空白要留住**，所以 pre-wrap。 */
export const branch = style({
  color: 'var(--affine-v2-text-tertiary)',
  whiteSpace: 'pre',
})

export const dir = style({ color: 'var(--affine-primary-color)' })

export const fname = style({ whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' })

/** 右边的次要信息：文件是大小，根是它挂在哪儿。 */
export const meta = style({
  marginLeft: 'auto',
  paddingLeft: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--affine-v2-text-tertiary)',
  fontSize: 11,
})

/** 根行右端那颗「卸掉这个根」。平时不显，指到那行才出现。 */
export const kill = style({
  display: 'flex',
  alignItems: 'center',
  paddingLeft: 6,
  color: 'var(--affine-v2-text-tertiary)',
  opacity: 0,
  selectors: {
    [`${row}:hover &`]: { opacity: 1 },
    '&:hover': { color: 'var(--affine-error-color)' },
  },
})

export const pane = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
})

export const paneHead = style({
  flex: '0 0 auto',
  minHeight: 32,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
  overflow: 'hidden',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
  borderBottom: '1px solid var(--affine-v2-layer-background-secondary)',
})

export const panePath = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--affine-v2-text-secondary)',
})

/** 栏头右端那颗「打开」（双击也能开，但双击是看不见的手势）。 */
export const paneBtn = style({
  marginLeft: 'auto',
  flex: '0 0 auto',
  padding: '2px 10px',
  border: 'none',
  borderRadius: 4,
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-primary-color)',
  fontFamily: MONO,
  fontSize: 12,
  cursor: 'pointer',
})

/** 事实栏：左键右值。 */
export const facts = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  alignContent: 'start',
  gap: '6px 12px',
  margin: 0,
  padding: '12px 16px',
  fontFamily: MONO,
  fontSize: 12,
  lineHeight: '18px',
})

export const factKey = style({ color: 'var(--affine-v2-text-tertiary)' })

export const factVal = style({
  color: 'var(--affine-v2-text-secondary)',
  wordBreak: 'break-all',
})

export const error = style({
  margin: 0,
  padding: '6px 16px',
  fontFamily: MONO,
  fontSize: 12,
  color: 'var(--affine-error-color)',
  borderBottom: '1px solid var(--affine-v2-layer-background-secondary)',
})

/** 空态 / 说明 —— 灰字，不是错。 */
export const note = style({
  margin: 0,
  padding: '6px 8px',
  fontFamily: MONO,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-tertiary)',
})
