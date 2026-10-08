/**
 * 前进/后退那两颗箭头（顶栏 `titlebar.left` 槽）。**只画，不改状态** —— 栈在 `./nav.ts`。
 */
import { useSyncExternalStore } from 'react'
import type { Context } from 'cordis'
import { ArrowLeftSmallIcon, ArrowRightSmallIcon } from '@blocksuite/icons/rc'
import type { NavStore } from './nav'
import * as s from './nav.css'

const ICON = 20

export function NavButtons({
  ctx,
  store,
  go,
}: {
  ctx: Context
  store: NavStore
  /** 往哪边挪一步（-1 退 / +1 进）。挪完主区换不换由 `index.ts` 发事件。 */
  go: (delta: -1 | 1) => void
}) {
  const snap = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.snapshot(),
    () => store.snapshot(),
  )
  const back = ctx.i18n.t('nav.back')
  const forward = ctx.i18n.t('nav.forward')

  return (
    <div className={s.group}>
      <button
        type="button"
        className={s.button}
        title={back}
        aria-label={back}
        disabled={snap.index <= 0}
        onClick={() => go(-1)}
      >
        <ArrowLeftSmallIcon width={ICON} height={ICON} />
      </button>
      <button
        type="button"
        className={s.button}
        title={forward}
        aria-label={forward}
        disabled={snap.index < 0 || snap.index >= snap.entries.length - 1}
        onClick={() => go(1)}
      >
        <ArrowRightSmallIcon width={ICON} height={ICON} />
      </button>
    </div>
  )
}
