/**
 * 像素宠物（D-0072）：内置助手那一页的标志和头像，外加设置页里换形象的一段。
 *
 * 引擎从 LingRui-Scribe 的 `@lingrui/mascot` 搬来：帧是**程序化生成**的，
 * 不带任何图片资产 —— 离线能用，也没有 Live2D / VRM 那套模型授权的事。
 */
import type { Context } from 'cordis'
import { createElement } from 'react'
// 契约靠 module augmentation 挂在 Context 上；显式 import 一次，保证它进编译单元
import type {} from '../../src/kernel/contract'
import { PetFace } from './pet-face'
import { MascotSettings } from './settings'

export const name = 'mascot'

// 挂两个槽位 + 读「选的是哪只」（`ctx.settings` 是同步读的，渲染路径上直接读）
export const inject = ['slot', 'settings', 'i18n']

export function apply(ctx: Context) {
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
