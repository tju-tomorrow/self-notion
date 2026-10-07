/**
 * `ctx.docs` —— 编辑器—存储契约。**只有三个方法**（D-0035，加第四个之前先问一句为什么）。
 *
 *   load(id)        → doc:open
 *   save(id, doc)   → doc:apply
 *   delete(id)      → doc:remove
 *
 * D-0047：跨线的字节字段一律 **base64 字符串** —— `Vec<u8>` 走 JSON 会变成
 * `[49,50,51,…]`，一个字节 ~3.5 个字符，而 update 在打开的 / 每次 apply 的热路径上。
 * Yjs 那边要的是 `Uint8Array`，所以编解码**只在这一层做一次**，别处只看见 Uint8Array。
 */
import type { Context } from 'cordis'
import type { DocsService } from '../../src/kernel/contract'

export const name = 'plugin-storage'

// 硬依赖（CONVENTIONS §6.4）：rpc 没就位就不装载。`inject` 的等待**没有超时**（D-0045），
// 所以先装 storage 后装 rpc 时它会 PENDING —— 这是**对的**，内核的 settled() 是兜底哨兵。
export const inject = ['rpc']

/* ────────────────────────── base64 ↔ Uint8Array ────────────────────────── */

// `String.fromCharCode(...bytes)` 一个字节一个参数。整块 1 MB 喂进去会**爆栈**
// （V8 / JavaScriptCore 的参数上限约 6.5 万）。按块切，块大小稳稳低于任何引擎上限。
const CHUNK = 0x8000 // 32768

export function bytesToBase64(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    raw += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(raw)
}

export function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/* ────────────────────────── 三个方法 ────────────────────────── */

/** `doc:open` 的返回（`store::docs::DocContent`），字节字段是 base64。 */
interface Opened {
  snapshot: string | null
  updates: string[]
}

export function apply(ctx: Context) {
  // inject 保证了这里拿得到 —— PENDING 的 fiber 根本不会跑到 apply（D-0045）。
  const rpc = ctx.rpc

  const docs: DocsService = {
    async load(id) {
      const opened = await rpc.call<Opened>('doc:open', { id })
      // 形状就是契约的 `DocHandle`（它就是照线上形状定的）——
      // 先 apply(snapshot)，再按 seq 依次 apply updates。
      return {
        id,
        snapshot: opened.snapshot === null ? null : base64ToBytes(opened.snapshot),
        updates: opened.updates.map(base64ToBytes),
      }
    },

    async save(id, doc) {
      // 信任边界：句柄是别的插件递进来的（CONVENTIONS §10 不许省）。
      if (!doc || !Array.isArray(doc.updates) || !('snapshot' in doc)) {
        throw new TypeError('ctx.docs.save: 传入的不是 DocHandle')
      }

      // 增量逐条落库（Rust 侧 doc_update 是 append-only）……
      for (const update of doc.updates) {
        await rpc.call('doc:apply', { id, update: bytesToBase64(update) })
      }
      doc.updates = []

      // ……再送完整状态：这是 `doc:apply` 的**合并点**，Rust 换掉 snapshot 并把尾段吸收掉。
      // `update` 是可选的（contract 2fc5bd2），所以不必把同一份字节送两遍。
      if (doc.snapshot !== null) {
        // 顺手把正文投影送上：Rust 的 `doc:apply` 拿 title/md 重建 doc_text + doc_fts
        // （没有这一步，搜索搜不到正文、首页也给不出摘要）。
        // `links` 和 md 同路（D-0085）—— **不送就当"别动已有的边"**，所以老调用方不用改。
        await rpc.call('doc:apply', {
          id,
          snapshot: bytesToBase64(doc.snapshot),
          title: doc.title,
          md: doc.md,
          links: doc.links,
        })
        doc.snapshot = null // 已落库；重发纯属烧带宽（D-0047 的 3.5×）
      }
    },

    async delete(id) {
      await rpc.call('doc:remove', { id })
    },
  }

  ctx.effect(() => ctx.provide('docs', docs))
}
