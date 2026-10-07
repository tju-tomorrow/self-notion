/**
 * 标签（D-0086）。**编辑界面只有这一份**：菜单里「标签」那一行点开就是它 ——
 * 上面是**已经加上的**（每个点 × 摘掉），下面一个框输入（逗号分隔，回车落库）。
 *
 * ★ 行**不在这儿画**：两个菜单的行样式是两份（`doc-menu.css.ts` 的 28/14、
 *   `doc-header.css.ts` 的 30/13），谁画谁的，才不会出现「跟邻居差一个色号/高两像素」。
 */
import { useRef, useState } from 'react'
import type { Context } from 'cordis'
import { CloseIcon } from '@blocksuite/icons/rc'
import { DOCS_CHANGED, type DocMeta } from '../kernel/contract'
import { reportError } from '../kernel/errors'
import * as s from './doc-menu.css'

export function TagPanel({ ctx, doc }: { ctx: Context; doc: DocMeta }) {
  const [tags, setTags] = useState<string[]>(doc.tags)
  const box = useRef<HTMLInputElement>(null)

  /** 每动一次就整组写回去（`doc:tags` 是替换语义），不做「保存」按钮。 */
  const save = (next: string[]) => {
    setTags(next)
    void ctx.rpc
      .call('doc:tags', { id: doc.id, tags: next })
      .then(() => ctx.emit(DOCS_CHANGED))
      .catch((err: unknown) => reportError('doc.tags', err))
  }

  const add = () => {
    const raw = box.current?.value ?? ''
    if (box.current) box.current.value = ''
    const fresh = raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t !== '' && !tags.includes(t))
    if (fresh.length) save([...tags, ...fresh])
  }

  return (
    <div className={s.tagPanel}>
      <span className={s.label}>{ctx.i18n.t('doc.tags.label')}</span>

      {tags.length ? (
        <div className={s.tagChips}>
          {tags.map((tag) => (
            <span key={tag} className={s.tagChip}>
              {tag}
              <button
                type="button"
                className={s.tagChipX}
                title={ctx.i18n.t('doc.tags.remove')}
                aria-label={ctx.i18n.t('doc.tags.remove')}
                onClick={() => save(tags.filter((t) => t !== tag))}
              >
                <CloseIcon width={12} height={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <input
        ref={box}
        className={s.tagInput}
        placeholder={ctx.i18n.t('doc.tags.placeholder')}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // 回车落库；打逗号也当场收一个 —— 「逗号分隔」这句话得真的成立。
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
        }}
      />
      <span className={s.tagHint}>{ctx.i18n.t('doc.tags.hint')}</span>
    </div>
  )
}
