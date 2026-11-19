/**
 * 一张评论卡片（一条评论 + 它的回复 + 回复框）和那个「写下评论」的输入卡。
 *
 * ★ 浮卡和窄栏**共用这一份** —— 差别只有摆位（`layer.tsx`）和「引用原文画不画」
 *   （浮卡贴在原文旁边，再抄一遍是废话）。两种形态各写一套卡片，两边迟早长歪。
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { fullTime, timeAgo } from '../../src/ui/timeago'
import type { Context } from 'cordis'
import type { Comment } from '../../src/kernel/contract'
import { commentOnPage, commitDraft, removeComment, replyTo, setResolved, updateBody } from './actions'
import { setCommentState, useCommentState, type Thread } from './state'
import * as s from './comment.css'

/** 卡片和引线的 DOM —— 摆位由 `layer.tsx` 直接写 `style.top`，不走 React（省一次重渲染）。 */
export interface Refs {
  cards: RefObject<Map<string, HTMLElement>>
  leads: RefObject<Map<string, HTMLElement>>
}

export function ThreadCard({
  ctx,
  thread,
  dock,
  refs,
}: {
  ctx: Context
  thread: Thread
  /** 窄栏里要画引用原文；浮卡不画。 */
  dock: boolean
  refs: Refs
}) {
  const st = useCommentState()
  const id = thread.root.id
  const draft = thread.root.body === ''
  const open = draft || st.expanded === id
  const place = (el: HTMLElement | null) => {
    if (el) refs.cards.current.set(id, el)
    else refs.cards.current.delete(id)
  }
  const lead = (
    <span
      ref={(el) => {
        if (el) refs.leads.current.set(id, el)
        else refs.leads.current.delete(id)
      }}
      className={s.lead}
      style={{ display: 'none' }}
    />
  )

  // 草稿只留输入框。回复 / 解决 / 删除是写完之后的事，塞进来会和输入框挤成一行。
  if (draft) {
    return (
      <div ref={place} className={dock ? s.card : `${s.card} ${s.floatPos}`}>
        {lead}
        <Composer
          ctx={ctx}
          kind="body"
          id={id}
          placeholder={ctx.i18n.t('comment.placeholder')}
          autoFocus={st.spot?.id === id}
          onCancel={() => void removeComment(ctx, id, false)}
        />
      </div>
    )
  }

  // 没展开：一行正文就够把这条和那条分开。点它、或点正文里的黄底，再摊开。
  if (!open) {
    return (
      <button
        type="button"
        ref={place}
        className={dock ? s.chip : `${s.chip} ${s.floatPos}`}
        title={dock ? thread.root.quote : undefined}
        onClick={() => {
          // 摊开卡片的同时让正文里那段闪一下 —— 只 setCommentState 的话，
          // 卡片开了、原文没反应，用户不知道评论指的是哪一段。
          setCommentState({ expanded: id })
          ctx.editor?.revealComment(id)
        }}
      >
        {lead}
        <span className={s.chipText}>{thread.root.body}</span>
        <span className={s.time}>{timeAgo(thread.root.createdAt)}</span>
      </button>
    )
  }

  return (
    <div ref={place} className={dock ? s.card : `${s.card} ${s.floatPos}`}>
      {lead}
      {dock && thread.root.quote ? <div className={s.quoted}>{thread.root.quote}</div> : null}
      <Row
        ctx={ctx}
        c={thread.root}
        onCollapse={draft ? undefined : () => setCommentState({ expanded: null, replyTo: null })}
      />
      {thread.replies.map((r) => (
        <Row key={r.id} ctx={ctx} c={r} reply />
      ))}
      {st.replyTo === id ? (
        <div className={s.reply}>
          <Composer
            ctx={ctx}
            kind="reply"
            parent={thread.root}
            placeholder={ctx.i18n.t('comment.replyPlaceholder')}
            autoFocus
          />
        </div>
      ) : null}
    </div>
  )
}

