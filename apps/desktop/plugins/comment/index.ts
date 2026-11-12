/**
 * 评论插件 —— 面板 / 回复 / 解决 / 删除 / 浮出按钮 / 顶栏入口，**UI 全在这边**
 * （编辑器只给机制：契约里那五个 `EditorService` 方法和 `ctx.get('comment')`）。
 *
 * 「当前是哪一篇」在这里订阅、状态放模块级 —— 和 `shell-doc-header/index.ts` 同一个理由：
 * 面板/入口组件的挂载晚于 `OPEN_DOC`，组件自己监听就永远错过那一篇。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { CLOSE_ALL, COMMENT_LAYOUT, OPEN_DOC, SHOW_LIST, type OpenDocEvent } from '../../src/kernel/contract'
import { commentOnSelection, dropOrphans, openPanel, setDoc } from './actions'
import { CommentHeader } from './header'
import { CommentLayer } from './layer'

export const name = 'comment'

// 三条都得有：库走 rpc、锚点走 editor、UI 挂槽。
export const inject = ['rpc', 'editor', 'slot']

export function apply(ctx: Context) {
  const open = ({ id }: OpenDocEvent) => void setDoc(ctx, id)
  const close = () => void setDoc(ctx, null)
  ctx.on(OPEN_DOC, open)
  ctx.on(CLOSE_ALL, close)
  ctx.on(SHOW_LIST, close)
  // 正文一改（删字、删块）就对一下锚点。几何变化也会来，对不上就什么都不删。
  ctx.on(COMMENT_LAYOUT, () => void dropOrphans(ctx))

  ctx.effect(() => [
    // 软依赖的另一端：编辑器点正文里的高亮时调这个（拿不到就只是点不动）。
    ctx.provide('comment', {
      open: (id?: string) => void openPanel(ctx, id),
      // 工具条上那颗「评论」点了：只打开输入框，写了字才进库。
      onSelection: (at) => commentOnSelection(ctx, { kind: 'inline', ...at }),
    }),
    ctx.slot.register('doc.aside', () => createElement(CommentLayer, { ctx })),
    // ★ 入口在顶栗那一行的**最右端**（D-0070）—— 原来挂在 `doc.header` 里，
    //   而插件装载顺序先于 shell-doc-header，于是那颗图标落在了面包屑左边。
    ctx.slot.register('doc.header.right', () => createElement(CommentHeader, { ctx })),
  ])
}
