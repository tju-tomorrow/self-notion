import { createElement } from 'react'
import type { Context } from 'cordis'
import { CLOSE_ALL, OPEN_DOC, SHOW_LIST, type OpenDocEvent } from '../../src/kernel/contract'
import { ExportSection, setCurrentDoc } from './ui'

export const name = 'export'

export const inject = ['rpc', 'slot', 'i18n']

export function apply(ctx: Context) {
  const section = () => createElement(ExportSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('export.title')
  ;(section as { group?: string }).group = 'system'

  // 第一篇文档的事件早于设置页挂载，当前篇放模块级，组件只订阅。
  ctx.on(OPEN_DOC, ({ id }: OpenDocEvent) => setCurrentDoc(id))
  ctx.on(CLOSE_ALL, () => setCurrentDoc(null))
  ctx.on(SHOW_LIST, () => setCurrentDoc(null))

  ctx.effect(() => ctx.slot.register('settings.section', section))
}
