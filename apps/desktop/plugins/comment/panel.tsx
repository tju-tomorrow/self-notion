/**
 * `doc.aside` 槽 —— 主区右侧那一列：头 + 列表 + 底部常驻输入框。
 *
 * 未解决的在上面（时间升序），下面一条分隔线接「已解决」折叠区（默认收起）。
 * 面板关着的时候整块返回 null —— 槽宿主不给插件包壳，返回 null 那一列宽度就是 0。
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { fullTime, timeAgo } from '../../src/ui/timeago'
import type { Context } from 'cordis'
import { ArrowDownSmallIcon, CloseIcon } from '@blocksuite/icons/rc'
import type { Comment } from '../../src/kernel/contract'
import {
  commentOnPage,
  removeComment,
  replyTo,
  setResolved,
  updateBody,
} from './actions'
import { groupThreads, setCommentState, useCommentState, type Thread } from './state'
import * as s from './comment.css'

type Nodes = RefObject<Map<string, HTMLElement>>

export function CommentPanel({ ctx }: { ctx: Context }) {
  const st = useCommentState()
  const nodes: Nodes = useRef(new Map<string, HTMLElement>())

  // 定位到某条：滚进视野 + 闪一下（1.4 秒后自己灭掉，`spot` 清空后同一条还能再点）。
  const spot = st.spot
  useEffect(() => {
    if (!spot) return
    nodes.current.get(spot.id)?.scrollIntoView({ block: 'center' })
    const timer = setTimeout(() => setCommentState({ spot: null }), 1400)
    return () => clearTimeout(timer)
  }, [spot])

  if (!st.open || st.docId === null) return null

  const threads = groupThreads(st.comments)
  const open = threads.filter((t) => !t.root.resolved)
  const done = threads.filter((t) => t.root.resolved)

  return (
    <aside className={s.panel}>
      <div className={s.head}>
        <span className={s.headTitle}>{ctx.i18n.t('comment.title')}</span>
        <button
          type="button"
          className={s.iconButton}
          title={ctx.i18n.t('comment.close')}
          onClick={() => setCommentState({ open: false })}
        >
          <CloseIcon width={18} height={18} />
        </button>
      </div>

      <div className={s.list}>
        {st.error ? <p className={s.error}>{st.error}</p> : null}
        {open.length === 0 && done.length === 0 ? (
          <p className={s.empty}>{ctx.i18n.t('comment.empty')}</p>
        ) : null}

        {open.map((t) => (
          <Thread key={t.root.id} ctx={ctx} thread={t} nodes={nodes} />
        ))}

        {done.length > 0 ? (
          <>
            <div className={s.divider} />
            <button
              type="button"
              className={s.resolvedToggle}
              onClick={() => setCommentState({ resolvedOpen: !st.resolvedOpen })}
            >
              <span className={st.resolvedOpen ? `${s.caret} ${s.caretOpen}` : s.caret}>
                <ArrowDownSmallIcon width={14} height={14} />
              </span>
              {ctx.i18n.t('comment.resolved')} {done.length}
            </button>
            {st.resolvedOpen
              ? done.map((t) => <Thread key={t.root.id} ctx={ctx} thread={t} nodes={nodes} />)
              : null}
          </>
        ) : null}
      </div>

      <div className={s.foot}>
        <Composer ctx={ctx} kind="page" placeholder={ctx.i18n.t('comment.placeholder')} />
        <p className={s.hint}>回车发送 · Shift+回车换行</p>
      </div>
    </aside>
  )
}

/** 一条评论 + 它下面的回复 + 回复框。 */
function Thread({ ctx, thread, nodes }: { ctx: Context; thread: Thread; nodes: Nodes }) {
  const st = useCommentState()
  return (
    <>
      <Row ctx={ctx} comment={thread.root} nodes={nodes} />
      {thread.replies.map((r) => (
        <Row key={r.id} ctx={ctx} comment={r} nodes={nodes} reply />
      ))}
      {st.replyTo === thread.root.id ? (
        <div className={s.replyBox}>
          <Composer ctx={ctx} kind="reply" parent={thread.root} placeholder={ctx.i18n.t('comment.replyPlaceholder')} autoFocus />
        </div>
      ) : null}
    </>
  )
}

