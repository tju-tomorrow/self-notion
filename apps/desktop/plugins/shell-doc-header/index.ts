/**
 * `doc.header` + 设置页的「字体」一段。
 *
 * 契约里 `doc.header` 这个槽一直空着（外壳没渲染它，`app-shell.tsx` 现在渲染了）。这里提供组件：
 *   - 顶栏：面包屑 + 收藏星 + ⋯ 菜单（字体 / 拷贝链接 / 拷贝页面内容 / 创建副本 / 移动到 / 移至垃圾箱）
 *   - 设置页：全局字体 + 文章默认字体 + 代码字体（单篇覆盖在页面 ⋯ 菜单里）
 *   - `fonts.ts`：把三级字体写到 `<html>` 上的变量（谁都不许再写第二份）
 *
 * 当前是哪一篇靠跳插件事件 `OPEN_DOC` —— 和编辑器插件同一条路（契约里没有、也不该有 currentDoc）。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { CLOSE_ALL, OPEN_DOC, SHOW_LIST, SPLIT_VIEW, type OpenDocEvent, type SplitViewEvent } from '../../src/kernel/contract'
import { DocHeader, FontSection, setCurrentDoc, setPaneCount } from './view'
import { createFonts } from './fonts'
import { FONT_SCALES, FONT_SCALE_DEFAULT, FONT_SCALE_KEY } from './config'

export const name = 'shell-doc-header'

// 页面动作全走 rpc，字体走 settings。两个都缺了就不装 —— 缺 settings 就是少一档功能，不值当 PENDING。
export const inject = ['rpc', 'settings']

export function apply(ctx: Context) {
  // 「当前是哪一篇」在**插件层**订阅（见 view.ts 那段注释）：组件的挂载晚于 OPEN_DOC。
  // ctx.on 是 fiber 作用域的，卸载时 cordis 自己摘掉。
  const fonts = createFonts(ctx)
  // 单篇覆盖只对当前这一篇有意义，所以换文档时要换掉盯着的那个 key。
  const open = ({ id }: OpenDocEvent) => {
    setCurrentDoc(id)
    fonts.track(id)
  }
  const close = () => {
    setCurrentDoc(null)
    fonts.track(null)
  }
  ctx.on(OPEN_DOC, open)
  // 「现在几栏」由编辑器插件广播（分栏状态在它那儿，见 D-0118）—— 这儿只收不改，
  // 所以不会回发、不会转圈。
  ctx.on(SPLIT_VIEW, ({ panes }: SplitViewEvent) => setPaneCount(panes))
  ctx.on(CLOSE_ALL, close)
  ctx.on(SHOW_LIST, close)
  ctx.effect(() => () => fonts.dispose())

  // 字号：`Cmd/Ctrl` + `=` / `-` / `0`（D-0070）。窗口内监听，跟 ⌘K 面板同一条路 ——
  // 不是 OS 级全局快捷键（那个要 Rust 侧注册）。档位是固定的那几档，不按 1.1 无限乘 ——
  // 浮点数乘起来会跑到 1.0000000000000002 那种值，逐步往下按会卡住不动。
  ctx.effect(() => {
    const read = () => Number(ctx.settings.get<string>(FONT_SCALE_KEY)) || FONT_SCALE_DEFAULT
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const step = e.key === '=' || e.key === '+' ? 1 : e.key === '-' || e.key === '_' ? -1 : 0
      if (step === 0 && e.key !== '0') return
      e.preventDefault()
      const at = FONT_SCALES.indexOf(read())
      const next =
        step === 0
          ? FONT_SCALE_DEFAULT
          : (FONT_SCALES[Math.min(FONT_SCALES.length - 1, Math.max(0, (at < 0 ? 2 : at) + step))] ??
            FONT_SCALE_DEFAULT)
      ctx.settings.set(FONT_SCALE_KEY, String(next))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // 设置页拿组件的 `.label` 当导航标签（`shell-settings` 的 `label()` 认这个属性，否则只能拿函数名）。
  const section = () => createElement(FontSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('font.section')

  ctx.effect(() => [
    ctx.slot.register('doc.header', () => createElement(DocHeader, { ctx })),
    ctx.slot.register('settings.section', section),
  ])
}
