/**
 * 内置助手那一页（左侧历史 + 右侧对话）和左下角那条撤销条。
 *
 * 走的槽是 `main.page`（D-0095）—— 整块主区，不是盖在正文上的浮层，所以这里是**两列**
 * （`side` + `chat`），不是一张卡片。撤销条仍然是自绘的覆盖层（它不属于哪一页）。
 *
 * 配色的口径照旧：一律 `--affine-*` token，样式自己写一份（插件不许 import 外壳的样式）。
 */
import { globalStyle, keyframes, style } from '@vanilla-extract/css'
import * as motion from '../../src/ui/motion.css'

/** 流式光标那一闪。 */
const blink = keyframes({ '0%': { opacity: 1 }, '50%': { opacity: 0 } })

/* ────────────────────────── 整页：左历史 + 右对话 ────────────────────────── */

export const page = style([motion.fadeIn, { flex: 1, minWidth: 0, display: 'flex' }])

export const side = style({
  flex: '0 0 248px',
  width: 248,
  display: 'flex',
  flexDirection: 'column',
  padding: '10px 8px 8px',
  borderRight: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  background: 'var(--affine-v2-layer-background-secondary)',
})

/** 左上角那一行：星芒 + 「内置助手」。 */
export const brand = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '2px 8px 12px',
  fontSize: 15,
  fontWeight: 500,
  color: 'var(--affine-v2-text-primary)',
})

export const mark = style({ display: 'flex', color: 'var(--affine-primary-color)' })

const flatButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const newChat = style([flatButton, { height: 34, padding: '0 10px', fontSize: 13 }])

export const historyLabel = style({
  padding: '14px 10px 6px',
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

/** 历史那一列。会话多了自己滚，**不动旁边那半**。 */
export const historyList = style({
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  overflowY: 'auto',
  selectors: {
    '&::-webkit-scrollbar': { width: 8 },
    '&::-webkit-scrollbar-thumb': {
      borderRadius: 4,
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
    },
  },
})

export const thread = style([
  flatButton,
  {
    padding: '7px 10px',
    fontSize: 13,
    color: 'var(--affine-v2-text-secondary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
])

/** 当前这条：底色 + 字亮起来。 */
export const threadOn = style([
  thread,
  {
    background: 'var(--affine-v2-layer-background-hoverOverlay)',
    color: 'var(--affine-v2-text-primary)',
  },
])

export const threadLabel = style({ overflow: 'hidden', textOverflow: 'ellipsis' })

/** 这条会话的字数估数。贴右边，淡到只占一只眼。 */
export const threadTok = style({
  flex: '0 0 auto',
  marginLeft: 'auto',
  paddingLeft: 6,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--affine-v2-text-tertiary)',
})

/* ── 右半：对话 ── */

export const chat = style({
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
})

/** 对话那一列。**有宽度上限**（760）—— 一行拉满整个窗口时眼睛要左右跳；两边留 24 的边。 */
const column = style({ width: '100%', maxWidth: 760, paddingLeft: 24, paddingRight: 24 })

/** 对话那一列最上面那条：只用来把「收进右侧栏」那颗顶到右上角。 */
export const chatBar = style([
  column,
  { flex: '0 0 auto', display: 'flex', justifyContent: 'flex-end', paddingTop: 6 },
])

export const stream = style([
  column,
  {
    flex: '1 1 auto',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    paddingTop: 32,
    paddingBottom: 8,
    overflowY: 'auto',
    selectors: {
      '&::-webkit-scrollbar': { width: 8 },
      '&::-webkit-scrollbar-thumb': {
        borderRadius: 4,
        background: 'var(--affine-v2-layer-background-hoverOverlay)',
      },
    },
  },
])

/** 右侧那一列里那两块的紧凑版：那一列本来就窄，24 的边会把字挤成一条。 */
export const dockStream = style([stream, { paddingLeft: 14, paddingRight: 14, paddingTop: 20 }])

/** 一句都没说过时中间那一块：星芒 + 一句话。 */
export const welcome = style({
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  color: 'var(--affine-v2-text-primary)',
})

export const welcomeTitle = style({
  margin: 0,
  fontSize: 26,
  fontWeight: 400,
  letterSpacing: '0.02em',
})

export const suggest = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 8,
})

export const suggestChip = style({
  padding: '7px 12px',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      color: 'var(--affine-v2-text-primary)',
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
    },
  },
})

/** 用户说的：靠右的圆气泡。 */
export const bubbleUser = style({
  alignSelf: 'flex-end',
  maxWidth: '80%',
  margin: 0,
  padding: '9px 13px',
  borderRadius: 16,
  background: 'var(--affine-v2-layer-background-secondary)',
  fontSize: 14,
  lineHeight: '22px',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  color: 'var(--affine-v2-text-primary)',
})

