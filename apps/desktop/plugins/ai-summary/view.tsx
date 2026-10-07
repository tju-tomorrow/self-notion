/**
 * 顶栏那颗「总结」按钮 + 它下面的浮层 + 设置页的「AI」一段。
 *
 * ★ 浮层 portal 到 body、按按钮的位置摆（`position: fixed`）：顶栏那一行是 `overflow: hidden`
 *   的，就地绝对定位会被裁掉。点外面 / Esc 都关。
 * ★ 所有网络都在 Rust（`src-tauri/src/ai/`），这里只经 `ctx.rpc` 调 `ai:*`。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from 'cordis'
import { SummarizeIcon } from '@blocksuite/icons/rc'
import { copyText } from '../../src/ui/clipboard'
import { Hint } from '../../src/ui/hint'
import { Button, Field, Group, Note, Row } from '../../src/ui/settings'
import type { AiStatus } from '../../src/kernel/contract'
import { useSummaryState } from './state'
import * as s from './summary.css'

/** 浮层宽度。摆位置时要它（面板自己定宽，这里得先知道有多宽）。 */
const POP_W = 320

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 「去设置」——设置页是命令开的（`shell-settings` 注册的 `settings.open`），拿不到就不显示那个按钮。 */
function openSettings(ctx: Context): void {
  const cmd = ctx.command.list().find((c) => c.id === 'settings.open')
  if (cmd) void cmd.run()
}

/* ────────────────────────── 顶栏那一格 ────────────────────────── */

