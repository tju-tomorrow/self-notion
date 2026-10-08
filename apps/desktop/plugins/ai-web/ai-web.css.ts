/**
 * web 版 AI 面板的样式。尺寸和配色照 `comment/comment.css.ts` 那一套来（同一个右侧列，
 * 摆在一起不该是两种长相）。
 *
 * ★ 插件不许 import 外壳的样式，所以这里自己写一份，不引 `src/shell/*.css.ts`。
 * ★ `screen`（页面容器）那一块**会被原生子 webview 整个盖住** —— 它只是个占位的框，
 *   子 webview 的位置就量它（见 `ui.tsx`）。所以那一块永远不要指望在里面看见 HTML。
 */
import { style } from '@vanilla-extract/css'
import * as motion from '../../src/ui/motion.css'

/** 槽宿主不给插件包壳，这一层就是主区右侧那一列本身。
 *  ★ 入场只做透明度（`motion.fadeIn`）不做位移：下面那块 `screen` 的矩形就是原生子
 *  webview 的落点，量的时候带 transform 会错一帧。 */
export const PANEL_W = 420
export const PANEL_MIN_W = 320
export const PANEL_MAX_W = 900

export const panel = style([
  motion.fadeIn,
  {
    flex: '0 0 auto',
    height: '100%',
    // 左缘那条抓带定位用
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    borderLeft: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
    background: 'var(--affine-v2-layer-background-primary)',
  },
])

/** 拖左缘改宽度。细到看不见，但够得着 —— 和外壳侧栏那条一样。 */
export const resizer = style({
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  width: 4,
  zIndex: 2,
  cursor: 'col-resize',
  selectors: {
    '&:hover': { boxShadow: 'inset 1px 0 0 var(--affine-primary-color)' },
  },
})

const row = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px 0 16px',
})

export const head = style([row, { height: 40, justifyContent: 'space-between' }])

export const headTitle = style({
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--affine-v2-text-secondary)',
})

/** 站点切换那一行（头下面、页面容器上面，也是我们自己的 HTML）。 */
export const siteBar = style([row, { height: 36, padding: '0 12px', gap: 6 }])

export const site = style({
  height: 24,
  padding: '0 10px',
  border: '1px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 12,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const siteOn = style([
  site,
  {
    borderColor: 'var(--affine-primary-color)',
    color: 'var(--affine-primary-color)',
    background: 'var(--affine-v2-layer-background-hoverOverlay)',
  },
])

/** 被原生子 webview 盖住的那块。它的 `getBoundingClientRect()` 就是子 webview 的矩形。 */
export const screen = style({
  flex: '1 1 auto',
  minHeight: 0,
  background: 'var(--affine-v2-layer-background-secondary)',
})

export const foot = style({
  flex: '0 0 auto',
  padding: '6px 12px 10px',
  borderTop: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  fontSize: 11,
  lineHeight: '16px',
  color: 'var(--affine-v2-text-tertiary)',
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
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    // 朗读那颗在没有文档时是灰的（顶栏开的够早了，docId 还没来）。
    '&:disabled': { opacity: 0.35, cursor: 'default' },
  },
})

/** 顶栏那一行里的一格（`doc.header.right`，和评论入口并排）。 */
export const entryBar = style({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  paddingRight: 4,
})

/* 「选中浮出的问 AI」那条样式没了 —— D-0079 把它挪进了编辑器那条工具条，
   按钮由 BlockSuite 自己画（`editor.ts` 里那两颗 action）。 */

