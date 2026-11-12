import { useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import { StopIcon, VoiceIcon } from '@blocksuite/icons/rc'

import { Hint } from '../../src/ui/hint'
import {
  RATE_KEY,
  RATES,
  VOICE_GROUPS,
  VOICE_KEY,
  VOICES,
  prefs,
  toggle,
  useDocId,
  useReading,
  voiceName,
} from './player'
import * as s from './read.css'

export function ReadHeader({ ctx }: { ctx: Context }) {
  const docId = useDocId()
  const reading = useReading()
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<{ top: number; right: number } | null>(null)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const chosen = prefs(ctx)
  const [voice, setVoice] = useState(chosen.voice)
  const [rate, setRate] = useState(chosen.rate)
  const label = reading ? ctx.i18n.t('voice.stop') : ctx.i18n.t('voice.start')

  useEffect(() => {
    const pull = () => {
      const next = prefs(ctx)
      setVoice(next.voice)
      setRate(next.rate)
    }
    const offVoice = ctx.settings.onChange(VOICE_KEY, pull)
    const offRate = ctx.settings.onChange(RATE_KEY, pull)
    pull()
    return () => {
      offVoice()
      offRate()
    }
  }, [ctx])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setCursor(null)
      return
    }
    listRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open])

  useEffect(() => {
    if (cursor == null) return
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const q = query.trim().toLowerCase()
  const shown = VOICES.filter((item) => {
    if (!q) return true
    const hint = ctx.i18n.t(item.hint).toLowerCase()
    const group = ctx.i18n.t(`read.group.${item.group}`).toLowerCase()
    return item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q) || hint.includes(q) || group.includes(q)
  })

  const pick = (id: string) => {
    setVoice(id)
    ctx.settings.set(VOICE_KEY, id)
  }

  return (
    <div className={s.bar}>
      <Hint text={label}>
        <button
          type="button"
          className={s.iconButton}
          aria-label={label}
          disabled={docId === null}
          onClick={() => toggle(ctx, docId)}
        >
          {reading ? <StopIcon width={18} height={18} /> : <VoiceIcon width={18} height={18} />}
        </button>
      </Hint>
      <button
        type="button"
        className={s.nameButton}
        disabled={docId === null}
        aria-label={ctx.i18n.t('read.voices')}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setBox({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
          setOpen((v) => !v)
        }}
      >
        {voiceName(voice)}
      </button>
      {open && box && (
        <div
          className={s.menu}
          style={{ top: box.top, right: box.right }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            className={s.find}
            value={query}
            placeholder={ctx.i18n.t('read.find')}
            spellCheck={false}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(null)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((i) => Math.min(shown.length - 1, (i ?? -1) + 1))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((i) => Math.max(0, (i ?? 0) - 1))
                return
              }
              if (e.key === 'Enter') {
                const item = shown[cursor ?? 0]
                if (!item) return
                e.preventDefault()
                pick(item.id)
              }
            }}
          />
          <div className={s.list} ref={listRef}>
            {shown.length === 0 ? <div className={s.empty}>{ctx.i18n.t('read.none')}</div> : null}
            {VOICE_GROUPS.map((group) => {
              const items = shown.filter((item) => item.group === group)
              if (items.length === 0) return null
              return (
                <div key={group}>
                  <div className={s.group}>{ctx.i18n.t(`read.group.${group}`)}</div>
                  {items.map((item) => {
                    const index = shown.indexOf(item)
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={s.row}
                        data-on={item.id === voice}
                        data-cursor={index === cursor}
                        onClick={() => {
                          setCursor(index)
                          pick(item.id)
                        }}
                      >
                        <span className={s.rowName}>{item.name}</span>
                        <span className={s.rowHint}>{ctx.i18n.t(item.hint)}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className={s.label}>{ctx.i18n.t('read.rate')}</div>
          <div className={s.chips}>
            {RATES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={s.chip}
                data-on={item.value === rate}
                onClick={() => {
                  setRate(item.value)
                  ctx.settings.set(RATE_KEY, item.value)
                }}
              >
                {ctx.i18n.t(item.key)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
