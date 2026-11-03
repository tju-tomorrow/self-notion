/**
 * 语音草稿条（D-0190）。不设 Agent Mode 开关：空闲时只是右下角一颗低对比麦克风，
 * 录音时才展开成底部这一条。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import { CloseIcon, DoneIcon, MicrophoneIcon, StopIcon } from '@blocksuite/icons/rc'

import { reportError } from '../../src/kernel/errors'
import * as api from './client'
import * as s from './bar.css'

type Phase = 'idle' | 'download' | 'starting' | 'recording' | 'transcribing' | 'draft' | 'error'
type Lang = 'zh' | 'en' | 'auto'

const LANGS: readonly Lang[] = ['zh', 'en', 'auto']
const BARS = [0.55, 0.9, 0.7, 1, 0.6] as const
const LANG_KEY = 'dictate.lang'

function clock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

export function VoiceBar({ ctx, docId }: { ctx: Context; docId: string | null }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [draft, setDraft] = useState('')
  const [editable, setEditable] = useState(false)
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ received: 0, total: 0 })
  /** 语音条要居中在**文章**上，不是整个窗口（左边还有侧栏，右边可能开着面板）。 */
  const [center, setCenter] = useState<number | null>(null)
  const [lang, setLang] = useState<Lang>(() => {
    const saved = ctx.settings.get<string>(LANG_KEY)
    return saved === 'en' || saved === 'auto' ? saved : 'zh'
  })

  const phaseRef = useRef<Phase>(phase)
  const langRef = useRef<Lang>(lang)
  const sessionRef = useRef('')
  const wantRef = useRef(false)
  const prevDocRef = useRef(docId)
  const startedAtRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  phaseRef.current = phase
  langRef.current = lang

  const t = (key: string, vars?: Record<string, string | number>) => ctx.i18n.t(key, vars)

  const reset = useCallback(() => {
    // 结束一次会话就把采集流扔掉（Rust 那边 `voice:cancel` 会 drop 掉 cpal Stream）。
    if (sessionRef.current !== '') {
      void api.cancel(ctx).catch((err) => reportError('voice-input', err))
    }
    wantRef.current = false
    sessionRef.current = ''
    setDraft('')
    setEditable(false)
    setError('')
    setLevel(0)
    setElapsed(0)
    setBusy(false)
    setProgress({ received: 0, total: 0 })
    setPhase('idle')
  }, [ctx])

  const fail = useCallback(
    (err: unknown) => {
      reportError('voice-input', err)
      setError(messageOf(err))
      setLevel(0)
      setBusy(false)
      setPhase('error')
      // 停不下来的采集流比一个错误更糟：顺手把这次会话扔掉（没有会话时是空操作）。
      void api.cancel(ctx).catch(() => {})
    },
    [ctx],
  )

  /** 真正开一次会话。下载完成后的自动开始也走它。 */
  const beginSession = useCallback(async () => {
    const sid = `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    sessionRef.current = sid
    setDraft('')
    setError('')
    setEditable(false)
    setLevel(0)
    setElapsed(0)
    setPhase('starting')
    try {
      await api.start(ctx, sid, langRef.current)
    } catch (err) {
      fail(err)
    }
  }, [ctx, fail])

  const begin = useCallback(async () => {
    if (!docId) return
    if (phaseRef.current !== 'idle' && phaseRef.current !== 'error') return
    wantRef.current = true
    setDraft('')
    setError('')
    setEditable(false)
    setLevel(0)
    setElapsed(0)
    try {
      const st = await api.status(ctx)
      if (!st.ready) {
        setBusy(st.downloading)
        setProgress({ received: st.received, total: st.total })
        setError(st.error)
        setPhase('download')
        return
      }
      await beginSession()
    } catch (err) {
      fail(err)
    }
  }, [ctx, docId, beginSession, fail])

  const startDownload = useCallback(async () => {
    wantRef.current = true
    setBusy(true)
    setError('')
    setProgress({ received: 0, total: 0 })
    setPhase('download')
    try {
      await api.download(ctx)
    } catch (err) {
      fail(err)
    }
  }, [ctx, fail])

  const stopRecording = useCallback(async () => {
    if (!sessionRef.current) return
    setPhase('transcribing')
    try {
      await api.stop(ctx)
    } catch (err) {
      fail(err)
    }
  }, [ctx, fail])

  const discard = useCallback(() => {
    reset()
  }, [reset])

  const apply = useCallback(() => {
    const text = draft.trim()
    if (!text) return
    if (!docId) {
      fail(t('dictate.noDoc'))
      return
    }
    if (!ctx.editor.insertText(docId, text)) {
      fail(t('dictate.insertFailed'))
      return
    }
    reset()
  }, [ctx, docId, draft, fail, reset, t])

  // 事件只订阅一次：会话号对不上的是上一次录音的收尾，丢掉。
  useEffect(() => {
    let dead = false
    let offs: Array<() => void> = []
    void api
      .listenVoice({
        loading: (sid) => {
          if (sid === sessionRef.current) setPhase('starting')
        },
        started: (sid) => {
          if (sid !== sessionRef.current) return
          startedAtRef.current = Date.now()
          setElapsed(0)
          setBusy(false)
          setPhase('recording')
        },
        level: (sid, value) => {
          if (sid === sessionRef.current) setLevel(value)
        },
        partial: (sid, text) => {
          if (sid === sessionRef.current) setDraft(text)
        },
        done: (sid, text) => {
          if (sid !== sessionRef.current) return
          setDraft(text)
          setEditable(true)
          setLevel(0)
          setError(text.trim() === '' ? ctx.i18n.t('dictate.empty') : '')
          setPhase('draft')
        },
        error: (sid, message) => {
          if (sid !== sessionRef.current) return
          setError(message)
          setLevel(0)
          setPhase('error')
          reportError('voice-input', new Error(message))
          // 采集流可能已经建起来了（模型装载失败时就是这样）—— 留在那儿就是一直开着麦克风。
          void api.cancel(ctx).catch((err) => reportError('voice-input', err))
        },
        progress: (received, total) => setProgress({ received, total }),
        modelReady: () => {
          setBusy(false)
          if (wantRef.current) void beginSession()
        },
        modelError: (message) => {
          setBusy(false)
          setError(message)
          setPhase('error')
        },
      })
      .then((list) => {
        if (dead) for (const off of list) off()
        else offs = list
      })
      .catch((err: unknown) => reportError('voice-input', err))
    return () => {
      dead = true
      for (const off of offs) off()
    }
  }, [ctx, beginSession])

  // 换文档就收起：草稿属于刚才那一篇，跟着换过去是错的。
  useEffect(() => {
    if (docId === prevDocRef.current) return
    prevDocRef.current = docId
    if (phaseRef.current !== 'idle') discard()
  }, [docId, discard])

  // 关窗口 / 拔插件时别留着麦克风开着。
  useEffect(() => {
    return () => {
      if (phaseRef.current !== 'idle') {
        void api.cancel(ctx).catch(() => {})
      }
    }
  }, [ctx])

  useEffect(() => {
    if (phase !== 'recording') return
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      500,
    )
    return () => clearInterval(timer)
  }, [phase])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [draft, phase])

  useEffect(() => {
    if (phase === 'draft') textareaRef.current?.focus()
  }, [phase])

  // 量正文那一栏的几何，而不是猜侧栏宽度 —— 分栏 / 评论栏 / 助手栏都不会算错。
  useEffect(() => {
    if (phase === 'idle' || !docId) {
      setCenter(null)
      return
    }
    const pane = Array.from(document.querySelectorAll<HTMLElement>('[data-doc-id]')).find(
      (node) => node.dataset.docId === docId,
    )
    const target = pane?.querySelector<HTMLElement>('.ProseMirror') ?? pane
    if (!target) {
      setCenter(null)
      return
    }
    const measure = () => {
      const rect = target.getBoundingClientRect()
      setCenter(Math.round(rect.left + rect.width / 2))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(pane ?? target)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [phase, docId])

  const cycleLang = () => {
    if (phase === 'recording' || phase === 'starting' || phase === 'transcribing') return
    const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length]
    setLang(next)
    ctx.settings.set(LANG_KEY, next)
  }

  if (!docId) return null

  if (phase === 'idle') {
    return (
      <button
        type="button"
        className={s.mic}
        title={t('dictate.start')}
        aria-label={t('dictate.start')}
        onClick={() => void begin()}
      >
        <MicrophoneIcon width={18} height={18} />
      </button>
    )
  }

  const barStyle = center === null ? undefined : { left: center }

  if (phase === 'download') {
    const percent = progress.total > 0 ? Math.round((progress.received / progress.total) * 100) : 0
    return (
      <div className={s.bar} style={barStyle}>
        <div className={s.download}>
          <div className={s.downloadTitle}>{t('dictate.download.title')}</div>
          <div className={s.downloadDesc}>{t('dictate.download.desc')}</div>
          {busy && progress.total > 0 && (
            <>
              <div className={s.track}>
                <div className={s.fill} style={{ width: `${percent}%` }} />
              </div>
              <div className={s.downloadDesc}>{t('dictate.downloading', { percent })}</div>
            </>
          )}
          {busy && progress.total === 0 && (
            <div className={s.downloadDesc}>{t('dictate.connecting')}</div>
          )}
          {error !== '' && <div className={`${s.downloadDesc} ${s.errorText}`}>{error}</div>}
        </div>
        <div className={s.status}>
          <span />
          <span className={s.actions}>
            <button
              type="button"
              className={s.primary}
              disabled={busy}
              onClick={() => void startDownload()}
            >
              {error !== '' ? t('common.retry') : t('dictate.download')}
            </button>
            <button
              type="button"
              className={s.iconButton}
              title={t('dictate.discard')}
              aria-label={t('dictate.discard')}
              onClick={discard}
            >
              <CloseIcon width={16} height={16} />
            </button>
          </span>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className={s.bar} style={barStyle}>
        <div className={s.status}>
          <span className={s.errorText}>{error === '' ? t('dictate.error') : error}</span>
          <span className={s.actions}>
            <button type="button" className={s.primary} onClick={() => void begin()}>
              {t('common.retry')}
            </button>
            <button
              type="button"
              className={s.iconButton}
              title={t('dictate.discard')}
              aria-label={t('dictate.discard')}
              onClick={discard}
            >
              <CloseIcon width={16} height={16} />
            </button>
          </span>
        </div>
      </div>
    )
  }

  const recording = phase === 'recording'
  const transcribing = phase === 'transcribing'
  const levelScale = Math.min(1, level * 7)

  return (
    <div className={s.bar} style={barStyle}>
      <div className={s.top}>
        {recording ? (
          <div className={s.wave} aria-hidden>
            {BARS.map((factor, i) => (
              <span
                key={i}
                className={s.waveBar}
                style={{
                  transform: `scaleY(${Math.max(0.14, levelScale * factor + 0.08)})`,
                }}
              />
            ))}
          </div>
        ) : phase === 'starting' || transcribing ? (
          <span className={s.spinner} />
        ) : (
          <span className={s.dotIdle} aria-hidden />
        )}

        <textarea
          ref={textareaRef}
          className={s.draft}
          rows={1}
          value={draft}
          readOnly={!editable}
          spellCheck={false}
          placeholder={recording ? `${t('dictate.listening')}…` : t('dictate.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              discard()
              return
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && editable) apply()
          }}
        />

        <div className={s.actions}>
          <button
            type="button"
            className={s.lang}
            disabled={recording || transcribing || phase === 'starting'}
            onClick={cycleLang}
          >
            {t(`dictate.lang.${lang}`)}
          </button>
          {recording || transcribing || phase === 'starting' ? (
            <button
              type="button"
              className={s.stopButton}
              title={t('dictate.stop')}
              aria-label={t('dictate.stop')}
              onClick={() => void stopRecording()}
            >
              <StopIcon width={14} height={14} />
            </button>
          ) : (
            <button
              type="button"
              className={s.primary}
              disabled={draft.trim() === ''}
              onClick={apply}
            >
              <DoneIcon width={13} height={13} style={{ marginRight: 4, verticalAlign: '-2px' }} />
              {t('dictate.apply')}
            </button>
          )}
          <button
            type="button"
            className={s.iconButton}
            title={t('dictate.discard')}
            aria-label={t('dictate.discard')}
            onClick={discard}
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      </div>

      <div className={s.status}>
        <span>
          {phase === 'starting' ? (
            <>
              <span className={s.spinner} />
              {t('dictate.modelLoading')}
            </>
          ) : recording ? (
            `${t('dictate.listening')} · ${clock(elapsed)}`
          ) : transcribing ? (
            <>
              <span className={s.spinner} />
              {t('dictate.transcribing')}
            </>
          ) : error !== '' ? (
            <span className={s.errorText}>{error}</span>
          ) : (
            t('dictate.ready')
          )}
        </span>
        <span>{phase === 'draft' ? t('dictate.lang.' + lang) : ''}</span>
      </div>
    </div>
  )
}
