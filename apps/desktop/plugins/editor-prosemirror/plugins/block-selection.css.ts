/**
 * 块选区长什么样 —— 机制在 `block-selection.ts`，画框的 decoration 挂在 `block-handle.ts` 上。
 *
 * PM 只给 `NodeSelection` 加 `ProseMirror-selectednode`，自定义选区没有现成 class（架构 §4.2），
 * 所以框是我们自己画的。
 */
import { globalStyle } from '@vanilla-extract/css'

// 暗色纸面上 .1 的蓝底几乎看不见。左边一条实色，底再浅一点，选中块才分得出来。
globalStyle('.sn-block-selected', {
  borderRadius: 4,
  backgroundColor: 'color-mix(in srgb, var(--sn-accent, #2383e2) 16%, transparent)',
  boxShadow: 'inset 3px 0 0 var(--sn-accent, #2383e2)',
})

// 框是我们画的，浏览器那层原生文本高亮叠上来就是两层蓝。
globalStyle('.sn-block-selected ::selection', { background: 'transparent' })

// visible=false 的选区会让 PM 挂上这个 class，靠 CSS 藏掉原生高亮；项目没引 PM 自带 stylesheet，
// 不补这两条的话空块会露出系统色的横条（深色主题下是一条条紫红）。
globalStyle('.ProseMirror-hideselection *::selection', { background: 'transparent' })
globalStyle('.ProseMirror-hideselection *::-moz-selection', { background: 'transparent' })
