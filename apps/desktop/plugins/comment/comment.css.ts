/**
 * 评论面板 + 顶栏入口 + 浮出按钮的样式。
 *
 * 尺寸照 AFFiNE 的 `components/comment/sidebar/style.css.ts`（头 40 高、条目 12 内边距、
 * 间隙 8、行 28、字号 fontSm/fontXs），配色一律 `--affine-*` token。
 * ★ 插件不许 import 外壳的样式，所以这里自己写一份，不引 `src/shell/*.css.ts`。
 */
import { style } from '@vanilla-extract/css'
import * as motion from '../../src/ui/motion.css'

/* ────────────────────────── 面板（`doc.aside` 那一列） ────────────────────────── */

/** 槽宿主不给插件包壳，这一层就是主区右侧那一列本身。 */
export const panel = style([
  motion.fadeIn,
  {
    flex: '0 0 320px',
    width: 320,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    borderLeft: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
    background: 'var(--affine-v2-layer-background-primary)',
  },
])

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
  padding: '0 8px',
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

export const divider = style({
  height: 0.5,
  margin: '8px 4px',
  background: 'var(--affine-v2-layer-insideBorder-border)',
})

export const resolvedToggle = style({
  width: '100%',
  height: 28,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 8px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const caret = style({ flex: '0 0 14px', display: 'flex', transition: 'transform .12s' })

export const caretOpen = style({ transform: 'rotate(180deg)' })

/* ────────────────────────── 一条评论 ────────────────────────── */

export const item = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 12,
  fontSize: 14,
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    // 被「打开面板定位到某条」点到的：闪一下，让眼睛找得到。
    '&[data-flash="true"]': {
      background: 'var(--affine-v2-block-comment-hanelActive)',
      boxShadow: 'inset 2px 0 0 var(--affine-v2-layer-insideBorder-primary)',
    },
  },
})

/** 回复：内缩 24，字号小一档（`body` 跟着 `inherit` 走）。 */
export const replyItem = style([item, { paddingLeft: 24, fontSize: 13 }])

/** 引用原文：两行截断，左边一道高亮条 —— 和正文里那条高亮同一种颜色。 */
export const pageTag = style({
  alignSelf: 'flex-start',
  padding: '0 6px',
  borderRadius: 4,
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--affine-v2-text-tertiary)',
  background: 'var(--affine-v2-layer-background-secondary)',
})

export const quoted = style({
  padding: '3px 8px',
  borderRadius: 4,
  borderLeft: '2px solid var(--affine-v2-block-comment-highlightUnderline)',
  background: 'var(--affine-v2-block-comment-highlightDefault)',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-secondary)',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
})

export const body = style({
  margin: 0,
  fontSize: 'inherit',
  lineHeight: '22px',
  color: 'var(--affine-v2-text-primary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  userSelect: 'text',
})

export const meta = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: '0.86em',
  color: 'var(--affine-v2-text-tertiary)',
})

export const metaName = style({ fontWeight: 500, color: 'var(--affine-v2-text-secondary)' })

export const actions = style({ display: 'flex', alignItems: 'center', gap: 2, marginTop: 2 })

export const action = style({
  height: 24,
  padding: '0 6px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
      color: 'var(--affine-v2-text-primary)',
    },
  },
})

/** 回复框挂在被回复那条的下面（`paddingLeft` 跟着回复的缩进）。 */
export const replyBox = style({ paddingLeft: 24, marginTop: 2 })

/* ────────────────────────── 底部输入框 + 回复框 ────────────────────────── */

export const foot = style({
  flex: '0 0 auto',
  padding: '8px 12px 12px',
  borderTop: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
})

export const input = style({
  width: '100%',
  minHeight: 30,
  maxHeight: 160,
  padding: '5px 8px',
  border: '1px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  resize: 'none',
  outline: 'none',
  selectors: {
    '&::placeholder': { color: 'var(--affine-v2-text-placeholder)' },
    '&:focus': { borderColor: 'var(--affine-primary-color)' },
  },
})

export const inputRow = style({ display: 'flex', alignItems: 'flex-end', gap: 6 })

export const hint = style({
  margin: '6px 0 0',
  fontSize: 11,
  color: 'var(--affine-v2-text-tertiary)',
})

/* ────────────────────────── 顶栏入口 ────────────────────────── */

/**
 * `doc.header` 那 44px 的一行由**外壳**出（高 + 底线），槽里注册的每一项就是这行里的一格。
 * 所以这一格只管自己那一颗按钮的尺寸，别撑满 —— 撑满会把面包屑挤没。
 */
export const entryBar = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  // 这一格在整行的最右端，离窗口边只留一点（`doc.header` 那格的 16px 在它左边）
  paddingRight: 4,
})

export const iconButton = style({
  position: 'relative',
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

export const badge = style({
  position: 'absolute',
  top: 1,
  right: 1,
  minWidth: 14,
  height: 14,
  padding: '0 3px',
  borderRadius: 7,
  background: 'var(--affine-primary-color)',
  color: '#fff',
  fontSize: 9,
  lineHeight: '14px',
  fontWeight: 600,
  textAlign: 'center',
})

/* ────────────────────────── 浮出的「评论」 ────────────────────────── */

export const bubble = style({
  position: 'fixed',
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 30,
  padding: '0 10px',
  border: 'none',
  borderRadius: 6,
  background: 'var(--affine-v2-layer-background-primary)',
  boxShadow: 'var(--affine-menu-shadow)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})
