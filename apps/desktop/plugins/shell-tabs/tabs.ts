/**
 * 标签条的状态机 —— **纯逻辑，不碰 React、不碰 ctx**，所以能单独断言（CONVENTIONS §8）。
 *
 * ★ 「哪个文档是激活的」是本插件的**内部状态**，不进 `contract.ts`：
 *   契约里根本没有「当前文档」这个概念，标签条自己记（任务约束 + D-0035 的窄契约）。
 *
 * ★ 会话恢复的形状也在这儿：`serialize` / `restore` 一对。恢复的入参**不可信**
 *   （来自 `meta` 表的 JSON），所以 `restore` 逐字段校验，坏数据一律降级成空标签
 *   —— 宁可从零开始，也不要往界面上塞半个坏标签。
 */

/** 一个标签 = 一个文档。文档身份就是 `documents.id`。 */
export interface Tab {
  readonly id: string
}

export interface TabSnapshot {
  /** 标签按**显示顺序**排（拖拽重排改的就是它） */
  readonly tabs: readonly Tab[]
  /** 当前激活的标签 id；一个标签都没有时为 null */
  readonly activeId: string | null
}

export interface TabsStore {
  /** 给 `useSyncExternalStore` 用的订阅；返回退订函数（逆函数纪律 D-0033） */
  subscribe(cb: () => void): () => void
  /** 当前快照。**内容不变时返回同一个对象** —— 否则 useSyncExternalStore 会无限重渲染 */
  snapshot(): TabSnapshot
  /** 用外部快照**整体替换**（会话恢复 / 预热回来的持久化值）。内容一样时是空操作 —— 见下。 */
  replace(next: TabSnapshot): void
  /** 开一个文档 = 加一个标签；已经开着就切过去 */
  open(id: string): void
  close(id: string): void

  /** 只留这一个（其余全关），它就是激活的那个。 */
  closeOthers(id: string): void

  /** 全关。激活位变 null —— 调用方自己发 `CLOSE_ALL` 回首页。 */
  closeAll(): void
  activate(id: string): void
  /** 拖拽重排：把 `from` 位置的标签移到 `to` 位置 */
  move(from: number, to: number): void
}

const EMPTY: TabSnapshot = { tabs: [], activeId: null }

/** 去重 + 让 activeId 一定落在 tabs 里。装载时的恢复、每次 commit 都过它，界面上不会有"激活一个不存在的标签"。 */
function normalize(input: TabSnapshot): TabSnapshot {
  const seen = new Set<string>()
  const tabs: Tab[] = []
  for (const tab of input.tabs) {
    if (seen.has(tab.id)) continue
    seen.add(tab.id)
    tabs.push({ id: tab.id })
  }
  const activeId =
    input.activeId !== null && seen.has(input.activeId) ? input.activeId : (tabs[0]?.id ?? null)
  return { tabs, activeId }
}

/** 两份快照内容是否一样（顺序算数）。`replace` 靠它短路，否则"自己写回 → 通知 → 再写回"会转圈。 */
function sameSnap(a: TabSnapshot, b: TabSnapshot): boolean {
  if (a.activeId !== b.activeId || a.tabs.length !== b.tabs.length) return false
  for (let i = 0; i < a.tabs.length; i++) {
    if (a.tabs[i]?.id !== b.tabs[i]?.id) return false
  }
  return true
}

export function createTabs(initial: TabSnapshot = EMPTY, onChange?: () => void): TabsStore {
  let snap = normalize(initial)
  const subs = new Set<() => void>()

  const commit = (next: TabSnapshot) => {
    if (next === snap) return
    snap = next
    subs.forEach((cb) => cb())
    // 状态变了就落一次盘（会话恢复）。放在订阅之后：订阅者先看到新值。
    onChange?.()
  }

  return {
    subscribe(cb) {
      subs.add(cb)
      return () => void subs.delete(cb)
    },

    snapshot: () => snap,

    replace(next) {
      const n = normalize(next)
      // 内容一样就不动：这是打断"写回 → onChange 通知 → 再写回"那个圈的唯一开关。
      if (sameSnap(n, snap)) return
      commit(n)
    },

    open(id) {
      const at = snap.tabs.findIndex((tab) => tab.id === id)
      if (at < 0) {
        commit({ tabs: [...snap.tabs, { id }], activeId: id })
        return
      }
      // 已经开着：只切过去，不重复加一个
      if (snap.activeId !== id) commit({ tabs: snap.tabs, activeId: id })
    },

    close(id) {
      const at = snap.tabs.findIndex((tab) => tab.id === id)
      if (at < 0) return
      const tabs = snap.tabs.filter((tab) => tab.id !== id)
      let activeId = snap.activeId
      // 关的正是激活那个：落到**右边那个**，右边没有了就落到左边（Notion 的行为）
      if (activeId === id) activeId = (tabs[at] ?? tabs[at - 1] ?? null)?.id ?? null
      commit({ tabs, activeId })
    },

    activate(id) {
      if (snap.activeId === id) return
      if (!snap.tabs.some((tab) => tab.id === id)) return
      commit({ tabs: snap.tabs, activeId: id })
    },

    closeOthers(id) {
      if (!snap.tabs.some((tab) => tab.id === id)) return
      commit({ tabs: snap.tabs.filter((tab) => tab.id === id), activeId: id })
    },

    closeAll() {
      if (snap.tabs.length === 0) return
      commit({ tabs: [], activeId: null })
    },

    move(from, to) {
      const n = snap.tabs.length
      if (from === to || from < 0 || to < 0 || from >= n || to >= n) return
      const tabs = [...snap.tabs]
      const moved = tabs.splice(from, 1)[0]
      if (!moved) return
      tabs.splice(to, 0, moved)
      commit({ tabs, activeId: snap.activeId })
    },
  }
}

/* ────────────────────────── 会话恢复 ────────────────────────── */

/** 落到 `meta` 表的形状（`ctx.settings` 会 JSON 序列化它）。只存 id —— 顺序即数组顺序。 */
export interface PersistedTabs {
  tabs: string[]
  activeId: string | null
}

export function serialize(snap: TabSnapshot): PersistedTabs {
  return { tabs: snap.tabs.map((tab) => tab.id), activeId: snap.activeId }
}

/** 恢复。入参是 `unknown`（来自别处的 JSON），**逐字段校验**后收窄。 */
export function restore(raw: unknown): TabSnapshot {
  if (!raw || typeof raw !== 'object') return EMPTY
  const { tabs, activeId } = raw as { tabs?: unknown; activeId?: unknown }
  const ids = Array.isArray(tabs) ? tabs.filter((id): id is string => typeof id === 'string') : []
  return normalize({
    tabs: ids.map((id) => ({ id })),
    activeId: typeof activeId === 'string' ? activeId : null,
  })
}
