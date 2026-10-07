/**
 * 分组与相对时间的纯函数 —— 不碰 ctx、不碰 React，组件那边只剩「怎么画」。
 *
 * 分「今天 / 更早 / 从未更新」是 AFFiNE 那个「按 updatedAt 分组」的简化版
 * （它的 `UpdatedAtGroupHeader` 每段日期一组，我们只留三段 —— 没有日期库，也没必要）。
 * 相对时间用平台自带的 `Intl.RelativeTimeFormat`，跟着界面语言走。
 */
import type { DocMeta, ListGroup } from '../../src/kernel/contract'

export type OrderKey = 'updatedAt' | 'createdAt'
export type SectionKey = 'today' | 'earlier' | 'never'

export interface Section {
  /** `null` = 没分组，组件据此决定画不画小标题。 */
  key: SectionKey | null
  docs: DocMeta[]
}

const DAY = 86_400_000

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', DAY * 365],
  ['month', DAY * 30],
  ['week', DAY * 7],
  ['day', DAY],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' })

/** "9m ago"。 */
export function timeAgo(ts: number, now: number): string {
  const diff = ts - now
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return RTF.format(Math.round(diff / ms), unit)
  }
  return RTF.format(Math.round(diff / 1000), 'second')
}

/** 回收站里的不进这一页（`doc:list` 已经筛了，这里是第二道）。 */
function live(docs: readonly DocMeta[]): DocMeta[] {
  return docs.filter((doc) => doc.deletedAt === null)
}

/**
 * `updatedAt` 与 `createdAt` 相等 = 建出来之后没再动过。
 * ★ `DocMeta` 没有单独的「从未更新」标志，只能这么认 —— 这是偷懒的判据，
 * 真的存在「改完时间戳又恰好相等」的情形（毫秒级），但那种误判的代价只是分错一段。
 */
function sectionOf(doc: DocMeta, dayStart: number): SectionKey {
  if (!doc.updatedAt || doc.updatedAt === doc.createdAt) return 'never'
  return doc.updatedAt >= dayStart ? 'today' : 'earlier'
}

export function buildSections(
  docs: readonly DocMeta[],
  order: OrderKey,
  grouped: boolean,
  now: number,
): Section[] {
  const sorted = live(docs).sort((a, b) => b[order] - a[order])
  if (!grouped) return [{ key: null, docs: sorted }]

  const dayStart = new Date(now).setHours(0, 0, 0, 0)
  const buckets: Record<SectionKey, DocMeta[]> = { today: [], earlier: [], never: [] }
  for (const doc of sorted) buckets[sectionOf(doc, dayStart)].push(doc)

  // 段的顺序就是日期的倒序，空段不画。
  return (['today', 'earlier', 'never'] as const)
    .map((key) => ({ key, docs: buckets[key] }))
    .filter((section) => section.docs.length > 0)
}

/** 「最近」显示几条。 */
export const RECENT_LIMIT = 10

/**
 * 一个分组该显示哪些文档 —— 首页/列表页的分组筛选（C12）。
 * `recent` 按「上次打开」排，从没打开过的退回 `updatedAt`（否则刚建的文档永远垫底）。
 * 回收站之外的分组都排除已删的；`trash` 反过来只留已删的。
 */
export function filterGroup(docs: readonly DocMeta[], group: ListGroup): DocMeta[] {
  const live = docs.filter((doc) => doc.deletedAt === null)
  switch (group) {
    case 'all':
      return live
    case 'favorite':
      return live.filter((doc) => doc.isFavorite)
    // 置顶：后置顶的在前 —— `pinnedAt` 就是排序键（它记的是置顶那一刻）。
    case 'pinned':
      return live
        .filter((doc) => doc.pinnedAt !== null)
        .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
    case 'trash':
      return docs.filter((doc) => doc.deletedAt !== null)
    case 'recent':
      return live
        .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt))
        .slice(0, RECENT_LIMIT)
    // 虚拟目录不是文档列表，主区那一页归 plugin-vfs 画 —— 这一页本来就该让开（D-0094）。
    case 'vfs':
      return []
  }
}
