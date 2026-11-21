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
import { CloseIcon } from '@blocksuite/icons/rc'
import { COMMENT_LAYOUT, type CommentLayout } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { closePanel, pendingTarget } from './actions'
import { DRAFT_ID, DraftCard, PAGE_ID, ThreadCard, type Refs } from './cards'
import { CARD_W, GAP } from './size'
import { groupThreads, useCommentState } from './state'
import * as s from './comment.css'

/** 外壳把移动判定写在 html / [data-sn-shell] 上；UA 命中的 iPad 也算手机。 */
function onMobile(): boolean {
  return (
    document.documentElement.dataset.mobile === '1' ||
    document.querySelector('[data-sn-shell][data-mobile="1"]') !== null
  )
}

export function CommentLayer({ ctx }: { ctx: Context }) {
  const st = useCommentState()
  const mobile = onMobile()
  const refs: Refs = { cards: useRef(new Map()), leads: useRef(new Map()) }
  const boxRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<CommentLayout | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)

  const threads = useMemo(
    () => groupThreads(st.comments.filter((c) => c.parentId !== null || c.body.trim() !== '')),
    [st.comments],
  )
  const shown = useMemo(() => {
    const open = threads.filter((t) => !t.root.resolved)
    if (!st.showResolved) return open
    return [...open, ...threads.filter((t) => t.root.resolved)]
  }, [threads, st.showResolved])

  // 要摆位的只有**有正文锚点**的那些 —— 页面级量不出 Y，排在末尾。块级按块 id 量（`comment.ts`）。
  const ids = useMemo(() => {
    const anchored = shown.filter((t) => t.root.anchor !== 'page').map((t) => t.root.id)
    // 有输入框也要把右侧留白打开，不然它只能退到窄栏里。
    return st.draft ? [...anchored, DRAFT_ID] : anchored
  }, [shown, st.draft])

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
    const docId = st.docId
    const entries = shown.map((t) => {
      let y = layout.tops[t.root.id] as number | undefined
      // 草稿还没 mark，tops 里没有它，不补就会被当成 0 钉在右上角。
      if (y === undefined && docId !== null) {
        const at = pendingTarget(t.root.id)
        if (at) {
          const index = at.kind === 'inline' ? at.index : 0
          y = ctx.editor.commentAnchorTop(docId, at.blockId, index) ?? undefined
        }
      }
      return { id: t.root.id, y }
    })
    if (st.draft && docId !== null) {
      const y = ctx.editor.commentAnchorTop(docId, st.draft.blockId, st.draft.index) ?? undefined
      entries.push({ id: DRAFT_ID, y })
    }
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

    // 卡片贴着版心右缘，不贴窗口右缘。版心是居中的，贴窗口就会飘在老远。
    const box = boxRef.current
    const pane = host?.parentElement
    const col = pane?.querySelector<HTMLElement>('.sn-block, .sn-pm-title')
    if (box && pane && col) {
      const paneBox = pane.getBoundingClientRect()
      const beside = paneBox.right - col.getBoundingClientRect().right - GAP - CARD_W
      const room = paneBox.width - CARD_W - 12
      box.style.right = `${Math.max(0, Math.min(room, beside))}px`
    }
  })

  if (!open || st.docId === null) return null

  const cards = (
    <>
      {/* 出错那句话只在窄栏里占位 —— 浮卡那一层是绝对定位的，塞一段静态文字进去会和卡片叠上。
          浮卡模式下这条错误走 `reportError`（右上角那几条，AGENTS.md §3 的正路）。 */}
      {st.error && !float ? <p className={s.error}>{st.error}</p> : null}
      {shown.length === 0 && !st.draft ? <p className={s.empty}>{ctx.i18n.t('comment.empty')}</p> : null}
      {st.draft ? <DraftCard ctx={ctx} dock={!float} refs={refs} /> : null}
      {shown.map((t) => (
        <ThreadCard key={t.root.id} ctx={ctx} thread={t} dock={!float} refs={refs} />
      ))}
    </>
  )

  if (float && host) {
    return createPortal(
      <div ref={boxRef} className={s.float}>
        {cards}
      </div>,
      host,
    )
  }
  const dockEl = (
    <aside className={mobile ? `${s.dock} ${s.dockSheetOn}` : s.dock}>
      {mobile ? (
        <div className={s.sheetBar}>
          <span className={s.sheetGrip} aria-hidden="true" />
          <button
            type="button"
            className={s.sheetClose}
            aria-label={ctx.i18n.t('comment.collapse')}
            onClick={closePanel}
          >
            {ctx.i18n.t('comment.collapse')}
          </button>
        </div>
      ) : (
        <div className={s.dockBar}>
          <button
            type="button"
            className={s.dockClose}
            title={ctx.i18n.t('comment.collapse')}
            aria-label={ctx.i18n.t('comment.collapse')}
            onClick={closePanel}
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      )}
      <div className={mobile ? `${s.stack} ${s.stackSheetOn}` : s.stack}>{cards}</div>
    </aside>
  )
  // 挂到 body 才压得住底部导航与 FAB：外壳那几层 fadeIn 会自成层叠上下文。
  return mobile ? createPortal(dockEl, document.body) : dockEl
}
