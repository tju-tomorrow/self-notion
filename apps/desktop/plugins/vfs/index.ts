/**
 * `ctx.vfs` —— 虚拟文档目录（D-0040）。完整设计见 `docs/vfs.md`。
 *
 * **薄到只剩转发**：投影、路径解析、全扫 grep 全在 Rust（`src-tauri/src/vfs/`）。
 * 这一层存在的唯一理由是把 `rpc.call('vfs:*')` 收成契约上的 `VfsService`，
 * 让消费者（plugin-ai / plugin-mcp，D-0042）拿到的是 `ctx.vfs` 而不是散落的字符串命令。
 *
 * ★ 目录树本身**不做编辑**：这棵树是**给外部 agent grep 用的**，不是给人改的 ——
 * 加一个能改的浏览视图就是别的东西了（docs/vfs.md 第三节：目录 = 查询）。
 * 但「长什么样」得看得见，所以侧栏那一行开出一页**只读**的树（`./page.tsx`，D-0094）。
 *
 * `ctx.vfs` 在契约里是**软依赖**（`vfs?: VfsService`）：消费者用 `ctx.get('vfs')` 取，
 * 拿不到就降级。这个插件只负责把它 provide 出来。
 */
import type { Context } from 'cordis'
import { createElement } from 'react'
import { SHOW_LIST, type VfsEntry, type VfsHit, type VfsService } from '../../src/kernel/contract'
import { setVfsPage, VfsPage } from './page'

export const name = 'plugin-vfs'

// 硬依赖：只是转发，没 rpc 就没这个服务（CONVENTIONS §6.4）。软依赖那侧是消费者的事。
// slot / i18n 是那一页要的：往 `main.home` 挂，文字走 `ctx.i18n.t`。
export const inject = ['rpc', 'slot', 'i18n']

export function apply(ctx: Context) {
  const rpc = ctx.rpc

  const vfs: VfsService = {
    list: (path) => rpc.call<VfsEntry[]>('vfs:list', { path }),

    // ignoreCase 给个具体布尔，别让 undefined 过去 —— Rust 侧是非 Option 的 bool，
    // 收到 null 会变成 bad_args（线上形状见 D-0047 那一类：形状必须两边对齐）。
    grep: (pattern, opts) =>
      rpc.call<VfsHit[]>('vfs:grep', { pattern, ignoreCase: opts?.ignoreCase ?? false }),

    read: (path, opts) =>
      rpc.call<string>('vfs:read', { path, offset: opts?.offset, limit: opts?.limit }),

    // Rust 侧找不到回 null；契约的返回是 `VfsEntry | undefined`，在这儿收一下。
    stat: async (path) => (await rpc.call<VfsEntry | null>('vfs:stat', { path })) ?? undefined,
  }

  // provide 自己就登记在 fiber 的 effect 账本上，卸载即撤销 —— 逆函数就是这个（D-0033）。
  ctx.effect(() => [
    ctx.provide('vfs', vfs),
    // 侧栏点「虚拟目录」→ 主区切到那一页（和四个分组同一条路：SHOW_LIST）。
    ctx.on(SHOW_LIST, ({ group }) => setVfsPage(group === 'vfs')),
    // 那一页挂在 `main.home`（外壳在「没开文档」时才渲染它）；同槽的 `home` 会让开。
    ctx.slot.register('main.home', () => createElement(VfsPage, { ctx, vfs })),
  ])
}