function Row({
  ctx,
  comment: c,
  nodes,
  reply,
}: {
  ctx: Context
  comment: Comment
  nodes: Nodes
  reply?: boolean
}) {
  const st = useCommentState()
  const spot = st.spot?.id === c.id
  const draft = c.body === ''
  const [editing, setEditing] = useState(false)

  return (
    <div
      ref={(el) => {
        if (el) nodes.current.set(c.id, el)
        else nodes.current.delete(c.id)
      }}
      data-comment-id={c.id}
      data-flash={spot}
      className={reply ? s.replyItem : s.item}
    >
      {c.quote ? <div className={s.quoted}>{c.quote}</div> : null}

      {draft || editing ? (
        <Composer
          ctx={ctx}
          kind="body"
          id={c.id}
          initial={draft ? '' : c.body}
          placeholder={ctx.i18n.t('comment.placeholder')}
          autoFocus={spot || editing}
          onSent={() => setEditing(false)}
          onCancel={() => (draft ? void removeComment(ctx, c.id, false) : setEditing(false))}
        />
      ) : (
        <>
          {c.anchor === 'page' ? (
            <span className={s.pageTag}>{ctx.i18n.t('comment.pageTag')}</span>
          ) : null}
          <p className={s.body}>{c.body}</p>
        </>
      )}

      <div className={s.meta}>
        <span className={s.metaName}>{ctx.i18n.t('comment.me')}</span>
        <span>·</span>
        <span title={fullTime(c.createdAt)}>{timeAgo(c.createdAt)}</span>
      </div>

      <div className={s.actions}>
        {draft || reply ? null : (
          <button type="button" className={s.action} onClick={() => setEditing(true)}>
            {ctx.i18n.t('comment.edit')}
          </button>
        )}
        {c.resolved || reply ? null : (
          <button
            type="button"
            className={s.action}
            onClick={() => setCommentState({ replyTo: st.replyTo === c.id ? null : c.id })}
          >
            {ctx.i18n.t('comment.reply')}
          </button>
        )}
        {reply ? null : (
          <button
            type="button"
            className={s.action}
            onClick={() => void setResolved(ctx, c.id, !c.resolved)}
          >
            {c.resolved ? ctx.i18n.t('comment.reopen') : ctx.i18n.t('comment.resolve')}
          </button>
        )}
        <button type="button" className={s.action} onClick={() => void removeComment(ctx, c.id, true)}>
          {ctx.i18n.t('comment.remove')}
        </button>
      </div>
    </div>
  )
}

/**
 * 三种输入框同一份身子：底部那条（对整页）、草稿评论（`body` 空串的那条）、回复。
 * 回车发出、Shift+回车换行、Esc 撤。
 */
function Composer({
  ctx,
  kind,
  id,
  parent,
  placeholder,
  initial = '',
  autoFocus,
  onSent,
  onCancel,
}: {
  ctx: Context
  kind: 'page' | 'body' | 'reply'
  id?: string
  parent?: Comment
  placeholder: string
  /** 编辑已有评论时的开头内容。 */
  initial?: string
  autoFocus?: boolean
  onSent?: () => void
  onCancel?: () => void
}) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const send = () => {
    const value = text.trim()
    if (value === '') return
    if (kind === 'page') {
      // 发成功了才清空 —— 失败了输入的东西还在，能再按一次。
      void commentOnPage(ctx, value).then((ok) => {
        if (!ok) return
        setText('')
        if (ref.current) ref.current.style.height = ''
      })
    } else if (kind === 'reply' && parent) {
      void replyTo(ctx, parent, value)
    } else if (id !== undefined) {
      void updateBody(ctx, id, value).then((ok) => {
        if (ok) onSent?.()
      })
    }
  }

  return (
    <div className={s.inputRow}>
      <textarea
        ref={ref}
        className={s.input}
        rows={1}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          // 跟着内容长高（到 160 就自己滚）
          e.target.style.height = 'auto'
          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel?.()
          }
        }}
      />
      {kind === 'body' && onCancel ? (
        <button type="button" className={s.action} onClick={onCancel}>
          {ctx.i18n.t('comment.cancel')}
        </button>
      ) : null}
    </div>
  )
}

