/**
 * 主题插件。**装了就多一层主题系统，删掉目录就回到原版**（D-0145，`docs/theme.md`）。
 *
 * 两件事：把当前主题刷到 `<html>` 上（`apply.ts`）+ 在设置页出一段界面（`ui.tsx`）。
 * 不需要的话整个目录删掉即可 —— 它不碰任何别的插件的文件，别的插件也不 import 它。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { reportError } from '../../src/kernel/errors'
// 契约靠 module augmentation 挂在 Context 上；显式 import 一次，保证它进编译单元
import type {} from '../../src/kernel/contract'
import { installTheme } from './apply'
import { ThemeSection } from './ui'

export const name = 'theme'

// `rpc` 是给插图用的：图存成 blob（`blob:put`），设置里只留 `self-notion://blob/<id>`。
export const inject = ['slot', 'i18n', 'theme', 'settings', 'rpc']

export function apply(ctx: Context) {
  // ★ 接住 + 记一笔，**不往外抛**：`apply` 里抛出去会被内核 `settled()` 判成 FAILED，
  //   `boot()` 跟着抛，用户看到整屏红字 —— 为一个装饰插件打不开应用不值（见 `apply.ts` 的 paint）。
  ctx.effect(() => {
    try {
      return installTheme(ctx)
    } catch (err) {
      reportError('theme', err)
      return () => {}
    }
  })

  // 设置页的段名认组件上的 `.label` / `.group`（`shell-settings/page.tsx`），跟 appearance 一个写法。
  const section = () => createElement(ThemeSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('theme.section')
  ;(section as { group?: string }).group = 'look'
  ctx.effect(() => ctx.slot.register('settings.section', section))
}
