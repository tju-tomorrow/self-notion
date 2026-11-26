/**
 * 标题下那一行：`创建于 2025-04-23 14:31 · 124 字`。**现算的投影** —— 不进 doc、不落库。
 *
 * ★ 用插件而不是手工接线：字数的刷新点就是 PM 自己的 `update`，销毁由 `view.destroy()` 带走。
 * ★ 创建时间来自 `doc-meta`（`doc:list` 那份）—— 装载那一刻可能还没到（冷启动直接开一篇），
 *   所以那边也订阅一次，到了再补画。取不到就整块收掉，不留一个空日历。
 */
import { Plugin } from 'prosemirror-state'

import { FAMILIARITY, type LearnRow } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { metaOf, subscribe } from './doc-meta'
import { calendarIcon, pageIcon } from './icons'
import { fetchLearn, setFamiliarity, subscribeLearn } from './learn'

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
      //   （一开查找面板就撞）。不先摘掉自己那几格，这行就变成两行 —— 真撞过。
      // 反链也挂在这一行里，重建时别把它一起摘掉。
      for (const node of el.querySelectorAll(
        ':scope > :is(.sn-meta-time, .sn-meta-sep, .sn-meta-words, .sn-meta-learn)',
      )) {
        node.remove()
      }

      const learn = document.createElement('span')
      learn.className = 'sn-meta-learn'
      learn.dataset.open = '0'
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'sn-meta-learn-chip'
      chip.textContent = '学习'
      const pop = document.createElement('span')
      pop.className = 'sn-meta-learn-pop'
      const stats = document.createElement('span')
      stats.className = 'sn-meta-stats'
      const fam = document.createElement('span')
      fam.className = 'sn-meta-fam'
      let current: LearnRow | null = null
      const buttons = FAMILIARITY.map((label, i) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'sn-fam'
        b.textContent = label
        b.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          const next = current?.familiarity === i + 1 ? null : i + 1
          void setFamiliarity(docId, next).catch((err) => reportError('learn', err))
        })
        return b
      })
      fam.append(...buttons)
      pop.append(stats, fam)
      learn.append(chip, pop)

      const applyRow = (row: LearnRow): void => {
        current = row
        const mins = Math.round(row.readMs / 60_000)
        const timeLabel =
          mins < 1 ? '不到 1 分' : mins < 60 ? `${mins} 分` : `${Math.floor(mins / 60)} 时 ${mins % 60} 分`
        stats.textContent = `打开 ${row.opens} · ${timeLabel} · 读到 ${row.depth}% · 效果 ${row.score}`
        const picked = row.familiarity != null ? FAMILIARITY[row.familiarity - 1] : undefined
        chip.textContent = picked ?? '学习'
        if (picked) chip.dataset.on = '1'
        else delete chip.dataset.on
        buttons.forEach((b, i) => {
          // 别写成 data-on="0"：这一行的 `[data-on="0"]` 是「整格收掉」，会把没选中的档藏没。
          if (row.familiarity === i + 1) b.dataset.on = '1'
          else delete b.dataset.on
        })
      }

      chip.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        learn.dataset.open = learn.dataset.open === '1' ? '0' : '1'
      })
      const closeLearn = () => {
        learn.dataset.open = '0'
      }
      const onPointer = (e: PointerEvent) => {
        if (!learn.contains(e.target as Node)) closeLearn()
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeLearn()
      }
      document.addEventListener('pointerdown', onPointer)
      document.addEventListener('keydown', onKey)

      // 反链可能已经在这一行末尾，时间/字数要留在它前面。
      el.prepend(time, sep, words, learn)

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
      const offLearn = subscribeLearn((row) => {
        if (row.docId === docId) applyRow(row)
      })
      void fetchLearn(docId)
        .then((row) => {
          if (row) applyRow(row)
        })
        .catch((err) => reportError('learn', err))

      return {
        update: (next, prev) => {
          if (next.state.doc !== prev.doc) paint()
        },
        destroy: () => {
          off()
          offLearn()
          document.removeEventListener('pointerdown', onPointer)
          document.removeEventListener('keydown', onKey)
          time.remove()
          sep.remove()
          words.remove()
          learn.remove()
        },
      }
    },
  })
}
