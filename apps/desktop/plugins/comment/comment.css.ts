/**
 * 评论卡片 + 顶栏入口 + 浮出按钮的样式（D-0172）。
 *
 * **同一份卡片，两种落法**：
 *   - 浮卡（正文那一栏够宽）：绝对定位在正文右侧的留白里，竖着跟被评论的那句话对齐；
 *   - 窄栏（栏宽不够）：退回主区右侧一列，卡片竖着排（`layer.tsx` 按 `layout.mode` 二选一）。
 *
 * ★ 卡片宽 260 / 与正文之间的缝 16 是**和编辑器共用的一组数**：那边
 *   `editor-prosemirror/comment.ts` 的 `COMMENT_CARD_W` / `COMMENT_GAP` 各有一份，
 *   它决定「够不够浮卡」和「正文让出多少留白」。改这里要一起改。
 * ★ 插件不许 import 外壳的样式，所以自己写一份 token 兜底。
 */
import { style } from '@vanilla-extract/css'
import * as motion from '../../src/ui/motion.css'
import { CARD_W, GAP } from './size'

/* ────────────────────────── 窄栏（栏宽不够时的退路） ────────────────────────── */

/** 槽宿主不给插件包壳，这一层就是主区右侧那一列本身。 */
export const dock = style([
  motion.fadeIn,
  {
    flex: `0 0 ${CARD_W}px`,
    width: CARD_W,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    padding: '0 12px',
    borderLeft: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
    background: 'var(--affine-v2-layer-background-primary)',
    // 暗色那档跟正文同一个画布色（D-0171）—— 这一列是正文的一部分，不该比正文深一截。
    selectors: { '[data-theme="dark"] &': { background: '#191919' } },
  },
])

export const stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: GAP,
  padding: '16px 0 24px',
  overflowY: 'auto',
})

/** 浮卡那一层（挂在编辑器的 `.sn-pane-float` 里）—— 只有卡片，没有别的壳。 */
export const float = style({ position: 'absolute', top: 0, right: 0, width: CARD_W })

/* ────────────────────────── 一张卡片 ────────────────────────── */

export const card = style({
  position: 'relative',
  boxSizing: 'border-box',
  // 窄栏那一列有 12 的内边距，卡片跟着那一列走；浮卡自己定宽（`cardFloat`）。
  width: '100%',
  padding: '10px 12px',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 8,
  background: 'var(--affine-v2-layer-background-secondary)',
  // 浮卡模式下这一层是 `pointer-events: none`（卡片那一层不该吃点击）—— 卡片自己得打开。
  pointerEvents: 'auto',
  selectors: {
    // 被「点一条评论」点到的：描一圈，让眼睛找得到。
    '&[data-flash="true"]': {
      borderColor: 'var(--affine-primary-color)',
      boxShadow: '0 0 0 1px var(--affine-primary-color)',
    },
  },
})

/** 浮卡模式下的卡片：自己就是绝对定位的那一个（`top` 由 `layer.tsx` 写）。 */
export const cardFloat = style([card, { position: 'absolute', right: 0, width: CARD_W }])

/** 回复：内缩一档、字号小一号。 */
export const reply = style({
  marginTop: 6,
  paddingTop: 6,
  borderTop: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  fontSize: 12,
})

export const head = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
  fontSize: 12,
  lineHeight: '18px',
})

/** 头像：一圆 + 名字首字。单人应用没有第二个人，用 `comment.me` 那个字就够。 */
export const avatar = style({
  flex: '0 0 18px',
  width: 18,
  height: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  background: 'var(--affine-primary-color)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  userSelect: 'none',
})

export const name = style({ color: 'var(--affine-v2-text-secondary)', fontWeight: 500 })

export const time = style({ color: 'var(--affine-v2-text-tertiary)' })

export const pageTag = style({
  marginLeft: 'auto',
  padding: '0 5px',
  borderRadius: 4,
  fontSize: 10,
  lineHeight: '15px',
  color: 'var(--affine-v2-text-tertiary)',
  background: 'var(--affine-v2-layer-background-tertiary)',
})

/** 引用原文。**只在窄栏里画** —— 浮卡就贴在原文旁边，再抄一遍是废话。 */
export const quoted = style({
  marginBottom: 4,
  padding: '2px 6px',
  borderLeft: '2px solid var(--affine-v2-block-comment-highlightUnderline)',
  borderRadius: 3,
  background: 'var(--affine-v2-block-comment-highlightDefault)',
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--affine-v2-text-secondary)',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
})

