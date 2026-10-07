/**
 * 事件带 + 那一页的刷新信号。**只有一份**，服务和页面读的是同一份
 * （同 `mem-monitor` 那条纪律：各开一份状态，屏幕上就会出现两个对不上的东西）。
 */
export interface BugEvent {
  readonly at: number
  readonly what: string
  readonly detail?: string
}

/** 留多少条。抓现场时**整条带一起进现场包** —— 要的是「前因」，不是完整历史。 */
const CAP = 200

let events: readonly BugEvent[] = []
const subs = new Set<() => void>()

export function pushEvent(what: string, detail?: string): void {
  events = [...events.slice(-(CAP - 1)), { at: Date.now(), what, detail }]
  for (const cb of subs) cb()
}

export function subscribeEvents(cb: () => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}

export function currentEvents(): readonly BugEvent[] {
  return events
}

/** 抓完一份就让那一页重取目录 —— 不把新抓的塞进页面状态（磁盘才是它的家）。 */
let revision = 0
const revSubs = new Set<() => void>()

export function bumpRevision(): void {
  revision += 1
  for (const cb of revSubs) cb()
}

export function subscribeRevision(cb: () => void): () => void {
  revSubs.add(cb)
  return () => void revSubs.delete(cb)
}

export function currentRevision(): number {
  return revision
}
