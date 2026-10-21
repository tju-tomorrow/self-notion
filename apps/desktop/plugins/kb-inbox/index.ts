/**
 * `kb-inbox` —— 整理建议收件箱（D-0181 ~ D-0189，全文 `docs/kb.md` §6）。
 *
 * 策展人（`kb::curator`）在后台把「标签 / 主题 / 关联 / 实体 / 标签合并」的建议写进
 * `proposal` 表，高置信的直接落库、剩下的堆在收件箱等人点。这个插件就是那个收件箱：
 * 一页（`./page.tsx`）+ `kb:proposals` / `kb:proposal` 两条命令，没有别的。
 *
 * ★ 挂 `main.home` 不是 `main.page`：外壳只有 home / doc / agent 三支，`main.page` 只在
 *   助手那一页渲染；收件箱要跟 vfs / bugs / files 一样蹭「主区该显示哪一页」那条路。
 *   `'inbox'` 这个 ListGroup 契约阶段就加好了（`contract.ts`），这里只读不改。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { SHOW_LIST } from '../../src/kernel/contract'
import { InboxPage, setInboxPage } from './page'

export const name = 'kb-inbox'

// rpc：两条 kb:* 命令；slot：挂 main.home；i18n：词条在契约阶段加齐了。
export const inject = ['rpc', 'slot', 'i18n']

export function apply(ctx: Context) {
  ctx.effect(() => [
    // 跟 vfs / bugs / files 同一条路：这一页在主区切过去时自己显，别人显示时自己让开。
    ctx.on(SHOW_LIST, ({ group }) => setInboxPage(group === 'inbox')),
    ctx.slot.register('main.home', () => createElement(InboxPage, { ctx })),
  ])
}
