/**
 * 主题插件。**装了就多一层主题系统，删掉目录就回到原版**（D-0145，`docs/theme.md`）。
 *
 * 两件事：把当前主题刷到 `<html>` 上（`apply.ts`）+ 在设置页出一段界面（`ui.tsx`）。
 * 不需要的话整个目录删掉即可。外壳上的钩子都带默认值（`data-sn-shell`、`--sn-nav-on*`），不选 Notion 时不算进去。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { reportError } from '../../src/kernel/errors'
// 契约靠 module augmentation 挂在 Context 上；显式 import 一次，保证它进编译单元
import type {} from '../../src/kernel/contract'
import type { ThemeController } from '../../src/theme/tokens'
import { installTheme } from './apply'
import { NOTION_ID } from './builtin'
import { ACTIVE_KEY, DRAFT_KEY } from './store'
import { ThemeSection } from './ui'

/** 只切一次。之后在设置里改回原版 / 夜空，下次启动不再抢。 */
const NOTION_SEEN = 'theme.notion.seen'

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

  // 用户要的是打开就是这套，不是在画廊里再找一次。seen 落盘之后就不再改他的选择。
  void ctx.rpc
    .call<Record<string, string>>('settings:list')
    .then((all) => {
      if (all[NOTION_SEEN] === 'true') return
      ctx.settings.set(ACTIVE_KEY, NOTION_ID)
      ctx.settings.set(DRAFT_KEY, {})
      ctx.settings.set(NOTION_SEEN, true)
      if (ctx.theme.scheme !== 'dark') (ctx.theme as ThemeController).set('dark')
    })
    .catch((err: unknown) => reportError('theme', err))
}
