/**
 * `kb-graph` —— 知识图谱画布（D-0181 ~ D-0189，全文 `docs/kb.md` §6）。
 *
 * 一页（`./page.tsx` + `./graph.ts`），挂 `main.home` + `ListGroup` 的 `'graph'`。
 * ★ 布局自己写（`./graph.ts`），**不引任何图布局库**（CONVENTIONS §6.7）——
 *   仓库里现在一个都没有，`mermaid` 只画代码块、没有物理模拟。
 * ★ `'graph'` 这个 ListGroup 值契约阶段就加好了（`contract.ts`），这里只读不改。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { SHOW_LIST } from '../../src/kernel/contract'
import { GraphPage, setGraphPage } from './page'

export const name = 'kb-graph'

// rpc：`doc:list` / `kb:graph`；slot：挂 main.home；i18n：词条在契约阶段加齐了。
export const inject = ['rpc', 'slot', 'i18n']

export function apply(ctx: Context) {
  ctx.effect(() => [
    // 跟 vfs / bugs / files / inbox 同一条路：这一页在主区切过去时自己显，别人显示时自己让开。
    ctx.on(SHOW_LIST, ({ group }) => setGraphPage(group === 'graph')),
    ctx.slot.register('main.home', () => createElement(GraphPage, { ctx })),
  ])
}
