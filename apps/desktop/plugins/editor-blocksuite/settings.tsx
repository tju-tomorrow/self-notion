/**
 * 「光标」设置页（D-0076 / D-0103）—— 正文里那个闪的插入点：形状（细线 / 方块）+ 颜色。
 *
 * 这一段只写 `ctx.settings`。**怎么落到界面上不在这儿**：订阅在 `index.ts`，画光标在
 * `caret.ts`。不做第二份注入。
 */
import { createElement, useEffect, useState, type CSSProperties } from 'react'
import type { Context } from 'cordis'
import { Group, Row } from '../../src/ui/settings'
import * as c from './caret.css'
import {
  CARET_COLOR_KEY,
  CARET_COLOR_PRESETS,
  CARET_COLOR_THEME,
  CARET_COLOR_WELL_DEFAULT,
  CARET_KEY,
  CARET_SHAPES,
  caretColorOf,
  caretShapeOf,
  type CaretShape,
} from './caret'

const mark: CSSProperties = {
  display: 'inline-block',
  height: 12,
  borderRadius: 1,
  background: 'currentColor',
  verticalAlign: '-2px',
  marginRight: 6,
}

/** 每个选项自带一个小样 —— 光看「细线 / 方块」两个字，不知道差多少。 */
const SAMPLE: Record<CaretShape, CSSProperties> = {
  default: { ...mark, width: 2, opacity: 0.65 },
  bar: { ...mark, width: 1 },
  block: { ...mark, width: 5 },
}

function Seg({
  value,
  options,
  onPick,
}: {
  value: string
  options: readonly { value: CaretShape; label: string }[]
  onPick: (value: CaretShape) => void
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
              value === option.value ? 'var(--affine-primary-color)' : 'var(--affine-v2-button-secondary)',
            color: value === option.value ? '#fff' : 'var(--affine-v2-text-primary)',
            fontFamily: 'inherit',
            fontSize: 13,
            cursor: 'pointer',
          },
        },
        createElement('span', { style: SAMPLE[option.value] }),
        option.label,
      ),
    ),
  )
}

/** 一排圆形色票 + 原生取色井，和正文纸面那排同一个样子。 */
function ColorRow({ ctx, value, onPick }: { ctx: Context; value: string; onPick: (next: string) => void }) {
  const t = (key: string) => ctx.i18n.t(key)

  const chip = (hex: string, key: string) =>
    createElement('button', {
      key,
      type: 'button',
      role: 'radio',
      'aria-checked': value === hex,
      className: value === hex ? `${c.swatch} ${c.swatchOn}` : c.swatch,
      style: { background: hex },
      title: hex,
      'aria-label': hex,
      onClick: () => onPick(hex),
    })

  return createElement(
    'div',
    { className: c.swatches, role: 'radiogroup', 'aria-label': t('caret.color') },
    createElement('button', {
      key: CARET_COLOR_THEME,
      type: 'button',
      role: 'radio',
      'aria-checked': value === CARET_COLOR_THEME,
      className:
        value === CARET_COLOR_THEME
          ? `${c.swatch} ${c.swatchTheme} ${c.swatchOn}`
          : `${c.swatch} ${c.swatchTheme}`,
      title: t('caret.color.theme'),
      'aria-label': t('caret.color.theme'),
      onClick: () => onPick(CARET_COLOR_THEME),
    }),
    ...CARET_COLOR_PRESETS.map((hex) => chip(hex, hex)),
    createElement('input', {
      key: 'custom',
      type: 'color',
      className: c.colorWell,
      value: value.startsWith('#') ? value : CARET_COLOR_WELL_DEFAULT,
      title: t('caret.color.custom'),
      'aria-label': t('caret.color.custom'),
      onChange: (e: { target: HTMLInputElement }) => onPick(e.target.value),
    }),
  )
}

export function CaretSection({ ctx }: { ctx: Context }) {
  const readShape = () => caretShapeOf(ctx.settings.get(CARET_KEY))
  const readColor = () => caretColorOf(ctx.settings.get(CARET_COLOR_KEY))
  const [shape, setShape] = useState(readShape)
  const [color, setColor] = useState(readColor)

  // 别处改了这两个键也要跟上（`ctx.settings` 的预热是异步的，订上就补回来了）。
  useEffect(() => ctx.settings.onChange(CARET_KEY, () => setShape(readShape())), [ctx])
  useEffect(() => ctx.settings.onChange(CARET_COLOR_KEY, () => setColor(readColor())), [ctx])

  return createElement(
    Group,
    null,
    createElement(
      Row,
      { label: ctx.i18n.t('caret.shape'), desc: ctx.i18n.t('caret.shape.desc') },
      createElement(Seg, {
        value: shape,
        options: CARET_SHAPES.map((value) => ({ value, label: ctx.i18n.t(`caret.shape.${value}`) })),
        onPick: (next) => {
          ctx.settings.set(CARET_KEY, next)
          setShape(next)
        },
      }),
    ),
    createElement(
      Row,
      { label: ctx.i18n.t('caret.color'), desc: ctx.i18n.t('caret.color.desc') },
      createElement(ColorRow, {
        ctx,
        value: color,
        onPick: (next) => {
          ctx.settings.set(CARET_COLOR_KEY, next)
          setColor(next)
        },
      }),
    ),
  )
}
