/**
 * `doc.aside` 槽 —— 评论那一层（D-0172）。
 *
 * **两种落法，同一份卡片**：
 *   - 浮卡：正文那一栏够宽 → portal 到编辑器留在滚动区里的那个零尺寸层上，
 *     每张卡竖着摆到它锚点的高度；挨太近的往下让，让开的画一根引线指回原文。
 *   - 窄栏：栏宽不够 → 退回主区右侧一列，卡片竖着排（就是以前那个位置，只是没了
 *     「评论」那个头和底部常驻输入框）。
 *
 * 「够不够宽」由**编辑器**算（它才知道正文那一栏有多宽、留白让给谁），这里只读 `mode`。
 * 摆位不走 React：卡片 DOM 挂上之后直接写 `style.top`（下面那个 `useLayoutEffect`）——
 * 走 state 就是每摆一次多一轮渲染，而且中间那一帧卡片还叠在 `top: 0` 上。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from 'cordis'
import { COMMENT_LAYOUT, type CommentLayout } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { PAGE_ID, ThreadCard, WriteCard, type Refs } from './cards'
import { GAP } from './size'
import { groupThreads, useCommentState } from './state'
import * as s from './comment.css'

export function CommentLayer({ ctx }: { ctx: Context }) {
  const st = useCommentState()
  const refs: Refs = { cards: useRef(new Map()), leads: useRef(new Map()) }
  const [layout, setLayout] = useState<CommentLayout | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)

  const threads = useMemo(() => groupThreads(st.comments), [st.comments])
  const shown = useMemo(() => {
    const open = threads.filter((t) => !t.root.resolved)
    if (!st.showResolved) return open
    return [...open, ...threads.filter((t) => t.root.resolved)]
  }, [threads, st.showResolved])

  // 要摆位的只有**有正文锚点**的那些 —— 页面级 / 块级量不出 Y，排在末尾。
  const ids = useMemo(
    () => shown.filter((t) => t.root.anchor === 'inline').map((t) => t.root.id),
    [shown],
  )

  const open = st.open
  useEffect(() => {
    let alive = true
    const run = () => {
      void ctx.editor
        .ready()
        .then(() => {
          if (!alive) return
          // 关着的时候也调一次（`ids` 给空）—— 正文右侧那条留白要收回去。
          setLayout(ctx.editor.commentLayout(open ? ids : []))
          setHost(open ? ctx.editor.commentLayer() : null)
        })
        .catch((err) => reportError('comment', err))
    }
    run()
    const off = ctx.on(COMMENT_LAYOUT, run)
    return () => {
      alive = false
      off()
    }
  }, [ctx, open, ids])

  const float = layout?.mode === 'float' && host !== null

  // 摆位：按锚点 Y 从小到大，挨太近的依次下推；页面级那张卡贴正文末尾。
  // ★ `useLayoutEffect`：`useEffect` 在 paint 之后跑，卡片会先在 `top: 0` 上叠一帧再散开。
  useLayoutEffect(() => {
    if (layout === null) return
    const cards = refs.cards.current
    const leads = refs.leads.current
    // 退回窄栏时把引线收干净 —— 卡片本身有 `top` 内联样式无所谓（静态定位下它不生效），
    // 引线是绝对定位的，不收就会留一条飘在卡片外面。
    if (!float) {
      for (const el of leads.values()) el.style.display = 'none'
      return
    }
    const entries = shown.map((t) => ({ id: t.root.id, y: layout.tops[t.root.id] as number | undefined }))
    entries.sort((a, b) => (a.y ?? Number.POSITIVE_INFINITY) - (b.y ?? Number.POSITIVE_INFINITY))

    let cursor = Number.NEGATIVE_INFINITY
    for (const e of entries) {
      const el = cards.get(e.id)
      if (!el) continue
      const floor = Number.isFinite(cursor) ? cursor + GAP : 0
      const top = e.y === undefined ? floor : Math.max(e.y, floor)
      el.style.top = `${top}px`
      cursor = top + el.offsetHeight

      const lead = leads.get(e.id)
      if (!lead) continue
      const pushed = e.y !== undefined && top - e.y > 8
      lead.style.display = pushed ? '' : 'none'
      if (pushed && e.y !== undefined) lead.style.top = `${e.y - top}px`
    }

    const write = cards.get(PAGE_ID)
    if (write) {
      const floor = Number.isFinite(cursor) ? cursor + GAP : 0
      write.style.top = `${Math.max(layout.contentHeight + 24, floor)}px`
    }
  })

  if (!open || st.docId === null) return null

  const cards = (
    <>
      {/* 出错那句话只在窄栏里占位 —— 浮卡那一层是绝对定位的，塞一段静态文字进去会和卡片叠上。
          浮卡模式下这条错误走 `reportError`（右上角那几条，AGENTS.md §3 的正路）。 */}
      {st.error && !float ? <p className={s.error}>{st.error}</p> : null}
      {shown.length === 0 ? <p className={s.empty}>{ctx.i18n.t('comment.empty')}</p> : null}
      {shown.map((t) => (
        <ThreadCard key={t.root.id} ctx={ctx} thread={t} dock={!float} refs={refs} />
      ))}
      <WriteCard ctx={ctx} refs={refs} dock={!float} />
    </>
  )

  if (float && host) {
    return createPortal(<div className={s.float}>{cards}</div>, host)
  }
  return (
    <aside className={s.dock}>
      <div className={s.stack}>{cards}</div>
    </aside>
  )
}
