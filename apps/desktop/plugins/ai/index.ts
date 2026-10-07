/**
 * 内置助手（D-0042 / D-0043 / D-0087）—— 问和写，写必可撤销。
 *
 * 四件事：
 *   1. **provide `ctx.ai`** —— 契约里那个 `AiService`，实现在 `chat.ts`（Rust 的流 → 迭代器）；
 *   2. **agent 循环**（`loop.ts`）—— 工具面来自 `ctx.tools`（唯一消费者就是这里，D-0042），
 *      一次问答一个回合，改了哪些文档记在撤销条上；
 *   3. **两块地儿**（`panel.tsx`）—— 整页（`AiPanel`，挂 `main.page`，开它就等于在标签条里
 *      开一个虚拟标签 `AGENT_TAB_ID`，D-0095）和**右侧那一列**（`AgentDock`，挂 `doc.aside.agent`，
 *      文档顶栗那颗宠物的按钮开关，D-0098）—— 后者是用户那句「边聊 边看到 笔记」。
 *   4. **一条撤销条**（`undo.tsx`）—— 覆盖层，自绘 + 自己开 root（它不属于哪一页）。
 *
 * 两个入口：⌘K 里那一行命令，和**侧栏左下角那只宠物**（点一下开助手）。
 * 宠物那一头走 `ctx.provide('agent', …)` —— 跨插件只能走契约（D-0052），
 * `plugins/mascot/` 那边是 `ctx.get('agent')?.toggle()`。
 *
 * 联网、key、SSE 全在 Rust（`src-tauri/src/ai/chat.rs`）：这个插件**不声明 `net`**，
 * 也不碰 key（它只知道「配没配」，那是 `ai:status` 的话）。
 */
import type { Context } from 'cordis'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

import { AGENT_TAB_ID, OPEN_DOC } from '../../src/kernel/contract'
import { makeAi } from './chat'
import { AgentEntry } from './entry'
import { installHistory } from './history'
import { AgentDock, AiPanel } from './panel'
import { setAiState } from './state'
import { toggleDock } from './state'
import { AiUndo } from './undo'

export const name = 'plugin-ai'

// rpc：`ai:chat` / `version:*`；editor：撤销之后让它丢掉活文档重读；
// command：⌘K 里那一行入口；i18n：页面和撤销条的文案；
// settings：会话历史（`history.ts`）；slot：`main.page` 那一页 + `doc.aside.agent` 那一列
// + `doc.header.agent` 那颗开关按钮。
// ★ `undo.tsx` 那条撤销条还是自己开 root 的覆盖层，不走槽。
export const inject = ['rpc', 'command', 'i18n', 'editor', 'settings', 'slot']

export function apply(ctx: Context) {
  const ai = makeAi(ctx)
  ctx.effect(() => ctx.provide('ai', ai))

  /** 开助手 = 打开那个虚拟标签（D-0095）：标签条据此加/切一个标签，外壳据此把主区让出来。 */
  const open = () => ctx.emit(OPEN_DOC, { id: AGENT_TAB_ID })

  // 入口一：命令面板。它读一次 `list()` 就够了（契约里就是这么定的）。
  // ★ 两条：开**整页**（会把正文顶掉）和开**右侧那一列**（边聊边看笔记）。
  const dock = () => toggleDock()
  ctx.effect(() => [
    ctx.command.register({
      id: 'agent.open',
      title: ctx.i18n.t('agent.open'),
      run: open,
    }),
    ctx.command.register({
      id: 'agent.dock',
      title: ctx.i18n.t('agent.dock'),
      run: dock,
    }),
  ])

  // 用户在看哪一篇：跟标签条/侧栏同一条事件。**助手自己那个虚拟标签不算** ——
  // 它一开，正文就没了，用户看的还是刚才那一篇。
  ctx.effect(() =>
    ctx.on(OPEN_DOC, ({ id }) => {
      if (id !== AGENT_TAB_ID) setAiState({ viewingDoc: id })
    }),
  )

  // 入口二：侧栏左下角那只宠物（`plugins/mascot/` 的 `ctx.get('agent')?.toggle()`）。
  // 叫 `toggle` 是留着手感一致（那一格原来就是开关）—— 现在关掉它只能点标签上那个 ×，
  // 标签条的状态机是它自己的内部状态，外面没有「关掉某个标签」的口子。
  ctx.effect(() => ctx.provide('agent', { toggle: open }))

  ctx.effect(() => [
    installHistory(ctx),
    ctx.slot.register('main.page', () => createElement(AiPanel, { ctx, ai })),
    // 右侧那一列（D-0098）：关着的时候它自己返回 null → 那里一个节点都没有 → 宽度 0。
    // ★ 必须**总是**注册：槽宿主不看 `docked`，注册处拿不到重新渲染的时机。
    ctx.slot.register('doc.aside.agent', () => createElement(AgentDock, { ctx, ai })),
    // ★ 就在**网页版 AI 那颗的右边一位**（用户 D-0106）。单独一格 `doc.header.agent` ——
    //   同槽里的左右是装载顺序说了算（`scanner.ts` 并发装载），挤在 `doc.header.right` 里钉不住。
    // ★ 助手那一页上那颗「收」不在这儿，写在 `panel.tsx` 的 `AiPanel` 里（那一页没有这一行）。
    ctx.slot.register('doc.header.agent', () => createElement(AgentEntry, { ctx })),
  ])

  // 撤销条：body 上自己的一个 root。逆函数只拆自己建的东西，
  // **不在 disposer 里注册任何 effect**（D-0045 硬纪律 9）。
  ctx.effect(() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(createElement(AiUndo, { ctx }))
    return () => {
      root.unmount()
      host.remove()
    }
  })
}
