/**
 * 文档页顶栏那颗入口：开关**右侧那一列**助手（D-0098）。
 *
 * 为什么还要它：整页那个（`AGENT_TAB_ID` 那个标签）会把正文顶掉，而用户要的是
 * 「边聊 边看到 笔记」—— 所以助手还能收进右边一列，跟评论列、网页版 AI 列并排。
 *
 * ★ 位置在网页版 AI 那颗的右边一位（D-0106），单独一格 `doc.header.agent` ——
 *   同一格里的左右由装载顺序决定，钉不住位置。
 *
 * ★ 为什么就放在文档页顶栏：那右边一列本来就只在文档页里（`doc.aside.agent` 挂在 `docBody`），
 *   主页/助手那一页根本没有可以「收」的东西。
 */
import type { Context } from 'cordis'
import { AiIcon } from '@blocksuite/icons/rc'

import { reportNote } from '../../src/kernel/errors'
import * as s from './ai.css'
import { toggleDock, useAiState } from './state'

export function AgentEntry({ ctx }: { ctx: Context }) {
  const st = useAiState()
  const label = ctx.i18n.t('agent.open')

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
      <AiIcon width={18} height={18} />
    </button>
  )
}
