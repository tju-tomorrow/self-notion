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
import { getCommentState, setCommentState } from './state'

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

export async function setDoc(ctx: Context, docId: string | null): Promise<void> {
  setCommentState({ docId, comments: [], spot: null, replyTo: null, error: '' })
  // 没文档了也要推一次：正文里的高亮得跟着撤掉。
  if (docId === null) {
    pendingAnchors.clear()
    return pushStates(ctx, [])
  }
  await load(ctx)
}

export async function openPanel(ctx: Context, id?: string): Promise<void> {
  setCommentState({ open: true, error: '', spot: id ? { id, at: Date.now() } : null })
  if (id !== undefined) await callEditor(ctx, (e) => e.revealComment(id))
}

export function closePanel(): void {
  setCommentState({ open: false })
}

export async function commentOnSelection(ctx: Context, sel: Selection): Promise<boolean> {
  const docId = getCommentState().docId
  if (docId === null) return false
  try {
    const made = await ctx.rpc.call<Comment>('comment:create', {
      docId,
      anchor: sel.kind,
      blockId: sel.blockId,
      quote: sel.quote,
    })
    const at: CommentTarget =
      sel.kind === 'inline'
        ? { kind: 'inline', blockId: sel.blockId, index: sel.index, length: sel.length }
        : { kind: 'block', blockId: sel.blockId }
    // 先不写正文：一个字没写就切走的草稿会在正文里留一个空高亮。存着，
    // 等第一次存下正文（`updateBody`）时再补上。
    pendingAnchors.set(made.id, at)
    // 正文是空串 = 草稿态，面板里那条的输入框要拿到焦点。
    setCommentState({ open: true, spot: { id: made.id, at: Date.now() }, replyTo: null, error: '' })
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
    setCommentState({ spot: { id: made.id, at: Date.now() }, error: '' })
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
    if (st.spot?.id === id) setCommentState({ spot: null })
    if (st.replyTo === id) setCommentState({ replyTo: null })
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
    const comments = await ctx.rpc.call<Comment[]>('comment:list', { docId })
    // 切文档途中回来的包丢掉，否则新文档的面板里会冒出上一篇的评论。
    if (getCommentState().docId !== docId) return
    setCommentState({ comments, error: '' })
    await pushStates(ctx, comments)
  } catch (err) {
    reportError('comment', err)
    setCommentState({ error: ctx.i18n.t('comment.fail.load') + '：' + message(err) })
  }
}

function pushStates(ctx: Context, comments: readonly Comment[]): Promise<void> {
  return callEditor(ctx, (e) =>
    e.setCommentStates(comments.map((c) => ({ id: c.id, resolved: c.resolved }))),
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
