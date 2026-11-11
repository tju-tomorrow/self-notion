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
  /** 固定：排在最左，且「关闭其他 / 关闭所有」不扫它。 */
  readonly pinned: boolean
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

  /** 只留这一个（固定住的也留），它就是激活的那个。 */
  closeOthers(id: string): void

  /** 关掉没固定的；固定的留下，激活位落到还活着的那个。一个不剩才是 null。 */
  closeAll(): void
  activate(id: string): void
  /** 固定 / 取消固定。钉住的排到最左。 */
  togglePin(id: string): void
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
    tabs.push({ id: tab.id, pinned: tab.pinned === true })
  }
  // 固定的永远在最左；sort 是稳定排序，组内顺序不动。
  tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned))
  const activeId =
    input.activeId !== null && seen.has(input.activeId) ? input.activeId : (tabs[0]?.id ?? null)
  return { tabs, activeId }
}

/** 只留 `keep` 认可的标签（库里还在的）。激活那篇被裁掉时落到邻居（跟 `close` 同一条规矩）。
 *  一个不剩返回空快照 —— 调用方自己发 `CLOSE_ALL` 回首页。内容没变时**返回原对象**，好让 `replace` 短路。 */
export function pruneSnapshot(snap: TabSnapshot, keep: (id: string) => boolean): TabSnapshot {
  const tabs = snap.tabs.filter((tab) => keep(tab.id))
  if (tabs.length === snap.tabs.length) return snap
  let activeId = snap.activeId
  if (activeId !== null && !tabs.some((tab) => tab.id === activeId)) {
    const at = snap.tabs.findIndex((tab) => tab.id === activeId)
    const right = snap.tabs.slice(at + 1).find((tab) => keep(tab.id))
    const left = snap.tabs.slice(0, at).reverse().find((tab) => keep(tab.id))
    activeId = (right ?? left)?.id ?? null
  }
  return { tabs, activeId }
}

/** 两份快照内容是否一样（顺序算数）。`replace` 靠它短路，否则"自己写回 → 通知 → 再写回"会转圈。 */
function sameSnap(a: TabSnapshot, b: TabSnapshot): boolean {
  if (a.activeId !== b.activeId || a.tabs.length !== b.tabs.length) return false
  for (let i = 0; i < a.tabs.length; i++) {
    if (a.tabs[i]?.id !== b.tabs[i]?.id) return false
    if (a.tabs[i]?.pinned !== b.tabs[i]?.pinned) return false
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
        commit({ tabs: [...snap.tabs, { id, pinned: false }], activeId: id })
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
      commit({ tabs: snap.tabs.filter((tab) => tab.id === id || tab.pinned), activeId: id })
    },

    closeAll() {
      const tabs = snap.tabs.filter((tab) => tab.pinned)
      if (tabs.length === snap.tabs.length) return
      const kept = tabs.some((tab) => tab.id === snap.activeId)
      commit({ tabs, activeId: kept ? snap.activeId : (tabs[0]?.id ?? null) })
    },

    togglePin(id) {
      if (!snap.tabs.some((tab) => tab.id === id)) return
      const tabs = snap.tabs.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab))
      // 跟 normalize 同一条规矩：钉住的在最左，组内顺序不变。
      tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned))
      commit({ tabs, activeId: snap.activeId })
    },

    move(from, to) {
      const n = snap.tabs.length
      if (from === to || from < 0 || to < 0 || from >= n || to >= n) return
      const tabs = [...snap.tabs]
      const moved = tabs.splice(from, 1)[0]
      if (!moved) return
      tabs.splice(to, 0, moved)
      // 拖进另一组也留不住：固定的必须在最左。
      tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned))
      commit({ tabs, activeId: snap.activeId })
    },
  }
}

/* ────────────────────────── 会话恢复 ────────────────────────── */

/** 落到 `meta` 表的形状（`ctx.settings` 会 JSON 序列化它）。`tabs` 的顺序即数组顺序；
 *  `pinned` 单独一份 —— 老版本存的数据没有这个字段，读到就是全不固定。 */
export interface PersistedTabs {
  tabs: string[]
  activeId: string | null
  pinned: string[]
}

export function serialize(snap: TabSnapshot): PersistedTabs {
  return {
    tabs: snap.tabs.map((tab) => tab.id),
    activeId: snap.activeId,
    pinned: snap.tabs.filter((tab) => tab.pinned).map((tab) => tab.id),
  }
}

/** 恢复。入参是 `unknown`（来自别处的 JSON），**逐字段校验**后收窄。 */
export function restore(raw: unknown): TabSnapshot {
  if (!raw || typeof raw !== 'object') return EMPTY
  const { tabs, activeId, pinned } = raw as { tabs?: unknown; activeId?: unknown; pinned?: unknown }
  const ids = Array.isArray(tabs) ? tabs.filter((id): id is string => typeof id === 'string') : []
  const pinnedIds = new Set(
    Array.isArray(pinned) ? pinned.filter((id): id is string => typeof id === 'string') : [],
  )
  return normalize({
    tabs: ids.map((id) => ({ id, pinned: pinnedIds.has(id) })),
    activeId: typeof activeId === 'string' ? activeId : null,
  })
}
