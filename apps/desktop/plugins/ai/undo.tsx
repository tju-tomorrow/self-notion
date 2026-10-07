/**
 * 撤销条 —— **一个回合一条**（`docs/ai.md` 第六节：撤销的单位是回合，不是文档）。
 *
 * 位置在左下角：右下角是 toast 的地盘，压着会互相盖住。条子自己不走槽（覆盖层），
 * 和面板同一个 root 渲染 —— 收起面板时它还在（用户可能正是收起之后才想撤）。
 *
 * 为什么是「条」不是弹窗：用户要的是**可撤销**，不是每次问一遍（`docs/ai.md` 第六节）。
 * 所以这里只有一颗「全部撤销」，没有确认框 —— 撤销本身也是可逆的（Rust 先把现在记一个版本）。
 */
import type { Context } from 'cordis'

import * as s from './ai.css'
import { undo } from './loop'
import { useAiState, type Undo } from './state'

export function AiUndo({ ctx }: { ctx: Context }) {
  const st = useAiState()
  if (!st.undo.length) return null

  return (
    <div className={s.bars}>
      {st.undo.map((entry) => (
        <Bar key={entry.groupId} ctx={ctx} entry={entry} />
      ))}
    </div>
  )
}

function Bar({ ctx, entry }: { ctx: Context; entry: Undo }) {
  return (
    <div className={s.bar}>
      <span>{ctx.i18n.t('agent.undoBar', { n: entry.docs.length })}</span>
      <button type="button" className={s.barAction} onClick={() => void undo(ctx, entry)}>
        {ctx.i18n.t('agent.undoAll')}
      </button>
    </div>
  )
}
