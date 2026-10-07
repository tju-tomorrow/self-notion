/**
 * 文档页顶栏那颗入口：开关**右侧那一列**助手（D-0098）。
 *
 * 为什么还要它：整页那个（`AGENT_TAB_ID` 那个标签）会把正文顶掉，而用户要的是
 * 「边聊 边看到 笔记」—— 所以助手还能收进右边一列，跟评论列、网页版 AI 列并排。
 *
 * ★ 位置和样子是用户定的（D-0106）：「给一个icon就这个宠物 在打开网页版AI右边一位
 *   就直接打开这样的局面」—— 图标是**那只宠物**，位置在网页版 AI 那颗的右边一位。
 *   那一格是 `doc.header.agent`（单独一格）：同一格里的左右由装载顺序决定，钉不住位置。
 *
 * ★ 为什么就放在文档页顶栏：那右边一列本来就只在文档页里（`doc.aside.agent` 挂在 `docBody`），
 *   主页/助手那一页根本没有可以「收」的东西。
 */
import type { ReactNode } from 'react'
import type { Context } from 'cordis'
import { AiIcon } from '@blocksuite/icons/rc'

import { reportNote } from '../../src/kernel/errors'
import * as s from './ai.css'
import { toggleDock, useAiState } from './state'

export function AgentEntry({ ctx }: { ctx: Context }) {
  const st = useAiState()
  const label = ctx.i18n.t('agent.open')
  const pet = ctx.get('mascot')

  return (
    <button
      type="button"
      className={st.docked ? `${s.entry} ${s.entryOn}` : s.entry}
      title={label}
      aria-label={label}
      aria-expanded={st.docked}
      onClick={() => {
        // ★ 留一行痕：这一颗点下去到底有没有人接，翻 `pnpm logs` 就知道 ——
        //   不用再靠「点了没反应」两边猜（D-0104 续）。
        reportNote('ai', `助手侧栏：${st.docked ? '收' : '开'}`)
        toggleDock()
      }}
    >
      {/* **就是那只宠物**（用户：「给一个icon就这个宠物」）—— 跟左下角那一格、标签条上那颗
          是同一只。宠物插件不在就退成一颗普通的 AI 图标。 */}
      {pet ? (pet.face(20) as ReactNode) : <AiIcon width={18} height={18} />}
    </button>
  )
}
