/**
 * 插件管理的地基：**读清单** + **启停** + **持久化**。一行 React 都没有 —— 界面在 `page.tsx`。
 *
 * ── 清单从哪来 ──────────────────────────────────────────────────────────────
 * 契约里没有「插件清单」这个服务（`ctx` 上只有 rpc / docs / editor / slot / command /
 * settings / theme / i18n / vfs? / tools? / ai?）。所以清单**从 cordis 自己的
 * `ctx.registry` 读** —— `RegistryService.values()` / `Plugin.Runtime.fibers` / `Fiber.name`
 * 都是框架的公开 API，不是内核的内部文件。
 *
 * `src/kernel/registry.ts` 的 `fibers()` 做的是同一件事，但它住在内核里，按规矩不 import
 * （CONVENTIONS §6.2：只通过 `ctx` 拿能力）。**内核本该把这件事做成一个 `ctx.plugins` 服务** ——
 * 那是改契约，不在这一轮（见报告）。
 *
 * ── 启停是真的启停 ──────────────────────────────────────────────────────────
 * 停用 = `fiber.dispose()`（D-0045：卸载只有这一条路，`ctx.dispose()` 不存在）。
 * 启用 = `ctx.plugin(recipe)` 重新装载。
 *
 * 重装需要「插件本体」（`name` / `apply` / `inject`），而 cordis 在**最后一根 fiber 销毁时
 * 会把 runtime 一起删掉**（`registry.ts` 的 delete 分支），所以停用前先把这份 recipe 抄在
 * 自己手里（`recipes`）。抄过 recipe 的插件，即使已经不在 registry 里，也照样留在列表上 ——
 * 否则用户一停用，「启用」的按钮就跟着消失了。
 *
 * ── 保护名单 ────────────────────────────────────────────────────────────────
 * 见 `isProtected`。一句话：停掉自己的依赖 = 把自己也停掉（cordis 的依赖消失→自动卸载），
 * 而设置页没了就再也点不回来 —— 那是自锁，不是功能。
 *
 * ── 不做的 ──────────────────────────────────────────────────────────────────
 * 「从市场安装 / 卸载」（下载 → 校验 → 落盘 → 登记）不在这轮：它需要 Rust 侧一个 `plugin:*`
 * 命名空间（Tauri 是编译期命令表，现在没有这个命名空间）。所以卸载按钮只占位。
 */
import type { Context, Fiber } from 'cordis'

/** 自己。停掉自己 = 设置页消失，所以列进保护名单。 */
export const SELF_ID = 'shell-settings'

/** 停用名单存在这一个 key 里（一个数组，不是每个插件一个 key）。 */
export const DISABLED_KEY = 'shell-settings.disabled'

/**
 * 提供这些服务的插件不许停。
 *
 * 为什么是它们：这是**这个页子自己活下来**所需的依赖闭包 —— 我 inject settings / slot /
 * command，而 settings 背后是 rpc，i18n / theme 出字和出颜色。停掉其中任何一个，本插件立刻
 * 变 PENDING（cordis：依赖消失 → 卸载），设置页从界面上消失，用户再也没地方点「启用」。
 * 实测确认过这条连锁（见报告里的探针结果）。
 *
 * 别的服务（`docs` / `search` / `blob` …）不在名单里 —— 停掉它们只是让依赖它们的功能降级，
 * 界面上还能点回来，那是用户该有的自由。
 */
export const PROTECTED_SERVICES = ['rpc', 'settings', 'slot', 'command', 'i18n', 'theme'] as const

// cordis 把 FiberState 声明成 ambient const enum，isolatedModules 下取不到成员（TS2748），
// 按 lib/fiber.d.ts 的顺序镜像一份 —— 和 `src/kernel/registry.ts` 同样的理由、同样的做法。
const STATES = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const

export type PluginState = (typeof STATES)[number] | 'STOPPED' | 'UNKNOWN'

export interface PluginEntry {
  /** 插件名（= `plugins/` 下的目录名，扫描器就是这么登记的）。 */
  id: string
  state: PluginState
  /** 现在有活着的 fiber 吗。false 只可能是「被我们停掉过」。 */
  running: boolean
  /** 它往 `ctx` 上提供了哪些服务（`Fiber.store` 的键）。 */
  services: string[]
  /** 它声明依赖了哪些服务（`Fiber.inject` 的键）。 */
  requires: string[]
  /** 用户的意图（持久化那一份），不是「现在在不在跑」。 */
  enabled: boolean
  /** 不许停（见 `PROTECTED_SERVICES`）。 */
  protected: boolean
}

