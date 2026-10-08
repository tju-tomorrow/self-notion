/**
 * `ctx.docs` —— 编辑器—存储契约。**只有三个方法**（D-0035，加第四个之前先问一句为什么）。
 *
 *   load(id)        → doc:open        |  file:read   （`file:` 前缀）
 *   save(id, doc)   → doc:apply       |  file:write  （`file:` 前缀）
 *   delete(id)      → doc:remove
 *
 * 字节是**一个 JSON 字符串**（PM 的 `doc.toJSON()`）—— 文本，过 IPC 不用 base64（D-0131）。
 *
 * ★ **外部文件的分流就在这儿**（D-0142，全文 `docs/external-md.md`）：`file:` 前缀的那条路上
 *   载荷换成了 `raw`（读进来）和 `md`（写回去），`content` 恒 null ——
 *   所以编辑器那边「多认一个字段」就够了，**不需要知道背后是库还是文件**。
 */
import type { Context } from 'cordis'
import { filePathOf, type DocsService, type FileRead, type FileStamp } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'

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

  /** 每篇外部文件手上那把锁（load 时拿的 mtime+hash）。写回时原样带回去当乐观锁。 */
  const stamps = new Map<string, FileStamp>()
  /** 冲突态：磁盘那份被外面改过，这篇**再也不许写**，直到重新打开（D-0142 的写盘规矩）。 */
  const conflicted = new Set<string>()

  const docs: DocsService = {
    async load(id) {
      const path = filePathOf(id)
      if (path !== null) {
        const file = await rpc.call<FileRead>('file:read', { path })
        stamps.set(id, { mtime: file.mtime, hash: file.hash })
        conflicted.delete(id) // 重新打开 = 拿新的锁，冲突态结束
        return { id, content: null, raw: file.text }
      }
      const opened = await rpc.call<Opened>('doc:open', { id })
      return { id, content: opened.content }
    },

    async save(id, doc) {
      // 信任边界：句柄是别的插件递进来的（CONVENTIONS §10 不许省）。
      if (!doc || !('content' in doc)) {
        throw new TypeError('ctx.docs.save: 传入的不是 DocHandle')
      }
      const path = filePathOf(id)
      if (path !== null) {
        // 文件模式：载荷是 `md`（保真序列化出来的整篇），`content` 恒 null。
        if (doc.md === undefined) return
        // ★ 冲突态下**不写**：把锁换成新的放行下一次 = 用户没看见的那次覆盖照样发生。
        if (conflicted.has(id)) {
          throw new Error('ctx.docs.save: 这篇在磁盘上被改过了，不会写 —— 重新打开它再改')
        }
        try {
          stamps.set(id, await rpc.call<FileStamp>('file:write', { path, text: doc.md, expect: stamps.get(id) }))
        } catch (err) {
          conflicted.add(id)
          reportError('plugin-storage', err)
          throw err
        }
        return
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
      // 文件是用户的，不是库里的东西 —— 这条路不提供删除（D-0140）。
      if (filePathOf(id) !== null) {
        throw new Error('ctx.docs.delete: 外部文件不从这个口子删')
      }
      await rpc.call('doc:remove', { id })
    },
  }

  ctx.effect(() => ctx.provide('docs', docs))
}
