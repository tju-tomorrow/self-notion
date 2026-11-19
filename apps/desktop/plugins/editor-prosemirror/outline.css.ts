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
  // 手机上没有右侧大纲栏，按钮留着只会点了没反应。
  '@media': { '(max-width: 720px)': { display: 'none' } },
})

globalStyle('.sn-outline-toggle:hover', {
  background: 'rgba(127, 127, 127, .16)',
  color: 'var(--sn-text, #333)',
})

globalStyle('.sn-pane-side[data-on="0"] .sn-outline', { display: 'none' })

// 顶部那 40 是**让开右上角那颗按钮**的位置，不然它会盖住标题行。
globalStyle('.sn-outline', { padding: '40px 8px 24px' })

globalStyle('.sn-outline-list', { display: 'flex', flexDirection: 'column', gap: 2 })

/* ── 锚点：跟大纲共用一列，各一颗按钮 ── */

// 大纲那颗在 `right: 8`，锚点往左让一格。
globalStyle('.sn-anchor-toggle', { right: 36 })

// 同一列只露当前模式那份列表。
globalStyle('.sn-pane-side[data-mode="anchors"] .sn-outline-list', { display: 'none' })
globalStyle('.sn-pane-side[data-mode="outline"] .sn-anchor-list', { display: 'none' })

globalStyle('.sn-anchor-row', { display: 'flex', alignItems: 'center', gap: 2 })
globalStyle('.sn-anchor-item', { flex: '1 1 auto', minWidth: 0 })

globalStyle('.sn-anchor-del', {
  flex: '0 0 20px',
  width: 20,
  height: 20,
  display: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--sn-muted, #8a8a8a)',
  fontSize: 13,
  cursor: 'pointer',
})

globalStyle('.sn-anchor-del:hover', {
  background: 'rgba(127, 127, 127, .16)',
  color: 'var(--sn-text, #333)',
})

globalStyle('.sn-anchor-row:hover .sn-anchor-del', { display: 'flex' })

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
