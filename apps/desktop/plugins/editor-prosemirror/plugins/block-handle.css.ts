/**
 * 手柄那一套（`block-handle.ts` 建的 DOM）。
 *
 * ★ 手柄**浮在版心左侧的留白里**（`left = 块左缘 - GUTTER`，见 `block-handle.ts`）——
 *   正文的宽度一点不被占，标题和正文从同一个左缘开始。这是本插件自己的样式，没吃外壳的 CSS 模块。
 */
import { globalStyle } from '@vanilla-extract/css'

const GUTTER = 40

// 选择器多带一层（`.ProseMirror` / `.sn-pane-body`）是为了赢过 `editor.css.ts` 里的 `padding` 简写 ——
// 两份都是 globalStyle，谁赢只看规则顺序，靠顺序太脆。
// ★ **正文不吃手柄槽**：手柄浮在版心左侧的留白里（`block-handle.ts` 里 `left = 块左缘 - GUTTER`），
//   所以 `.sn-block` 这里**不加** padding —— 加了正文的文字就往右缩，跟标题错开一条槽。

// 浮层：fixed + viewport 坐标（rect 直接就能用，不换算滚动）。
globalStyle('.sn-block-handle', {
  position: 'fixed',
  zIndex: 30,
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  width: GUTTER,
  height: 22,
  userSelect: 'none',
  color: 'var(--sn-muted, #8a8a8a)',
})

globalStyle('.sn-block-handle[hidden]', { display: 'none' })

globalStyle('.sn-block-btn', {
  width: 19,
  height: 20,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
  userSelect: 'none',
})

globalStyle('.sn-block-btn:hover', {
  background: 'var(--sn-hover, rgba(0, 0, 0, .07))',
  color: 'var(--sn-text, #333)',
})

globalStyle('.sn-block-drag', { cursor: 'grab', fontSize: 13, letterSpacing: -1 })

// 拖拽缩略图：塞在视口外，只为给 setDragImage 一个挂着的元素。
globalStyle('.sn-drag-ghost', {
  position: 'fixed',
  top: -4000,
  left: 0,
  pointerEvents: 'none',
  opacity: 0.6,
  background: 'var(--sn-bg, #fff)',
})

// 「会嵌进这一块」的那条蓝缩进线（`block-handle.ts` 拖拽时画）。fixed + viewport 坐标，跟手柄同一套。
// 跟 `dropCursor` 那条同色，只是自己算位置 —— 嵌进去的落点 PM 的 dropPoint 够不着，得我们画。
globalStyle('.sn-drop-indent', {
  position: 'fixed',
  zIndex: 50,
  height: 2,
  borderRadius: 1,
  background: 'var(--sn-accent, #1e96eb)',
  pointerEvents: 'none',
})

globalStyle('.sn-drop-indent[hidden]', { display: 'none' })