function Row({
  ctx,
  c,
  reply,
  onCollapse,
}: {
  ctx: Context
  c: Comment
  reply?: boolean
  /** 根评论上的时间能把这张卡收回一行。草稿没有这个。 */
  onCollapse?: () => void
}) {
  const st = useCommentState()
  const draft = c.body === ''
  const [editing, setEditing] = useState(false)

  const inner = (
    <>
      {draft || editing ? (
        <Composer
          ctx={ctx}
          kind="body"
          id={c.id}
          initial={draft ? '' : c.body}
          placeholder={ctx.i18n.t('comment.placeholder')}
          autoFocus={editing || st.spot?.id === c.id}
          onSent={() => setEditing(false)}
          onCancel={() => (draft ? void removeComment(ctx, c.id, false) : setEditing(false))}
        />
      ) : (
        <p className={s.body}>{c.body}</p>
      )}

      <div className={s.foot}>
        {onCollapse ? (
          <button
            type="button"
            className={s.timeBtn}
            title={`${ctx.i18n.t('comment.collapse')} · ${fullTime(c.createdAt)}`}
            onClick={onCollapse}
          >
            {timeAgo(c.createdAt)}
          </button>
        ) : (
          <span className={s.time} title={fullTime(c.createdAt)}>
            {timeAgo(c.createdAt)}
          </span>
        )}
        {c.anchor === 'page' && !reply ? (
          <span className={s.pageTag}>{ctx.i18n.t('comment.pageTag')}</span>
        ) : null}
        <div className={s.actions} data-on={editing ? '1' : '0'}>
          {reply ? null : (
            <button type="button" className={s.action} onClick={() => setEditing(true)}>
              {ctx.i18n.t('comment.edit')}
            </button>
          )}
          {c.resolved || reply ? null : (
            <button
              type="button"
              className={s.action}
              onClick={() =>
                setCommentState({
                  expanded: c.id,
                  replyTo: st.replyTo === c.id ? null : c.id,
                })
              }
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
    </>
  )

  return reply ? <div className={s.reply}>{inner}</div> : inner
}

/** 点了「评论」、还没写字的那一个输入框。不进库。 */
export const DRAFT_ID = 'sn:draft'

export function DraftCard({
  ctx,
  dock,
  refs,
}: {
  ctx: Context
  dock: boolean
  refs: Refs
}) {
  return (
    <div
      ref={(el) => {
        if (el) refs.cards.current.set(DRAFT_ID, el)
        else refs.cards.current.delete(DRAFT_ID)
      }}
      className={dock ? s.card : `${s.card} ${s.floatPos}`}
    >
      <Composer
        ctx={ctx}
        kind="draft"
        placeholder={ctx.i18n.t('comment.placeholder')}
        autoFocus
        onCancel={() => setCommentState({ draft: null })}
      />
    </div>
  )
}

/** 页面级那张卡 —— 贴在正文末尾（Notion 也是放页面最下面）。 */
export function WriteCard({ ctx, refs, dock }: { ctx: Context; refs: Refs; dock: boolean }) {
  return (
    <div
      ref={(el) => {
        if (el) refs.cards.current.set(PAGE_ID, el)
        else refs.cards.current.delete(PAGE_ID)
      }}
      className={dock ? s.writeCard : `${s.writeCard} ${s.floatPos}`}
    >
      <Composer ctx={ctx} kind="page" placeholder={ctx.i18n.t('comment.placeholder')} />
    </div>
  )
}

/** 页面级那张卡在 `refs` 里的键 —— 它没有 id（还没建出来）。 */
export const PAGE_ID = 'sn:page-comment'

/**
 * 三种输入框同一份身子：页面级（那张卡）、草稿评论（`body` 空串的那条）、回复。
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
  kind: 'page' | 'body' | 'reply' | 'draft'
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
    if (kind === 'draft') {
      void commitDraft(ctx, value).then((ok) => {
        if (!ok) return
        setText('')
      })
    } else if (kind === 'page') {
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
    <div>
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
      {(kind === 'body' || kind === 'draft') && onCancel ? (
        <div className={s.foot}>
          <button type="button" className={s.action} onClick={onCancel}>
            {ctx.i18n.t('comment.cancel')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
