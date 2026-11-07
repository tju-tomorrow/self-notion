/**
 * 谁提到了这一篇。挂在标题下那行元信息里 —— 摊在正文里会挡住点空白落光标。
 *
 * 数据是 Rust 现算的（`link:backlinks`）。口子由 `index.ts` 装。
 * 刷新：挂载一次 + 每次 `DOCS_CHANGED`（别的文档改了出链，这边读的是「谁指向我」）。
 */
import type { DocMeta } from '../../src/kernel/contract'
import { openDoc, subscribe } from './doc-meta'
import { linkIcon } from './icons'

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
  el.dataset.on = '0'
  el.dataset.open = '0'

  const sep = document.createElement('span')
  sep.className = 'sn-meta-sep'
  sep.textContent = '·'

  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'sn-backlinks-head'
  const headText = document.createElement('span')
  head.append(linkIcon(14), headText)

  const pop = document.createElement('div')
  pop.className = 'sn-backlinks-pop'
  el.append(sep, head, pop)

  const close = () => {
    el.dataset.open = '0'
  }
  head.addEventListener('click', (e) => {
    e.preventDefault()
    el.dataset.open = el.dataset.open === '1' ? '0' : '1'
  })
  const onPointer = (e: PointerEvent) => {
    if (!el.contains(e.target as Node)) close()
  }
  const onKey = () => close()
  document.addEventListener('pointerdown', onPointer)
  document.addEventListener('keydown', onKey)

  const paint = () => {
    if (!load) return
    void load(docId)
      .then((rows) => {
        pop.replaceChildren()
        el.dataset.on = rows.length ? '1' : '0'
        if (!rows.length) {
          close()
          return
        }
        headText.textContent = `${rows.length} 个页面提到了这里`
        for (const row of rows) {
          const item = document.createElement('button')
          item.type = 'button'
          item.className = 'sn-backlinks-item'
          item.textContent = row.title || '未命名'
          item.addEventListener('click', () => {
            close()
            openDoc(row.id)
          })
          pop.appendChild(item)
        }
      })
      .catch(() => {
        el.dataset.on = '0'
        close()
      })
  }

  paint()
  const off = subscribe(paint)

  return {
    el,
    destroy: () => {
      off()
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      el.remove()
    },
  }
}
