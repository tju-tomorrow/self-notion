/**
 * 标题下那一行：`创建于 2025-04-23 14:31 · 124 字`。**现算的投影** —— 不进 doc、不落库。
 *
 * ★ 用插件而不是手工接线：字数的刷新点就是 PM 自己的 `update`，销毁由 `view.destroy()` 带走。
 * ★ 创建时间来自 `doc-meta`（`doc:list` 那份）—— 装载那一刻可能还没到（冷启动直接开一篇），
 *   所以那边也订阅一次，到了再补画。取不到就整块收掉，不留一个空日历。
 */
import { Plugin } from 'prosemirror-state'

import { metaOf, subscribe } from './doc-meta'
import { calendarIcon, pageIcon } from './icons'

export interface MetaStrings {
  /** 形如 `创建于 {time}`。 */
  readonly createdAt: string
  /** 形如 `{count} 字`。 */
  readonly words: string
}

/** 跟 i18n 的插值同一个写法（`{name}`），这一层不认识 ctx，只能自己补。 */
const fill = (s: string, vars: Record<string, string | number>): string =>
  s.replace(/\{(\w+)\}/g, (whole, name: string) => String(vars[name] ?? whole))

/** `2025-04-23 14:31` —— 本地时间，跟 Notion 一个格式。 */
function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function metaPlugin(el: HTMLElement, docId: string, strings: MetaStrings): Plugin {
  return new Plugin({
    view: (view) => {
      const time = document.createElement('span')
      time.className = 'sn-meta-time'
      const timeText = document.createElement('span')
      time.append(calendarIcon(14), timeText)

      const sep = document.createElement('span')
      sep.className = 'sn-meta-sep'
      sep.textContent = '·'

      const words = document.createElement('span')
      words.className = 'sn-meta-words'
      const wordsText = document.createElement('span')
      words.append(pageIcon(14), wordsText)

      // ★ 视图会被**重建**：`find.ts` / `comment.ts` 的 `reconfigure` 会把所有插件视图 destroy 再建一遍
      //   （一开查找面板就撞）。不先清空自己那一格，这行就变成两行 —— 真撞过。
      el.replaceChildren()
      el.append(time, sep, words)

      const paint = (): void => {
        const created = metaOf(docId)?.createdAt
        time.dataset.on = created === undefined ? '0' : '1'
        sep.dataset.on = created === undefined ? '0' : '1'
        if (created !== undefined) timeText.textContent = fill(strings.createdAt, { time: stamp(created) })
        // 空格不算字数（中英混排时「字数」指的是字），跟 Notion 显示的口径一致。
        const count = view.state.doc.textContent.replace(/\s+/g, '').length
        wordsText.textContent = fill(strings.words, { count })
      }

      paint()
      const off = subscribe(paint)

      return {
        update: (next, prev) => {
          if (next.state.doc !== prev.doc) paint()
        },
        destroy: () => {
          off()
          // 重建时上面那句 `replaceChildren` 兜得住，但**真正的销毁**（换篇 / 拔插件）得自己摘干净。
          el.replaceChildren()
        },
      }
    },
  })
}
