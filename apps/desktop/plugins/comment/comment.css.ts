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
import { style, type CSSProperties } from '@vanilla-extract/css'
import * as motion from '../../src/ui/motion.css'
import { CARD_W, GAP } from './size'

/* 手机规则双匹配：宽度断点 + 外壳标记；UA 命中的 iPad / 横屏只有后者认得出。 */
const MOBILE_MEDIA = '(max-width: 720px)'
const M_HTML = 'html[data-mobile="1"] &'
const M_SHELL = '[data-sn-shell][data-mobile="1"] &'

const dockSheet: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 'calc(env(safe-area-inset-bottom) + var(--sn-keyboard-inset, 0px))',
  width: '100%',
  height: 'auto',
  flex: 'none',
  maxHeight: '60dvh',
  zIndex: 400,
  borderRadius: '16px 16px 0 0',
  borderLeft: 'none',
  borderTop: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  boxShadow: '0 -8px 30px rgba(0, 0, 0, .18)',
  // portal 到 body 后拿不到外壳那层设的界面字体
  fontFamily: 'var(--affine-font-family, Inter, "PingFang SC", system-ui, sans-serif)',
}

const stackSheet: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overscrollBehavior: 'contain',
  paddingTop: 8,
}

const hit40: CSSProperties = { width: 40, height: 40 }
const bubble40: CSSProperties = { height: 40 }

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
    selectors: {
      '[data-theme="dark"] &': { background: '#191919' },
      [M_HTML]: dockSheet,
      [M_SHELL]: dockSheet,
    },
    '@media': { [MOBILE_MEDIA]: dockSheet },
  },
])

/** 外壳还没往 <html> 写标记时，JS 判定命中靠这一颗兜底。 */
export const dockSheetOn = style(dockSheet)

export const stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: GAP,
  padding: '16px 0 24px',
  overflowY: 'auto',
  selectors: { [M_HTML]: stackSheet, [M_SHELL]: stackSheet },
  '@media': { [MOBILE_MEDIA]: stackSheet },
})

export const stackSheetOn = style(stackSheet)

/** 浮卡那一层（挂在编辑器的 `.sn-pane-float` 里）—— 只有卡片，没有别的壳。 */
export const float = style({ position: 'absolute', top: 0, right: 0, width: CARD_W })

/* ────────────────────────── 一张卡片 ────────────────────────── */

export const card = style({
  position: 'relative',
  boxSizing: 'border-box',
  width: '100%',
  padding: '8px 10px',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 10,
  background: 'var(--affine-v2-layer-background-secondary)',
  // 浮卡那一层是 `pointer-events: none` —— 卡片自己得打开。
  pointerEvents: 'auto',
})

/** 浮卡摆位。长相在 `card` / `chip` 上，这一份只负责绝对定位（`top` 由 `layer.tsx` 写）。 */
export const floatPos = style({ position: 'absolute', right: 0, width: CARD_W })

/** 收起时的一行。正文本身就是这条和那条的区别，不再画头像和名字。 */
export const chip = style({
  position: 'relative',
  boxSizing: 'border-box',
  width: '100%',
  height: 32,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 10px',
  border: 'none',
  borderRadius: 8,
  appearance: 'none',
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: '18px',
  textAlign: 'left',
  cursor: 'pointer',
  pointerEvents: 'auto',
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-tertiary)' },
  },
})

export const chipText = style({
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** 回复：内缩一档、字号小一号。 */
export const reply = style({
  marginTop: 6,
  paddingTop: 6,
  borderTop: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  fontSize: 12,
})

export const foot = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 4,
})

export const time = style({ color: 'var(--affine-v2-text-tertiary)', fontSize: 12, flex: '0 0 auto' })

/** 时间就是收起按钮 —— 单人没有第二个人，不需要头像和名字。 */
export const timeBtn = style([
  time,
  {
    padding: 0,
    border: 'none',
    appearance: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    cursor: 'pointer',
    selectors: { '&:hover': { color: 'var(--affine-v2-text-primary)' } },
  },
])

export const pageTag = style({
  padding: '0 5px',
  borderRadius: 4,
  fontSize: 10,
  lineHeight: '15px',
  color: 'var(--affine-v2-text-tertiary)',
  background: 'var(--affine-v2-layer-background-tertiary)',
})

/** 窄栏里卡片不贴着原文，留一行原文让人知道在说哪句。浮卡不画。 */
export const quoted = style({
  marginBottom: 4,
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--affine-v2-text-tertiary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
  marginLeft: 'auto',
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
  display: 'block',
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  minHeight: 32,
  maxHeight: 160,
  padding: '6px 10px',
  border: 'none',
  borderRadius: 8,
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
  lineHeight: '18px',
  resize: 'none',
  outline: 'none',
  selectors: {
    '&::placeholder': { color: 'var(--affine-v2-text-placeholder)' },
    '&:focus': { background: 'var(--affine-v2-layer-background-tertiary)' },
  },
})

/** 页面级那张、以及还没写完的草稿：就是一条输入，不再套一张带框的卡。 */
export const writeCard = style({
  position: 'relative',
  boxSizing: 'border-box',
  width: '100%',
  pointerEvents: 'auto',
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
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    [M_HTML]: hit40,
    [M_SHELL]: hit40,
  },
  '@media': { [MOBILE_MEDIA]: hit40 },
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
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    [M_HTML]: bubble40,
    [M_SHELL]: bubble40,
  },
  '@media': { [MOBILE_MEDIA]: bubble40 },
})

/* ────────────────────────── 手机 sheet 顶上那一条 ────────────────────────── */

/** 桌面窄栏顶部那颗收起——和顶栏评论图标再点一次同一条路（`closePanel`）。 */
export const dockBar = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  height: 40,
})

export const dockClose = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--affine-v2-text-tertiary)',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      color: 'var(--affine-v2-text-primary)',
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
    },
  },
})

export const sheetBar = style({
  flex: '0 0 auto',
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  height: 44,
  padding: '0 4px',
})

export const sheetGrip = style({
  position: 'absolute',
  top: 6,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 36,
  height: 4,
  borderRadius: 2,
  background: 'var(--affine-v2-layer-insideBorder-border)',
  pointerEvents: 'none',
})

export const sheetClose = style({
  minWidth: 40,
  minHeight: 40,
  padding: '0 12px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})
