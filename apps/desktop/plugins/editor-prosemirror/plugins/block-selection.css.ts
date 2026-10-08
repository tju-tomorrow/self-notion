/**
 * 块选区长什么样 —— 机制在 `block-selection.ts`，画框的 decoration 挂在 `block-handle.ts` 上。
 *
 * PM 只给 `NodeSelection` 加 `ProseMirror-selectednode`，自定义选区没有现成 class（架构 §4.2），
 * 所以框是我们自己画的。
 */
import { globalStyle } from '@vanilla-extract/css'

// 淡蓝底 + 内框线：蓝框跟着左边那条 40px 的槽一起铺满整行（Notion 也是这样）。
globalStyle('.sn-block-selected', {
  borderRadius: 4,
  backgroundColor: 'rgba(100, 160, 255, .1)',
  boxShadow: 'inset 0 0 0 2px rgba(100, 160, 255, .3)',
})

// 框是我们画的，浏览器那层原生文本高亮叠上来就是两层蓝。
globalStyle('.sn-block-selected ::selection', { background: 'transparent' })
