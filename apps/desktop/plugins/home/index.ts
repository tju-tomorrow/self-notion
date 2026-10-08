/**
 * 「All docs」首页 —— 主区在**没有打开文档时**的那一页（`main.home` 槽）。
 *
 * 一行一篇文档（图标 / 标题 / 更新·创建时间 / 收藏 / ⋯），按更新时间分「今天 / 更早 / 从未更新」。
 * 数据一次全量 `doc:list`，分组纯函数在 `./group.ts`，怎么画在 `./home.tsx`、
 * 点了写什么（favorite / trash / create）也在那儿。
 *
 * 打开文档走契约里那条广播 `OPEN_DOC` —— 和侧栏同一条路，不直接调标签条。
 * 侧栏点导航行发 `SHOW_LIST` → 这里换列表页的分组（C12）。
 */
import type { Context } from 'cordis'
import { createElement } from 'react'
// 契约靠 module augmentation 挂到 Context 上；显式 import 一次，保证它进了编译单元。
import type {} from '../../src/kernel/contract'
import { SHOW_LIST } from '../../src/kernel/contract'
import { HomePage, setListGroup } from './home'

export const name = 'home'

// rpc 读写文档 / slot 挂主区 / i18n 出文案（组合根先 provide 了，写上是自我说明）。
export const inject = ['rpc', 'slot', 'i18n']

export function apply(ctx: Context) {
  // 逆函数是显式纪律（D-0033）：交给 ctx.effect 记账，卸载时不留半页。
  ctx.effect(() => [
    // 侧栏点了「全部文档 / 最近 / 收藏 / 回收站」→ 主区切到对应列表页。
    ctx.on(SHOW_LIST, ({ group }) => setListGroup(group)),
    ctx.slot.register('main.home', () => createElement(HomePage, { ctx })),
  ])
}
