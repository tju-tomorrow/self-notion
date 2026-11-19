/**
 * 网页端的 `ctx.rpc` —— 用 IndexedDB 实现和 Rust 同名同形的那批方法（D-0197）。
 *
 * 目标是让插件**一行不改**：编辑器调 `doc:open` / `doc:apply`，侧栏调 `doc:list`，
 * 搜索调 `search:query`，在这里换成读写手机本地库；同步引擎在后台把本地库和桌面拉齐。
 *
 * 桌面专属的方法（AI / 知识库 / 评论 / 版本 / 外部文件）不在白名单插件里，走到这里就是
 * 明确的 `unsupported`，不是静默空值。
 */
import type { DocMeta, DocSummary, DocText, LearnRow, RpcService, SearchHit } from '../../kernel/contract'
import {
  allContents,
  allDocs,
  allTombstones,
  delDoc,
  delTombstone,
  getBlob,
  getContent,
  getDoc,
  getMeta,
  getSrc,
  metaValue,
  putBlob,
  putContent,
  putDoc,
  putMeta,
  putSrc,
  putTombstone,
  type DocRecord,
} from './db'
import { schedulePush } from './sync'

const HIT_OPEN = '\u0002'
const HIT_CLOSE = '\u0003'

export interface RpcHooks {
  onChange: () => void
}

function now(): number {
  return Date.now()
}

function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '')
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function notFound(what: string): Error {
  return Object.assign(new Error(`${what} not found`), { code: 'not_found' })
}

function toMeta(rec: DocRecord): DocMeta {
  return {
    id: rec.id,
    parentId: rec.parentId,
    title: rec.title,
    icon: rec.icon,
    sortOrder: rec.sortOrder,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    deletedAt: rec.deletedAt,
    isFavorite: rec.isFavorite,
    pinnedAt: rec.pinnedAt,
    lastOpenedAt: rec.lastOpenedAt,
    tags: rec.tags,
  }
}

function sorted(rows: DocRecord[]): DocRecord[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
}

function children(rows: DocRecord[], parentId: string | null): DocRecord[] {
  return rows.filter((r) => r.parentId === parentId)
}

function descendants(rows: DocRecord[], id: string): DocRecord[] {
  const out: DocRecord[] = []
  const stack = [id]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const r of rows) {
      if (r.parentId === cur) {
        out.push(r)
        stack.push(r.id)
      }
    }
  }
  return out
}

function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ─────────────────────────── 搜索 / 投影 ─────────────────────────── */

