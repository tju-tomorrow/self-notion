/**
 * 侧栏：文档树 + 新建 / 改名 / 删除，外加最近 / 最爱 / 回收站三个分组。
 *
 * 数据全部来自 `ctx.rpc.call('doc:list', { includeTrashed: true })` 一次全量，
 * 分组与树在前端切；写操作走 `doc:create` / `doc:rename` / `doc:trash` /
 * `doc:restore` / `doc:remove` / `doc:favorite`（命令表见 docs/execution-plan.md §6.2）。
 *
 * 「点了某篇文档」**不直接调标签条** —— 用契约里的 `ctx.emit(OPEN_DOC, { id })` 广播，
 * 标签条 / 编辑器那边 `ctx.on(OPEN_DOC, …)` 收（声明补丁见 `./events.ts`）。
 *
 * 树怎么搭 / 分组怎么筛在 `./tree.ts`（纯函数，能单独断言）；怎么画在 `./sidebar.tsx`。
 */
import type { Context } from 'cordis'
import { createElement } from 'react'
// 契约靠 module augmentation 挂到 Context 上；显式 import 一次，保证它进了编译单元。
import type {} from '../../src/kernel/contract'
import { Sidebar } from './sidebar'

export const name = 'shell-sidebar'

// 依赖走 inject 声明（CONVENTIONS §6.4）：rpc 读写文档、slot 挂侧栏、settings 记住分组。
// i18n 是组合根服务（main.tsx 先 provide 了，见 contract.ts 末尾），写不写都能装载；
// 写上是自我说明 —— 组件里每一处 `ctx.i18n.t()` 都是这条声明在兜底。
export const inject = ['rpc', 'slot', 'settings', 'command', 'i18n']

export function apply(ctx: Context) {
  // 逆函数是显式纪律（D-0033）：`register` 返回的就是它的 unregister，交给 ctx.effect 记账 ——
  // 卸载时自动撤销，不留半棵侧栏。
  ctx.effect(() => ctx.slot.register('sidebar.item', () => createElement(Sidebar, { ctx })))
}
