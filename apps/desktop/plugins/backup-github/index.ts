/**
 * GitHub 单向备份的设置页（D-0026）。
 *
 * 这个插件只做两件事：往 `settings.section` 槽塞一个组件、经 `ctx.rpc` 调 `backup:*` 命令。
 * ★ **HTTP 全在 Rust**（`src-tauri/src/backup/`）—— 插件自己不联网，所以**不**声明 `net` 权限；
 *   token 也只进 Rust 的 `meta` 表，**永不回传** webview（`backup:status` 只回「配没配」）。
 * 卸掉它，设置页少一节、应用照常跑（CONVENTIONS §6.2）。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { DOCS_CHANGED } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { BackupSection } from './ui'

export const name = 'backup-github'

// 依赖走 inject 声明（CONVENTIONS §6.4）。三个都由别处 provide，缺了就不装载。
export const inject = ['rpc', 'slot', 'i18n']

export function apply(ctx: Context) {
  // 返回的 unregister 交给 ctx.effect 记账 —— 卸载即撤销（D-0033 的逆函数纪律）。
  // 设置页导航的标签取自这个函数上的 `.label`（`shell-settings` 认它），不给就只能显示「设置项 N」。
  const section = () => createElement(BackupSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('backup.title')
  ;(section as { group?: string }).group = 'integration'
  ctx.effect(() => ctx.slot.register('settings.section', section))

  // 自动备份：文档改动后推一次。Rust 侧没有调度器，这一层最省事；
  // 「启用备份」这个开关不开就是没开 —— 之前它只是个摆设（只在手动推时被读一眼）。
  ctx.effect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const fire = async () => {
      timer = undefined
      try {
        const st = await ctx.rpc.call<{ enabled: boolean; configured: boolean }>('backup:status')
        if (!st.enabled || !st.configured) return
        await ctx.rpc.call('backup:now')
      } catch (err) {
        reportError('backup-github', err)
      }
    }
    const off = ctx.on(DOCS_CHANGED, () => {
      if (timer !== undefined) return
      timer = setTimeout(() => void fire(), 60_000)
    })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      void off()
    }
  })
}
