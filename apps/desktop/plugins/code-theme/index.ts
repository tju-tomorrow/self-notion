/**
 * 代码配色。两件事：把选中的那套写到 `<html data-code-theme>`（编辑器里的代码块读它），
 * 以及在设置页出一段画廊（`ui.tsx`）。高亮本身在 `editor-prosemirror/plugins/code-highlight.ts`。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import type {} from '../../src/kernel/contract'
import { ACTIVE_KEY, themeId } from './themes'
import { CodeThemeSection } from './ui'

export const name = 'code-theme'

export const inject = ['slot', 'i18n', 'settings']

export function apply(ctx: Context) {
  const section = () => createElement(CodeThemeSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('codeTheme.section')
  ;(section as { group?: string }).group = 'look'
  ctx.effect(() => ctx.slot.register('settings.section', section))
  ctx.effect(() => paint(ctx))
}

function paint(ctx: Context): () => void {
  const root = document.documentElement
  const draw = () => {
    root.dataset.codeTheme = themeId(ctx.settings.get(ACTIVE_KEY))
  }
  const off = ctx.settings.onChange(ACTIVE_KEY, draw)
  draw()
  return () => {
    off()
    delete root.dataset.codeTheme
  }
}