/** 助手说的：不套底，就是正文。markdown 那些块自己带边距 —— 所以这里只管字体和颜色。 */
export const bubbleAi = style({
  alignSelf: 'flex-start',
  maxWidth: '100%',
  margin: 0,
  fontSize: 14,
  lineHeight: '24px',
  wordBreak: 'break-word',
  color: 'var(--affine-v2-text-primary)',
})

/** 工具那一行 —— Claude Code 那样走等宽：它是「过程」不是「话」。 */
export const tool = style({
  alignSelf: 'flex-start',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: 0,
  maxWidth: '100%',
  fontFamily: 'var(--affine-font-code-family)',
  fontSize: 12.5,
  lineHeight: '20px',
  color: 'var(--affine-v2-text-tertiary)',
})

/** 正在跑的那一行：亮起来（淡紫），一眼就看得出现在卡在哪一步。 */
export const toolOn = style({ color: 'var(--affine-primary-color)' })

export const toolMark = style({ flex: '0 0 auto', width: 12, textAlign: 'center' })

export const toolName = style({ flex: '0 0 auto' })

/** 括号里的路径 / 关键词、合堆的 ×N —— 都是同一档淡色。 */
export const toolDetail = style({
  flex: '0 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--affine-v2-text-tertiary)',
})

export const toolTime = style({ flex: '0 0 auto', color: 'var(--affine-v2-text-tertiary)' })

/** 流式那一截末尾的方块光标。 */
export const cursor = style({
  display: 'inline-block',
  width: 7,
  height: 15,
  marginLeft: 2,
  verticalAlign: '-2px',
  background: 'var(--affine-primary-color)',
  animation: `${blink} 1s steps(2, start) infinite`,
})

/** 过程记录（调用了哪个工具）—— 小而淡，别跟对话抢。 */
export const note = style({
  alignSelf: 'flex-start',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-tertiary)',
})

export const noteDot = style({
  flex: '0 0 auto',
  width: 6,
  height: 6,
  borderRadius: 3,
  background: 'var(--affine-primary-color)',
})

export const error = style({
  alignSelf: 'stretch',
  margin: 0,
  padding: '8px 10px',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--affine-v2-text-primary)',
  background: 'var(--affine-v2-layer-background-error)',
})

/* ── 右半：下面那个输入条 ── */

export const foot = style([
  column,
  {
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingBottom: 10,
  },
])

/** 紧凑版那个输入条（`dockFoot` 得等 `foot` 声明完，所以放这儿）。 */
export const dockFoot = style([foot, { paddingLeft: 14, paddingRight: 14 }])

/** 输入那一块整体是一个圆角胶囊 —— 输入框自己**不能**再带边框，不然就是两层框。 */
export const box = style({
  display: 'flex',
  alignItems: 'flex-end',
  gap: 6,
  padding: 6,
  border: '1px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 16,
  background: 'var(--affine-v2-layer-background-secondary)',
  transition: 'border-color 160ms ease, box-shadow 160ms ease',
  selectors: {
    '&:focus-within': {
      borderColor: 'var(--affine-primary-color)',
      boxShadow: '0 0 0 3px color-mix(in srgb, var(--affine-primary-color) 15%, transparent)',
    },
  },
})

export const input = style({
  flex: '1 1 auto',
  minHeight: 34,
  maxHeight: 160,
  resize: 'none',
  padding: '6px 4px 6px 8px',
  border: 'none',
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  lineHeight: '22px',
  outline: 'none',
})

/** 发送：圆的一颗，只有图标 —— 文案「发送/正在想…」会让按钮宽度来回跳。 */
export const send = style({
  flex: '0 0 auto',
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: '50%',
  background: 'var(--affine-primary-color)',
  color: '#fff',
  cursor: 'pointer',
  transition: 'opacity 160ms ease, transform 120ms ease',
  selectors: {
    '&:hover:not(:disabled)': { opacity: 0.86 },
    '&:active:not(:disabled)': { transform: 'scale(0.94)' },
    '&:disabled': {
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
      color: 'var(--affine-v2-text-tertiary)',
      cursor: 'default',
    },
  },
})

/** 中断：同一颗位置、同一个尺寸，只换个底色 —— 它这会儿**不是**灰掉的（D-0103）。 */
export const stopButton = style([
  send,
  {
    background: 'var(--affine-v2-layer-background-error)',
    color: 'var(--affine-v2-text-primary)',
  },
])

/** 快捷键只在这一行小字里说一次，不再塞进占位符。 */
export const hint = style({
  alignSelf: 'center',
  fontSize: 11,
  lineHeight: '14px',
  color: 'var(--affine-v2-text-tertiary)',
})

/* ── 助手那半边的 markdown（`md.tsx` 画出来的那些标签） ── */

