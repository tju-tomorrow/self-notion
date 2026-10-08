/**
 * 正文里那条评论高亮 —— 类名由 `comment.ts` 的 decoration 挂（机制在那边，样式归这儿）。
 *
 * 配色跟面板里的引用条同一套 token（`plugins/comment/comment.css.ts`），兜底值照 `@toeverything/theme`。
 * ★ 插件不许 import 外壳的样式，所以这里自己写一份，不引 `src/shell/*.css.ts`。
 */
import { globalStyle } from '@vanilla-extract/css'

// ★ 两个类都由 decoration 挂。mark 自己那层 `span.sn-comment` 不画东西 —— 它只是锚点（`data-ids`）。

globalStyle('.sn-comment-unresolved', {
  backgroundColor: 'var(--affine-v2-block-comment-highlightDefault, #1e96eb14)',
  borderBottom: '2px solid var(--affine-v2-block-comment-highlightUnderline, #1e96ebb2)',
})

// 面板里点一条评论时，正文里那一闪（1.6 秒后自己灭）。
globalStyle('.sn-comment-active', {
  backgroundColor: 'var(--affine-v2-block-comment-highlightActive, #1e96eb4d)',
})
