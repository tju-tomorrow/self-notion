/**
 * 网页端的本地库（D-0197）。**手机上的真相就是这里** —— 断网时不再有别的数据源。
 *
 * ★ 元数据和正文分两张表：`doc:list` 每次都要全量读，而正文可能有几十 MB。
 *   放一张表里就等于每次刷新侧栏都把所有正文搬一遍。
 */
import type { Comment, DocMeta } from '../../kernel/contract'

const NAME = 'self-notion-web'
// ★ 2 = 加评论表（D-0199）。Service Worker 里那份建库清单必须同步（public/sw.js）。
const VERSION = 2

/** 一篇的元数据 + 同步状态。`doc:list` 只读这张表。 */
export interface DocRecord extends DocMeta {
  /** 服务端版本号；0 = 还没同步过 */
  rev: number
  /** 本地改过、还没推上去（包括只改了标题 / 父级） */
  dirty: boolean
  mdAt: number
}

/** 一篇的字节：正文、投影、三方合并的 base。只有打开的 / 同步的文档才读它。 */
export interface ContentRecord {
  id: string
  content: string | null
  md: string
  baseContent: string | null
}

export interface BlobRecord {
  id: string
  mime: string
  size: number
  bytes: ArrayBuffer
  at: number
  synced: boolean
}

export interface Tombstone {
  id: string
  rev: number
  at: number
}

/** 评论的本地副本。`deleted` 是等推给服务端的墓碑，推成功才物理删。 */
export interface CommentRecord extends Comment {
  dirty: boolean
  deleted: boolean
}

let dbp: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('contents'))
        db.createObjectStore('contents', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('syncsrc')) db.createObjectStore('syncsrc', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('tombstones'))
        db.createObjectStore('tombstones', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('comments')) db.createObjectStore('comments', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB 打不开'))
  })
  return dbp
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB 请求失败'))
  })
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await open()
  return db.transaction(name, mode).objectStore(name)
}

export async function getOne<T>(name: string, key: string): Promise<T | undefined> {
  return wrap((await store(name, 'readonly')).get(key)) as Promise<T | undefined>
}

export async function getAll<T>(name: string): Promise<T[]> {
  return wrap((await store(name, 'readonly')).getAll()) as Promise<T[]>
}

export async function putOne(name: string, value: unknown): Promise<void> {
  await wrap((await store(name, 'readwrite')).put(value))
}

export async function delOne(name: string, key: string): Promise<void> {
  await wrap((await store(name, 'readwrite')).delete(key))
}

export async function clearStore(name: string): Promise<void> {
  await wrap((await store(name, 'readwrite')).clear())
}

/* ── 数据版本（搜索缓存用：任何正文/元数据写入都会 +1） ── */

let revision = 0
export const dataRevision = (): number => revision
function bump(): void {
  revision += 1
}

/* ── 文档元数据 ── */

export const getDoc = (id: string) => getOne<DocRecord>('docs', id)
export const allDocs = () => getAll<DocRecord>('docs')
export async function putDoc(rec: DocRecord): Promise<void> {
  await putOne('docs', rec)
  bump()
}

export async function delDoc(id: string): Promise<void> {
  await delOne('docs', id)
  await delOne('contents', id)
  bump()
}

/* ── 正文 ── */

export const getContent = (id: string) => getOne<ContentRecord>('contents', id)
export async function putContent(rec: ContentRecord): Promise<void> {
  await putOne('contents', rec)
  bump()
}
export const allContents = () => getAll<ContentRecord>('contents')

/* ── meta / 同步块 / 墓碑 ── */

export const getMeta = (key: string) => getOne<{ key: string; value: string }>('meta', key)
export const putMeta = (key: string, value: string) => putOne('meta', { key, value })

export async function metaValue(key: string): Promise<string | null> {
  const row = await getMeta(key)
  return row?.value ?? null
}

export interface SyncSource {
  id: string
  content: string
  dirty: boolean
}

export const getSrc = (id: string) => getOne<SyncSource>('syncsrc', id)
export const allSrc = () => getAll<SyncSource>('syncsrc')
export const putSrc = (rec: SyncSource) => putOne('syncsrc', rec)

export const allTombstones = () => getAll<Tombstone>('tombstones')
export const putTombstone = (t: Tombstone) => putOne('tombstones', t)
export const delTombstone = (id: string) => delOne('tombstones', id)

/* ── 评论（D-0199） ── */

export const getComment = (id: string) => getOne<CommentRecord>('comments', id)
export const allComments = () => getAll<CommentRecord>('comments')
export const putComment = (rec: CommentRecord) => putOne('comments', rec)
export const delComment = (id: string) => delOne('comments', id)

/* ── blob ── */

export const getBlob = (id: string) => getOne<BlobRecord>('blobs', id)
export const allBlobs = () => getAll<BlobRecord>('blobs')
export const putBlob = (b: BlobRecord) => putOne('blobs', b)
