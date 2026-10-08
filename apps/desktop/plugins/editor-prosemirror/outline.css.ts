/**
 * 大纲那一列（`outline.ts` 建的 DOM）。列自己的宽度在 `editor.css.ts`（骨架是那边定的）。
 */
import { globalStyle } from '@vanilla-extract/css'

// 收起时那一列是 0 宽（`.sn-pane-side`），只剩这颗按钮浮在右上角 —— 收着也得看得见、点得到。
globalStyle('.sn-outline-toggle', {
  position: 'absolute',
  top: 6,
  right: 8,
  zIndex: 5,
  width: 24,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--sn-muted, #8a8a8a)',
  cursor: 'pointer',
})

globalStyle('.sn-outline-toggle:hover', {
  background: 'rgba(127, 127, 127, .16)',
  color: 'var(--sn-text, #333)',
})

globalStyle('.sn-pane-side[data-on="0"] .sn-outline', { display: 'none' })

// 顶部那 40 是**让开右上角那颗按钮**的位置，不然它会盖住标题行。
globalStyle('.sn-outline', { padding: '40px 8px 24px' })

globalStyle('.sn-outline-list', { display: 'flex', flexDirection: 'column', gap: 2 })

globalStyle('.sn-outline-item', {
  boxSizing: 'border-box',
  padding: '3px 8px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 13,
  lineHeight: 1.5,
  textAlign: 'left',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

globalStyle('.sn-outline-item:hover', { background: 'rgba(127, 127, 127, .14)' })

// 滚到哪一条亮哪一条（`outline.ts` 按正文位置算）。
globalStyle('.sn-outline-item[data-active="1"]', { color: 'var(--sn-accent, #1e96eb)' })

globalStyle('.sn-outline-title', { fontWeight: 600, marginBottom: 4 })

globalStyle('.sn-outline-empty', {
  padding: '3px 8px',
  fontSize: 13,
  color: 'var(--sn-muted, #8a8a8a)',
})
