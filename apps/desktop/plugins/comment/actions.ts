/**
 * 评论的读写：库走 `ctx.rpc`（五条命令，见 docs/comment.md §七），正文里那份锚点走 `ctx.editor`。
 *
 * 两条纪律：
 *   - 列表一变就把「解决没有」推给编辑器（`setCommentStates`）—— 高亮只给未解决的；
 *   - `ctx.editor` 是懒装载的，调之前先 `ready()`；没开文档时那些方法空转，不抛。
 * 失败一律从 `reportError` 出去（AGENTS.md §3），同时在面板上留一句话 —— 不然用户看不见。
 */
import type { Comment, CommentTarget, EditorService } from '../../src/kernel/contract'
import type { Context } from 'cordis'
import { reportError } from '../../src/kernel/errors'
import { confirmDialog } from '../../src/ui/confirm'
import { getCommentState, lostRoots, setCommentState, strayAnchors, type CommentDraft } from './state'

/** 选中正文后要建的那种锚点。 */
export type Selection = {
  kind: 'inline'
  blockId: string
  index: number
  length: number
  quote: string
} | { kind: 'block'; blockId: string; quote: string }

/** 还没写正文的评论 → 它的锚点。空草稿不往正文里写高亮（D-0067 的欠账）。 */
const pendingAnchors = new Map<string, CommentTarget>()

/** 草稿的锚点。摆卡片用 —— 这时正文里还没有 mark，按 id 去量会得到 0，卡就钉在顶上。 */
export function pendingTarget(id: string): CommentTarget | undefined {
  return pendingAnchors.get(id)
}

/** 这篇的评论列表已经从库里读回来了。没读回来之前不能拿「锚点不在」当删除依据。 */
let readyDoc: string | null = null
let sweeping = false
let sweepAgain = false

export async function setDoc(ctx: Context, docId: string | null): Promise<void> {
  readyDoc = null
  setCommentState({ docId, comments: [], spot: null, replyTo: null, expanded: null, draft: null, error: '' })
  // 没文档了也要推一次：正文里的高亮得跟着撤掉。
  if (docId === null) {
    pendingAnchors.clear()
    return pushStates(ctx, [])
  }
  await load(ctx)
  if (getCommentState().docId !== docId) return
  readyDoc = docId
  await dropOrphans(ctx)
}

export async function openPanel(ctx: Context, id?: string): Promise<void> {
  const cur = getCommentState()
  // 再点同一条高亮 = 收起。没点到具体的一条（顶栏那颗）就维持现在展开的。
  const expanded = id === undefined ? cur.expanded : cur.expanded === id ? null : id
  setCommentState({
    open: true,
    error: '',
    expanded,
    replyTo: expanded === null ? null : cur.replyTo,
    spot: id ? { id, at: Date.now() } : cur.spot,
  })
  if (id !== undefined && expanded !== null) await callEditor(ctx, (e) => e.revealComment(id))
}

export function closePanel(): void {
  setCommentState({ open: false })
}

/**
 * 原文没了，评论一起删（连带回复）。
 * 行内：mark 不在了。块级：那个块不在了。页面级不动。
 * 撤销把字带回来时，评论不复活 —— 锚点再擦掉，免得留一截没有评论的高亮。
 */
export async function dropOrphans(ctx: Context): Promise<void> {
  const docId = getCommentState().docId
  if (docId === null || readyDoc !== docId) return
  if (sweeping) {
    sweepAgain = true
    return
  }
  sweeping = true
  try {
    do {
      sweepAgain = false
      await sweepOnce(ctx)
    } while (sweepAgain && getCommentState().docId === docId)
  } finally {
    sweeping = false
  }
}

