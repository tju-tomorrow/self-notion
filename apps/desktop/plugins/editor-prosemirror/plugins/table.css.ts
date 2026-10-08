/**
 * 表格自己的样式（CONVENTIONS §6.2：插件不 import 外壳的样式）。
 *
 * ★ 不引 prosemirror-tables 自带的 `style/tables.css` —— 那份写死 `.ProseMirror` 前缀、颜色也不跟主题。
 *   代价是**单元格多选高亮**（`.selectedCell:after`）得自己补一条。
 * 颜色走 `--affine-*`（那张表挂在 `<html>` 上），取不到退回中性色。
 */
import { globalStyle } from '@vanilla-extract/css'

const BORDER = 'var(--affine-border-color, rgba(0, 0, 0, .12))'
const SELECT = 'var(--affine-primary-color, #1e96eb)'

globalStyle('.sn-table', {
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
  width: '100%',
  overflow: 'hidden',
})

globalStyle('.sn-table-cell', {
  // .selectedCell:after 的定位基准（那份 CSS 我们没引）
  position: 'relative',
  verticalAlign: 'top',
  boxSizing: 'border-box',
  minWidth: 40,
  padding: '4px 8px',
  border: `1px solid ${BORDER}`,
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
