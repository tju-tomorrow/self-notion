/**
 * 设置页那一节：「设为默认 Markdown 编辑器」+ **现在是谁占着**（D-0138）。
 *
 * ★ 不是我们的时候必须把 `bundlePath` 如实显示出来 —— 不说，用户就不知道系统把 `.md`
 *   交给了谁、也就不知道该去关掉谁。
 * ★ `tauri dev` 下这条**一律不可用**（没有 Info.plist，注册无从谈起，D-0050 第 4 条），
 *   所以失败长什么样是常态：错误原样画出来，不假装成功。
 */
import { useCallback, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { FileDefaultStatus } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import * as s from './settings.css'

function errText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
}

export function FilesSection({ ctx }: { ctx: Context }) {
  const t = ctx.i18n.t
  const [status, setStatus] = useState<FileDefaultStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const read = useCallback(async () => {
    try {
      setStatus(await ctx.rpc.call<FileDefaultStatus>('file:defaultStatus'))
      setError(null)
    } catch (err) {
      reportError('external-files', err)
      setError(errText(err))
    }
  }, [ctx])

  useEffect(() => {
    void read()
  }, [read])

  const setDefault = useCallback(async () => {
    setBusy(true)
    try {
      // 系统自己会弹确认框（macOS 12+ 的 NSWorkspace 那条路），这里不自己再问一遍。
      await ctx.rpc.call('file:setDefault')
      await read()
    } catch (err) {
      reportError('external-files', err)
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }, [ctx, read])

  const now =
    status === null
      ? null
      : status.isDefault
        ? t('files.settings.isDefault')
        : status.bundlePath !== null
          ? t('files.settings.occupied', { path: status.bundlePath })
          : t('files.settings.unknown')

  return (
    <section className={s.section}>
      <h3 className={s.title}>{t('files.settings.title')}</h3>
      <p className={s.hint}>{t('files.settings.hint')}</p>

      <div className={s.row}>
        <button
          className={`${s.button} ${s.primary}`}
          disabled={busy || status?.isDefault === true}
          onClick={() => void setDefault()}
        >
          {t('files.settings.setDefault')}
        </button>
        {now !== null && <span className={s.note}>{now}</span>}
      </div>

      <p className={s.hint}>{t('files.settings.packed')}</p>
      {error !== null && <span className={s.error}>{error}</span>}
    </section>
  )
}
