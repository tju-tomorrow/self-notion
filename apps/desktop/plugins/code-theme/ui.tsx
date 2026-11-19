/**
 * 设置页的「代码配色」一段：六张卡片，卡片里是**真的着色过**的一小段代码。
 * 点一下写 `ctx.settings`，`index.ts` 的订阅立刻把 `<html data-code-theme>` 换掉。
 */
import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import { Group } from '../../src/ui/settings'
import * as c from './code-theme.css'
import { ACTIVE_KEY, THEMES, themeId } from './themes'

/** 预览片段：关键词、函数、变量、数字、字符串、类型、注释、运算符各来一份。 */
const SAMPLE: ReadonlyArray<readonly [kind: string, text: string]> = [
  ['kw', 'const '],
  ['var', 'answer'],
  ['op', ' = '],
  ['num', '42'],
  ['com', '  // the point\n'],
  ['kw', 'function '],
  ['fn', 'greet'],
  ['', '('],
  ['var', 'name'],
  ['', ': '],
  ['type', 'string'],
  ['', ') {\n  '],
  ['kw', 'return '],
  ['str', '`hi, ${name}`'],
  ['', '\n}'],
]

function useActive(ctx: Context): string {
  const [, setTick] = useState(0)
  useEffect(() => ctx.settings.onChange(ACTIVE_KEY, () => setTick((n) => n + 1)), [ctx])
  return themeId(ctx.settings.get(ACTIVE_KEY))
}

export function CodeThemeSection({ ctx }: { ctx: Context }) {
  const current = useActive(ctx)
  return (
    <Group desc={ctx.i18n.t('codeTheme.desc')}>
      <div className={c.grid} role="radiogroup" aria-label={ctx.i18n.t('codeTheme.section')}>
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={theme.id === current}
            data-code-theme={theme.id}
            className={theme.id === current ? `${c.card} ${c.on}` : c.card}
            onClick={() => ctx.settings.set(ACTIVE_KEY, theme.id)}
          >
            <span className={c.name}>{ctx.i18n.t(theme.key)}</span>
            <pre className={c.sample}>
              {SAMPLE.map(([kind, text], i) =>
                kind ? (
                  <span key={i} className={`hl-${kind}`}>
                    {text}
                  </span>
                ) : (
                  <span key={i}>{text}</span>
                ),
              )}
            </pre>
          </button>
        ))}
      </div>
    </Group>
  )
}
