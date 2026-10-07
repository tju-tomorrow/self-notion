/**
 * 「9m ago」。首页列表与评论面板共用一份 —— 两处各写一份迟早会给出两种说法。
 */
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

export function timeAgo(ts: number, now: number = Date.now()): string {
  const diff = ts - now
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return RTF.format(Math.round(diff / ms), unit)
  }
  return RTF.format(Math.round(diff / 1000), 'second')
}

/** 悬停时看的完整时间。 */
export function fullTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