async function sweepOnce(ctx: Context): Promise<void> {
  const st = getCommentState()
  const docId = st.docId
  if (docId === null || readyDoc !== docId) return
  let live: { inlineIds: string[]; blockIds: string[] } | null = null
  try {
    await ctx.editor.ready()
    if (getCommentState().docId !== st.docId) return
    live = ctx.editor.commentAnchors(docId)
  } catch (err) {
    reportError('comment', err)
    return
  }
  // 视图还没挂上：null 不是「一篇空文」，什么都别删。
  if (live === null) return
  const pending = new Set(pendingAnchors.keys())
  const lost = lostRoots(st.comments, pending, live)
  const stray = strayAnchors(st.comments, pending, live.inlineIds)
  if (lost.length === 0 && stray.length === 0) return
  try {
    for (const id of lost) {
      await ctx.rpc.call('comment:remove', { id })
      pendingAnchors.delete(id)
    }
    if (getCommentState().docId !== docId) return
    if (stray.length > 0) {
      await callEditor(ctx, (e) => e.stripCommentAnchors(docId, stray))
    }
    if (lost.length > 0) {
      const now = getCommentState()
      const patch: Partial<ReturnType<typeof getCommentState>> = {}
      if (now.spot && lost.includes(now.spot.id)) patch.spot = null
      if (now.replyTo && lost.includes(now.replyTo)) patch.replyTo = null
      if (now.expanded && lost.includes(now.expanded)) patch.expanded = null
      if (patch.spot !== undefined || patch.replyTo !== undefined || patch.expanded !== undefined) {
        setCommentState(patch)
      }
      await load(ctx)
    }
  } catch (err) {
    reportError('comment', err)
  }
}

/** 点「评论」只打开输入框。一个字没写就不进库。 */
export function commentOnSelection(_ctx: Context, sel: Selection): void {
  if (getCommentState().docId === null) return
  const draft: CommentDraft =
    sel.kind === 'inline'
      ? { kind: 'inline', blockId: sel.blockId, index: sel.index, length: sel.length, quote: sel.quote }
      : { kind: 'block', blockId: sel.blockId, index: 0, length: 0, quote: sel.quote }
  setCommentState({ open: true, draft, replyTo: null, error: '' })
}

/** 草稿里按下回车才建评论，并补上锚点。 */
export async function commitDraft(ctx: Context, body: string): Promise<boolean> {
  const docId = getCommentState().docId
  const draft = getCommentState().draft
  if (docId === null || draft === null || body.trim() === '') return false
  try {
    const made = await ctx.rpc.call<Comment>('comment:create', {
      docId,
      anchor: draft.kind,
      blockId: draft.blockId,
      quote: draft.quote,
      body,
    })
    const at: CommentTarget =
      draft.kind === 'inline'
        ? { kind: 'inline', blockId: draft.blockId, index: draft.index, length: draft.length }
        : { kind: 'block', blockId: draft.blockId }
    await callEditor(ctx, (e) => e.addCommentAnchor(made.id, at))
    setCommentState({
      draft: null,
      expanded: made.id,
      spot: { id: made.id, at: Date.now() },
      error: '',
    })
    await load(ctx)
    return true
  } catch (err) {
    return fail(ctx, err, 'comment.fail.create')
  }
}

export async function commentOnPage(ctx: Context, body: string): Promise<boolean> {
  const docId = getCommentState().docId
  if (docId === null || body.trim() === '') return false
  try {
    const made = await ctx.rpc.call<Comment>('comment:create', { docId, anchor: 'page', body })
    setCommentState({ expanded: made.id, spot: { id: made.id, at: Date.now() }, error: '' })
    await load(ctx)
    return true
  } catch (err) {
    return fail(ctx, err, 'comment.fail.send')
  }
}

export async function replyTo(ctx: Context, parent: Comment, body: string): Promise<boolean> {
  const docId = getCommentState().docId
  if (docId === null || body.trim() === '') return false
  try {
    // 回复没有自己的锚点，照父评论的抄一份 —— 库里那两列不是 NULL。
    await ctx.rpc.call<Comment>('comment:create', {
      docId,
      parentId: parent.id,
      anchor: parent.anchor,
      blockId: parent.blockId ?? undefined,
      body,
    })
    setCommentState({ replyTo: null, error: '' })
    await load(ctx)
    return true
  } catch (err) {
    return fail(ctx, err, 'comment.fail.reply')
  }
}

