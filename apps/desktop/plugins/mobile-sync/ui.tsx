import { useEffect, useState } from 'react'
import type { Context } from 'cordis'
import { reportError } from '../../src/kernel/errors'
import * as s from './ui.css'

interface Status {
  running: boolean
  url?: string
  urlAlt?: string | null
  setupUrl?: string
  caUrl?: string
  code?: string
  paired?: boolean
  pairUrl?: string
  qrSvg?: string
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

export function MobileSection({ ctx }: { ctx: Context }) {
  const [st, setSt] = useState<Status>({ running: false })
  const [copied, setCopied] = useState('')
  const pairUrl = st.pairUrl
  const qrSvg = st.qrSvg

  useEffect(() => {
    let dead = false
    const load = () => {
      void ctx.rpc
        .call<Status>('mobile:status')
        .then((v) => {
          if (!dead) setSt(v)
        })
        .catch((err: unknown) => {
          if (!dead) reportError('mobile-sync', err)
        })
    }
    load()
    const t = setInterval(load, 5000)
    return () => {
      dead = true
      clearInterval(t)
    }
  }, [ctx])

  const rotate = async () => {
    try {
      const r = await ctx.rpc.call<{ code: string; pairUrl?: string; qrSvg?: string }>('mobile:code')
      // 换码后二维码也得跟着换，否则还指着旧码。
      setSt((v) => ({
        ...v,
        code: r.code,
        pairUrl: r.pairUrl ?? v.pairUrl,
        qrSvg: r.qrSvg ?? v.qrSvg,
      }))
    } catch (err) {
      reportError('mobile-sync', err)
    }
  }

  const put = async (name: string, value: string) => {
    await copy(value)
    setCopied(name)
    setTimeout(() => setCopied(''), 1500)
  }

  if (!st.running) {
    return (
      <div className={s.wrap}>
        <div className={s.badge}>
          <span className={`${s.dot} ${s.dotOff}`} />
          {ctx.i18n.t('mobile.stopped')}
        </div>
      </div>
    )
  }

  return (
    <div className={s.wrap}>
      <div className={s.badge}>
        <span className={s.dot} />
        {ctx.i18n.t('mobile.running')} · {st.paired ? ctx.i18n.t('mobile.paired') : ctx.i18n.t('mobile.notPaired')}
      </div>

      <div className={s.row}>
        <span className={s.label}>{ctx.i18n.t('mobile.url')}</span>
        <div className={s.value}>
          <span className={s.url}>{st.url}</span>
          <button type="button" className={s.btn} onClick={() => st.url && void put('url', st.url)}>
            {copied === 'url' ? ctx.i18n.t('mobile.copied') : ctx.i18n.t('mobile.copy')}
          </button>
        </div>
        {st.urlAlt ? (
          <div className={s.value}>
            <span className={s.label}>{ctx.i18n.t('mobile.urlAlt')}</span>
            <span className={s.url}>{st.urlAlt}</span>
            <button type="button" className={s.btn} onClick={() => st.urlAlt && void put('alt', st.urlAlt)}>
              {copied === 'alt' ? ctx.i18n.t('mobile.copied') : ctx.i18n.t('mobile.copy')}
            </button>
          </div>
        ) : null}
      </div>

      {qrSvg ? (
        <div className={s.pairBlock}>
          {/* 桌面端生成的 svg，不是用户内容。 */}
          <div className={s.qr} dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className={s.pairInfo}>
            {pairUrl ? (
              <div className={s.row}>
                <span className={s.label}>{ctx.i18n.t('mobile.pairUrl')}</span>
                <div className={s.value}>
                  <span className={s.url}>{pairUrl}</span>
                  <button
                    type="button"
                    className={s.btn}
                    onClick={() => pairUrl && void put('pair', pairUrl)}
                  >
                    {copied === 'pair' ? ctx.i18n.t('mobile.copied') : ctx.i18n.t('mobile.copy')}
                  </button>
                </div>
              </div>
            ) : null}
            <p className={s.note}>{ctx.i18n.t('mobile.scanHint')}</p>
          </div>
        </div>
      ) : null}

      <div className={s.row}>
        <span className={s.label}>{ctx.i18n.t('mobile.code')}</span>
        <div className={s.value}>
          <span className={s.code}>{st.code || '------'}</span>
          <button type="button" className={s.btn} onClick={() => void rotate()}>
            {ctx.i18n.t('mobile.newCode')}
          </button>
        </div>
      </div>

      <div className={s.row}>
        <span className={s.label}>{ctx.i18n.t('mobile.ca')}</span>
        <div className={s.value}>
          <span className={s.url}>{st.caUrl}</span>
          <button type="button" className={s.btn} onClick={() => st.caUrl && void put('ca', st.caUrl)}>
            {copied === 'ca' ? ctx.i18n.t('mobile.copied') : ctx.i18n.t('mobile.copy')}
          </button>
        </div>
      </div>

      <p className={s.note}>{ctx.i18n.t('mobile.hint')}</p>
    </div>
  )
}
