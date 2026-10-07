/**
 * 侧栏底部那只像素宠物。
 *
 * 引擎从 LingRui-Scribe 的 `@lingrui/mascot` 搬来（D-0072）：帧是**程序化生成**的，
 * 不带任何图片资产 —— 离线能用，也没有 Live2D / VRM 那套模型授权的事。
 *
 * 两处注册：侧栏底部新加的 `sidebar.foot` 槽（**只展示**，用户要求）+ 设置页里的
 * 「宠物」一段（在这儿换形象）。做成独立插件，不想要了整个目录删掉即可。
 *
 * **以后这是 AI 入口**：`mascot.tsx` 里 `speak()` 那一处换成开 AI 面板就行。
 */
import type { Context } from 'cordis'
import { createElement } from 'react'
// 契约靠 module augmentation 挂在 Context 上；显式 import 一次，保证它进编译单元
import type {} from '../../src/kernel/contract'
import { Mascot } from './mascot'
import { PetFace } from './pet-face'
import { MascotSettings } from './settings'

export const name = 'mascot'

// 挂两个槽位 + 读「选的是哪只」（`ctx.settings` 是同步读的，渲染路径上直接读）
export const inject = ['slot', 'settings', 'i18n']

export function apply(ctx: Context) {
  ctx.effect(() => ctx.slot.register('sidebar.foot', () => createElement(Mascot, { ctx })))

  // 别人要一只宠物时给一只（`MascotService`，D-0095）：内置助手那一页的标志和头像。
  // 软依赖 —— 没装这个插件那头就少画一只宠物，不会什么都打不开。
  ctx.effect(() =>
    ctx.provide('mascot', { face: (size: number) => createElement(PetFace, { ctx, size }) }),
  )

  // 设置页的段名认组件上的 `.label`（`shell-settings/page.tsx` 的 `label()`），
  // 词条表里没有别的插件那几段 —— 跟 appearance 一个写法。
  const section = () => createElement(MascotSettings, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('settings.mascot')
  ;(section as { group?: string }).group = 'system'
  ctx.effect(() => ctx.slot.register('settings.section', section))
}