export const mdP = style({ margin: '0 0 10px', selectors: { '&:last-child': { marginBottom: 0 } } })

export const mdH = style({
  margin: '14px 0 8px',
  fontSize: 15,
  fontWeight: 600,
  lineHeight: '24px',
  selectors: { '&:first-child': { marginTop: 0 } },
})

const list = { margin: '0 0 10px', paddingLeft: 22 }
export const mdUl = style({ ...list, listStyle: 'disc' })
export const mdOl = style({ ...list, listStyle: 'decimal' })
export const mdLi = style({ margin: '2px 0' })

export const mdCode = style({
  padding: '1px 4px',
  borderRadius: 4,
  background: 'var(--affine-v2-layer-background-secondary)',
  fontFamily: 'var(--affine-font-code-family)',
  fontSize: 12.5,
})

export const mdPre = style({
  margin: '0 0 10px',
  padding: '10px 12px',
  borderRadius: 10,
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  background: 'var(--affine-v2-layer-background-secondary)',
  overflowX: 'auto',
  fontFamily: 'var(--affine-font-code-family)',
  fontSize: 12.5,
  lineHeight: '20px',
})

export const mdQuote = style({
  margin: '0 0 10px',
  paddingLeft: 12,
  borderLeft: '2px solid var(--affine-v2-layer-insideBorder-border)',
  color: 'var(--affine-v2-text-secondary)',
})

export const mdHr = style({
  margin: '14px 0',
  border: 'none',
  borderTop: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
})

export const mdLink = style({
  color: 'var(--affine-link-color)',
  textDecoration: 'none',
  selectors: { '&:hover': { textDecoration: 'underline' } },
})

/* ────────────────────────── 右侧那一列（D-0098） ────────────────────────── */

/** 宽度走 inline style（`panel.tsx` 里拖出来的那个值）。列里自己排：头 + 对话。 */
export const dock = style([
  motion.fadeIn,
  {
    flex: '0 0 auto',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    position: 'relative',
    borderLeft: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
    background: 'var(--affine-v2-layer-background-primary)',
  },
])

/** 拖左缘改宽度。细到看不见，但够得着（同网页版 AI 面板那条）。 */
export const dockResizer = style({
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  width: 4,
  zIndex: 2,
  cursor: 'col-resize',
  selectors: { '&:hover': { boxShadow: 'inset 1px 0 0 var(--affine-primary-color)' } },
})

export const dockHead = style({
  flex: '0 0 auto',
  height: 40,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 8px 0 12px',
})

export const dockTitle = style({
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--affine-v2-text-secondary)',
})

/** 右边那一列里的历史列：那一列没有整页那个 `.side` 的边距，自己补一层。 */
export const dockListWrap = style({
  flex: '1 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '0 8px 8px',
})

/** 「历史 / 对话」那颗字按钮（一个沙漏式的图标说不清意思，就直接写字）。 */
export const dockButton = style({
  flex: '0 0 auto',
  padding: '3px 8px',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 11,
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const dockIcon = style({
  flex: '0 0 24px',
  width: 24,
  height: 24,
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

/** 顶栏那一颗（`AgentEntry`）—— 跟它旁边那几颗一样是 28px 的公图标（里面的是那只宠物）。 */
export const entry = style({
  flex: '0 0 28px',
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--affine-v2-icon-primary)',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

/** 开着：主色底 + 主色描一圈 —— 「现在说话的是它」。 */
export const entryOn = style({
  background: 'var(--affine-v2-layer-background-hoverOverlay)',
  boxShadow: 'inset 0 0 0 1px var(--affine-primary-color)',
})

/* ────────────────────────── 撤销条 ────────────────────────── */

/** 左下角，一回合一条地往上摞。右下角是 toast 的地盘（`src/ui/toast.tsx`）。 */
export const bars = style({
  position: 'fixed',
  left: 16,
  bottom: 16,
  zIndex: 940,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'flex-start',
})

export const bar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  maxWidth: 420,
  padding: '10px 12px',
  borderRadius: 8,
  background: 'var(--affine-v2-layer-background-primary)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  boxShadow: 'var(--affine-shadow-2)',
  fontSize: 13,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-primary)',
})

export const barAction = style({
  border: 'none',
  background: 'transparent',
  color: 'var(--affine-primary-color)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  padding: 0,
})

/** 输入框上面那颗「在看哪一篇」的小签（用户红框的位置）。小到不抢戏，但一眼能看见。 */
export const place = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: '100%',
  marginBottom: 4,
  color: 'var(--affine-v2-text-secondary)',
  fontSize: 11,
})

// vanilla-extract 不许在 style 里写「指向别的元素」的选择器（`& > span` 报 Invalid selector）——
// 这条只能这么写。
globalStyle(`${place} > span`, {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})
