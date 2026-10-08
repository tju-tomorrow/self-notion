/**
 * `import-notion` —— 设置页里那节「从 Notion 导入」。
 *
 * 交付：选一个 Notion 的 HTML 导出 zip → 每篇页面成一篇文档（文件夹层级 → 父子层级，
 * 图片进 blob 表）。解析与落库的来龙去脉写在 `notion.ts` 的文件头。
 *
 * 依赖 `rpc`（`doc:create` / `blob:put` / `doc:apply`）+ `editor`（markdown → doc JSON 走
 * `ctx.editor.docFromMarkdown`）。落库走 rpc 不再走 `ctx.docs`。都由别处 provide，缺了不装载。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'

import type {} from '../../src/kernel/contract'
import { ImportSection } from './ui'

export const name = 'import-notion'

export const inject = ['rpc', 'editor', 'slot', 'i18n']

export function apply(ctx: Context) {
  // 设置页导航的标签取自这个函数上的 `.label`（`shell-settings` 认它）。
  const section = () => createElement(ImportSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('import.title')
  ;(section as { group?: string }).group = 'integration'
  ctx.effect(() => ctx.slot.register('settings.section', section))
}
