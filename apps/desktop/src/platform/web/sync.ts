/**
 * 网页端同步引擎（D-0196）。
 *
 * 三个动作，反复做：
 *   1. 把本地新 blob 传上去（sha256 内容寻址，天然去重）
 *   2. 把本地改过的文档推上去（带 baseRev / baseContent，让服务端能三方合并）
 *   3. 按 `sync_log.seq` 游标拉增量
 *
 * 冲突策略：服务端合不了就返回它那份；本地这份**另存成「冲突副本」**，一个字不丢。
 */
import type { Context } from 'cordis'
import { DOCS_CHANGED, type DocMeta } from '../../kernel/contract'
import { reportNote } from '../../kernel/errors'
import {
  allBlobs,
  allContents,
  allDocs,
  allSrc,
  allTombstones,
  delDoc,
  delTombstone,
  getContent,
  getDoc,
  getSrc,
  metaValue,
  putBlob,
  putContent,
  putDoc,
  putMeta,
  putSrc,
  type ContentRecord,
  type DocRecord,
} from './db'

const PAGE = 200
const PUSH_BATCH = 50
const INTERVAL = 15_000
const DEBOUNCE = 800

let running = false
let pushTimer: ReturnType<typeof setTimeout> | undefined
let started = false
let onChange: (() => void) | undefined
let syncCtx: Context | undefined
let lastNote = 0

interface ServerDoc {
  id: string
  rev: number
  content: string | null
  md: string
  meta: DocMeta
}

interface PushResult {
  id: string
  status: 'accepted' | 'merged' | 'conflict' | 'deleted'
  rev: number
  content: string | null
  md: string | null
  meta: DocMeta | null
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  if (res.status === 401) {
    throw Object.assign(new Error('网页版还没配对'), { code: 'unauthorized' })
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null
    throw Object.assign(new Error(body?.message ?? res.statusText), { code: body?.code ?? 'http' })
  }
  return (await res.json()) as T
}

async function deviceId(): Promise<string> {
  let id = await metaValue('sync.deviceId')
  if (!id) {
    id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : Math.random().toString(16).slice(2)
    await putMeta('sync.deviceId', id)
  }
  return id
}

async function cursor(): Promise<number> {
  return Number((await metaValue('sync.cursor')) ?? 0)
}

function emptyBody(id: string): ContentRecord {
  return { id, content: null, md: '', baseContent: null }
}

function reloadIfOpen(id: string): void {
  void syncCtx?.get('editor')?.reload(id)
}

/** 推送那一刻「这篇长什么样」。回来时对不上 = 用户在等网络的时候又改了。 */
function fingerprint(rec: DocRecord, body: ContentRecord): string {
  return JSON.stringify([
    rec.parentId,
    rec.title,
    rec.icon,
    rec.sortOrder,
    rec.isFavorite,
    rec.pinnedAt,
    rec.lastOpenedAt,
    rec.deletedAt,
    rec.tags,
    body.content,
    body.md,
  ])
}

function note(err: unknown): void {
  const now = Date.now()
  if (now - lastNote < 60_000) return
  lastNote = now
  reportNote('sync', err instanceof Error ? err.message : String(err))
}

/* ─────────────────────────── 推送 ─────────────────────────── */

