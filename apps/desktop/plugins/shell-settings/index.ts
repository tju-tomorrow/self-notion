/**
 * `shell-settings` —— 设置页 + 插件管理。
 *
 * ── 交付了什么 ──────────────────────────────────────────────────────────────
 * 1. **设置页**：往 `settings.section` 槽里注册一扇页面，它把这个槽里的**所有** section
 *    列成导航并切换。这个槽是共用的 —— 别的插件也往里塞，所以页面必须能列出来
 *    （读 `ctx.slot.list('settings.section')`，见 `page.tsx` 的文件头）。
 * 2. **插件管理**：列出当前被扫描到的插件，每个一个「启用 / 停用」开关，状态持久化到
 *    `ctx.settings`（key 见 `store.ts` 的 `DISABLED_KEY`）。停用是真停用（`fiber.dispose()`），
 *    启用是真重装（`ctx.plugin(recipe)`）。
 *
 * ── 这轮**不做**「从市场安装 / 卸载」 ────────────────────────────────────────
 * 不是忘了，是它缺一块地基：安装流水线是「下载 → 校验 → 落盘到 plugins/<id>/ → 登记（热装载）」
 * 四步（extension-architecture §7），前三步都得在主进程干 —— 要 Rust 侧一个 `plugin:*`
 * 命名空间（`plugin:install` / `plugin:uninstall` / `plugin:list`）。Tauri 的 command 表是
 * **编译期**的，那个命名空间现在还不存在。所以这轮只做「**已扫描到的**插件里启停」，
 * 卸载按钮在界面上占位（`disabled` + title 说明为什么，见 `page.tsx` 的 `PluginRow`）。
 * 升级路径：Rust 补上 `plugin:*` 三条命令 → 这里的 `active` 那一列换成「已登记 vs 已扫描」
 * 两个来源，卸载按钮就能接上，`store.ts` 的启停机制一行都不用改。
 *
 * ── 关于 inject ─────────────────────────────────────────────────────────────
 * 任务给的清单是 `['settings','slot','command']`，这里补上 `i18n` / `theme`：本插件出字走
 * `ctx.i18n.t()`；配色走 `--affine-*` CSS 变量（那张表挂在 `<html>` 上，portal 到 body
 * 照样取得到），`theme` 留在清单里是因为**它就是维护 `data-theme` 的那个服务**。
 * search-panel 撞的是同一件事，补法一样（它那份注释里写着）。
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from 'cordis'
// 契约靠 module augmentation 挂到 Context 上；显式 import 一次，保证它进了编译单元。
import type {} from '../../src/kernel/contract'
import { SettingsOverlay, SettingsPage, PluginSection } from './page'
import { createPluginManager, createToggle, DISABLED_KEY, isAlive } from './store'

export const name = 'shell-settings'

export const inject = ['settings', 'slot', 'command', 'i18n', 'theme']

export function apply(ctx: Context) {
  const manager = createPluginManager(ctx)
  const toggle = createToggle()

  // ① 插件管理那一段（先注册 → 导航里排最前，`page.tsx` 的 `label()` 靠它认词条）
  function own() {
    return createElement(PluginSection, { ctx, manager })
  }
  ;(own as { group?: string }).group = 'system'
  ctx.effect(() => ctx.slot.register('settings.section', own))

  // ② 设置页框架。它自己也注册进这个槽（谁渲染这个槽谁就得到整扇设置页），
  //    所以把自己的引用一起交进去，好从导航里滤掉自己（否则一层套一层）。
  function page() {
    return createElement(SettingsPage, { ctx, self: page, own })
  }
  ctx.effect(() => ctx.slot.register('settings.section', page))

  // ③ 「打开设置」。契约里没有设置窗口，外壳也没渲染 `settings.section` —— 命令 + 覆盖层
  //    这个插件自己补上（理由写在 `page.tsx` 的 `SettingsOverlay` 上面）。
  //    ⌘K 面板能搜到它：search-panel 列的就是 `ctx.command.list()`。
  ctx.effect(() =>
    ctx.command.register({
      id: 'settings.open',
      title: ctx.i18n.t('settings.open'),
      run: () => toggle.set(true),
    }),
  )

  // ④ 覆盖层的宿主根（body 上的空锚，同 search-panel）。
  //    逆函数只拆自己建的东西，**不在 disposer 里注册任何 effect**（D-0045 硬纪律 9）。
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(createElement(SettingsOverlay, { ctx, self: page, own, toggle }))
    return () => {
      root.unmount()
      host.remove()
    }
  })

  /**
   * 名单（用户意图）与现状（谁活着）对齐的触发点。
   *
   * ★ 两个触发点合起来覆盖全部时机：
   *   · `internal/status`：任何 fiber 状态一变就跑（装载、卸载、依赖就绪）。它一次兜住三件事 ——
   *     本插件**自己**转 ACTIVE 时的那一趟（就是「装载时对齐一次」，apply 里跑不了：那时自己的
   *     fiber 还在 LOADING）、启动时名单还没落地就先 ACTIVE 的插件（下一轮再收拾）、以及
   *     **装载之后**才被停用的插件。
   *   · `settings.onChange`：plugin-settings 的预热是异步的（`settings:list`），上次会话停用的
   *     那些插件要等这份名单灌进来才认得出。
   *
   * ★ `isAlive` 闸门：自己 UNLOADING 期间不许再装载别的插件（D-0045 硬纪律 9：UNLOADING
   *   期注册的 effect 永久泄漏）。卸载时这监听器还没摘掉，别的 fiber 的状态变化照样进来。
   */
  const wake = (): void => {
    if (isAlive(ctx)) manager.reconcile()
  }
  ctx.on('internal/status', wake)
  ctx.settings.onChange(DISABLED_KEY, wake)
}
