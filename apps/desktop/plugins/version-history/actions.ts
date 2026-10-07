/**
 * 版本插件对外的全部动作：切文档 / 打点 / 载入清单 / 恢复。
 *
 * 两条纪律（照 `comment/actions.ts`）：
 *   - 失败都从 `reportError` 出去（AGENTS.md §3），同时在面板上留一句话 —— 不然用户看不见；
 *   - 恢复是「改库 + 让编辑器重读」的**一对**动作，中间不许有任何落库（见 `restore`）。
 */
import type { Context } from 'cordis'
import { DOCS_CHANGED, type VersionMeta } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { confirmDialog } from '../../src/ui/confirm'
import { getVersionState, setVersionState } from './state'

/** 打点的由头：定时 / 离开这一篇 / 首次打开。写进 `label`，面板上直接显示。 */
export type Mark = 'auto' | 'close' | 'first'

/**
 * 换到某一篇：先给上一篇收尾（打一个版本点），再载入新一篇的清单。
 *
 * 打点在**离开时**做，不在进入时 —— 进入时打的是「还没打开这篇」的旧状态，没意义。
 */
export async function enterDoc(ctx: Context, docId: string): Promise<void> {
  const previous = getVersionState().docId
  setVersionState({ docId, versions: [], error: '', busy: false })
  if (previous !== null && previous !== docId) await checkpoint(ctx, previous, 'close')
  await load(ctx, docId)
  // 这一篇还没有任何版本点 → 先记一个基线。不记的话用户要等 10 分钟才看得见功能生效。
  if (getVersionState().versions.length === 0) await checkpoint(ctx, docId, 'first')
}

/** 回到首页 / 回收站那些列表：同一篇离开。 */
export async function leaveDoc(ctx: Context): Promise<void> {
  const previous = getVersionState().docId
  setVersionState({ docId: null, open: false, versions: [], error: '', busy: false })
  if (previous !== null) await checkpoint(ctx, previous, 'close')
}

export function closePanel(): void {
  setVersionState({ open: false })
}

export async function openPanel(ctx: Context): Promise<void> {
  const docId = getVersionState().docId
  if (docId === null) return
  setVersionState({ open: true, error: '' })
  await load(ctx, docId)
}

/**
 * 打一个版本点。**不带字节** —— Rust 拿自己手里的最近一份全量（`doc_snapshot`），
 * 前端不必把整篇塞进 RPC。
 *
 * 只在显式事件上打（D-0043）：AI 写入前 / 离开这一篇 / 每 10 分钟。**不是**每次 300ms flush
 * —— 那个粒度下版本表会爆炸。
 */
export async function checkpoint(ctx: Context, docId: string, mark: Mark): Promise<void> {
  try {
    await ctx.rpc.call('version:checkpoint', {
      id: docId,
      origin: 'user',
      label: ctx.i18n.t(`history.mark.${mark}`),
    })
    // 顺手刷新清单，不然用户盯着一个不会动的列表。
    if (getVersionState().docId === docId) await load(ctx, docId)
  } catch (err) {
    reportError('version-history', err)
  }
}

export async function load(ctx: Context, docId: string): Promise<void> {
  try {
    const versions = await ctx.rpc.call<VersionMeta[]>('version:list', { id: docId })
    // 切文档途中回来的包丢掉，否则新一篇的列表里会冒出上一篇的版本。
    if (getVersionState().docId !== docId) return
    setVersionState({ versions, error: '' })
  } catch (err) {
    reportError('version-history', err)
    if (getVersionState().docId === docId) {
      setVersionState({ error: `${ctx.i18n.t('history.failed.load')}：${message(err)}` })
    }
  }
}

/**
 * 恢复到这里。
 *
 * ★ 顺序是这里最要紧的事，两步都不能挪：
 *   1. `version:restore` 先把库改成目标状态；
 *   2. 紧接着 `ctx.editor.reload` —— 它**第一句同步**就把这一篇的落库闸门关上，
 *      然后丢掉编辑器手里的活 Y.Doc、照库里的新字节重建。
 *   中间夹一次落库（编辑器那 300ms 的定时器就是）就会把刚恢复的状态盖回旧内容，
 *   而 `reload` 是 `await` 的第一件事，正好抢在那些定时器（宏任务）前面。
 *
 * ★ 恢复**不会丢数据**：Rust 的 `restore` 先把「现在」记成一个新版本，再去装目标。
 *   所以这一下随时能再退回来 —— 历史只增不改。
 */
export async function restore(ctx: Context, docId: string, version: VersionMeta): Promise<void> {
  const ok = await confirmDialog({
    title: ctx.i18n.t('history.confirm'),
    body: ctx.i18n.t('history.confirmBody'),
    ok: ctx.i18n.t('history.restore'),
  })
  if (!ok) return

  setVersionState({ busy: true, error: '' })
  try {
    await ctx.rpc.call('version:restore', { id: docId, versionId: version.id })
    await ctx.editor.reload(docId)
    // 标题 / 更新时间可能跟着回到那一刻 —— 侧栏、标签条、首页都靠这条事件重取。
    ctx.emit(DOCS_CHANGED)
    setVersionState({ busy: false, open: false })
    await load(ctx, docId)
  } catch (err) {
    reportError('version-history', err)
    setVersionState({ busy: false, error: `${ctx.i18n.t('history.failed')}：${message(err)}` })
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
