/**
 * 正文里那条评论高亮 —— 类名由 `comment.ts` 的 decoration 挂（机制在那边，样式归这儿）。
 *
 * 配色跟面板里的引用条同一套 token（`plugins/comment/comment.css.ts`），兜底值照 `@toeverything/theme`。
 * ★ 插件不许 import 外壳的样式，所以这里自己写一份，不引 `src/shell/*.css.ts`。
 */
import { globalStyle } from '@vanilla-extract/css'

// ★ 两个类都由 decoration 挂。mark 自己那层 `span.sn-comment` 不画东西 —— 它只是锚点（`data-ids`）。

globalStyle('.sn-comment-unresolved', {
  backgroundColor: 'var(--affine-v2-block-comment-highlightDefault, #f0c14b6b)',
  borderRadius: '2px',
})

// 面板里点一条评论时，正文里那一闪（1.6 秒后自己灭）。
globalStyle('.sn-comment-active', {
  backgroundColor: 'var(--affine-v2-block-comment-highlightActive, #f0c14bad)',
})

/* ── 卡片那一层（D-0172） ──
 *
 * 层是**正文滚动区里的一个零高元素**（`comment.ts` 的 `layerOf` 建、`prepend` 在正文前面）：
 * 在流里 → 卡片跟着内容一起滚，不用追 `scroll`、也不会和正文错开一帧。
 * ★ `margin-right` 是负的：正文那边加了等宽的 `padding-right`，层要伸进那条留白里，
 *   卡片才能贴到栏的右缘（不伸的话 `right: 0` 落在版心右缘上、盖住字）。
 * ★ 只在浮卡模式下才伸 —— 窄栏模式没有那条留白，伸出去就是横向溢出。 */
globalStyle('.sn-pane-float', {
  position: 'relative',
  height: 0,
  pointerEvents: 'none',
  zIndex: 5,
})

/** 浮卡模式下正文让出右侧那条留白（`COMMENT_CARD_W + COMMENT_GAP` = 276）——
 *  版心本来就是 `margin: 0 auto`，让完自己就居中在剩下的地方。
 *  ★ 这个数在 `comment.ts` 的 `GUTTER` 里也有一份，改要一起改。 */
globalStyle('.sn-pane-body.sn-comment-float', { paddingRight: 276 })

globalStyle('.sn-comment-float > .sn-pane-float', { marginRight: '-276px' })
