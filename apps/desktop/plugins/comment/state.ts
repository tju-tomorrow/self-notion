/**
 * 评论插件的模块级状态 —— 面板 / 顶栏入口 / 浮出按钮三处共用一份。
 *
 * 订阅放在插件层（`index.ts`）、组件只读这里，理由和 `shell-doc-header/view.tsx`
 * 那段一样：组件的挂载晚于 `OPEN_DOC`。
 */
import { useSyncExternalStore } from 'react'
import type { Comment } from '../../src/kernel/contract'

export interface CommentUiState {
  docId: string | null
  /** 面板开着没有。关着的时候 `doc.aside` 那个组件返回 null，那一列宽度是 0。 */
  open: boolean
  comments: Comment[]
  /** 要滚过去 + 闪一下的那条（`at` 换一下就重新触发，点同一条两次也管用）。 */
  spot: { id: string; at: number } | null
  /** 打开着回复框的是哪条。 */
  replyTo: string | null
  resolvedOpen: boolean
  error: string
}

const EMPTY: CommentUiState = {
  docId: null,
  open: false,
  comments: [],
  spot: null,
  replyTo: null,
  resolvedOpen: false,
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

/** 正文里要打高亮的条数 —— 回复不算，未解决的才算。 */
export function unresolvedCount(comments: readonly Comment[]): number {
  let n = 0
  for (const c of comments) if (c.parentId === null && !c.resolved) n++
  return n
}
