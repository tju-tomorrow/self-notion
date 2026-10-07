/**
 * 顶栏中间的**文档标签条**（`titlebar.center` 槽）。
 *
 * 开/关/切/拖拽重排 + 会话恢复。打开哪些标签、哪个是激活的，都是**本插件的内部状态**
 * （`./tabs.ts`），不进 `contract.ts` —— 契约里没有「当前文档」这个概念。
 *
 * 「打开一篇文档」这条线走契约里的**事件** `OPEN_DOC`（`ui:openDoc`）：侧栏/编辑器广播，
 * 这里收；用户点标签时这里再广播回去，让编辑器知道当前该挂哪篇。
 */
import type { Context } from 'cordis'
import { createElement } from 'react'
import { listen } from '@tauri-apps/api/event'
// 事件名与载荷类型都从契约来；`Events` 的声明也在契约里（`declare module` 那一块）
// —— 消费方不用再各补一份。
import { CLOSE_ALL, CLOSE_TAB, OPEN_DOC } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
// 多窗口：窗口标签（`win-N`）—— 会话恢复与持久化只有主窗口做。
import { isMainWindow } from '../../src/kernel/window'
import { createTabs, restore, serialize } from './tabs'
import { TabBar } from './view'

export const name = 'shell-tabs'

// 依赖走 inject 声明（CONVENTIONS §6.4「不许手动探测」）。任务给的清单是
// ['docs','slot','settings']；补上 i18n —— 标签的文字全走 `ctx.i18n.t`，少声明就是探测
// （同波次的 search-panel 也是这么补的）。
export const inject = ['docs', 'slot', 'settings', 'i18n', 'rpc']

/** 会话恢复的键。**带插件名前缀** —— `meta` 表是全局的，不前缀早晚跟别的插件撞。 */
const SESSION_KEY = 'shell-tabs.session'

export function apply(ctx: Context) {
  // ★ 会话恢复是**主窗口**一个人的事：`meta` 表是全局的，让第二个窗口也读同一份、写同一份，
  //   两个窗口的标签条就会互相顶掉（Notion 里每个窗口各有各的标签）。
  const store = createTabs(
    undefined,
    isMainWindow ? () => ctx.settings.set(SESSION_KEY, serialize(store.snapshot())) : undefined,
  )

  /** 把设置里的会话读回来（`restore` 逐字段校验，坏数据降级成空标签）。 */
  const pull = () => {
    const before = store.snapshot().activeId
    store.replace(restore(ctx.settings.get(SESSION_KEY)))
    const after = store.snapshot().activeId
    // ★ 恢复出来的标签得**告诉编辑器**。少了这一句，重启后标签条上躺着那几篇，
    //   主区却空着 —— 编辑器只认 OPEN_DOC，不认标签条里有什么（契约里没有「当前文档」）。
    //   自己也会收到这条（同 ctx 的 emit 会回到下面的 `ctx.on`），但 `store.open` 对
    //   已经激活的标签是空操作，不会转圈。
    if (after !== null && after !== before) ctx.emit(OPEN_DOC, { id: after })
  }

  // 先按当下读到的恢复一次（非主窗口不读，理由见上）。
  if (isMainWindow) pull()

  ctx.effect(() => [
    // ★ 再订阅一次同样的恢复。为什么不能只读一次：`plugin-settings` 的预热是**异步**的
    // （`settings:list` 的 IPC 没回来之前，它的 cache 是空的），所以装载这一刻 `get` 多半是
    // undefined。预热填完会 `notify` 一次，那时才真拿到上次那批标签。
    // 这条也是唯一的"读到值"路径 —— 没有它，会话恢复永远恢复不出来。
    // 自己的写回同样会触发它：`replace` 见到内容一样会短路，不会转圈。
    // 非主窗口不订：别的窗口一保存就会把这边的标签换掉。
    ...(isMainWindow ? [ctx.settings.onChange(SESSION_KEY, pull)] : []),

    // 侧栏/编辑器点了文档 → 加一个标签（已开着就切过去）。**不回发**，否则自己收自己。
    ctx.on(OPEN_DOC, ({ id }) => store.open(id)),

    // 标签条本体。返回的 unregister 交给 ctx.effect 记账 —— 卸载时自动撤销（D-0033）。
    ctx.slot.register('titlebar.center', () => createElement(TabBar, { ctx, store })),

    // 「关掉某一个标签」（D-0104 续）。助手那一页用它把自己收成右边一列 ——
    // 规矩跟点标签上那个 × 一模一样（`view.tsx` 的 `close()`）：关掉、邻居上位、没标签回首页。
    ctx.on(CLOSE_TAB, ({ id }) => {
      const before = store.snapshot().activeId
      store.close(id)
      const after = store.snapshot().activeId
      if (after === null) ctx.emit(CLOSE_ALL)
      else if (after !== before) ctx.emit(OPEN_DOC, { id: after })
    }),

    // 菜单里的「新窗口」（⌘⇧N，见 `src/windows.rs`）：Rust 把事件发给**前台那个窗口**，
    // 由这里应一声并带上**当前这一篇** —— 新窗口于是停在同一页（Notion 的行为）。
    // 当前是哪一篇只有标签条知道，所以这件事归这里。
    (() => {
      let off: (() => void) | null = null
      let dead = false
      void listen('ui:new-window', () => {
        void ctx.rpc
          .call('window:new', { docId: store.snapshot().activeId ?? undefined })
          .catch((err) => reportError('window', err))
      }).then((un) => {
        if (dead) un()
        else off = un
      })
      return () => {
        dead = true
        off?.()
      }
    })(),
  ])
}