async function pushOnce(): Promise<boolean> {
  const docs = (await allDocs()).filter((r) => r.dirty).slice(0, PUSH_BATCH)
  const tombstones = (await allTombstones()).slice(0, PUSH_BATCH)
  if (!docs.length && !tombstones.length && !(await allSrc()).some((s) => s.dirty)) return false

  const bodies = new Map((await allContents()).map((c) => [c.id, c]))
  const pushed = new Map(
    docs.map((r) => {
      const b = bodies.get(r.id) ?? emptyBody(r.id)
      return [r.id, fingerprint(r, b)]
    }),
  )

  const sources = (await allSrc()).filter((s) => s.dirty)
  const payload = {
    deviceId: await deviceId(),
    sources: sources.map((s) => ({ id: s.id, content: s.content })),
    docs: [
      ...docs.map((r) => {
        const b = bodies.get(r.id) ?? emptyBody(r.id)
        return {
          id: r.id,
          mode: 'put',
          baseRev: r.rev,
          baseContent: b.baseContent,
          content: b.content,
          title: r.title,
          md: b.md,
          parentId: r.parentId,
          icon: r.icon,
          sortOrder: r.sortOrder,
          isFavorite: r.isFavorite,
          pinnedAt: r.pinnedAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          deletedAt: r.deletedAt,
          tags: r.tags,
        }
      }),
      ...tombstones.map((t) => ({
        id: t.id,
        mode: 'hardDelete',
        baseRev: t.rev,
        baseContent: null,
        content: null,
        title: '',
        md: '',
        parentId: null,
        icon: null,
        sortOrder: null,
        isFavorite: null,
        pinnedAt: null,
        createdAt: null,
        updatedAt: null,
        deletedAt: null,
        tags: null,
      })),
    ],
  }

  const res = await api<{ results: PushResult[] }>('/sync/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  for (const s of sources) await putSrc({ ...s, dirty: false })
  const tombstoneIds = new Set(tombstones.map((t) => t.id))
  for (const r of res.results) {
    if (r.status === 'deleted') {
      await delDoc(r.id)
      await delTombstone(r.id)
      continue
    }
    if (r.status === 'conflict') {
      await keepConflict(r, tombstoneIds.has(r.id))
      continue
    }
    const rec = await getDoc(r.id)
    if (!rec) continue
    const body = (await getContent(r.id)) ?? emptyBody(r.id)
    const sent = pushed.get(r.id)
    if (sent && sent !== fingerprint(rec, body)) {
      // 推送在飞的时候用户又改了：保住本地这份，只把服务端版本号 / base 收下来，下一轮再合。
      rec.rev = r.rev
      body.baseContent = r.content
      rec.dirty = true
      await putDoc(rec)
      await putContent(body)
      continue
    }
    applyServer(
      rec,
      body,
      r.meta,
      r.rev,
      r.content,
      r.status === 'merged' ? (r.md ?? projectMd(r.content)) : (r.md ?? undefined),
    )
    await putDoc(rec)
    await putContent(body)
    // 合并后的正文里有桌面那边加的块，开着的编辑器必须重读，否则下一次保存会把它盖回去。
    if (r.status === 'merged') reloadIfOpen(r.id)
  }

  return true
}

async function keepConflict(r: PushResult, wasTombstone: boolean): Promise<void> {
  const local = await getDoc(r.id)
  const body = local ? ((await getContent(r.id)) ?? emptyBody(r.id)) : null

  // 本地已经把这篇硬删了：服务端拒绝（它那边改过）。把服务端那份接回来，
  // 删掉墓碑 —— 否则下一轮还会拿同一个墓碑去撞同一面墙。
  if (!local || !body || wasTombstone) {
    await delTombstone(r.id)
    await restoreFromServer(r)
    return
  }

  // 只有正文真的不一样才值得留副本；只撞了标题 / 父级就按服务端走。
  if (body.content && body.content !== r.content) {
    const at = new Date()
    const stamp = `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    const id = newId()
    const copy: DocRecord = {
      ...local,
      id,
      title: `${local.title || '未命名'}（冲突 ${stamp}）`,
      sortOrder: local.sortOrder + 0.5,
      rev: 0,
      dirty: true,
      isFavorite: false,
      pinnedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await putDoc(copy)
    await putContent({ ...body, id, baseContent: null })
  }
  applyServer(local, body, r.meta, r.rev, r.content, r.md ?? undefined)
  await putDoc(local)
  await putContent(body)
  reloadIfOpen(r.id)
}

async function restoreFromServer(r: PushResult): Promise<void> {
  if (!r.meta) return
  reloadIfOpen(r.id)
  const rec: DocRecord = {
    ...r.meta,
    id: r.id,
    rev: r.rev,
    dirty: false,
    mdAt: 0,
  }
  await putDoc(rec)
  await putContent({ id: r.id, content: r.content, md: r.md ?? '', baseContent: r.content })
}

function applyServer(
  rec: DocRecord,
  body: ContentRecord,
  meta: DocMeta | null,
  rev: number,
  content: string | null,
  md?: string,
): void {
  if (meta) {
    rec.parentId = meta.parentId
    rec.title = meta.title
    rec.icon = meta.icon
    rec.sortOrder = meta.sortOrder
    rec.createdAt = meta.createdAt
    rec.updatedAt = meta.updatedAt
    rec.deletedAt = meta.deletedAt
    rec.isFavorite = meta.isFavorite
    rec.pinnedAt = meta.pinnedAt
    rec.lastOpenedAt = meta.lastOpenedAt
    rec.tags = meta.tags
  }
  if (md !== undefined) {
    body.md = md
    rec.mdAt = Date.now()
  }
  rec.rev = rev
  body.content = content
  body.baseContent = content
  rec.dirty = false
}

/* ─────────────────────────── 拉取 ─────────────────────────── */

async function pullOnce(): Promise<boolean> {
  let changed = false
  let since = await cursor()
  for (let page = 0; page < 20; page++) {
    const res = await api<{
      cursor: number
      docs: ServerDoc[]
      deleted: string[]
      sources: { id: string; content: string }[]
    }>(`/sync/changes?since=${since}&limit=${PAGE}`)
    for (const src of res.sources ?? []) {
      const local = await getSrc(src.id)
      if (local?.dirty) continue
      await putSrc({ id: src.id, content: src.content, dirty: false })
      changed = true
    }
    for (const d of res.docs) {
      const local = await getDoc(d.id)
      if (local?.dirty) continue
      // 这篇正开着：先把它攒着的改动落库。落了就说明本地也改了 → 不进这一轮，等推送去合并。
      const editor = syncCtx?.get('editor')
      if (editor && local) {
        try {
          await editor.flush(d.id)
        } catch {
          /* 编辑器没开着 / 还没装载：flush 本来就是空操作 */
        }
        const after = await getDoc(d.id)
        if (after?.dirty) continue
      }
      const { rec, body } = recordFrom(d)
      if (local?.lastOpenedAt && (!rec.lastOpenedAt || local.lastOpenedAt > rec.lastOpenedAt)) {
        rec.lastOpenedAt = local.lastOpenedAt
      }
      await putDoc(rec)
      await putContent(body)
      // 服务端这份变了，开着的编辑器手上还是旧内容 —— 重读，否则下一次保存会把它盖回去。
      if (local) void syncCtx?.get('editor')?.reload(d.id)
      changed = true
    }
    for (const id of res.deleted) {
      const local = await getDoc(id)
      const body = local ? await getContent(id) : null
      if (local?.dirty && body?.content) {
        // 远端硬删了、本地还有没推的改动 —— 留成一份新页，别把字丢掉。
        const id2 = newId()
        await putDoc({
          ...local,
          id: id2,
          title: `${local.title || '未命名'}（冲突副本）`,
          rev: 0,
          dirty: true,
          deletedAt: null,
        })
        await putContent({ id: id2, content: body.content, md: body.md, baseContent: null })
      }
      await delDoc(id)
      changed = true
    }
    since = res.cursor
    await putMeta('sync.cursor', String(since))
    if (res.docs.length + res.deleted.length < PAGE) break
  }
  return changed
}

function recordFrom(d: ServerDoc): { rec: DocRecord; body: ContentRecord } {
  return {
    rec: {
      ...d.meta,
      id: d.id,
      rev: d.rev,
      dirty: false,
      mdAt: 0,
    },
    body: { id: d.id, content: d.content, md: d.md ?? '', baseContent: d.content },
  }
}

/* ─────────────────────────── blob 预取 ─────────────────────────── */

let prefetching = false
let prefetchedAt = 0

/** 扫一遍正文里引用的 blob id，交给 Service Worker 缓存。失败不重试、不打扰用户。 */
async function prefetchBlobs(): Promise<void> {
  if (prefetching) return
  if (Date.now() - prefetchedAt < 60_000) return
  prefetching = true
  prefetchedAt = Date.now()
  try {
    const ids = new Set<string>()
    for (const c of await allContents()) {
      const text = `${c.md}\n${c.content ?? ''}`
      for (const m of text.matchAll(/(?:self-notion:\/\/blob\/|blobId":")([0-9a-f]{64})/g)) {
        ids.add(m[1])
      }
    }
    const queue = [...ids]
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift()
        if (!id) return
        try {
          await fetch(`/blob/${id}`, { credentials: 'include' })
        } catch {
          /* 断网 / 图不在库里：下一个 */
        }
      }
    }
    await Promise.all([worker(), worker(), worker()])
  } finally {
    prefetching = false
  }
}

/* ─────────────────────────── blob 上传 ─────────────────────────── */

async function uploadBlobs(): Promise<void> {
  const pending = (await allBlobs()).filter((b) => !b.synced).slice(0, 3)
  for (const b of pending) {
    const res = await fetch('/blob', {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-sn-id': b.id, 'x-sn-mime': b.mime },
      body: b.bytes,
    })
    if (res.ok) {
      b.synced = true
      await putBlob(b)
    }
  }
}

/* ─────────────────────────── 主循环 ─────────────────────────── */

export async function runSyncNow(): Promise<void> {
  if (running) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  running = true
  try {
    // 先把新图传上去：文档先到、图后到的话，桌面会先裂一会儿图。
    await uploadBlobs()
    let changed = await pushOnce()
    changed = (await pullOnce()) || changed
    if (changed) {
      onChange?.()
      // 首轮 / 有变化之后把正文引用的图也拉下来 —— 「完整离线」包括图片。
      void prefetchBlobs()
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'unauthorized') {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sn:need-pair'))
    } else {
      note(err)
    }
  } finally {
    running = false
  }
}

export function schedulePush(): void {
  if (pushTimer !== undefined) return
  pushTimer = setTimeout(() => {
    pushTimer = undefined
    void runSyncNow()
  }, DEBOUNCE)
}

export function startSync(ctx: Context): void {
  if (started) return
  started = true
  syncCtx = ctx
  onChange = () => ctx.emit(DOCS_CHANGED)

  window.addEventListener('online', () => void runSyncNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runSyncNow()
    else if (pushTimer === undefined) schedulePush()
  })
  window.addEventListener('sn:need-pair', () => {
    note(new Error('配对失效，重新打开网页并输入配对码'))
  })

  // 先让界面从本地库起来，再安静地拉第一轮。
  setTimeout(() => void runSyncNow(), 600)
  // 首轮拉完再补一次图片预取（缓存被系统清过也能自己长回来）。
  setTimeout(() => void prefetchBlobs(), 10_000)
  setInterval(() => void runSyncNow(), INTERVAL)
}

/* ─────────────────────────── 投影：合并后的正文 → markdown ─────────────────────────── */

/** 服务端合出来的正文没有 md 投影。这里从 PM JSON 抽纯文本，够搜索和摘要用。 */
export function projectMd(content: string | null): string {
  if (!content) return ''
  let doc: unknown
  try {
    doc = JSON.parse(content)
  } catch {
    return ''
  }
  const out: string[] = []
  walk(doc as Node, out)
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

interface Node {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: Node[]
}

function walk(node: Node, out: string[]): void {
  if (!node || typeof node !== 'object') return
  if (node.type === 'text') {
    out.push(node.text ?? '')
    return
  }
  if (node.type === 'hardBreak') {
    out.push('\n')
    return
  }
  const block = node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock'
  const level = Number(node.attrs?.level ?? 1)
  if (node.type === 'heading') out.push('#'.repeat(Math.min(6, Math.max(1, level))) + ' ')
  if (node.type === 'listItem') out.push('- ')
  if (node.type === 'blockquote') out.push('> ')
  for (const child of node.content ?? []) walk(child, out)
  if (block) out.push('\n')
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '')
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}
