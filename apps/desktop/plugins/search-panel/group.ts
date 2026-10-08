/**
 * 搜索面板的纯逻辑：日期分段、祖先路径、命中切片、Markdown 切块。
 * 不碰 ctx、不碰 React —— 组件那边只剩「怎么画」（和首页的 `group.ts` 同一个分工）。
 *
 * 分段边界照 AFFiNE 的 `components/page-list/group-definitions.tsx`：今天 / 昨天 /
 * 2–7 天 / 7–30 天 / 更早。它把那一段叫「过去 7 天」，截图里是「上周」，跟着截图叫。
 */
import { HIT_CLOSE, HIT_OPEN, type DocMeta } from '../../src/kernel/contract'

const DAY = 86_400_000

export interface Segment {
  text: string
  hit: boolean
}

/**
 * 把 Rust 递来的正文片段按 `HIT_OPEN`/`HIT_CLOSE` 切成若干 run。
 *
 * ★ **切成元素渲染，永远不 innerHTML** —— 正文是用户内容，也是导入进来的内容。
 *   标记用 U+0002/U+0003 而不是 `<mark>`，正是为了让「切段」这套对 `<` 免疫。
 *
 * 标记不成对（理论上不会有，Rust 侧成对写）时，尾巴当归到命中段 —— 降级但可见，
 * 不吞内容也不抛。真出现时说明 Rust 的 snippet 出了岔子，那时再收紧。
 */
export function parseSnippet(body: string): Segment[] {
  const out: Segment[] = []
  let hit = false
  let at = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch !== HIT_OPEN && ch !== HIT_CLOSE) continue
    if (i > at) out.push({ text: body.slice(at, i), hit })
    hit = ch === HIT_OPEN
    at = i + 1
  }
  if (at < body.length) out.push({ text: body.slice(at), hit })
  return out
}

export type GroupKey = 'today' | 'yesterday' | 'lastWeek' | 'last30Days' | 'earlier'

const ORDER: readonly GroupKey[] = ['today', 'yesterday', 'lastWeek', 'last30Days', 'earlier']

/** 分组标题的词条 key —— 文案在 i18n.ts，别在这儿写中文。 */
export const GROUP_LABEL: Readonly<Record<GroupKey, string>> = {
  today: 'search.group.today',
  yesterday: 'search.group.yesterday',
  lastWeek: 'search.group.lastWeek',
  last30Days: 'search.group.last30Days',
  earlier: 'search.group.earlier',
}

function dayStart(ts: number): number {
  return new Date(ts).setHours(0, 0, 0, 0)
}

/**
 * 一条记录落在哪一段。「天数」按**当天的零点**相减，不是按 24 小时的整数倍 ——
 * 否则晚上 11 点写的东西，第二天早上 9 点还算「今天」。
 * `round` 而不是 `floor`：夏令时那天两个零点差 23/25 小时，floor 会差一天。
 */
export function dateGroup(ts: number, now: number): GroupKey {
  const days = Math.round((dayStart(now) - dayStart(ts)) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days <= 7) return 'lastWeek'
  if (days <= 30) return 'last30Days'
  return 'earlier'
}

export interface Section<T> {
  key: GroupKey
  rows: T[]
}

/** 分段，段内保持传入的顺序（调用方已经按更新时间排好），空段不画。 */
export function groupByDate<T extends { updatedAt: number }>(
  rows: readonly T[],
  now: number,
): Section<T>[] {
  const buckets: Record<GroupKey, T[]> = {
    today: [],
    yesterday: [],
    lastWeek: [],
    last30Days: [],
    earlier: [],
  }
  for (const row of rows) buckets[dateGroup(row.updatedAt, now)].push(row)
  return ORDER.map((key) => ({ key, rows: buckets[key] })).filter((sec) => sec.rows.length > 0)
}

/**
 * 祖先路径（「开源项目 / 基础概念」），给行尾那截灰字用。根到父的顺序。
 * 带环保护：`parentId` 是用户数据，导入坏数据时成环不是不可能，成环不能把界面吊死。
 */
export function ancestorPath(id: string, byId: ReadonlyMap<string, DocMeta>): string {
  const names: string[] = []
  const seen = new Set([id])
  let at = byId.get(id)?.parentId ?? null
  while (at && !seen.has(at) && names.length < 32) {
    seen.add(at)
    const doc = byId.get(at)
    if (!doc) break
    names.unshift(doc.title)
    at = doc.parentId
  }
  return names.join(' / ')
}

/** 空查询时列表里放什么：没进回收站的，按更新时间倒序。 */
export function recentDocs(docs: readonly DocMeta[], limit: number): DocMeta[] {
  return docs
    .filter((doc) => doc.deletedAt === null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

export type MdKind = 'h' | 'p' | 'li' | 'quote' | 'code'

export interface MdBlock {
  kind: MdKind
  text: string
}

/** 行内的装饰记号，预览里没法呈现，就抹掉（`**粗**` → `粗`）。 */
function inline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`/g, '')
}

/**
 * Markdown 投影 → 几行可以直着画的文字。
 *
 * ★ 这不是 Markdown 渲染器，**只认行首那一个记号**（标题 / 列表 / 引用），
 *   是为了让预览别把 `##` `- ` 原样怼到脸上。真要排版得上渲染器，那是一个依赖，
 *   而预览只是「扫一眼这篇写了啥」。
 */
export function mdBlocks(md: string): MdBlock[] {
  const out: MdBlock[] = []
  let prose = true // 现在不在代码围栏里
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('```')) {
      prose = !prose
      continue
    }
    if (!line.trim()) continue
    if (!prose) {
      out.push({ kind: 'code', text: line })
      continue
    }
    const head = /^(#{1,6})\s+(.*)$/.exec(line)
    if (head) {
      out.push({ kind: 'h', text: inline(head[2]) })
      continue
    }
    const li = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line)
    if (li) {
      out.push({ kind: 'li', text: inline(li[1]) })
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      out.push({ kind: 'quote', text: inline(quote[1]) })
      continue
    }
    out.push({ kind: 'p', text: inline(line) })
  }
  return out
}
