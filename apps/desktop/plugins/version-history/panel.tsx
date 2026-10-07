/**
 * 版本时间线 —— 右侧滑出的面板。
 *
 * 覆盖层**不走槽**（契约的槽只装内联元素），所以本插件在 body 上开一个自己的 root，
 * 面板 `position: fixed` 贴在右缘：主区右侧那一列（`doc.aside`）归评论，两个面板
 * 挤一列会各占 320 宽，正文就没地方了。
 *
 * 每行一件事：什么时刻 / 谁改的 / 一句说明，右边一个「恢复到这里」。
 * 恢复是**可逆**的（Rust 先记现在再装目标），所以不用「只读预览」那一步也能看 —— 见 `actions.ts`。
 */
import type { Context } from 'cordis'
import { CloseIcon } from '@blocksuite/icons/rc'
import type { VersionMeta } from '../../src/kernel/contract'
import { fullTime, timeAgo } from '../../src/ui/timeago'
import { closePanel, restore } from './actions'
import { useVersionState } from './state'
import * as s from './version.css'

export function VersionPanel({ ctx }: { ctx: Context }) {
  const st = useVersionState()
  const docId = st.docId
  if (!st.open || docId === null) return null

  return (
    <div
      className={s.overlay}
      // 点空白处关（点面板本体不关）
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePanel()
      }}
    >
      <aside className={s.panel}>
        <div className={s.head}>
          <span className={s.headTitle}>{ctx.i18n.t('history.title')}</span>
          <button
            type="button"
            className={s.iconButton}
            title={ctx.i18n.t('history.close')}
            onClick={closePanel}
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div className={s.list}>
          {st.error ? <p className={s.error}>{st.error}</p> : null}
          {st.versions.length === 0 ? <p className={s.empty}>{ctx.i18n.t('history.empty')}</p> : null}
          {st.versions.map((version, i) => (
            <Row key={version.id} ctx={ctx} docId={docId} version={version} latest={i === 0} />
          ))}
        </div>

        <div className={s.foot}>{ctx.i18n.t('history.keep')}</div>
      </aside>
    </div>
  )
}

function Row({
  ctx,
  docId,
  version,
  latest,
}: {
  ctx: Context
  docId: string
  version: VersionMeta
  latest: boolean
}) {
  const st = useVersionState()
  return (
    <div className={s.row}>
      <span className={latest ? `${s.dot} ${s.dotLatest}` : s.dot} />
      <div className={s.rowMain}>
        <div className={s.rowTop}>
          <span className={s.time} title={fullTime(version.at)}>
            {timeAgo(version.at)}
          </span>
          <span className={s.badge}>{ctx.i18n.t(`version.origin.${version.origin}`)}</span>
        </div>
        {version.label === null ? null : <div className={s.label}>{version.label}</div>}
      </div>
      <button
        type="button"
        className={s.restore}
        disabled={st.busy}
        onClick={() => void restore(ctx, docId, version)}
      >
        {ctx.i18n.t('history.restore')}
      </button>
    </div>
  )
}
