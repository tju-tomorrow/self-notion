/**
 * 设置页那一节的界面：选 zip → 导入 → 一行结果。
 *
 * ★ 选文件用页面里的 `<input type="file">`，**不装** `@tauri-apps/plugin-dialog` 那个 JS 包 ——
 *   WKWebView 自己会弹原生选文件框（Rust 侧的 dialog 插件是给别处用的）。少一个依赖。
 */
import { useCallback, useRef, useState } from 'react'
import type { Context } from 'cordis'

import { DOCS_CHANGED, OPEN_DOC } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { importNotionZip } from './notion'
import * as s from './import.css'

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function ImportSection({ ctx }: { ctx: Context }) {
  const t = ctx.i18n.t
  const file = useRef<HTMLInputElement>(null)
  const cancelling = useRef(false)
  const [busy, setBusy] = useState('')
  /** 0-100，只在导入途中用。 */
  const [percent, setPercent] = useState(0)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  /** 导完之后不自己跳走 —— 存着入口，给用户一个按钮。 */
  const [made, setMade] = useState<string | null>(null)

  const run = useCallback(
    async (picked: File) => {
      setNote('')
      setError('')
      setMade(null)
      cancelling.current = false
      setPercent(0)
      setBusy(t('import.parsing', { name: picked.name }))
      try {
        // ★ `docFromMarkdown` 走编辑器，而编辑器是懒装载的 —— 先 await 一下再导（契约那条要求）。
        await ctx.editor.ready()
        const summary = await importNotionZip(
          {
            rpc: ctx.rpc,
            editor: ctx.editor,
            onProgress: (done, total) => {
              setBusy(t('import.progress', { done, total }))
              setPercent(total === 0 ? 0 : Math.round((done / total) * 100))
            },
            shouldCancel: () => cancelling.current,
          },
          picked,
        )
        setNote(
          summary.cancelled
            ? t('import.cancelled', { done: summary.pages })
            : t('import.done', {
                pages: summary.pages,
                images: summary.images,
                skipped: summary.skipped,
              }),
        )
        // 侧栏树 / 首页列表 / 标签条都要重取一遍，否则导入完界面还是旧的。
        ctx.emit(DOCS_CHANGED)
        // 不自动跳：几百篇导完突然换页很吓人，把入口交给用户点。
        if (summary.entryId) setMade(summary.entryId)
      } catch (e) {
        reportError('import-notion', e)
        setError(t('import.failed', { msg: errText(e) }))
      } finally {
        setBusy('')
        setPercent(0)
      }
    },
    [ctx, t],
  )

  return (
    <section className={s.section}>
      <h3 className={s.title}>{t('import.title')}</h3>
      <p className={s.hint}>{t('import.hint')}</p>

      <div className={s.row}>
        <button
          className={`${s.button} ${s.primary}`}
          disabled={!!busy}
          onClick={() => file.current?.click()}
        >
          {t('import.pick')}
        </button>
        {busy ? (
          <>
            <span className={s.note}>{busy}</span>
            <button className={s.button} onClick={() => (cancelling.current = true)}>
              {t('import.cancel')}
            </button>
          </>
        ) : null}
      </div>

      {busy ? (
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: 'var(--affine-v2-layer-background-secondary)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: '100%',
              background: 'var(--affine-primary-color)',
              transition: 'width .2s',
            }}
          />
        </div>
      ) : null}

      <input
        ref={file}
        className={s.hidden}
        type="file"
        accept=".zip"
        onChange={(e) => {
          // 同一个文件连选两次也要能触发 —— 清掉 value，否则第二次没有 change 事件。
          const picked = e.target.files?.[0]
          e.target.value = ''
          if (picked) void run(picked)
        }}
      />

      {note ? <span className={s.note}>{note}</span> : null}
      {made ? (
        <button
          className={s.button}
          onClick={() => {
            const id = made
            setMade(null)
            ctx.emit(OPEN_DOC, { id })
          }}
        >
          {t('import.open')}
        </button>
      ) : null}
      {error ? <span className={s.error}>{error}</span> : null}
    </section>
  )
}