function plainOf(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~|[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function snippetOf(text: string, q: string): string | null {
  const lower = text.toLowerCase()
  const needle = q.trim().toLowerCase()
  if (!needle) return null
  const terms = needle.split(/\s+/).filter(Boolean)
  let at = lower.indexOf(needle)
  if (at < 0) {
    for (const t of terms) {
      at = lower.indexOf(t)
      if (at >= 0) break
    }
  }
  if (at < 0) return null
  const word = at >= 0 ? text.slice(at, at + Math.max(needle.length, 1)) : ''
  const start = Math.max(0, at - 30)
  const end = Math.min(text.length, at + Math.max(needle.length, 1) + 60)
  const head = text.slice(start, at)
  const tail = text.slice(at + word.length, end)
  return `${start > 0 ? '…' : ''}${head}${HIT_OPEN}${word}${HIT_CLOSE}${tail}${end < text.length ? '…' : ''}`
}

/* ─────────────────────────── 主入口 ─────────────────────────── */

export function createWebRpc(hooks: RpcHooks): RpcService {
  const changed = () => {
    schedulePush()
    hooks.onChange()
  }

  async function mustGet(id: string): Promise<DocRecord> {
    const rec = await getDoc(id)
    if (!rec) throw notFound('doc')
    return rec
  }

  async function patch(id: string, fn: (rec: DocRecord) => void): Promise<DocRecord> {
    const rec = await mustGet(id)
    fn(rec)
    await putDoc(rec)
    changed()
    return rec
  }

  async function subtreeMark(id: string, deleted: boolean): Promise<void> {
    const rows = await allDocs()
    const targets = [await mustGet(id), ...descendants(rows, id)]
    const at = now()
    for (const rec of targets) {
      rec.deletedAt = deleted ? at : null
      rec.updatedAt = at
      rec.dirty = true
      await putDoc(rec)
    }
    changed()
  }

  async function hardDelete(id: string): Promise<void> {
    const rows = await allDocs()
    const targets = [await mustGet(id), ...descendants(rows, id)]
    for (const rec of targets) {
      await putTombstone({ id: rec.id, rev: rec.rev, at: now() })
      await delDoc(rec.id)
    }
    changed()
  }

  return {
    async call<T = unknown>(method: `${string}:${string}`, args?: unknown): Promise<T> {
      const a = (args ?? {}) as Record<string, unknown>
      const out = await handle(method, a)
      return out as T
    },
  }

  async function handle(method: string, a: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      /* ── 启动探活 ── */
      case 'boot:ready':
        return null
      case 'meta:ping':
        return 'pong'

      /* ── 文档元数据 ── */
      case 'doc:list': {
        const include = Boolean(a.includeTrashed)
        const rows = sorted(await allDocs()).filter((r) => include || r.deletedAt === null)
        return rows.map(toMeta)
      }

      case 'doc:open': {
        const rec = await mustGet(String(a.id))
        return { doc: toMeta(rec), content: (await getContent(rec.id))?.content ?? null }
      }

      case 'doc:create': {
        const rows = await allDocs()
        const id = typeof a.id === 'string' && a.id ? a.id : newId()
        const parentId = (a.parentId as string | null | undefined) ?? null
        const at = now()
        const siblings = children(rows, parentId)
        const sortOrder = siblings.reduce((m, r) => Math.max(m, r.sortOrder), 0) + 1
        const rec: DocRecord = {
          id,
          parentId,
          title: String(a.title ?? ''),
          icon: (a.icon as string | null | undefined) ?? null,
          sortOrder,
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
          isFavorite: false,
          pinnedAt: null,
          lastOpenedAt: null,
          tags: [],
          rev: 0,
          mdAt: 0,
          dirty: true,
        }
        await putDoc(rec)
        await putContent({ id, content: null, md: '', baseContent: null })
        changed()
        return toMeta(rec)
      }

      case 'doc:rename': {
        const rec = await patch(String(a.id), (r) => {
          r.title = String(a.title ?? '')
          r.updatedAt = now()
          r.dirty = true
        })
        return toMeta(rec)
      }

      case 'doc:icon': {
        const rec = await patch(String(a.id), (r) => {
          r.icon = (a.icon as string | null | undefined) ?? null
          r.updatedAt = now()
          r.dirty = true
        })
        return toMeta(rec)
      }

      case 'doc:move': {
        const rec = await patch(String(a.id), (r) => {
          r.parentId = (a.parentId as string | null | undefined) ?? null
          if (typeof a.sortOrder === 'number') r.sortOrder = a.sortOrder
          r.updatedAt = now()
          r.dirty = true
        })
        return toMeta(rec)
      }

      case 'doc:trash':
        await subtreeMark(String(a.id), true)
        return null

      case 'doc:restore':
        await subtreeMark(String(a.id), false)
        return null

      case 'doc:remove':
        await hardDelete(String(a.id))
        return null

      case 'doc:emptyTrash': {
        const rows = await allDocs()
        const dead = rows.filter((r) => r.deletedAt !== null)
        for (const rec of dead) {
          await putTombstone({ id: rec.id, rev: rec.rev, at: now() })
          await delDoc(rec.id)
        }
        changed()
        return dead.length
      }

      case 'doc:restoreTrash': {
        const rows = await allDocs()
        const dead = rows.filter((r) => r.deletedAt !== null)
        for (const rec of dead) {
          rec.deletedAt = null
          rec.updatedAt = now()
          rec.dirty = true
          await putDoc(rec)
        }
        changed()
        return dead.length
      }

      case 'doc:favorite': {
        const rec = await mustGet(String(a.id))
        const next = typeof a.value === 'boolean' ? a.value : !rec.isFavorite
        rec.isFavorite = next
        rec.dirty = true
        await putDoc(rec)
        changed()
        return next
      }

      case 'doc:pin': {
        const rec = await mustGet(String(a.id))
        const next = typeof a.value === 'boolean' ? a.value : rec.pinnedAt === null
        rec.pinnedAt = next ? now() : null
        rec.dirty = true
        await putDoc(rec)
        changed()
        return next
      }

      case 'doc:tags': {
        const rec = await patch(String(a.id), (r) => {
          r.tags = Array.isArray(a.tags) ? (a.tags as string[]) : []
          r.updatedAt = now()
          r.dirty = true
        })
        return toMeta(rec)
      }

      case 'doc:apply': {
        const rec = await mustGet(String(a.id))
        const body = (await getContent(rec.id)) ?? { id: rec.id, content: null, md: '', baseContent: null }
        const content = typeof a.content === 'string' ? a.content : body.content
        const title = typeof a.title === 'string' ? a.title : rec.title
        const md = typeof a.md === 'string' ? a.md : body.md
        // 关文档 / 失焦会再送一遍同样的内容 —— 不脏就不写，省掉无意义的同步。
        if (content === body.content && title === rec.title && md === body.md) return null
        if (content !== body.content || md !== body.md) {
          body.content = content
          body.md = md
          await putContent(body)
          rec.mdAt = now()
        }
        rec.title = title
        rec.updatedAt = now()
        rec.dirty = true
        await putDoc(rec)
        schedulePush()
        return null
      }

      case 'doc:touch': {
        const rec = await getDoc(String(a.id))
        if (rec) {
          rec.lastOpenedAt = now()
          await putDoc(rec)
        }
        return null
      }

      case 'doc:summary': {
        const ids = Array.isArray(a.ids) ? (a.ids as string[]) : []
        const rows: DocSummary[] = []
        for (const id of ids) {
          const rec = await getDoc(id)
          if (!rec) continue
          const body = await getContent(id)
          rows.push({ id, body: plainOf(body?.md ?? '').slice(0, 160) })
        }
        return rows
      }

      case 'doc:text': {
        const body = await getContent(String(a.id))
        return { md: body?.md ?? '' } satisfies DocText
      }

      /* ── 搜索 ── */
      case 'search:query': {
        const q = String(a.q ?? '')
        const limit = Math.min(500, Math.max(1, Number(a.limit ?? 50)))
        const include = Boolean(a.includeTrashed)
        const bodies = new Map((await allContents()).map((c) => [c.id, c.md]))
        const rows = sorted(await allDocs()).filter((r) => include || r.deletedAt === null)
        const hits: SearchHit[] = []
        for (const rec of rows) {
          const md = bodies.get(rec.id) ?? ''
          const fromTitle = snippetOf(rec.title, q)
          const fromBody = snippetOf(md, q)
          if (!fromTitle && !fromBody) continue
          hits.push({
            id: rec.id,
            title: rec.title,
            parentId: rec.parentId,
            updatedAt: rec.updatedAt,
            body: fromBody ?? fromTitle ?? '',
          })
          if (hits.length >= limit) break
        }
        hits.sort((x, y) => y.updatedAt - x.updatedAt)
        return hits
      }

      /* ── 反链：扫投影里的 doc 链接 ── */
      case 'link:backlinks': {
        const target = String(a.id)
        const needle = `self-notion://doc/${target}`
        const bodies = new Map((await allContents()).map((c) => [c.id, c.md]))
        const out: DocMeta[] = []
        for (const rec of await allDocs()) {
          if (rec.id === target || rec.deletedAt !== null) continue
          if ((bodies.get(rec.id) ?? '').includes(needle)) out.push(toMeta(rec))
        }
        return out
      }

      /* ── 图片 / 附件 ── */
      case 'blob:put': {
        const mime = String(a.mime ?? 'application/octet-stream')
        const bytes = base64ToBytes(String(a.bytes ?? ''))
        const buf = bytes.buffer as ArrayBuffer
        const id = await sha256Hex(buf)
        const dup = (await getBlob(id)) !== undefined
        if (!dup) {
          await putBlob({ id, mime, size: bytes.length, bytes: buf, at: now(), synced: false })
          schedulePush()
        }
        return { id, mime, size: bytes.length, dedup: dup }
      }

      case 'blob:getUrl': {
        const id = String(a.id)
        if (!(await getBlob(id))) throw notFound('blob')
        return `/blob/${id}`
      }

      case 'blob:meta': {
        const b = await getBlob(String(a.id))
        return b ? { id: b.id, mime: b.mime, size: b.size } : null
      }

      /* ── 同步块（P3-4 的「源只有一份」） ── */
      case 'sync:new': {
        const id = newId()
        await putSrc({ id, content: '', dirty: true })
        schedulePush()
        return { id }
      }
      case 'sync:get': {
        const row = await getSrc(String(a.id))
        if (!row) throw notFound('sync')
        return { content: row.content }
      }
      case 'sync:put': {
        const id = String(a.id)
        const row = await getSrc(id)
        if (!row) throw notFound('sync')
        row.content = String(a.content ?? '')
        row.dirty = true
        await putSrc(row)
        schedulePush()
        return { ok: true }
      }

      /* ── 设置（meta 表） ── */
      case 'settings:list': {
        const all = await import('./db').then((m) => m.getAll<{ key: string; value: string }>('meta'))
        const out: Record<string, string> = {}
        for (const row of all) {
          if (row.key.startsWith('setting.')) out[row.key.slice('setting.'.length)] = row.value
        }
        return out
      }
      case 'settings:set': {
        await putMeta(`setting.${String(a.key)}`, String(a.value ?? ''))
        return null
      }
      case 'settings:get': {
        return (await getMeta(`setting.${String(a.key)}`))?.value ?? null
      }

      /* ── 学习指标：手机上先只留熟悉度，行为计数不跨端 ── */
      case 'learn:list': {
        const all = await import('./db').then((m) => m.getAll<{ key: string; value: string }>('meta'))
        return all
          .filter((r) => r.key.startsWith('learn.'))
          .map((r) => JSON.parse(r.value) as LearnRow)
      }
      case 'learn:get': {
        const raw = await metaValue(`learn.${String(a.id)}`)
        return raw ? (JSON.parse(raw) as LearnRow) : emptyLearn(String(a.id))
      }
      case 'learn:familiarity': {
        const id = String(a.id)
        const raw = await metaValue(`learn.${id}`)
        const row = raw ? (JSON.parse(raw) as LearnRow) : emptyLearn(id)
        row.familiarity = typeof a.level === 'number' ? a.level : null
        await putMeta(`learn.${id}`, JSON.stringify(row))
        return row
      }
      case 'learn:opened': {
        const id = String(a.id)
        const raw = await metaValue(`learn.${id}`)
        const row = raw ? (JSON.parse(raw) as LearnRow) : emptyLearn(id)
        row.opens += 1
        await putMeta(`learn.${id}`, JSON.stringify(row))
        // 桌面端这条会回整行，编辑器拿到后 publish(row)；回 null 就是在 publish 里炸。
        return row
      }
      case 'learn:progress': {
        const id = String(a.id)
        const raw = await metaValue(`learn.${id}`)
        const row = raw ? (JSON.parse(raw) as LearnRow) : emptyLearn(id)
        row.readMs += Number(a.addMs ?? 0)
        row.depth = Math.max(row.depth, Number(a.depth ?? 0))
        await putMeta(`learn.${id}`, JSON.stringify(row))
        return row
      }

      /* ── 日志：网页端也进桌面那份 errors.log ── */
      case 'log:error': {
        const body = JSON.stringify({
          source: String(a.source ?? 'web'),
          message: String(a.message ?? ''),
        })
        void fetch('/log/error', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }).catch(() => {})
        return null
      }

      /* ── 无消费者的心跳 ── */
      case 'perf:beat':
      case 'mem:snapshot':
      case 'mem:render':
      case 'mem:tray':
        return null

      default:
        throw Object.assign(new Error(`网页版没有实现 ${method}`), { code: 'unsupported' })
    }
  }
}

function emptyLearn(docId: string): LearnRow {
  return { docId, opens: 0, readMs: 0, depth: 0, familiarity: null, score: 0 }
}

export async function wipeLocal(): Promise<void> {
  for (const rec of await allDocs()) await delDoc(rec.id)
  for (const t of await allTombstones()) await delTombstone(t.id)
}
