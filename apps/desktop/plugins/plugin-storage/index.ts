/**
 * `ctx.docs` —— 编辑器—存储契约。**只有三个方法**（D-0035，加第四个之前先问一句为什么）。
 *
 *   load(id)        → doc:open
 *   save(id, doc)   → doc:apply
 *   delete(id)      → doc:remove
 *
 * 字节是**一个 JSON 字符串**（PM 的 `doc.toJSON()`）—— 文本，过 IPC 不用 base64（D-0131）。
 */
import type { Context } from 'cordis'
import type { DocsService } from '../../src/kernel/contract'

export const name = 'plugin-storage'

// 硬依赖（CONVENTIONS §6.4）：rpc 没就位就不装载。`inject` 的等待**没有超时**（D-0045），
// 所以先装 storage 后装 rpc 时它会 PENDING —— 这是**对的**，内核的 settled() 是兜底哨兵。
export const inject = ['rpc']

/** `doc:open` 的返回里用得上的那一半 —— 形状 = 契约的 `DocHandle`。 */
interface Opened {
  content: string | null
}

export function apply(ctx: Context) {
  // inject 保证了这里拿得到 —— PENDING 的 fiber 根本不会跑到 apply（D-0045）。
  const rpc = ctx.rpc

  const docs: DocsService = {
    async load(id) {
      const opened = await rpc.call<Opened>('doc:open', { id })
      return { id, content: opened.content }
    },

    async save(id, doc) {
      // 信任边界：句柄是别的插件递进来的（CONVENTIONS §10 不许省）。
      if (!doc || !('content' in doc)) {
        throw new TypeError('ctx.docs.save: 传入的不是 DocHandle')
      }
      // 句柄是**一次性的落库缓冲**：送完即清空（契约 DocHandle 的语义）——
      // 所以 null 就是这次没字节可落，静默返回。`content` 是**合并点**（D-0131）：Rust 整篇覆盖。
      if (doc.content === null) return
      await rpc.call('doc:apply', {
        id,
        content: doc.content,
        // 正文投影跟 content 同路（D-0085）：不送 = 保持库里原值，老调用方不用改。
        title: doc.title,
        md: doc.md,
        links: doc.links,
      })
      doc.content = null // 已落库；重发纯属烧带宽
    },

    async delete(id) {
      await rpc.call('doc:remove', { id })
    },
  }

  ctx.effect(() => ctx.provide('docs', docs))
}