/** 重装一个被停掉的插件所需的最小信息。 */
export interface Recipe {
  apply: (ctx: Context) => unknown
  inject: string[]
}

/* ────────────────────────── 纯逻辑（能单独断言） ────────────────────────── */

/** 读停用名单。库里什么脏东西都可能（设置是 JSON 存 TEXT），收窄一次，坏值当没配。 */
export function readDisabled(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((id): id is string => typeof id === 'string')
}

/** 加/去一个 id。**排序**：名单会被写进库、也可能被别的窗口读走，定序才好逐字节比（D-0033）。 */
export function toggleDisabled(current: readonly string[], id: string, enabled: boolean): string[] {
  const set = new Set(current)
  if (enabled) set.delete(id)
  else set.add(id)
  return [...set].sort()
}

/** 见 `PROTECTED_SERVICES` 上面那段为什么。 */
export function isProtected(id: string, services: readonly string[]): boolean {
  if (id === SELF_ID) return true
  return services.some((name) => (PROTECTED_SERVICES as readonly string[]).includes(name))
}

/** 数字状态 → 名字。越界的（cordis 以后加状态）报 UNKNOWN，不瞎猜。 */
export function pluginState(state: number): PluginState {
  return STATES[state] ?? 'UNKNOWN'
}

/**
 * 本插件的 fiber 现在是 ACTIVE 吗。
 *
 * 用来卡住「在自己 UNLOADING 期间去装载别的插件」—— D-0045 硬纪律 9：UNLOADING 期注册的
 * effect 永久泄漏。事件监听器在卸载途中还没摘掉，别的 fiber 的状态变化照样会打进来。
 */
export function isAlive(ctx: Context): boolean {
  return (ctx.fiber.state as number) === ACTIVE
}

// = FiberState.ACTIVE（同上：const enum 取不到成员，照 lib/fiber.d.ts 的顺序镜像）。
const ACTIVE = 2

/**
 * 一个极小的开关：`command.run()` 与覆盖层组件之间的唯一联系。
 * 不引状态库（CONVENTIONS §3），也够用 —— 就一个布尔量。
 */
export function createToggle(initial = false) {
  let open = initial
  const subs = new Set<() => void>()
  return {
    get: (): boolean => open,
    set(next: boolean): void {
      if (next === open) return
      open = next
      for (const cb of subs) cb()
    },
    subscribe(cb: () => void): () => void {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
  }
}

export type Toggle = ReturnType<typeof createToggle>

/* ────────────────────────── 管理器 ────────────────────────── */

export interface PluginManager {
  list(): PluginEntry[]
  /** 停用（幂等）：先抄 recipe，再 dispose。 */
  stop(id: string): void
  /** 启用（幂等）：只重装我们停过、手里有 recipe 的。 */
  start(id: string): void
  /** 写入用户的意图，然后按名单对齐现状。 */
  setEnabled(id: string, enabled: boolean): void
  /** 按持久化的名单对齐一遍现状：装载时、设置变化时、状态变化时都走它。 */
  reconcile(): void
  /** 给 `useSyncExternalStore` 用的版本号（每次变化 +1，快照恒定）。 */
  version(): number
  subscribe(cb: () => void): () => void
}

/** 活着的 fiber，按插件名去重（同一个插件被装两次时列表只显示一条）。 */
function liveFibers(ctx: Context): Map<string, Fiber> {
  const out = new Map<string, Fiber>()
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) {
      if (!out.has(fiber.name)) out.set(fiber.name, fiber)
    }
  }
  return out
}

