/**
 * 把 Rust 的 `kb:tools` 目录逐条包成 `ToolSpec`（D-0187「一份目录，两处运输」）。
 *
 * ★ **不在这边写死工具定义** —— 写死就是两份，必然漂。目录只有 Rust 一份
 *   （`kb::tools::catalog_writable`，MCP 那边读同一个函数）。
 * ★ `ctx.tools` 是**软依赖**：tools 插件没装就一条都不注册，不报错（照 `plugins/ai/loop.ts`）。
 */
import type { Context } from 'cordis'
import type { ToolSpec } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'

/** `kb:tools` 回来的一行 —— Rust `kb::tools::catalog*` 的形状。 */
interface KbToolDef {
  name: string
  description: string
  inputSchema: unknown
}

export function registerKbTools(ctx: Context): void {
  const tools = ctx.get('tools')
  if (!tools) return

  // 目录要异步拉。挂在同一个 effect 里：装载途中被拔就一条都不挂
  // —— PENDING fiber 上的 disposable 永不回收（D-0045）。
  ctx.effect(() => {
    let dead = false
    const offs: (() => void)[] = []
    void ctx.rpc
      .call<KbToolDef[]>('kb:tools', {})
      .then((catalog) => {
        if (dead) return
        for (const def of defs(catalog)) offs.push(tools.register(spec(ctx, def)))
      })
      .catch((err: unknown) => reportError('kb', err))
    return () => {
      dead = true
      for (const off of offs) off()
    }
  })
}

function spec(ctx: Context, def: KbToolDef): ToolSpec {
  return {
    name: def.name,
    description: def.description,
    // 模型看到的 JSON Schema 就是 Rust 那份，原样转过去（D-0187）。
    parameters: def.inputSchema,
    // 执行在 Rust（`kb::tools::call`）—— 这边只把名字和参数转过去。
    run: (args) => ctx.rpc.call<string>('kb:call', { name: def.name, args }),
  }
}

/** rpc 回来的形状不保证（跨线没有编译期检查）—— 只留长得对的那几条，坏的丢掉。 */
function defs(raw: unknown): KbToolDef[] {
  if (!Array.isArray(raw)) return []
  const out: KbToolDef[] = []
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue
    const o = d as Record<string, unknown>
    if (typeof o['name'] !== 'string' || typeof o['description'] !== 'string') continue
    out.push({ name: o['name'], description: o['description'], inputSchema: o['inputSchema'] })
  }
  return out
}
