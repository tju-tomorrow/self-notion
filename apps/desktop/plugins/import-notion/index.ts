/**
 * `import-notion` —— 设置页里那节「从 Notion 导入」。
 *
 * 交付：选一个 Notion 的 HTML 导出 zip → 每篇页面成一篇文档（文件夹层级 → 父子层级，
 * 图片进 blob 表）。解析与落库的来龙去脉写在 `notion.ts` 的文件头。
 *
 * 依赖 `docs`（落库）+ `rpc`（`doc:create` / `blob:put`）+ `editor`（拿和编辑器**同一套**块 schema）。
 * 都由别处 provide，缺了不装载。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'

import type {} from '../../src/kernel/contract'
import { ImportSection } from './ui'

export const name = 'import-notion'

export const inject = ['rpc', 'docs', 'editor', 'slot', 'i18n']

export function apply(ctx: Context) {
  // 设置页导航的标签取自这个函数上的 `.label`（`shell-settings` 认它）。
  const section = () => createElement(ImportSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('import.title')
  ctx.effect(() => ctx.slot.register('settings.section', section))
}
