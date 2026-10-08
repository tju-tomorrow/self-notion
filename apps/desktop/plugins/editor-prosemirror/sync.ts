/**
 * 同步块的源（P3-4 / D-0136）。节点只存一个 id，**内容在源里只有一份** —— 多处引用同一份，
 * 任意一处改的都是源。所以「一致」不需要 CRDT：要保证的是一份、不是两份副本。
 *
 * ★ 为什么不 import rpc：接线是 `index.ts` 在装载时做的（跟 `blob.ts` 一个形状）。
 *   这一层没有任何依赖 —— `nodes/synced-block.ts` 和斜杠菜单都能 import，不绕成循环。
 */
export interface SyncApi {
  /** 建一个空源，回它的 id（节点拿这个 id 存进 JSON）。 */
  newSrc: () => Promise<string>
  /** 读源里的块 JSON。空串 = 刚建、还没内容。 */
  get: (id: string) => Promise<string>
  /** 覆盖源内容 —— 源里永远只有最新那一份（同 `doc:apply` 的覆盖语义）。 */
  put: (id: string, content: string) => Promise<void>
}

let api: SyncApi | undefined

export function setSyncApi(next: SyncApi): void {
  api = next
}

function need(): SyncApi {
  if (!api) throw new Error('同步块的口子没接上 —— 要先 await ctx.editor.ready()')
  return api
}

export async function newSrc(): Promise<string> {
  return need().newSrc()
}

export async function getSrc(id: string): Promise<string> {
  return need().get(id)
}

/** 写回源，写完广播一遍 —— 同一份源被多处引用时要一起变。 */
export async function putSrc(id: string, content: string): Promise<void> {
  await need().put(id, content)
  notifySrc(id)
}

/* ─────────────── 「某个源变了」的订阅（照 doc-meta.ts 的 subscribe）─────────────── */

const subs = new Map<string, Set<() => void>>()

export function subscribeSrc(id: string, cb: () => void): () => void {
  let set = subs.get(id)
  if (!set) {
    set = new Set()
    subs.set(id, set)
  }
  set.add(cb)
  return () => {
    const s = subs.get(id)
    if (!s) return
    s.delete(cb)
    if (s.size === 0) subs.delete(id)
  }
}

export function notifySrc(id: string): void {
  const set = subs.get(id)
  if (!set) return
  for (const cb of set) cb()
}
