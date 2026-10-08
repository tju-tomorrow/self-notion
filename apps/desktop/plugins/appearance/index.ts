/**
 * 外观设置段：界面语言 + 深浅色 + **正文纸面** + 快捷键速查。
 *
 * 语言 / 深浅色**不经过 ctx.settings**：`plugin-settings` 的预热是异步的，而它们在组合根建
 * i18n / theme 的那一刻就要读到（`main.tsx` 比插件装载早）。所以落 localStorage，改完直接
 * `location.reload()` —— 换语言要重建整棵界面树，重载是最省事也最不容易漏的做法。
 *
 * 纸面（底色 + 磨砂）晚得多、也不重建树，所以**走 ctx.settings**（D-0074）。
 */
import { createElement, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { SchemePref, ThemeController } from '../../src/theme/tokens'
import { Group, Row } from '../../src/ui/settings'
import {
  FOLLOW_THEME,
  PAPER_ALPHA_KEY,
  PAPER_KEY,
  PAPER_PRESETS,
  createPaper,
  paperAlpha,
  paperChoice,
  paperSwatchValue,
  schemeNow,
} from './paper'
import * as p from './paper.css'

export const name = 'appearance'

export const inject = ['slot', 'i18n', 'theme', 'settings']

const LANG_KEY = 'sn.lang'

type LangChoice = 'system' | 'zh' | 'en'

function currentLang(): LangChoice {
  try {
    const raw = localStorage.getItem(LANG_KEY)
    return raw === 'zh' || raw === 'en' ? raw : 'system'
  } catch {
    return 'system'
  }
}

function pickLang(value: LangChoice): void {
  try {
    if (value === 'system') localStorage.removeItem(LANG_KEY)
    else localStorage.setItem(LANG_KEY, value)
  } catch {
    // 落不了盘（隐私模式）就只在这次会话里生效
  }
  location.reload()
}

export function apply(ctx: Context) {
  const section = () => createElement(AppearanceSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('settings.appearance')
  ;(section as { group?: string }).group = 'look'
  ctx.effect(() => ctx.slot.register('settings.section', section))
  // 纸面的颜色/磨砂写 `<html>` 那份变量 —— 跟设置页分开：改一次不必重建整棵树。
  ctx.effect(() => createPaper(ctx))
}

/** 读设置并跟着它重画（`ctx.settings` 的预热是异步的，订上就补回来了）。 */
function useSetting<T>(ctx: Context, key: string, read: (ctx: Context) => T): T {
  const [, setTick] = useState(0)
  useEffect(() => ctx.settings.onChange(key, () => setTick((n) => n + 1)), [ctx, key])
  return read(ctx)
}

function AppearanceSection({ ctx }: { ctx: Context }) {
  const theme = ctx.theme as ThemeController

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 22 } },

    createElement(
      Group,
      null,
      createElement(
        Row,
        { label: ctx.i18n.t('settings.lang') },
        createElement(Seg, {
          value: currentLang(),
          options: [
            { value: 'system', label: ctx.i18n.t('settings.followSystem') },
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
          ],
          onPick: (value) => pickLang(value as LangChoice),
        }),
      ),
      createElement(
        Row,
        { label: ctx.i18n.t('settings.theme') },
        createElement(Seg, {
          value: theme.preference,
          options: [
            { value: 'system', label: ctx.i18n.t('settings.followSystem') },
            { value: 'light', label: ctx.i18n.t('theme.light') },
            { value: 'dark', label: ctx.i18n.t('theme.dark') },
          ],
          onPick: (value) => {
            theme.setPreference(value as SchemePref)
            // 偏好写在 localStorage 里，`theme` 服务自己记着 —— 这里只要重画就够。
            location.reload()
          },
        }),
      ),
    ),

    createElement(PaperRows, { ctx }),

    createElement(
      Group,
      { title: ctx.i18n.t('settings.shortcuts') },
      ...[
        ['⌘K', ctx.i18n.t('search.placeholder')],
        ['⌘= / ⌘- / ⌘0', ctx.i18n.t('font.scale')],
        ['⌘⇧H', ctx.i18n.t('settings.shortcuts.color')],
        ['Esc', ctx.i18n.t('settings.shortcuts.close')],
        ['double-click', ctx.i18n.t('doc.rename')],
      ].map(([key, what]) =>
        createElement(
          Row,
          { key, label: what },
          createElement(
            'span',
            {
              style: {
                fontFamily: 'var(--affine-font-code-family, ui-monospace)',
                fontSize: 12,
                color: 'var(--affine-v2-text-secondary)',
              },
            },
            key,
          ),
        ),
      ),
    ),
  )
}

