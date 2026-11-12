/**
 * 手柄那一套（`block-handle.ts` 建的 DOM）。
 *
 * ★ 手柄**浮在版心左侧的留白里**（`left = 块左缘 - GUTTER`，见 `block-handle.ts`）——
 *   正文的宽度一点不被占，标题和正文从同一个左缘开始。这是本插件自己的样式，没吃外壳的 CSS 模块。
 */
import { globalStyle } from '@vanilla-extract/css'

const GUTTER = 44

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
  justifyContent: 'center',
  gap: 2,
  width: GUTTER,
  height: 24,
  userSelect: 'none',
  color: 'var(--sn-muted, #8a8a8a)',
  opacity: 0.55,
  transition: 'opacity .12s ease',
})

globalStyle('.sn-block-handle:hover', { opacity: 1 })

globalStyle('.sn-block-handle[hidden]', { display: 'none' })

globalStyle('.sn-block-btn', {
  width: 20,
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
  lineHeight: 1,
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background .1s ease, color .1s ease',
})

globalStyle('.sn-block-btn:hover', {
  background: 'var(--sn-hover, rgba(0, 0, 0, .07))',
  color: 'var(--sn-text, #333)',
})

globalStyle('.sn-block-drag', { cursor: 'default' })

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


/* ── 块菜单（`⋮⋮` 点开 / 块上右键）── */
// 苹果那套：半透明 + 背景模糊 + 大圆角 + 一行 28 的安静列表。
globalStyle('.sn-block-menu', {
  position: 'fixed',
  zIndex: 60,
  width: 232,
  maxHeight: 'min(70vh, 640px)',
  overflowY: 'auto',
  padding: 6,
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, currentColor 10%, transparent)',
  background: 'color-mix(in srgb, var(--sn-bg, #fff) 92%, transparent)',
  backdropFilter: 'blur(24px) saturate(1.6)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
  boxShadow: '0 12px 32px rgba(0, 0, 0, .16), 0 2px 8px rgba(0, 0, 0, .06)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  fontSize: 13,
  lineHeight: 1.3,
  color: 'var(--sn-text, #333)',
})

globalStyle('.sn-block-menu-item', {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'background .1s ease',
})

globalStyle('.sn-block-menu-item:hover', {
  background: 'color-mix(in srgb, currentColor 8%, transparent)',
})

globalStyle('.sn-block-menu-label', {
  marginTop: 8,
  padding: '6px 8px 2px',
  borderTop: '1px solid color-mix(in srgb, currentColor 9%, transparent)',
  fontSize: 11,
  color: 'var(--sn-muted, #8a8a8a)',
})

globalStyle('.sn-block-menu-grid', {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  columnGap: 2,
})

globalStyle('.sn-block-menu-cell', { height: 28 })

globalStyle('.sn-block-menu-swatches', {
  display: 'grid',
  gridTemplateColumns: 'repeat(10, 1fr)',
  gap: 6,
  padding: '4px 8px 2px',
})

globalStyle('.sn-block-menu-swatch', {
  width: '100%',
  aspectRatio: '1 / 1',
  maxWidth: 15,
  maxHeight: 15,
  justifySelf: 'center',
  alignSelf: 'center',
  padding: 0,
  border: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
  borderRadius: '50%',
  cursor: 'pointer',
  transition: 'transform .1s ease',
})

globalStyle('.sn-block-menu-swatch:hover', { transform: 'scale(1.15)' })

globalStyle('.sn-block-menu-swatch[data-on="true"]', {
  boxShadow:
    '0 0 0 2px var(--sn-bg, #fff), 0 0 0 3.5px color-mix(in srgb, currentColor 50%, transparent)',
})

globalStyle('.sn-block-menu-swatch-none', {
  backgroundImage:
    'linear-gradient(135deg, transparent 44%, color-mix(in srgb, currentColor 55%, transparent) 44%, color-mix(in srgb, currentColor 55%, transparent) 56%, transparent 56%)',
})
