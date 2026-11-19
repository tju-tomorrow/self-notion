/** 标签条那颗 `+` 的选择器：挑一篇现有页面打开（用户 2026-11-19：「+ 应该是打开某个页面」）。 */
import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Context } from 'cordis'
import { PageIcon } from '@blocksuite/icons/rc'
import type { DocMeta } from '../../src/kernel/contract'
import * as s from './tabs.css'

export function PagePicker({
  ctx,
  docs,
  onPick,
  onClose,
}: {
  ctx: Context
  docs: ReadonlyMap<string, DocMeta>
  onPick: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...docs.values()]
      .filter((doc) => doc.deletedAt === null)
      .filter(
        (doc) =>
          needle === '' ||
          (doc.title || ctx.i18n.t('doc.untitled')).toLowerCase().includes(needle),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 60)
  }, [ctx, docs, query])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (list.length === 0) return
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setAt((n) => (n + delta + list.length) % list.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = list[at]
      if (hit) onPick(hit.id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <>
      <div className={s.pickerScrim} onMouseDown={onClose} />
      <div className={s.picker}>
        <input
          className={s.pickerInput}
          value={query}
          autoFocus
          spellCheck={false}
          placeholder={ctx.i18n.t('shell-tabs.pickPlaceholder')}
          onChange={(e) => {
            setQuery(e.target.value)
            setAt(0)
          }}
          onKeyDown={onKeyDown}
        />
        <div className={s.pickerList}>
          {list.length === 0 ? (
            <div className={s.pickerEmpty}>{ctx.i18n.t('shell-tabs.pickEmpty')}</div>
          ) : (
            list.map((doc, i) => {
              const parent = doc.parentId === null ? undefined : docs.get(doc.parentId)
              return (
                <button
                  key={doc.id}
                  type="button"
                  className={`${s.pickerItem} ${i === at ? s.pickerItemOn : ''}`}
                  onMouseEnter={() => setAt(i)}
                  onClick={() => onPick(doc.id)}
                >
                  <span className={s.pickerIcon}>
                    {doc.icon ?? <PageIcon width={16} height={16} />}
                  </span>
                  <span className={s.pickerTitle}>{doc.title || ctx.i18n.t('doc.untitled')}</span>
                  {parent ? <span className={s.pickerPath}>{parent.title || ctx.i18n.t('doc.untitled')}</span> : null}
                </button>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
