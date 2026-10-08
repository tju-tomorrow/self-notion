/**
 * 把主题刷到界面上。**这个文件是插件对外唯一有副作用的地方**，所以规矩全写在这儿：
 *
 *   1. 变量走 `<html>` 的**内联** style（`setProperty`）—— 内联永远赢，不跟
 *      `@toeverything/theme` 那张 `[data-theme=...]` 的表抢特异性（同 `paper.ts` / `fonts.ts`）。
 *   2. 重画之前先收回**上一轮自己写过的键**（记在 `written` 里）—— 绝不 `removeProperty` 别人的。
 *   3. 一个 `<style id="sn-theme-css">` 只装变量表达不了的：装饰 + 那五个页面写死的画布底 + 圆角。
 *   4. 卸载 = 收回内联键 + 摘掉 style + 撤掉属性。**验收第二条是「拔掉插件回到原版逐像素一样」。**
 *
 * 明暗闸门（D-0149）：主题声明了 `scheme` 而当前明暗不是它那一档 → **什么都不写**，
 * 等于回到原版。不静默改用户设置，也不跟 `appearance` 抢明暗。
 */
import type { Context } from 'cordis'
import { reportError } from '../../src/kernel/errors'
import { DECOR_CSS, artVars } from './art'
import { expand } from './expand'
import { ACTIVE_KEY, DRAFT_KEY, USERS_KEY, resolved } from './store'

/** 圆角只给「本来就是一张卡片 / 一个浮层」的稳定类名，不动结构类的。 */
const RADIUS_TARGETS = '.sn-code, .sn-slash, .sn-template-pick, .sn-pane-side'

const radiusCss = (radius: number | undefined) =>
  radius === undefined ? '' : `\nhtml[data-sn-theme] ${RADIUS_TARGETS} { border-radius: ${radius}px }\n`

export const STYLE_ID = 'sn-theme-css'

export function installTheme(ctx: Context): () => void {
  const root = document.documentElement
  let written: string[] = []

  const clear = () => {
    for (const key of written) root.style.removeProperty(key)
    written = []
    root.removeAttribute('data-sn-theme')
    document.getElementById(STYLE_ID)?.remove()
  }

  const draw = () => {
    const theme = resolved(ctx)
    clear()
    // 原版：一个变量都不写。带色主题在不是它那一档的明暗下也不写。
    if (!theme.seeds) return
    if (theme.scheme && theme.scheme !== ctx.theme.scheme) return

    const vars = {
      ...expand(theme.seeds),
      ...artVars(theme.seeds, theme),
    }
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value)
      written.push(key)
    }
    root.setAttribute('data-sn-theme', theme.id)

    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = DECOR_CSS + radiusCss(theme.radius) + (theme.css ?? '')
    document.head.appendChild(style)
  }

  /**
   * ★ 换皮肤失败**不许把应用拦在启动前**：`apply` 里抛出去会被内核的 `settled()` 判成 FAILED，
   *   然后 `boot()` 抛 → 用户看到的是整屏红字，为一个装饰插件打不开应用（2026-10-08 日志里就出现过
   *   两条 `theme —— 状态 FAILED`，那是我写文件的中途 HMR 读到半成品）。
   *   所以这里接住 + `reportError` —— 走仓库唯一那个出口（errors.log + 右上角浮一条），
   *   照样响，但应用照常开。
   */
  const paint = () => {
    try {
      draw()
    } catch (err) {
      reportError('theme', err)
    }
  }

  const offs = [ACTIVE_KEY, USERS_KEY, DRAFT_KEY].map((key) => ctx.settings.onChange(key, paint))
  const offTheme = ctx.theme.onChange(paint)
  // 预热是异步的，这会儿可能还读到「原版」；预热完 plugin-settings 会 notify 一次，那时再画。
  paint()

  return () => {
    for (const off of offs) off()
    offTheme()
    clear()
  }
}
