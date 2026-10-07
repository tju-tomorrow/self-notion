/**
 * ⌘K 面板的样式。大小写照 AFFiNE 的 `modules/quicksearch/views/{modal,cmdk}.css.ts`
 * 与它的文档搜索页（分组标题 12px、结果行圆角 4），面板本身改成「左列表 + 右预览」的宽版。
 *
 * ★ `var(--affine-v2-*)` 的大小写照抄（`layer/insideBorder/border` →
 *   `--affine-v2-layer-insideBorder-border`）。写错一个字母 → `var()` 落空 →
 *   **整条声明作废**（不是回退到初值）。
 */
import { style } from '@vanilla-extract/css'
import * as motion from '../../src/ui/motion.css'

/** 遮罩。AFFiNE 用 `backgroundModalColor`（0.7 黑）—— 太实会把底下的编辑器糊死，
 *  所以压到 0.45 再开一点毛玻璃（任务里允许的那条退路）。 */
export const overlay = style([
  motion.fadeIn,
  {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '9vh 24px 24px',
    background: 'rgba(0, 0, 0, 0.45)',
    backdropFilter: 'blur(4px)',
  },
])

/** 面板：左列表 + 右预览（照 AFFiNE 搜索页）。高度定死一档，切结果时面板不跳。 */
export const panel = style([
  motion.riseIn,
  {
    width: 'min(1080px, calc(100vw - 48px))',
    height: 'min(720px, 78vh)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 12,
    background: 'var(--affine-v2-layer-background-overlayPanel)',
    color: 'var(--affine-v2-text-primary)',
    boxShadow: 'var(--affine-shadow-2)',
  },
])

/** 输入行：44 高、不带边框、下缘一条内描边。图标槽跟 AFFiNE 的 `itemIcon` 同一档色。 */
export const inputRow = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  height: 44,
  padding: '0 16px',
  color: 'var(--affine-v2-icon-secondary)',
  borderBottom: '1px solid var(--affine-v2-layer-insideBorder-border)',
})

export const input = style({
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  font: 'inherit',
  fontSize: 16,
  color: 'var(--affine-v2-text-primary)',
  selectors: { '&::placeholder': { color: 'var(--affine-v2-text-tertiary)' } },
})

/** 输入行与下面两栏之间的分界；两栏自己排（`body`）。 */
export const body = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
})

export const list = style({
  flex: 1,
  minWidth: 0,
  overflowY: 'auto',
  padding: '8px 6px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
})

/** 右侧预览：一张内嵌的卡片（截图里它比列表低一层底色、带圆角）。 */
export const preview = style({
  flex: '0 0 380px',
  minWidth: 0,
  overflowY: 'auto',
  margin: 8,
  padding: '16px 18px',
  borderRadius: 8,
  border: '1px solid var(--affine-v2-layer-insideBorder-border)',
  background: 'var(--affine-v2-layer-background-secondary)',
})

export const previewTitle = style({
  fontSize: 20,
  fontWeight: 600,
  lineHeight: '1.4',
  marginBottom: 10,
})

export const previewBody = style({
  fontSize: 13,
  lineHeight: '1.8',
  color: 'var(--affine-v2-text-primary)',
})

export const previewEmpty = style({
  fontSize: 13,
  color: 'var(--affine-v2-text-tertiary)',
})

/* 预览里那几行文字的类型 —— 只认行首那一个记号，见 group.ts 的 mdBlocks。 */
export const mdH = style({
  fontSize: 15,
  fontWeight: 600,
  lineHeight: '1.5',
  margin: '12px 0 6px',
})

export const mdP = style({ marginBottom: 8, whiteSpace: 'pre-wrap' })

export const mdLi = style({
  marginBottom: 4,
  paddingLeft: 14,
  selectors: { '&::before': { content: '"•"', marginRight: 6, marginLeft: -14 } },
})

export const mdQuote = style({
  marginBottom: 8,
  paddingLeft: 10,
  borderLeft: '2px solid var(--affine-v2-layer-insideBorder-border)',
  color: 'var(--affine-v2-text-secondary)',
})

export const mdCode = style({
  fontFamily: 'var(--affine-font-code-family, monospace)',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
})

/** AFFiNE 的 `[cmdk-group-heading]`：12px / 600。 */
export const group = style({
  padding: '8px 12px 4px',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: '1.67',
  color: 'var(--affine-v2-text-tertiary)',
})

/** AFFiNE 的 `[cmdk-item]`：圆角 4、图标 20。选中**只换底色**（悬停即选中，见 index.ts）。 */
export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 36,
  padding: '6px 12px',
  borderRadius: 4,
  fontSize: 14,
  color: 'var(--affine-v2-text-primary)',
  cursor: 'default',
  userSelect: 'none',
})

export const rowOn = style({ background: 'var(--affine-v2-layer-background-hoverOverlay)' })

export const rowIcon = style({
  flex: '0 0 20px',
  width: 20,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--affine-v2-icon-secondary)',
})

export const rowMain = style({ flex: 1, minWidth: 0 })

/** 标题一行（标题 + 祖先路径）、命中正文一行，都截断。 */
export const rowTitle = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: 2,
  minWidth: 0,
})

/** 标题让位给路径：挤的时候先截标题，路径那截灰字信息量更大。 */
export const rowName = style({
  flex: '0 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

export const rowPath = style({
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

export const rowHint = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary)',
})

/** 命中高亮。AFFiNE 的 `highlightKeyword` 走主题色，这里要的是"被搜到的词"，
 *  用 highlight 那一档 —— 深浅色各有一份值，不会在白底上糊成一片。 */
export const mark = style({
  background: 'var(--affine-text-highlight-yellow)',
  color: 'inherit',
  borderRadius: 2,
  padding: '0 1px',
})

export const empty = style({ padding: '16px 12px', fontSize: 13, color: 'var(--affine-v2-text-secondary)' })

/** 底部提示行。与内容之间一条内描边（AFFiNE 的 `insideBorder`）。 */
export const footer = style({
  flex: '0 0 auto',
  padding: '8px 16px',
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
  borderTop: '1px solid var(--affine-v2-layer-insideBorder-border)',
})
