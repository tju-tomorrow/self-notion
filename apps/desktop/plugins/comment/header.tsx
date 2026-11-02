/**
 * `doc.header.right` 槽 —— 顶栏最右端那一格：评论入口（一颗图标 + 未解决数角标）+ 浮出按钮。
 *
 * 图标点了**开 / 关评论层**（跟以前一样）。它右边那颗 ▾ 只在层开着的时候露，
 * 点开一个小菜单 —— 「显示已解决」住那儿（D-0172：已解决默认不画，正文旁边只留没完的事）。
 *
 * 那一行（44 高 + 底线）由外壳出，槽里注册的每一项就是行里的一格；这一格排在前一格
 * （`shell-doc-header` 的面包屑 + ⋯）后面，所以按钮落在 ⋯ 的右边。
 */
import { useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import { CommentIcon } from '@blocksuite/icons/rc'
import { Switch } from '../../src/ui/settings'
import { closePanel, openPanel } from './actions'
import { setCommentState, unresolvedCount, useCommentState } from './state'
import { CommentBubble } from './bubble'
import { Hint } from '../../src/ui/hint'
import * as s from './comment.css'

export function CommentHeader({ ctx }: { ctx: Context }) {
  return (
    <>
      <Entry ctx={ctx} />
      <CommentBubble ctx={ctx} />
    </>
  )
}

function Entry({ ctx }: { ctx: Context }) {
  const st = useCommentState()
  const n = unresolvedCount(st.comments)
  const [menu, setMenu] = useState(false)
  const bar = useRef<HTMLDivElement>(null)

  // 点外面 / 按 Esc 关菜单。捕获阶段挂：菜单里那一下别把别的浮层也点开。
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node)) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  return (
    <div className={s.entryBar} ref={bar}>
      <Hint text={ctx.i18n.t('comment.open')}>
        <button
          type="button"
          className={st.open ? `${s.iconButton} ${s.iconButtonOn}` : s.iconButton}
          aria-label={ctx.i18n.t('comment.open')}
          aria-expanded={st.open}
          onClick={() => {
            if (st.open) {
              closePanel()
              setMenu(false)
            } else void openPanel(ctx)
          }}
        >
          <CommentIcon width={18} height={18} />
          {n > 0 ? <span className={s.badge}>{n > 99 ? '99+' : n}</span> : null}
        </button>
      </Hint>

      {st.open ? (
        <button
          type="button"
          className={s.caretButton}
          aria-label={ctx.i18n.t('comment.options')}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          <span aria-hidden="true">▾</span>
        </button>
      ) : null}

      {menu ? (
        // ★ 行是 div 不是 button —— `Switch` 自己就是个 button，嵌在 button 里是非法 HTML
        //   （`shell-doc-header` 那一行踩过同一个坑）。所以标签和开关并排两个控件。
        <div className={s.menu} role="menu">
          <div className={s.menuRow}>
            <button
              type="button"
              className={s.menuLabel}
              role="menuitemcheckbox"
              aria-checked={st.showResolved}
              onClick={() => setCommentState({ showResolved: !st.showResolved })}
            >
              {ctx.i18n.t('comment.showResolved')}
            </button>
            <Switch
              on={st.showResolved}
              label={ctx.i18n.t('comment.showResolved')}
              onChange={(next) => setCommentState({ showResolved: next })}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
