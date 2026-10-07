/**
 * 顶栏左侧的**前进/后退**两颗箭头（`titlebar.left` 槽，紧挨侧栏折叠开关右边）。
 *
 * 栈是本插件的内部状态（`./nav.ts`）。记录什么、重放什么全部走契约里那三条事件 ——
 * 「主区该显示哪一页」只有这两个出口：`OPEN_DOC` / `SHOW_LIST`（`CLOSE_ALL` 也是回首页）。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { CLOSE_ALL, OPEN_DOC, SHOW_LIST, type ShowListEvent } from '../../src/kernel/contract'
import { createNav, type NavEntry } from './nav'
import { NavButtons } from './view'

export const name = 'shell-nav'

export const inject = ['slot', 'i18n']

export function apply(ctx: Context) {
  const store = createNav()

  /** ★ 正在重放历史。`true` 的那一瞬间收到的事件都是**自己发出去的**，
   *  再记一条就会把栈走成「退一步又前进两步」，来回点两下就卡在原地。 */
  let replaying = false

  const apply_ = (entry: NavEntry | undefined) => {
    if (!entry) return
    replaying = true
    try {
      if (entry.kind === 'doc') ctx.emit(OPEN_DOC, { id: entry.id })
      else ctx.emit(SHOW_LIST, { group: entry.group })
    } finally {
      // 事件在这一行之前已经同步派完了，所以同步放开就够（编辑器/侧栏都是同步 emit）。
      replaying = false
    }
  }

  const go = (delta: -1 | 1) => apply_(delta < 0 ? store.back() : store.forward())

  // 退不动/进不动时那两颗按钮是 `disabled`，但 ⌘[ / ⌘] 绕过了按钮 —— 这里自己兜住。
  const keyBack = () => {
    const at = store.snapshot().index
    if (at > 0) go(-1)
  }
  const keyForward = () => {
    const snap = store.snapshot()
    if (snap.index >= 0 && snap.index < snap.entries.length - 1) go(1)
  }

  ctx.effect(() => [
    ctx.on(OPEN_DOC, ({ id }) => {
      if (!replaying) store.push({ kind: 'doc', id })
    }),
    ctx.on(SHOW_LIST, ({ group }: ShowListEvent) => {
      if (!replaying) store.push({ kind: 'list', group })
    }),
    // 关光标签回首页。首页的默认那一页就是「全部文档」。
    ctx.on(CLOSE_ALL, () => {
      if (!replaying) store.push({ kind: 'list', group: 'all' })
    }),

    ctx.slot.register('titlebar.left', () => createElement(NavButtons, { ctx, store, go })),

    // Notion 的快捷键：⌘[ 退 / ⌘] 进（Windows 上就是 Ctrl 那两个）。
    ctx.effect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (!(e.metaKey || e.ctrlKey) || e.altKey) return
        if (e.key === '[') {
          e.preventDefault()
          keyBack()
        } else if (e.key === ']') {
          e.preventDefault()
          keyForward()
        }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }),
  ])
}
