/**
 * 同步块的样式（CONVENTIONS §6.2：不许 import 外壳的样式）。
 * 跟 `nodes.css.ts` 一样不吃 `--affine-*`，只认 `--sn-accent`，其余退回中性兜底。
 */
import { globalStyle } from '@vanilla-extract/css'

const LINE = 'rgba(128, 128, 128, .4)'
const WASH = 'rgba(128, 128, 128, .12)'

// 左边一条竖线：一眼认出这是「引用进来的」一块，跟正文划开。
globalStyle('.sn-synced', {
  margin: '4px 0',
  padding: '2px 0 2px 12px',
  borderLeft: `2px solid ${LINE}`,
})

globalStyle('.sn-synced-tag', {
  fontSize: 11,
  lineHeight: 1.6,
  opacity: 0.5,
  userSelect: 'none',
})

globalStyle('.sn-synced-body', { minWidth: 0 })

// 空态 / 加载中 / 源读不出来 —— 灰字斜体，别装作这里面有内容。
globalStyle('.sn-synced[data-state="empty"] .sn-synced-body', {
  color: 'rgba(128, 128, 128, .8)',
  fontStyle: 'italic',
  fontSize: 13,
})

globalStyle('.sn-synced[data-state="ready"]:hover', { background: WASH })
