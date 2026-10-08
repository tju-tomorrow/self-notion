/**
 * `ctx.command` —— 命令**注册表**：`register` 进、`list` 出。就这两件事。
 *
 * 快捷键绑定、菜单渲染、⌘K 命令面板都不在这儿：那些是消费者（S6 / Stage 2 的 UI），
 * 它们 inject 这个服务，不反过来。
 */
import type { Context } from 'cordis'
import type { CommandService, CommandSpec } from '../../src/kernel/contract'

export const name = 'plugin-command'

export function apply(ctx: Context) {
  // id → 命令。按 id 存（同一个 id 重注册以最后一次为准），注销时按 id 找回来。
  const commands = new Map<string, CommandSpec>()

  const command: CommandService = {
    register(cmd) {
      commands.set(cmd.id, cmd)
      // 逆函数即 register 的返回值（D-0033），幂等。
      return () => {
        // 只删自己写进去的那一条：同 id 换过一版之后，旧版的注销不许把新版带走。
        if (commands.get(cmd.id) === cmd) commands.delete(cmd.id)
      }
    },

    // 宿主（命令面板）**打开时读一次** —— 跟 `SlotService.list` 是同一个用途。
    // 拿到 spec 自己调 `run()`，所以契约里没有 run/subscribe。
    list: () => [...commands.values()],
  }

  ctx.effect(() => ctx.provide('command', command))
}
