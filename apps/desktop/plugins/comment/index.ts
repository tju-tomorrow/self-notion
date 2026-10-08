/**
 * 评论插件 —— 面板 / 回复 / 解决 / 删除 / 浮出按钮 / 顶栏入口，**UI 全在这边**
 * （编辑器只给机制：契约里那五个 `EditorService` 方法和 `ctx.get('comment')`）。
 *
 * 「当前是哪一篇」在这里订阅、状态放模块级 —— 和 `shell-doc-header/index.ts` 同一个理由：
 * 面板/入口组件的挂载晚于 `OPEN_DOC`，组件自己监听就永远错过那一篇。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { CLOSE_ALL, OPEN_DOC, SHOW_LIST, type OpenDocEvent } from '../../src/kernel/contract'
import { commentOnSelection, openPanel, setDoc } from './actions'
import { CommentHeader } from './header'
import { CommentPanel } from './panel'

export const name = 'comment'

// 三条都得有：库走 rpc、锚点走 editor、UI 挂槽。
export const inject = ['rpc', 'editor', 'slot']

export function apply(ctx: Context) {
  const open = ({ id }: OpenDocEvent) => void setDoc(ctx, id)
  const close = () => void setDoc(ctx, null)
  ctx.on(OPEN_DOC, open)
  ctx.on(CLOSE_ALL, close)
  ctx.on(SHOW_LIST, close)

  ctx.effect(() => [
    // 软依赖的另一端：编辑器点正文里的高亮时调这个（拿不到就只是点不动）。
    ctx.provide('comment', {
      open: (id?: string) => void openPanel(ctx, id),
      // 工具条上那颗「评论」点了（D-0079）。文字选区那份编号由编辑器量好递过来，
      // 这里只补一个 `kind` —— 建锚点、开面板那套跟以前一样，一个字没改。
      onSelection: (at) => void commentOnSelection(ctx, { kind: 'inline', ...at }),
    }),
    ctx.slot.register('doc.aside', () => createElement(CommentPanel, { ctx })),
    // ★ 入口在顶栗那一行的**最右端**（D-0070）—— 原来挂在 `doc.header` 里，
    //   而插件装载顺序先于 shell-doc-header，于是那颗图标落在了面包屑左边。
    ctx.slot.register('doc.header.right', () => createElement(CommentHeader, { ctx })),
  ])
}
