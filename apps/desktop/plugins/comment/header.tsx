/**
 * `doc.header` 槽 —— 顶栏那一行里的评论入口（一颗图标 + 未解决数角标）。
 *
 * 那一行（44 高 + 底线）由外壳出，槽里注册的每一项就是行里的一格；这一格排在前一格
 * （`shell-doc-header` 的面包屑 + ⋯）后面，所以按钮落在 ⋯ 的右边。
 */
import type { Context } from 'cordis'
import { CommentIcon } from '@blocksuite/icons/rc'
import { closePanel, openPanel } from './actions'
import { unresolvedCount, useCommentState } from './state'
import { CommentBubble } from './bubble'
import { Hint } from '../../src/ui/hint'
import * as s from './comment.css'

export function CommentHeader({ ctx }: { ctx: Context }) {
  return (
    <>
      <Entry ctx={ctx} />
      <CommentBubble ctx={ctx} />
    </>
  )
}

function Entry({ ctx }: { ctx: Context }) {
  const st = useCommentState()
  const n = unresolvedCount(st.comments)
  return (
    <div className={s.entryBar}>
      <Hint text={ctx.i18n.t('comment.open')}>
        <button
          type="button"
          className={st.open ? `${s.iconButton} ${s.iconButtonOn}` : s.iconButton}
          aria-label={ctx.i18n.t('comment.open')}
          onClick={() => {
            if (st.open) closePanel()
            else void openPanel(ctx)
          }}
        >
          <CommentIcon width={18} height={18} />
          {n > 0 ? <span className={s.badge}>{n > 99 ? '99+' : n}</span> : null}
        </button>
      </Hint>
    </div>
  )
}
