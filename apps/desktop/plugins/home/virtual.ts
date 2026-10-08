/**
 * 「All docs」列表的**窗口计算**：纯函数 + 三个高度常量，不碰 React、不碰 ctx。
 *
 * 行高固定（行 42 / 分组标题 24 / 间隔 12），所以不用测量元素：算一遍前缀和，
 * 再从 scrollTop 二分/线性扫出可见区间。几千篇的列表也只挂几十个 DOM 节点。
 *
 * ★ 这三个数**同时**是 `home.css.ts` 里 row / groupHead 的高度和 slot 的间距 ——
 *   CSS 那边反过来 import 这里，两边不各写一份，改一个数不会只改一半。
 */
import type { DocMeta } from '../../src/kernel/contract'

export const ROW_H = 42
export const HEAD_H = 32
export const GAP = 12

export type Item =
  | { kind: 'head'; key: string; section: string; count: number }
  | { kind: 'doc'; key: string; doc: DocMeta }

export function itemHeight(item: Item): number {
  return item.kind === 'head' ? HEAD_H : ROW_H
}

/** 每条的顶边（已含间隔）与总高。间隔加在每条**之后**，所以最后一条后不用减尾巴。 */
export function layout(items: readonly Item[]): { tops: number[]; total: number } {
  const tops: number[] = []
  let y = 0
  for (const item of items) {
    tops.push(y)
    y += itemHeight(item) + GAP
  }
  return { tops, total: items.length === 0 ? 0 : y - GAP }
}

/** 屏幕外多渲染几条，滚动时不会先看见空白。 */
const OVERSCAN = 6

/**
 * 可见区间 `[start, end)`。`viewH = 0`（还没量到高度）时给前几条，
 * 免得首帧什么都不画、白闪一下。
 */
export function windowRange(
  items: readonly Item[],
  tops: readonly number[],
  scrollTop: number,
  viewH: number,
): { start: number; end: number } {
  const pad = OVERSCAN * ROW_H
  const from = scrollTop - pad
  const to = scrollTop + (viewH || ROW_H * 12) + pad

  let start = 0
  while (start < items.length && tops[start]! + itemHeight(items[start]!) < from) start++
  // 列表刚变短（切了分组）时 scrollTop 可能还停在旧位置上 → 会算出「一条都不显示」。
  // 浏览器下一帧才把 scrollTop 夹回来，这一帧白着很显眼，所以退到末尾那条。
  if (start >= items.length && items.length > 0) start = items.length - 1
  let end = start
  while (end < items.length && tops[end]! < to) end++
  return { start, end }
}