export function SummaryEntry({
  ctx,
  onToggle,
  onGenerate,
  onClose,
}: {
  ctx: Context
  onToggle: () => void
  onGenerate: () => void
  onClose: () => void
}) {
  const st = useSummaryState()
  const chip = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)

  // 开浮层才量位置。窗口一改大小就重新量（跟着按钮走）。
  useEffect(() => {
    if (!st.open) {
      setAt(null)
      return
    }
    const place = () => {
      const r = chip.current?.getBoundingClientRect()
      if (!r) return
      setAt({
        top: r.bottom + 6,
        left: Math.min(Math.max(8, r.right - POP_W), Math.max(8, window.innerWidth - POP_W - 8)),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [st.open])

  useEffect(() => {
    if (!st.open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      // 按钮自己（点它交给 onClick 去切）和浮层里面都不算「外面」。
      if (chip.current?.contains(t) || t.closest('[data-summary-pop]')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [st.open, onClose])

  if (st.docId === null) return null

  const label = st.busy ? ctx.i18n.t('summary.busy') : st.data ? st.data.line : ctx.i18n.t('summary.action')

  return (
    <>
      <Hint text={ctx.i18n.t('summary.open')}>
        <button
          ref={chip}
          type="button"
          className={st.open ? `${s.chip} ${s.chipOn}` : st.data ? `${s.chip} ${s.chipHas}` : s.chip}
          aria-label={ctx.i18n.t('summary.open')}
          onClick={onToggle}
        >
          <SummaryIcon />
          <span className={s.chipText}>{label}</span>
        </button>
      </Hint>
      {at ? createPortal(<Popover ctx={ctx} at={at} onGenerate={onGenerate} />, document.body) : null}
    </>
  )
}

/** 那颗小图标 —— 转的时候是「正在读」。 */
function SummaryIcon() {
  return (
    <span className={s.chipIcon}>
      <SummarizeIcon width={14} height={14} />
    </span>
  )
}

/* ────────────────────────── 浮层 ────────────────────────── */

function Popover({
  ctx,
  at,
  onGenerate,
}: {
  ctx: Context
  at: { top: number; left: number }
  onGenerate: () => void
}) {
  const st = useSummaryState()
  const [copied, setCopied] = useState(false)

  // 「还没配 AI」「这篇没正文」都是用户自己能解决的状态，给专门的句子，别把错误码糊到脸上。
  const notConfigured = st.error.includes('ai_not_configured')
  const noBody = st.error.includes('ai_empty')

  const copy = () => {
    if (!st.data) return
    const lines = [st.data.line, '', st.data.para]
    if (st.data.entities.length) {
      lines.push('', `${ctx.i18n.t('summary.entities')}：${st.data.entities.join('、')}`)
    }
    void copyText(lines.join('\n'))
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  return (
    <div data-summary-pop className={s.pop} style={{ top: at.top, left: at.left, width: POP_W }}>
      {st.data ? (
        <>
          <div className={s.popLabel}>{ctx.i18n.t('summary.line')}</div>
          <p className={s.popLine}>{st.data.line}</p>
          <div className={s.popLabel}>{ctx.i18n.t('summary.para')}</div>
          <p className={s.popPara}>{st.data.para}</p>
          {st.data.entities.length ? (
            <>
              <div className={s.popLabelHead}>{ctx.i18n.t('summary.entities')}</div>
              <div className={s.tags}>
                {st.data.entities.map((e) => (
                  <span key={e} className={s.tag}>
                    {e}
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {st.data.stale ? <p className={s.stale}>{ctx.i18n.t('summary.stale')}</p> : null}
        </>
      ) : (
        <p className={s.note}>
          {ctx.i18n.t(st.busy ? 'summary.busy' : 'summary.intro')}
        </p>
      )}

      {st.error ? (
        <p className={s.error}>
          {notConfigured
            ? ctx.i18n.t('summary.noKey')
            : noBody
              ? ctx.i18n.t('summary.noBody')
              : `${ctx.i18n.t('summary.fail')}：${st.error}`}
        </p>
      ) : null}

      <div className={s.popFoot}>
        <button type="button" className={s.action} disabled={st.busy} onClick={onGenerate}>
          {ctx.i18n.t(st.data ? 'summary.again' : 'summary.generate')}
        </button>
        {notConfigured ? (
          <button type="button" className={s.action} onClick={() => openSettings(ctx)}>
            {ctx.i18n.t('summary.settings')}
          </button>
        ) : null}
        {st.data ? (
          <button type="button" className={s.action} onClick={copy}>
            {ctx.i18n.t(copied ? 'summary.copied' : 'summary.copy')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/* ────────────────────────── 设置页：AI ────────────────────────── */

export function AiSection({ ctx }: { ctx: Context }) {
  const t = ctx.i18n.t
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    ctx.rpc
      .call<AiStatus>('ai:status')
      .then((st) => {
        setStatus(st)
        setBaseUrl(st.baseUrl)
        setModel(st.model)
      })
      .catch((e: unknown) => setError(errText(e)))
  }, [ctx])

  const save = () => {
    setBusy(true)
    setNote('')
    setError('')
    ctx.rpc
      .call<AiStatus>('ai:configure', { baseUrl, model, ...(key ? { apiKey: key } : {}) })
      .then((st) => {
        setStatus(st)
        setKey('')
        setNote(t('ai.saved'))
      })
      .catch((e: unknown) => setError(errText(e)))
      .finally(() => setBusy(false))
  }

  return (
    <Group>
      <Row label={t('ai.baseUrl')} desc={t('ai.baseUrlHint')}>
        <Field
          value={baseUrl}
          onChange={setBaseUrl}
          placeholder="https://api.deepseek.com/v1/chat/completions"
          width={320}
        />
      </Row>

      <Row label={t('ai.model')} desc={t('ai.modelHint')}>
        <Field value={model} onChange={setModel} placeholder="deepseek-chat" width={200} />
      </Row>

      <Row label={t('ai.key')} desc={t('ai.keyHint')}>
        <Field
          value={key}
          onChange={setKey}
          type="password"
          mono
          width={260}
          placeholder={status?.hasKey ? t('ai.keyKept') : t('ai.keyPlaceholder')}
        />
      </Row>

      <Row label={t('ai.state')} desc={status?.configured ? t('ai.ready') : t('ai.notReady')}>
        <Button variant="primary" onClick={save} disabled={busy}>
          {t('ai.save')}
        </Button>
      </Row>

      <Note>{t('ai.privacy')}</Note>
      {status?.insecure ? <Note tone="error">{t('ai.insecure')}</Note> : null}
      {note ? <Note tone="ok">{note}</Note> : null}
      {error ? <Note tone="error">{error}</Note> : null}
    </Group>
  )
}
