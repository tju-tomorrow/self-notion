/**
 * 版本历史（D-0043）—— 顶栏一颗图标 + 右侧时间线面板 + 打点的三个由头。
 *
 * 后端那三条命令（`version:list` / `version:restore` / `version:checkpoint`）和 `doc_version`
 * 表早就在了，前端一直没接，所以界面上点不到。这个插件就是那个入口。
 *
 * 打点只在**显式事件**上做，不是每次 300ms 落库都打 —— 那个粒度下版本表会爆炸（D-0043）：
 *   - 离开这一篇（切走 / 回首页）→ `enterDoc` / `leaveDoc` 里收尾
 *   - 每 10 分钟 → 下面那个定时器
 *   - AI 写入前 → 在 Rust 侧（`docs::apply`），前端管不着，也不用管
 *
 * 「当前是哪一篇」在这里订阅、状态放模块级 —— 和 `comment/index.ts` 同一个理由：
 * 入口 / 面板组件的挂载晚于 `OPEN_DOC`，组件自己监听就永远错过那一篇。
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from 'cordis'
import { CLOSE_ALL, OPEN_DOC, SHOW_LIST, type OpenDocEvent } from '../../src/kernel/contract'
import { checkpoint, enterDoc, leaveDoc, openPanel } from './actions'
import { getVersionState } from './state'
import { VersionHeader } from './header'
import { VersionPanel } from './panel'

export const name = 'version-history'

// rpc：三条命令；editor：恢复之后要它丢掉活文档重读；slot：顶栏那一格。
export const inject = ['rpc', 'editor', 'slot']

/** 每 10 分钟一个版本点。 */
const AUTO_MS = 10 * 60 * 1000

export function apply(ctx: Context) {
  ctx.on(OPEN_DOC, ({ id }: OpenDocEvent) => void enterDoc(ctx, id))
  ctx.on(CLOSE_ALL, () => void leaveDoc(ctx))
  ctx.on(SHOW_LIST, () => void leaveDoc(ctx))

  // 定时打点：只对当前那一篇，没开文档就空转。`ctx.effect` 拔插件时自己清。
  ctx.effect(() => {
    const timer = setInterval(() => {
      const docId = getVersionState().docId
      if (docId !== null) void checkpoint(ctx, docId, 'auto')
    }, AUTO_MS)
    return () => clearInterval(timer)
  })

  // 面板：body 上自己的一个 root（覆盖层不走槽，理由见 `panel.tsx`）。
  // 逆函数只拆自己建的东西，**不在 disposer 里注册任何 effect**（D-0045 硬纪律 9）。
  ctx.effect(() => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(createElement(VersionPanel, { ctx }))
    return () => {
      root.unmount()
      host.remove()
    }
  })

  ctx.effect(() =>
    ctx.slot.register('doc.header.right', () => createElement(VersionHeader, { ctx })),
  )

  // 软件依赖的另一端：文档页 ⋯ 菜单里那个「历史版本」入口打开的就是这个面板（拿不到就不显示）。
  ctx.effect(() => ctx.provide('version', { open: () => void openPanel(ctx) }))
}