/**
 * 正文纸面：一排圆形色票（跟随主题 / 五个预设 / 自定义取色）+ 一根磨砂滑块。
 *
 * 预设的色值**按主题分两档**（`paper.ts` 里的表），所以这里要跟着 `scheme` 取色 ——
 * 换主题时整段会重画（纸面变量那边也在 `theme.onChange` 上重算）。
 */
function PaperRows({ ctx }: { ctx: Context }) {
  const choice = useSetting(ctx, PAPER_KEY, paperChoice)
  const alpha = useSetting(ctx, PAPER_ALPHA_KEY, paperAlpha)
  const scheme = schemeNow(ctx)
  const t = (key: string) => ctx.i18n.t(key)
  const pick = (value: string) => ctx.settings.set(PAPER_KEY, value)

  const themeChip = createElement('button', {
    key: FOLLOW_THEME,
    type: 'button',
    role: 'radio',
    'aria-checked': choice === FOLLOW_THEME,
    className:
      choice === FOLLOW_THEME
        ? `${p.swatch} ${p.swatchTheme} ${p.swatchOn}`
        : `${p.swatch} ${p.swatchTheme}`,
    title: t('settings.paper.theme'),
    'aria-label': t('settings.paper.theme'),
    onClick: () => pick(FOLLOW_THEME),
  })

  return createElement(
    Group,
    { title: t('settings.paper'), desc: t('settings.paper.desc') },
    createElement(
      Row,
      { label: t('settings.paper.color') },
      createElement(
        'div',
        { className: p.swatches, role: 'radiogroup', 'aria-label': t('settings.paper.color') },
        themeChip,
        ...PAPER_PRESETS.map((preset) =>
          createElement('button', {
            key: preset.id,
            type: 'button',
            role: 'radio',
            'aria-checked': choice === preset.id,
            className: choice === preset.id ? `${p.swatch} ${p.swatchOn}` : p.swatch,
            style: { background: preset[scheme] },
            title: t(`settings.paper.${preset.id}`),
            'aria-label': t(`settings.paper.${preset.id}`),
            onClick: () => pick(preset.id),
          }),
        ),
        createElement('input', {
          key: 'custom',
          type: 'color',
          className: p.colorWell,
          value: paperSwatchValue(ctx, choice),
          title: t('settings.paper.custom'),
          'aria-label': t('settings.paper.custom'),
          onChange: (e: { target: HTMLInputElement }) => pick(e.target.value),
        }),
      ),
    ),
    createElement(
      Row,
      { label: t('settings.paper.glass'), desc: t('settings.paper.glass.desc') },
      createElement('input', {
        type: 'range',
        min: 0,
        max: 100,
        step: 1,
        className: p.slider,
        value: alpha,
        'aria-label': t('settings.paper.glass'),
        onChange: (e: { target: HTMLInputElement }) => ctx.settings.set(PAPER_ALPHA_KEY, Number(e.target.value)),
      }),
      createElement('span', { className: p.pct }, `${alpha}%`),
    ),
  )
}

/** 三选一的分段按钮（浅色 / 深色 / 跟随系统这种）。 */
function Seg({
  value,
  options,
  onPick,
}: {
  value: string
  options: readonly { value: string; label: string }[]
  onPick: (value: string) => void
}) {
  return createElement(
    'div',
    { style: { display: 'flex', gap: 4 } },
    ...options.map((option) =>
      createElement(
        'button',
        {
          key: option.value,
          type: 'button',
          onClick: () => onPick(option.value),
          style: {
            height: 26,
            padding: '0 10px',
            border: 'none',
            borderRadius: 6,
            background:
              value === option.value
                ? 'var(--affine-primary-color)'
                : 'var(--affine-v2-button-secondary)',
            color: value === option.value ? '#fff' : 'var(--affine-v2-text-primary)',
            fontFamily: 'inherit',
            fontSize: 13,
            cursor: 'pointer',
          },
        },
        option.label,
      ),
    ),
  )
}
