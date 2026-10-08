/**
 * 右下角的轻提示 + 一个可选的「撤销」。宿主挂一次（`main.tsx`），插件只管调 —— 同 `confirm.tsx`，
 * 这里没有 ctx。
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as motion from './motion.css'

export interface ToastAction {
  label: string
  run(): void
}

export interface ToastOptions {
  text: string
  action?: ToastAction
  /** 出错用 error，会留在屏幕上更久。 */
  tone?: 'info' | 'error'
}

interface Shown extends ToastOptions {
  id: number
  at: number
}

/** 同时最多显示几条；多的把最旧的挤掉。 */
const MAX = 3
const LIFE = { info: 6000, error: 12000 } as const

let nextId = 1
let shown: Shown[] = []
const subs = new Set<() => void>()

const emit = () => {
  for (const cb of subs) cb()
}

export function toast(options: ToastOptions): void {
  const item: Shown = { ...options, id: nextId++, at: Date.now() }
  shown = [...shown, item].slice(-MAX)
  emit()
  setTimeout(() => dismiss(item.id), LIFE[options.tone ?? 'info'])
}

export function dismiss(id: number): void {
  const next = shown.filter((t) => t.id !== id)
  if (next.length === shown.length) return
  shown = next
  emit()
}

export function mountToastHost(): () => void {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<ToastHost />)
  return () => {
    shown = []
    root.unmount()
    host.remove()
  }
}

function ToastHost() {
  const [, bump] = useState(0)
  useEffect(() => {
    const cb = () => bump((n) => n + 1)
    subs.add(cb)
    return () => void subs.delete(cb)
  }, [])

  if (!shown.length) return null

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 2147483000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'flex-end',
      }}
    >
      {shown.map((item) => (
        <div
          key={item.id}
          className={motion.riseIn}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            maxWidth: 420,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--affine-v2-layer-background-primary, #fff)',
            boxShadow: 'var(--affine-menu-shadow, 0 8px 24px rgba(0,0,0,.18))',
            border: '0.5px solid var(--affine-v2-layer-insideBorder-border, rgba(0,0,0,.08))',
            color:
              item.tone === 'error'
                ? 'var(--affine-error-color, #c00)'
                : 'var(--affine-v2-text-primary, #222)',
            fontFamily: 'var(--affine-font-family, inherit)',
            fontSize: 13,
            lineHeight: '18px',
          }}
        >
          <span>{item.text}</span>
          {item.action ? (
            <button
              type="button"
              onClick={() => {
                dismiss(item.id)
                item.action?.run()
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--affine-primary-color, #1e96eb)',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
