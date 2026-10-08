/**
 * 6 个种子 → 70 个变量。**纯函数，无副作用**（写盘那些在 `apply.ts`）。
 *
 * 全部用 `color-mix()` 现算 —— 值本身还是 CSS 表达式，所以这里不需要色彩空间的数学，
 * 而且主题表达的是**关系**（「次要文字 = 正文和画布混一半」）而不是一堆死 hex：
 * 用户把画布调暗，整套跟着暗，不会出现「调了一个色，另一处对不上了」。
 *
 * ★ 键名大小写照抄 `@toeverything/theme`（`layer/insideBorder/border` 那种），
 *   写错一个字母 → `var()` 落空 → 整条声明作废（`shell.css.ts` 顶上那条警告）。
 * ★ 只写**项目真的引用过**的键（65 个，实测 grep）+ 自己那层 `--sn-*` 钩子。
 */
import type { Seeds } from './types'

/** 带透明度的染色：`on('#fff', 8)` = 8% 的白。 */
const on = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

/** 往另一个色里兑：`blend(text, 66, canvas)` = 66% 正文 + 34% 画布。 */
const blend = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`

/** 影子统一偏靛黑，压在靛蓝画布上不发灰。 */
const INK = '#05060f'

export function expand(seeds: Seeds | null): Record<string, string> {
  if (!seeds) return {}

  const { canvas, sidebar, surface, accent, text, border } = seeds

  // 混出来的中间色，下面反复用 —— 明暗两档主题走的是同一套比例，所以换主题不用改公式。
  const text2 = blend(text, 66, canvas)
  const text3 = blend(text, 52, canvas)
  const disabled = blend(text, 40, canvas)
  const iconPrimary = blend(text, 92, canvas)
  const iconSecondary = blend(text, 78, canvas)
  const iconTertiary = blend(text, 42, canvas)
  const raise = on(text, 8) // 抬起（按钮底、内描边）

  return {
    // ── 层：画布 / 卡片 / 浮层 ──────────────────────────────────────────────
    '--affine-v2-layer-background-primary': canvas,
    '--affine-background-primary-color': canvas,
    '--affine-v2-layer-background-secondary': surface,
    '--affine-v2-layer-background-codeBlock': surface,
    '--affine-v2-layer-background-overlayPanel': surface,
    '--affine-background-overlay-panel-color': surface,
    // 默认那档暗色是 #565656（比 secondary 亮）—— 保持这个方向：比卡片再亮一档
    '--affine-v2-layer-background-tertiary': blend(surface, 72, text3),
    '--affine-v2-layer-background-modal': on(INK, 85),
    '--affine-v2-layer-background-translucentUI': on(canvas, 82),
    '--affine-v2-layer-background-hoverOverlay': on(accent, 18),
    '--affine-v2-layer-background-hover': on(accent, 12),
    '--affine-v2-layer-background-error': blend('#e5484d', 20, canvas),

    // ── 描边 ────────────────────────────────────────────────────────────────
    '--affine-border-color': border,
    '--affine-v2-layer-insideBorder-border': border,
    '--affine-v2-layer-insideBorder-blackBorder': on(text, 5),
    '--affine-v2-layer-insideBorder-whiteBorder': on(text, 5),
    '--affine-v2-layer-insideBorder-primaryBorder': accent,
    '--affine-v2-layer-insideBorder-primary': on(accent, 35),

    // ── 文字 ────────────────────────────────────────────────────────────────
    '--affine-v2-text-primary': text,
    '--affine-text-primary-color': text,
    '--affine-v2-text-secondary': text2,
    '--affine-text-secondary-color': text2,
    '--affine-v2-text-tertiary': text3,
    '--affine-v2-text-placeholder': blend(text, 48, canvas),
    '--affine-text-disable-color': disabled,

    // ── 图标 ────────────────────────────────────────────────────────────────
    '--affine-v2-icon-primary': iconPrimary,
    '--affine-v2-icon-secondary': iconSecondary,
    '--affine-v2-icon-tertiary': iconTertiary,
    '--affine-icon-color': blend(text, 68, canvas),
    '--affine-icon-secondary': iconSecondary,

    // ── 强调色（68 处引用，换主色实际上是一次替换就到位的）────────────────────
    '--affine-primary-color': accent,
    '--affine-primary-color-04': on(accent, 8),
    '--affine-hover-color': on(accent, 12),
    // 默认那档链接比主色浅（#78BEFF vs #1C9EE4），深色画布上才读得清 —— 同向。
    '--affine-link-color': blend(accent, 78, text),

    // ── 按钮 ────────────────────────────────────────────────────────────────
    '--affine-v2-button-primary': accent,
    '--affine-v2-button-secondary': raise,
    '--affine-v2-button-iconButtonSolid': raise,
    '--affine-v2-button-emptyIconBackground': on(text, 5),
    '--affine-v2-button-buttonOverHover': on(text, 14),
    '--affine-v2-button-innerBlackBorder': on(INK, 5),
    '--affine-v2-button-disable': disabled,
    '--affine-v2-button-pureWhiteText': '#ffffff',

    // ── 标签 / 开关 / 状态 ──────────────────────────────────────────────────
    '--affine-v2-tab-tabBackground-default': surface,
    '--affine-v2-tab-tabBackground-active': border,
    '--affine-v2-tab-iconColor-default': text3,
    '--affine-v2-tab-fontColor-default': disabled,
    '--affine-v2-toggle-backgroundOff': blend(text, 32, canvas),
    '--affine-v2-status-success': '#3fb950',
    '--affine-v2-status-error': '#e5484d',
    '--affine-error-color': '#e5484d',

    // ── 查找 / 评论高亮 ─────────────────────────────────────────────────────
    '--affine-find-highlight': on(accent, 35),
    '--affine-find-highlight-active': on(accent, 62),
    '--affine-v2-block-comment-highlightDefault': on(accent, 14),
    '--affine-v2-block-comment-highlightActive': on(accent, 26),
    '--affine-v2-block-comment-highlightUnderline': accent,

    // ── 影子：几何照抄 AFFiNE（换了会看着"位移"），只把颜色染成靛黑 ──────────
    '--affine-shadow-2': `0px 0px 12px 0px ${on(INK, 55)}`,
    '--affine-shadow-3': `0px 0px 20px 0px ${on(INK, 62)}`,
    '--affine-menu-shadow': `0px 10px 18px ${on(INK, 45)}, 0px -1px 12px ${on(INK, 30)}`,
    '--affine-popover-shadow': `0px 0px 30px 0px ${on(INK, 35)}, 0px 0px 8px 0px ${on(INK, 45)}`,
    '--affine-overlay-shadow': `0px 1px 6px 0px ${on(INK, 72)}, 0px 8px 14px 0px ${on(INK, 45)}`,

    // ── 侧栏（壳直接读 `--sn-sidebar`，见 apply.ts 的附加表）──────────────────
    '--sn-sidebar': sidebar,

    // ── 项目自留的钩子（编辑器 / 大纲 / 分割线读它们）────────────────────────
    '--sn-accent': accent,
    '--sn-muted': text2,
    '--sn-text': text,
    '--sn-line': border,
    '--sn-bg': canvas,
    '--sn-panel': surface,
    '--sn-hover': on(accent, 12),
    '--sn-canvas': canvas,
    // 纸面「跟随主题」时落到这儿 —— 于是那个选项从此真的跟随当前主题（D-0148）
    '--sn-paper-default': canvas,
  }
}

/** 变量表 → 内联样式串。`;` 收尾 + 末尾空格，拼在 style 属性里是合法的。 */
export function cssText(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}