export const body = style({
  margin: 0,
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--affine-v2-text-primary)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  userSelect: 'text',
})

/** 卡片上的动作：**平时不显示**，鼠标进卡片才露（照 Notion）。 */
export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  marginTop: 2,
  opacity: 0,
  transition: 'opacity .12s',
  selectors: {
    [`${card}:hover &`]: { opacity: 1 },
    // 回复框开着的时候不能藏 —— 正在打字的人找不到「取消」。
    '&[data-on="1"]': { opacity: 1 },
    // 键盘走得到：焦点进得来就露出来。
    '&:focus-within': { opacity: 1 },
  },
})

export const action = style({
  height: 22,
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

/**
 * 卡片被推下去之后连回锚点的那根引线。
 *
 * ★ 从卡片左缘**往左**伸出 `-GAP` 再 24：伸进正文那条缝里，读起来才是「这张卡说的是那句话」。
 *   高度由 `layer.tsx` 写成内联（对齐锚点的 Y），这里只管长相。
 */
export const lead = style({
  position: 'absolute',
  right: '100%',
  width: 24 + GAP,
  height: 1,
  background: 'var(--affine-v2-layer-insideBorder-border)',
  pointerEvents: 'none',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: -2,
      width: 5,
      height: 5,
      borderRadius: '50%',
      background: 'var(--affine-v2-block-comment-highlightUnderline)',
    },
  },
})

/* ────────────────────────── 输入框（回复 / 编辑 / 页面级） ────────────────────────── */

export const inputRow = style({ display: 'flex', alignItems: 'flex-end', gap: 6 })

export const input = style({
  width: '100%',
  minHeight: 28,
  maxHeight: 160,
  padding: '4px 8px',
  border: '1px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 6,
  background: 'var(--affine-v2-layer-background-primary)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: '18px',
  resize: 'none',
  outline: 'none',
  selectors: {
    '&::placeholder': { color: 'var(--affine-v2-text-placeholder)' },
    '&:focus': { borderColor: 'var(--affine-primary-color)' },
  },
})

/** 页面级那张卡：只有一个输入框 + 一行提示，没有头像那行。 */
export const writeCard = style([card, { padding: '8px 10px' }])

export const writeCardFloat = style([cardFloat, { padding: '8px 10px' }])

export const hint = style({
  margin: '5px 0 0',
  fontSize: 11,
  color: 'var(--affine-v2-text-tertiary)',
})

export const empty = style({
  margin: 0,
  padding: '24px 8px',
  fontSize: 12,
  lineHeight: '18px',
  textAlign: 'center',
  color: 'var(--affine-v2-text-tertiary)',
})

export const error = style({
  margin: '8px 0',
  padding: '6px 8px',
  borderRadius: 6,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-primary)',
  background: 'var(--affine-v2-layer-background-error)',
})

/* ────────────────────────── 顶栏入口 ────────────────────────── */

/**
 * `doc.header` 那 44px 的一行由**外壳**出（高 + 底线），槽里注册的每一项就是这行里的一格。
 * 所以这一格只管自己那两颗按钮的尺寸，别撑满 —— 撑满会把面包屑挤没。
 */
export const entryBar = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  position: 'relative',
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

/** 「显示已解决」那颗 ▾ —— 只在评论层开着的时候露。 */
export const caretButton = style([
  iconButton,
  { width: 16, color: 'var(--affine-v2-icon-secondary)' },
])

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

export const menu = style({
  position: 'absolute',
  top: 32,
  right: 0,
  zIndex: 30,
  minWidth: 168,
  padding: 4,
  borderRadius: 8,
  background: 'var(--affine-v2-layer-background-primary)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  boxShadow: 'var(--affine-menu-shadow)',
})

export const menuRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 30,
  padding: '0 4px 0 8px',
  borderRadius: 4,
  color: 'var(--affine-v2-text-primary)',
})

/** 标签自己是个 button（`Switch` 也是 button，两个不能嵌套）。 */
export const menuLabel = style({
  flex: '1 1 auto',
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: { '&:hover': { color: 'var(--affine-primary-color)' } },
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