export async function updateBody(ctx: Context, id: string, body: string): Promise<boolean> {
  try {
    await ctx.rpc.call('comment:update', { id, body })
    // 草稿第一次存下正文：把先前押着的锚点补进正文。
    const at = pendingAnchors.get(id)
    if (at) {
      pendingAnchors.delete(id)
      await callEditor(ctx, (e) => e.addCommentAnchor(id, at))
    }
    await load(ctx)
    return true
  } catch (err) {
    return fail(ctx, err, 'comment.fail.save')
  }
}

export async function setResolved(ctx: Context, id: string, resolved: boolean): Promise<boolean> {
  try {
    await ctx.rpc.call('comment:resolve', { id, resolved })
    await load(ctx)
    return true
  } catch (err) {
    return fail(ctx, err, resolved ? 'comment.fail.resolve' : 'comment.fail.reopen')
  }
}

/** `confirm=false` 的是空草稿 —— 用户没写过东西，不问。 */
export async function removeComment(ctx: Context, id: string, confirm: boolean): Promise<boolean> {
  if (
    confirm &&
    !(await confirmDialog({ title: ctx.i18n.t('comment.confirmRemove'), ok: '删除', danger: true }))
  ) {
    return false
  }
  try {
    await ctx.rpc.call('comment:remove', { id })
    pendingAnchors.delete(id)
    await callEditor(ctx, (e) => e.removeCommentAnchor(id))
    const st = getCommentState()
    const patch: Partial<ReturnType<typeof getCommentState>> = {}
    if (st.spot?.id === id) patch.spot = null
    if (st.replyTo === id) patch.replyTo = null
    if (st.expanded === id) patch.expanded = null
    if (patch.spot !== undefined || patch.replyTo !== undefined || patch.expanded !== undefined) {
      setCommentState(patch)
    }
    await load(ctx)
    return true
  } catch (err) {
    return fail(ctx, err, 'comment.fail.remove')
  }
}

async function load(ctx: Context): Promise<void> {
  const docId = getCommentState().docId
  if (docId === null) return
  try {
    let comments = await ctx.rpc.call<Comment[]>('comment:list', { docId })
    if (getCommentState().docId !== docId) return
    // 以前点一下「评论」就会落一条空的。正文是空的不算评论，清掉。
    const empties = comments.filter((c) => c.parentId === null && c.body.trim() === '')
    if (empties.length > 0) {
      for (const c of empties) {
        await ctx.rpc.call('comment:remove', { id: c.id })
        pendingAnchors.delete(c.id)
        await callEditor(ctx, (e) => e.removeCommentAnchor(c.id))
      }
      if (getCommentState().docId !== docId) return
      comments = await ctx.rpc.call<Comment[]>('comment:list', { docId })
      if (getCommentState().docId !== docId) return
    }
    setCommentState({ comments, error: '' })
    await pushStates(ctx, comments)
  } catch (err) {
    reportError('comment', err)
    setCommentState({ error: ctx.i18n.t('comment.fail.load') + '：' + message(err) })
  }
}

function pushStates(ctx: Context, comments: readonly Comment[]): Promise<void> {
  return callEditor(ctx, (e) =>
    e.setCommentStates(
      comments.map((c) => ({
        id: c.id,
        resolved: c.resolved,
        blockId: c.anchor === 'block' ? c.blockId : null,
      })),
    ),
  )
}

async function callEditor(ctx: Context, use: (e: EditorService) => void): Promise<void> {
  try {
    await ctx.editor.ready()
    use(ctx.editor)
  } catch (err) {
    reportError('comment', err)
  }
}

/** 界面上的失败路径：面板里留一句话（面板没开就顺带开一下，不然白报）。 */
function fail(ctx: Context, err: unknown, key: string): false {
  reportError('comment', err)
  // 后面那截原始报错是唯一能查的东西，别丢。
  setCommentState({ error: `${ctx.i18n.t(key)}：${message(err)}`, open: true })
  return false
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