export function createPluginManager(ctx: Context): PluginManager {
  // 「被我停掉的」→ 重装所需。内核不记，只能自己记。
  const recipes = new Map<string, Recipe>()
  const subs = new Set<() => void>()
  let rev = 0
  // reconcile 会 dispose，而 dispose 会同步发 internal/status —— 不设闸门就会递归进来。
  // 递归进来那一趟本来要干的事，外层这一趟的 stop/start 都会幂等地补上，所以直接跳过。
  let reconciling = false

  const bump = (): void => {
    rev += 1
    for (const cb of subs) cb()
  }

  const disabled = (): string[] => readDisabled(ctx.settings.get(DISABLED_KEY))

  const list = (): PluginEntry[] => {
    const off = new Set(disabled())
    const fibers = liveFibers(ctx)
    const ids = new Set([...fibers.keys(), ...recipes.keys()])
    const rows: PluginEntry[] = []
    for (const id of ids) {
      // 没有 runtime 的 fiber（root 之类）走到 `Fiber.name` 会一路冒泡成 'root'，不是插件。
      if (id === 'root') continue
      const fiber = fibers.get(id)
      const services = fiber ? Object.keys(fiber.store ?? {}) : []
      const recipe = recipes.get(id)
      const guarded = isProtected(id, services)
      rows.push({
        id,
        state: fiber ? pluginState(fiber.state as number) : 'STOPPED',
        running: Boolean(fiber),
        services,
        requires: fiber ? Object.keys(fiber.inject) : (recipe?.inject ?? []),
        // 保护名单里的插件**不认**名单上的停用 —— 否则界面上写着「已停用」，它却在跑。
        // （名单是历史遗留，比如保护范围后来收窄过；不清理它，只在对齐现状时无视它。）
        enabled: guarded ? true : !off.has(id),
        protected: guarded,
      })
    }
    // 定序：同一个集合每次列出来顺序一致（D-0033 的路径无关性精神）。
    return rows.sort((a, b) => a.id.localeCompare(b.id))
  }

  const stop = (id: string): void => {
    const fiber = liveFibers(ctx).get(id)
    if (!fiber) return
    const runtime = fiber.runtime
    if (!runtime) return // 没 runtime 的 fiber 不是插件，不碰
    recipes.set(id, {
      // `callback` 是 cordis 记着的插件本体（`resolve()` 的键就是这个函数）。
      // 类型上它是 `Function`，落到我们的形状上要一次收窄 —— 收不了就宁可别记，
      // 记错了会在「启用」时装出个错的插件，比装不上更糟。
      apply: runtime.callback as (ctx: Context) => unknown,
      inject: Object.keys(fiber.inject),
    })
    // dispose 是异步的，而这里是同步路径 —— fire-and-forget，但失败必须留痕（D-0045 的
    // 「不许静默」）。不 await：`fiber.await()` 对 PENDING fiber 立刻返回，等它等于没等。
    void fiber.dispose().catch((err: unknown) => {
      console.error(`[shell-settings] 停用 ${id} 失败`, err)
    })
  }

  const start = (id: string): void => {
    const recipe = recipes.get(id)
    if (!recipe) return
    if (liveFibers(ctx).has(id)) {
      recipes.delete(id) // 已经在跑（别的路径装回来的），recipe 没用了
      return
    }
    recipes.delete(id)
    // 这里**不 await**：`ctx.plugin()` 返回的 then 是 fiber.await()，对 PENDING fiber
    // 立刻返回、什么也没等到（registry.ts 的告诫）。装载结果由 internal/status 汇报。
    ctx.plugin({ name: id, apply: recipe.apply, inject: recipe.inject })
  }

  const reconcile = (): void => {
    if (reconciling) return
    reconciling = true
    try {
      // 名单（意图）与现状（有没有活着）对齐。两边的判断都幂等，所以可以放心多跑。
      for (const entry of list()) {
        if (entry.protected) continue
        if (!entry.enabled && entry.running) stop(entry.id)
        else if (entry.enabled && !entry.running) start(entry.id)
      }
    } finally {
      reconciling = false
    }
    bump()
  }

  return {
    list,
    stop,
    start,
    setEnabled(id, enabled) {
      // 保护名单里的插件：界面上那个按钮已经 `disabled` 了，这里再挡一次 ——
      // 写进名单会让下次启动对着一个「停不掉的东西」空转。见 `isProtected` 上面那段。
      if (list().some((entry) => entry.id === id && entry.protected)) return
      // 写穿到库（plugin-settings 负责落盘），然后对齐现状。
      // 不直接 stop/start —— 意图和现状只有一条同步路径，免得两处判断漂移。
      ctx.settings.set(DISABLED_KEY, toggleDisabled(disabled(), id, enabled))
      reconcile()
    },
    reconcile,
    version: () => rev,
    subscribe(cb) {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
  }
}
