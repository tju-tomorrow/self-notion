/**
 * `kb` —— 知识库的服务面 + agent 工具面（D-0181…D-0189，全文 `docs/kb.md` §6）。
 *
 * 三件事，都在这一份里：
 *   1. `provide('kb')` —— 收件箱 / 图谱 / 侧栏读的那一层（`./service.ts`，D-0189）；
 *   2. 从 `kb:tools` 拉目录、逐条包成 `ToolSpec` 注册（`./tools.ts`，D-0187「一份目录两处运输」）；
 *   3. 设置页一段 —— 自动整理开关 / embedding 模型 / 「现在整理一轮」/ 计数（`./view.tsx`）。
 *
 * ★ 全部经 `ctx.rpc` 走 `kb:*`，本地不留缓存（Rust 是唯一真相源，CONVENTIONS §4）。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { makeKbService } from './service'
import { registerKbTools } from './tools'
import { KbSection } from './view'

export const name = 'kb'

// rpc：全部 `kb:*` 命令。settings：自动整理开关。i18n / slot：设置页那一段。
// ★ `tools` 是软依赖（`ctx.get('tools')`），**不写进 inject** —— 漏了 rpc 才是永久 PENDING（D-0045）。
export const inject = ['rpc', 'settings', 'i18n', 'slot']

export function apply(ctx: Context) {
  ctx.effect(() => ctx.provide('kb', makeKbService(ctx)))

  registerKbTools(ctx)

  const section = () => createElement(KbSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('kb.settings.title')
  ;(section as { group?: string }).group = 'integration'
  ctx.effect(() => ctx.slot.register('settings.section', section))
}
