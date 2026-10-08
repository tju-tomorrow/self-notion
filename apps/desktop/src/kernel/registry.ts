/**
 * 内核的装载器 + settled 兜底。
 *
 * 官方 `@cordisjs/plugin-loader` 是 Node-only（要 node:module / process.* 的 stub），
 * WKWebView 里跑不了 —— 官方那套的职责只剩「注册一个插件」，所以自己写（D-0045）。
 */
import type { Context, Fiber, Plugin } from 'cordis'

/** 装载一个插件，返回它的 fiber。 */
export function load(ctx: Context, plugin: Plugin): Fiber {
  // ★ 故意不把 cordis 返回的 `Fiber & PromiseLike<Fiber>` 透出去：它的 then 是 fiber.await()，
  //   对 PENDING fiber 会**立刻返回**，什么也没等到 —— 一个静默无用的 await。
  // ★ 也**不许**写 `ctx.plugin(() => import(...))`：不抛错，但异步变 FAILED（D-0045）。
  //   先 `await import()` 再把模块交进来，见 scanner.ts。
  return ctx.plugin(plugin)
}

/** 卸载。**只有这一条路** —— `ctx.dispose()` 在 rc.10 里不存在（D-0045）。幂等。 */
export async function unload(fiber: Fiber): Promise<void> {
  await fiber.dispose()
}

/** 当前活着的全部 fiber。cordis 自己也是这么遍历的（ReflectService.notify）。 */
export function fibers(ctx: Context): Fiber[] {
  const out: Fiber[] = []
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) out.push(fiber)
  }
  return out
}

/**
 * 全 ACTIVE 扫描（D-0045 的 fail-loud 兜底）。
 *
 * `inject` 的等待**没有超时**：依赖永不出现 → fiber 永远 PENDING、**永不报错**。
 * 所以在一个固定时间点扫一遍，谁没 ACTIVE 就大声抛错，不让它静默留着。
 *
 * 注意"等"的写法：`fiber.await()` 等的只是**在途的 load/unload**，对 PENDING 立刻返回。
 * 所以能做的只有「等一轮 → 看 state → 报告」，没有更好的办法 —— 这正是它必须存在的理由。
 */
export async function settled(ctx: Context): Promise<Fiber[]> {
  const seen = new Set<Fiber>()
  // 插件里再挂插件会在装载途中冒出新的 fiber，扫到集合不再增长为止（5 轮封顶，防死循环）。
  for (let round = 0; round < 5; round++) {
    const now = fibers(ctx)
    if (now.every((fiber) => seen.has(fiber))) break
    now.forEach((fiber) => seen.add(fiber))
    await Promise.allSettled(now.map((fiber) => fiber.await()))
  }

  const all = fibers(ctx)
  const stuck = all.filter((fiber) => (fiber.state as number) !== ACTIVE)
  if (stuck.length) {
    throw new Error(
      `插件没能进入 ACTIVE：\n${stuck.map((fiber) => `  · ${describe(fiber)}`).join('\n')}`,
    )
  }
  return all
}

// cordis 把 FiberState 声明成 ambient const enum，`isolatedModules` 下取不到成员（TS2748），
// 所以按 lib/fiber.d.ts 的顺序镜像一份。顺序若变，上面 settled 的兜底会全部误报。
const STATES = ['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'] as const
const ACTIVE = 2 // = FiberState.ACTIVE

function describe(fiber: Fiber): string {
  const missing = Object.keys(fiber.inject).filter((name) => !fiber.ctx.get(name))
  const state = `状态 ${STATES[fiber.state as number] ?? `?(${fiber.state as number})`}`
  // 名字要指名道姓：缺依赖是 PENDING 的**唯一**原因，报出来才知道去装谁。
  if (!missing.length) return `${fiber.name} —— ${state}`
  return `${fiber.name} —— ${state}，缺依赖 ${missing.join(', ')}`
}
