/**
 * 表格自己的样式（CONVENTIONS §6.2：插件不 import 外壳的样式）。
 *
 * ★ 不引 prosemirror-tables 自带的 `style/tables.css` —— 那份写死 `.ProseMirror` 前缀、颜色也不跟主题。
 *   代价是**单元格多选高亮**（`.selectedCell:after`）得自己补一条。
 * 颜色走 `--affine-*`（那张表挂在 `<html>` 上），取不到退回中性色。
 */
import { globalStyle } from '@vanilla-extract/css'

const BORDER = 'color-mix(in srgb, currentColor 34%, transparent)'
const SELECT = 'var(--affine-primary-color, #1e96eb)'

// 滚动条只出在表格这一块上。版心本身不跟着变宽（Notion 同款）。
globalStyle('.sn-table-wrap', {
  maxWidth: '100%',
  overflowX: 'auto',
  overflowY: 'hidden',
  overscrollBehaviorX: 'contain',
})

globalStyle('.sn-table', {
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
  // 没拖过时铺满版心；拖过之后宽度写在行内 style 上，比这条优先。
  width: '100%',
  overflow: 'hidden',
})

globalStyle('.sn-table-cell', {
  // .selectedCell:after 的定位基准（那份 CSS 我们没引）
  position: 'relative',
  verticalAlign: 'middle',
  textAlign: 'left',
  boxSizing: 'border-box',
  minWidth: 48,
  padding: '7px 10px',
  lineHeight: 1.5,
  overflowWrap: 'break-word',
  border: `1px solid ${BORDER}`,
})

globalStyle('.sn-table-header', {
  fontWeight: 600,
  background: 'color-mix(in srgb, currentColor 7%, transparent)',
})

// 单元格多选（CellSelection）的底色；prosemirror-tables 给选中的格挂 `selectedCell`。
globalStyle('.sn-table-cell.selectedCell::after', {
  content: "''",
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 2,
  background: SELECT,
  opacity: 0.16,
  pointerEvents: 'none',
})

// 鼠标贴着列边时官方插件塞进来的那根线。点不着，拖拽命中靠格子边缘那几像素。
globalStyle('.column-resize-handle', {
  position: 'absolute',
  right: 0,
  top: 0,
  bottom: 0,
  width: 2,
  zIndex: 20,
  background: SELECT,
  pointerEvents: 'none',
})

globalStyle('.ProseMirror.resize-cursor', { cursor: 'col-resize' })

// 光标在表格里时浮出来的那排按钮（`plugins/table.ts` 的 `tableBarPlugin`）。
globalStyle('.sn-table-bar', {
  position: 'fixed',
  zIndex: 40,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 6,
  border: '1px solid var(--sn-line, rgba(0, 0, 0, .1))',
  background: 'var(--sn-bg, #fff)',
  boxShadow: '0 4px 14px rgba(0, 0, 0, .12)',
})

globalStyle('.sn-table-bar[hidden]', { display: 'none' })

globalStyle('.sn-table-bar-btn', {
  padding: '3px 7px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--sn-text, #333)',
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1.4,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
})

globalStyle('.sn-table-bar-btn:hover', { background: 'var(--sn-hover, rgba(0, 0, 0, .07))' })

// 行 / 列拖动的小手柄（`plugins/table.ts` 悬浮计算位置）和落点线。
globalStyle('.sn-table-grip', {
  position: 'fixed',
  zIndex: 41,
  width: 16,
  height: 16,
  borderRadius: 3,
  border: '1px solid var(--sn-line, rgba(0, 0, 0, .15))',
  background: 'var(--sn-bg, #fff)',
  cursor: 'grab',
  opacity: 0.85,
})

globalStyle('.sn-table-grip-row', { cursor: 'row-resize' })
globalStyle('.sn-table-grip-col', { cursor: 'col-resize' })
globalStyle('.sn-table-grip[hidden]', { display: 'none' })

globalStyle('.sn-table-drop', {
  position: 'fixed',
  zIndex: 50,
  borderRadius: 1,
  background: 'var(--sn-accent, #1e96eb)',
  pointerEvents: 'none',
})

globalStyle('.sn-table-drop[hidden]', { display: 'none' })
