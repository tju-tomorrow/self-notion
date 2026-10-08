/**
 * 文档底部的**反向链接** —— 谁提到了这一篇（D-0085 那条链接图谱的另一半）。
 *
 * ★ 数据是 Rust 现算的（`link:backlinks`，走 `doc_link` 的 `to_id` 索引）—— 这一侧只负责画。
 *   口子由 `index.ts` 装（跟 `blob.ts` / `doc-meta.ts` 一个规矩，不 import 别人的内部）。
 * ★ 刷新时机：挂载一次 + 每次 `DOCS_CHANGED`。别的文档改了正文就会重建出链，
 *   而我们读的是「谁指向我」，所以得跟着重取。
 */
import type { DocMeta } from '../../src/kernel/contract'
import { openDoc } from './doc-meta'
import { subscribe } from './doc-meta'

export type LoadBacklinks = (id: string) => Promise<DocMeta[]>

let load: LoadBacklinks | undefined

export function setLoadBacklinks(fn: LoadBacklinks): void {
  load = fn
}

export interface BacklinksView {
  el: HTMLElement
  destroy(): void
}

export function renderBacklinks(docId: string): BacklinksView {
  const el = document.createElement('div')
  el.className = 'sn-backlinks'

  const paint = () => {
    if (!load) return
    void load(docId)
      .then((rows) => {
        el.replaceChildren()
        // 没有人提到这一篇 → 整块收掉，别在每篇空文档底下挂一句「暂无」。
        el.dataset.on = rows.length ? '1' : '0'
        if (!rows.length) return

        const head = document.createElement('div')
        head.className = 'sn-backlinks-head'
        head.textContent = `${rows.length} 个页面提到了这里`
        el.appendChild(head)

        for (const row of rows) {
          const item = document.createElement('button')
          item.type = 'button'
          item.className = 'sn-backlinks-item'
          item.textContent = row.title || '未命名'
          item.addEventListener('click', () => openDoc(row.id))
          el.appendChild(item)
        }
      })
      .catch(() => {
        // 取不到就不画 —— 反链是附加信息，不该拦一次错误弹窗（错误进 errors.log）。
        el.dataset.on = '0'
      })
  }

  paint()
  const off = subscribe(paint)

  return { el, destroy: off }
}
