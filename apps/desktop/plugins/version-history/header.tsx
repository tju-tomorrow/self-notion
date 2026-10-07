/**
 * `doc.header.right` 槽 —— 顶栏那一行里的版本入口（一颗时钟图标）。
 *
 * 那一行（44 高 + 底线）由外壳出，槽里注册的每一项就是行里的一格；这一格和评论入口同一格
 * （`doc.header.right`），两颗图标挨着落在最右端。没打开文档时整块返回 null。
 */
import type { Context } from 'cordis'
import { HistoryIcon } from '@blocksuite/icons/rc'
import { closePanel, openPanel } from './actions'
import { useVersionState } from './state'
import { Hint } from '../../src/ui/hint'
import * as s from './version.css'

export function VersionHeader({ ctx }: { ctx: Context }) {
  const st = useVersionState()
  if (st.docId === null) return null

  return (
    <div className={s.entryBar}>
      <Hint text={ctx.i18n.t('history.open')}>
        <button
          type="button"
          className={st.open ? `${s.iconButton} ${s.iconButtonOn}` : s.iconButton}
          aria-label={ctx.i18n.t('history.open')}
          onClick={() => {
            if (st.open) closePanel()
            else void openPanel(ctx)
          }}
        >
          <HistoryIcon width={18} height={18} />
        </button>
      </Hint>
    </div>
  )
}
