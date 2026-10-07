/**
 * 设置页的「内存」段（D-0088）：一个开关 + 实时明细。
 *
 * 明细读的是 `state.ts` 那份 —— 时钟在插件里（`index.ts`），这一段只订阅。
 * 挂上/卸下要告诉插件（`onOpen`），它据此决定那个定时器跑不跑：设置页关着、菜单栏也关着，
 * 就一拍都不量。
 */
import { createElement, useEffect, useState, type CSSProperties } from 'react'
import type { Context } from 'cordis'
import { Group, Row, Switch } from '../../src/ui/settings'
import { TRAY_KEY } from './index'
import { fmtBytes, useMemState } from './state'

/** 数值那格：等宽 + 右对齐，眼睛能上下比。 */
const num: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--affine-v2-text-secondary)',
}

const note: CSSProperties = {
  margin: '8px 0 0',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-tertiary)',
}

const page: CSSProperties = {
  margin: 0,
  padding: '16px 0',
  fontSize: 13,
  color: 'var(--affine-v2-text-tertiary)',
}

export function MemSection({ ctx, onOpen }: { ctx: Context; onOpen: (open: boolean) => void }) {
  const st = useMemState()
  const read = () => ctx.settings.get<boolean>(TRAY_KEY) === true
  const [on, setOn] = useState(read)

  useEffect(() => ctx.settings.onChange(TRAY_KEY, () => setOn(read())), [ctx])

  // 挂上就要时钟，卸下就停 —— 这两句是「不常驻还在轮询」的唯一防线。
  useEffect(() => {
    onOpen(true)
    return () => onOpen(false)
  }, [onOpen])

  const docBytes = st.docs.reduce((n, d) => n + d.bytes, 0)

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 22 } },

    createElement(
      Group,
      null,
      createElement(
        Row,
        { label: ctx.i18n.t('mem.tray'), desc: ctx.i18n.t('mem.tray.desc') },
        createElement(Switch, {
          on,
          label: ctx.i18n.t('mem.tray'),
          onChange: (next: boolean) => ctx.settings.set(TRAY_KEY, next),
        }),
      ),
      createElement(
        Row,
        { label: ctx.i18n.t('mem.total'), desc: ctx.i18n.t('mem.total.desc') },
        createElement('span', { style: num }, st.at === 0 ? ctx.i18n.t('mem.waiting') : fmtBytes(st.total)),
      ),
      createElement(
        Row,
        { label: `· ${ctx.i18n.t('mem.own')}` },
        createElement('span', { style: num }, fmtBytes(st.own)),
      ),
      createElement(
        Row,
        { label: '· WebKit' },
        createElement('span', { style: num }, fmtBytes(st.webkit)),
      ),
      st.error === '' ? null : createElement('p', { style: note }, st.error),
    ),

    createElement(
      Group,
      { title: ctx.i18n.t('mem.procs') },
      // 拿不到责任进程接口时把话说清楚 —— 这组的数字可能混了别的 app 的。
      st.certain ? null : createElement('p', { style: note }, ctx.i18n.t('mem.uncertain')),
      st.procs.length === 0
        ? createElement('p', { style: page }, ctx.i18n.t('mem.procs.empty'))
        : st.procs.map((p) =>
            createElement(
              Row,
              { key: p.pid, label: p.name, desc: `pid ${p.pid}` },
              createElement('span', { style: num }, fmtBytes(p.bytes)),
            ),
          ),
    ),

    createElement(
      Group,
      { title: ctx.i18n.t('mem.pages') },
      createElement('p', { style: note }, ctx.i18n.t('mem.pages.desc')),
      st.docs.length === 0
        ? createElement('p', { style: page }, ctx.i18n.t('mem.pages.empty'))
        : [
            ...st.docs.map((d) =>
              createElement(
                Row,
                {
                  key: d.id,
                  label: d.title === '' ? ctx.i18n.t('doc.untitled') : d.title,
                  desc: `${d.blocks} ${ctx.i18n.t('mem.blocks')} · ${d.chars} ${ctx.i18n.t('mem.chars')}`,
                },
                createElement('span', { style: num }, fmtBytes(d.bytes)),
              ),
            ),
            createElement(
              Row,
              { key: '__sum', label: ctx.i18n.t('mem.pages.sum') },
              createElement('span', { style: num }, fmtBytes(docBytes)),
            ),
          ],
    ),
  )
}
