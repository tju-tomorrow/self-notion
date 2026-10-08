/**
 * 块选区长什么样 —— 机制在 `block-selection.ts`，画框的 decoration 挂在 `block-handle.ts` 上。
 *
 * PM 只给 `NodeSelection` 加 `ProseMirror-selectednode`，自定义选区没有现成 class（架构 §4.2），
 * 所以框是我们自己画的。
 */
import { globalStyle } from '@vanilla-extract/css'

// 淡蓝底，**每块各自一块**圆角高亮，不描边。
// ★ 浓度只到「看得出来」为止：.18 那档用户说「太沉、太实心」，退回 .1
//   ——这层底是压在正文上的，字要被它衬托，不能被它盖住。
globalStyle('.sn-block-selected', {
  borderRadius: 4,
  backgroundColor: 'rgba(35, 131, 226, .1)',
})

// 框是我们画的，浏览器那层原生文本高亮叠上来就是两层蓝。
globalStyle('.sn-block-selected ::selection', { background: 'transparent' })
