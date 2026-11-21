/**
 * 手机第一次打开时的配对页。桌面设置页显示 6 位码，手机输一次，换一年的 cookie。
 *
 * 离线（fetch 直接失败）不当成未配对 —— 本地库还在，先让应用起来。
 */
import { useEffect, useRef, useState } from 'react'

export async function authState(): Promise<'ok' | 'pair'> {
  try {
    const res = await fetch('/sync/hello', { credentials: 'include' })
    return res.status === 401 ? 'pair' : 'ok'
  } catch {
    return 'ok'
  }
}

export function PairingScreen() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const tried = useRef(false)

  async function pair(raw: string): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/pair', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: raw.trim() }),
      })
      if (!res.ok) {
        setError(res.status === 403 ? '配对码不对或已过期' : '配对失败，稍后再试')
        return
      }
      // 码已用掉，别留在地址栏 / 历史记录里。
      history.replaceState(null, '', '/')
      location.reload()
    } catch {
      setError('连不上桌面端，确认手机和电脑在同一个 Wi-Fi')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setUrl(location.origin)
    const onNeed = () => setError('配对已失效，请重新输入桌面端显示的 6 位码')
    window.addEventListener('sn:need-pair', onNeed)
    // 桌面设置页的二维码把码带在 ?code= 里 —— 扫一下就直接连（D-0199）。
    const fromUrl = new URLSearchParams(location.search).get('code') ?? ''
    if (!tried.current && /^\d{6}$/.test(fromUrl)) {
      tried.current = true
      setCode(fromUrl)
      void pair(fromUrl)
    }
    return () => window.removeEventListener('sn:need-pair', onNeed)
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void pair(code)
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 18px',
        background: '#faf9f7',
        font: '16px/1.6 -apple-system, system-ui, "PingFang SC", sans-serif',
        color: '#222',
      }}
    >
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>连接到 self-notion</h2>
        <p style={{ margin: '0 0 22px', color: '#777', fontSize: 14 }}>
          {url || location.origin}
        </p>
        <label style={{ display: 'block', fontSize: 13, color: '#666', marginBottom: 8 }}>
          桌面端「设置 → 手机版」里的 6 位配对码
        </label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          autoFocus
          style={{
            width: '100%',
            padding: '14px 16px',
            fontSize: 26,
            letterSpacing: 8,
            textAlign: 'center',
            borderRadius: 12,
            border: '1px solid #ddd',
            background: '#fff',
          }}
        />
        {error ? (
          <p style={{ color: '#c0392b', fontSize: 14, margin: '12px 0 0' }}>{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          style={{
            width: '100%',
            marginTop: 18,
            padding: '14px 16px',
            fontSize: 16,
            border: 0,
            borderRadius: 12,
            background: code.length === 6 ? '#1e96eb' : '#c9d8e5',
            color: '#fff',
          }}
        >
          {busy ? '连接中…' : '连接'}
        </button>
        <p style={{ fontSize: 12, color: '#999', marginTop: 18, lineHeight: 1.6 }}>
          数据只在你自己局域网里走。首次使用前，先在桌面端设置页下载并信任根证书。
        </p>
      </form>
    </div>
  )
}
