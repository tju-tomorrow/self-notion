/**
 * 评论插件的模块级状态 —— 面板 / 顶栏入口 / 浮出按钮三处共用一份。
 *
 * 订阅放在插件层（`index.ts`）、组件只读这里，理由和 `shell-doc-header/view.tsx`
 * 那段一样：组件的挂载晚于 `OPEN_DOC`。
 */
import { useSyncExternalStore } from 'react'
import type { Comment } from '../../src/kernel/contract'

/** 还没发出去的那一条。写了字才进库。 */
export interface CommentDraft {
  kind: 'inline' | 'block'
  blockId: string
  index: number
  length: number
  quote: string
}

export interface CommentUiState {
  docId: string | null
  /** 评论层开着没有。关着的时候 `doc.aside` 那个组件返回 null，那一列宽度是 0，
   *  正文右侧的留白也收回去。 */
  open: boolean
  comments: Comment[]
  /** 要滚过去 + 闪一下的那条（`at` 换一下就重新触发，点同一条两次也管用）。 */
  spot: { id: string; at: number } | null
  /** 打开着回复框的是哪条。 */
  replyTo: string | null
  /** 展开着的那一条。其余收成一行（点正文高亮或点那一行再展开）。 */
  expanded: string | null
  /** 点了「评论」还没写字。不进库，关掉就当没发生。 */
  draft: CommentDraft | null
  /** 已解决的也画出来没有（D-0172）。默认不画 —— 正文旁边只留还没了结的事。 */
  showResolved: boolean
  error: string
}

const EMPTY: CommentUiState = {
  docId: null,
  open: false,
  comments: [],
  spot: null,
  replyTo: null,
  expanded: null,
  draft: null,
  showResolved: false,
  error: '',
}

let state: CommentUiState = EMPTY
const subs = new Set<() => void>()

export function getCommentState(): CommentUiState {
  return state
}

export function setCommentState(patch: Partial<CommentUiState>): void {
  state = { ...state, ...patch }
  for (const cb of subs) cb()
}

export function useCommentState(): CommentUiState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => state,
    () => state,
  )
}

/** 库里的平表 → 面板要的树（回复按 `parentId` 挂回去，时间升序）。 */
export interface Thread {
  root: Comment
  replies: Comment[]
}

export function groupThreads(comments: readonly Comment[]): Thread[] {
  const threads: Thread[] = []
  const byId = new Map<string, Thread>()
  for (const c of comments) {
    if (c.parentId !== null) continue
    const t: Thread = { root: c, replies: [] }
    threads.push(t)
    byId.set(c.id, t)
  }
  for (const c of comments) {
    if (c.parentId === null) continue
    byId.get(c.parentId)?.replies.push(c)
  }
  for (const t of threads) t.replies.sort((a, b) => a.createdAt - b.createdAt)
  return threads.sort((a, b) => a.root.createdAt - b.root.createdAt)
}

/**
 * 原文已经不在的根评论。回复跟着父评论走，不单列。
 * 页面级没有「那一段原文」。还没写进正文的草稿（`pending`）先留着。
 */
export function lostRoots(
  comments: readonly Comment[],
  pending: ReadonlySet<string>,
  live: { inlineIds: readonly string[]; blockIds: readonly string[] },
): string[] {
  const inline = new Set(live.inlineIds)
  const blocks = new Set(live.blockIds)
  const lost: string[] = []
  for (const c of comments) {
    if (c.parentId !== null || pending.has(c.id) || c.anchor === 'page') continue
    if (c.anchor === 'inline' && !inline.has(c.id)) lost.push(c.id)
    else if (c.anchor === 'block' && c.blockId !== null && !blocks.has(c.blockId)) lost.push(c.id)
  }
  return lost
}

/** 正文里还挂着、库里已经没有的锚点（撤销把字带回来时，评论不跟着复活）。 */
export function strayAnchors(
  comments: readonly Comment[],
  pending: ReadonlySet<string>,
  inlineIds: readonly string[],
): string[] {
  const known = new Set(pending)
  for (const c of comments) known.add(c.id)
  return inlineIds.filter((id) => !known.has(id))
}

/** 正文里要打高亮的条数 —— 回复不算，未解决的才算。 */
export function unresolvedCount(comments: readonly Comment[]): number {
  let n = 0
  for (const c of comments) if (c.parentId === null && !c.resolved) n++
  return n
}
