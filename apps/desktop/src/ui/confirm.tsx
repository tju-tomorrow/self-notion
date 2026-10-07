/**
 * 应用内的确认框。**本仓库里不再用 `window.confirm`**。
 *
 * 为什么：WKWebView 的 `confirm` 走到 Tauri 的 dialog 插件，而 `capabilities/default.json`
 * 只给了 `dialog:allow-open` / `allow-save` —— 于是每次确认都**被当成点了取消**
 * （`errors.log` 实锤：`promise: dialog.confirm not allowed. Command not found`）：
 * 删文档、清空回收站、删评论三处全部静默失效。补权限要重编 Rust，而且系统弹窗跟界面不搭，
 * 所以自己做（D-0070）。
 *
 * 用法：`if (!(await confirmDialog({ title: '…' }))) return`。
 * 宿主在 `main.tsx` 挂一次（组合根），插件只管调 —— 这里没有 ctx，跟 `slot` 同一层。
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as s from './confirm.css'

export interface ConfirmOptions {
  title: string
  /** 补一句后果说明（「回复会一起删掉」这种）。 */
  body?: string
  /** 确定键的字。默认「确定」。 */
  ok?: string
  /** 危险动作（删除…）：确定键用红底。 */
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  id: number
}

/** 词条从 `main.tsx` 注进来 —— 这里没有 ctx（跟 `slot` 同一层）。 */
let t: (key: string) => string = (key) => key

let queue: Pending[] = []
let nextId = 1
const waiting = new Map<number, (ok: boolean) => void>()
const subs = new Set<() => void>()

const emit = () => {
  for (const cb of subs) cb()
}

/** 弹一个确认框。**排队**：后弹的等前一个答完再出现 —— 挤掉前一个会让用户以为没点过。 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const id = nextId++
  queue = [...queue, { ...options, id }]
  emit()
  return new Promise<boolean>((resolve) => {
    waiting.set(id, resolve)
  })
}

/** 挂在 `main.tsx`。返回逆函数，把宿主拆干净。 */
export function mountConfirmHost(translate?: (key: string) => string): () => void {
  if (translate) t = translate
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<ConfirmHost />)
  return () => {
    for (const resolve of waiting.values()) resolve(false)
    waiting.clear()
    queue = []
    root.unmount()
    host.remove()
  }
}

function ConfirmHost() {
  const [, bump] = useState(0)
  useEffect(() => {
    const cb = () => bump((n) => n + 1)
    subs.add(cb)
    return () => void subs.delete(cb)
  }, [])

  const answer = (ok: boolean) => {
    const head = queue[0]
    if (!head) return
    queue = queue.slice(1)
    emit()
    waiting.get(head.id)?.(ok)
    waiting.delete(head.id)
  }

  // Esc = 取消、Enter = 确定。挂在 document 上（框是 portal 到 body 的，没有自己的焦点域）。
  useEffect(() => {
    if (!queue.length) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        answer(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        answer(true)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })

  if (!queue.length) return null
  const { title, body, ok, danger } = queue[0]!

  return (
    <div
      className={s.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) answer(false)
      }}
    >
      <div className={s.card} role="dialog" aria-modal="true">
        <p className={s.title}>{title}</p>
        {body ? <p className={s.body}>{body}</p> : null}
        <div className={s.actions}>
          {/* 危险动作把焦点给「取消」—— 按 Enter 顺手确认删除是最容易出的事。 */}
          <button type="button" className={s.ghost} autoFocus={Boolean(danger)} onClick={() => answer(false)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={danger ? `${s.primary} ${s.danger}` : s.primary}
            autoFocus={!danger}
            onClick={() => answer(true)}
          >
            {ok ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
