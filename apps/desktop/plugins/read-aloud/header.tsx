import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import { StopIcon, VoiceIcon } from '@blocksuite/icons/rc'

import { Hint } from '../../src/ui/hint'
import {
  RATE_KEY,
  RATES,
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
          <div className={s.label}>{ctx.i18n.t('read.voices')}</div>
          <div className={s.chips}>
            {VOICES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={s.chip}
                data-on={item.id === voice}
                onClick={() => {
                  setVoice(item.id)
                  ctx.settings.set(VOICE_KEY, item.id)
                }}
              >
                {item.name}
              </button>
            ))}
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
