/** 编辑器设置：从 PDF / 网页粘文字时怎么落进来（`plugins/paste.ts` 读这里）。 */
import { useEffect, useState } from 'react'
import type { Context } from 'cordis'

import { Group, Row, Select } from '../../src/ui/settings'
import type { PasteMode } from './plugins/paste'

export const PASTE_MODE_KEY = 'editor.pasteMode'

/** 默认保留原格式；只有明确选了另外两档才改变行为。 */
export function readPasteMode(ctx: Context): PasteMode {
  const raw = ctx.settings.get<string>(PASTE_MODE_KEY)
  return raw === 'clean' || raw === 'text' ? raw : 'original'
}

export function PasteSection({ ctx }: { ctx: Context }) {
  const [, setTick] = useState(0)
  useEffect(() => ctx.settings.onChange(PASTE_MODE_KEY, () => setTick((n) => n + 1)), [ctx])
  const label = ctx.i18n.t('editor.settings.paste')
  return (
    <Group>
      <Row label={label} desc={ctx.i18n.t('editor.settings.pasteHint')}>
        <Select
          value={readPasteMode(ctx)}
          ariaLabel={label}
          width={200}
          onChange={(next) => ctx.settings.set(PASTE_MODE_KEY, next)}
          options={[
            { value: 'original', label: ctx.i18n.t('editor.settings.pasteOriginal') },
            { value: 'clean', label: ctx.i18n.t('editor.settings.pasteClean') },
            { value: 'text', label: ctx.i18n.t('editor.settings.pasteText') },
          ]}
        />
      </Row>
    </Group>
  )
}
