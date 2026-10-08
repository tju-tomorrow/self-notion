/**
 * 编辑器 ↔ 存储的适配层（JSON 版）—— 取代 `editor-blocksuite/doc-source.ts` 那份 Yjs 的。
 *
 * ★ 砍了 CRDT 就没有「增量」这回事（D-0131）：`content` 是一整段 JSON，`save` 整篇覆盖。
 *   库里那份就是**唯一真相**，这一层不缓存任何镜像（架构 §6.3 的 A：谁改谁落库、
 *   落库后广播重读）—— 缓存会引入「镜像和活文档谁新」这个问题，而答案永远不唯一。
 */
import type { DocHandle, DocLink, DocsService } from '../../src/kernel/contract'

/** 一次落库要送的东西。`title` / `md` / `links` 是正文投影（D-0085），Rust 拿它们喂 FTS / 摘要 / 出链。 */
export interface DocPayload {
  id: string
  /** PM `doc.toJSON()` 的字符串形式。★ **外部文件那条路恒 `null`**（载荷换成了 `md`，契约 `DocHandle` 注释）。 */
  content: string | null
  title: string
  md: string
  links: DocLink[]
}

export interface DocsBacking {
  /** 读一篇的载荷。库文档只有 `content`；外部文件是 `raw`（原文，`content` 恒 null）。 */
  hydrate(docId: string): Promise<DocHandle>
  /** 整篇覆盖写回（`doc:apply` 的合并点语义从「合并 Yjs」变成「覆盖 JSON」，架构 §6.2）。 */
  flush(payload: DocPayload): Promise<void>
}

export function docsBacking(docs: DocsService): DocsBacking {
  return {
    async hydrate(docId) {
      return docs.load(docId)
    },

    async flush(payload) {
      // 句柄是**一次性的落库缓冲**：`plugin-storage` 送完会把 `content` 置空，复用一个旧的只会送出空调用。
      await docs.save(payload.id, {
        id: payload.id,
        content: payload.content,
        title: payload.title,
        md: payload.md,
        links: payload.links,
      })
    },
  }
}
