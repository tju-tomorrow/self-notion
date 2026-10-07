/**
 * 「光标」设置页（D-0076）—— 正文里那个闪的插入点，选细线还是方块。
 *
 * 这一段只写 `ctx.settings`。**形状怎么落到界面上不在这儿**：订阅在 `index.ts`（写
 * `<html data-caret>`），画光标在 `caret.ts`。不做第二份注入。
 */
import { createElement, useEffect, useState, type CSSProperties } from 'react'
import type { Context } from 'cordis'
import { Group, Row } from '../../src/ui/settings'
import { CARET_KEY, CARET_SHAPES, caretShapeOf, type CaretShape } from './caret'

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

export function CaretSection({ ctx }: { ctx: Context }) {
  const read = () => caretShapeOf(ctx.settings.get(CARET_KEY))
  const [shape, setShape] = useState(read)

  // 别处改了这个键也要跟上（`ctx.settings` 的预热是异步的，订上就补回来了）。
  useEffect(() => ctx.settings.onChange(CARET_KEY, () => setShape(read())), [ctx])

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
  )
}
