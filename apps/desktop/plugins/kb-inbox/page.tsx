/**
 * 整理建议收件箱那一页（挂在 `main.home` 槽，跟 `external-files/page.tsx` 一个形状）。
 *
 * ★ 策展人在后台跑出的**待确认**建议堆在这儿：每条一行 —— 哪一篇 / 建议什么 / 为什么，
 *   右端「采纳 / 忽略」。**采纳了才动笔记**（高置信的那批由策展人直接落库，不进这儿，D-0185）。
 *
 * ★ 页面显不显走模块级状态 + 订阅（侧栏 → SHOW_LIST → 这里）：事件可能在首页还没挂载时发
 *   （用户正看编辑器时点侧栏），放组件里就永远错过那一下。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Context } from 'cordis'
import { OPEN_DOC, type KbProposal } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { toast } from '../../src/ui/toast'
import * as s from './inbox.css'

/* ── 这一页显不显：模块级状态 + 订阅 ── */

let on = false
const subs = new Set<() => void>()

export function setInboxPage(next: boolean) {
  if (next === on) return
  on = next
  for (const cb of subs) cb()
}

function subscribePage(cb: () => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}

const readPage = () => on

/** 五个 kind 的展示顺序 —— 从「最贴笔记」到「最需要人判」（合并标签会删东西，排最后）。 */
const KIND_ORDER: readonly string[] = ['tag', 'topic', 'link', 'entity', 'merge']

function errText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** `from` 契约里是 `string[]`，也认单个字符串（防形状漂移）。 */
function names(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return typeof v === 'string' ? [v] : []
}

/** 一条建议的正文 —— 形状随 kind（见契约 `KbProposal.payload`）。 */
function describe(p: KbProposal): string {
  const pl = p.payload
  switch (p.kind) {
    case 'tag':
      return `#${str(pl.tag)}`
    case 'topic':
      return str(pl.topic)
    case 'link': {
      const to = str(pl.toTitle) || str(pl.toId)
      const rel = str(pl.relation)
      return rel ? `${to} · ${rel}` : to
    }
    case 'entity': {
      const name = str(pl.name)
      const k = str(pl.kind)
      return k ? `${name} · ${k}` : name
    }
    case 'merge': {
      const from = names(pl.from).join('、')
      const into = str(pl.into) || str(pl.to)
      return `${from} → ${into}`
    }
    default:
      return ''
  }
}

export function InboxPage({ ctx }: { ctx: Context }) {
  const active = useSyncExternalStore(subscribePage, readPage, readPage)
  return active ? <Inbox ctx={ctx} /> : null
}

function Inbox({ ctx }: { ctx: Context }) {
  const t = ctx.i18n.t
  // null = 还没拉到（首屏别闪一下空态）。
  const [items, setItems] = useState<KbProposal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await ctx.rpc.call<KbProposal[]>('kb:proposals', { state: 'pending' })
      setItems(list)
      setError(null)
    } catch (err) {
      reportError('kb', err)
      setError(errText(err))
    }
  }, [ctx])

  // 每次进这一页都重拉 —— 策展人在后台随时往这儿放新的。
  useEffect(() => {
    void load()
  }, [load])

  const decide = useCallback(
    async (id: number, accept: boolean) => {
      try {
        await ctx.rpc.call('kb:proposal', { id, accept })
        setItems((prev) => prev?.filter((p) => p.id !== id) ?? prev)
        setError(null)
        toast({ text: t('kb.inbox.done') })
      } catch (err) {
        reportError('kb', err)
        setError(errText(err))
      }
    },
    [ctx, t],
  )

  const acceptAll = useCallback(async () => {
    if (items === null || items.length === 0) return
    setBusy(true)
    try {
      for (const p of items) await ctx.rpc.call('kb:proposal', { id: p.id, accept: true })
      setItems([])
      setError(null)
      toast({ text: t('kb.inbox.done') })
    } catch (err) {
      reportError('kb', err)
      setError(errText(err))
      // 循环中途炸了：前面几条可能已经采纳 —— 重拉一次对齐真实状态。
      void load()
    } finally {
      setBusy(false)
    }
  }, [ctx, items, t, load])

  const count = items?.length ?? 0
  const kinds =
    items === null
      ? []
      : KIND_ORDER.filter((k) => items.some((p) => p.kind === k)).concat(
          [...new Set(items.map((p) => p.kind))].filter((k) => !KIND_ORDER.includes(k)),
        )

  return (
    <div className={s.page}>
      <div className={s.header}>
        <h1 className={s.title}>{t('kb.inbox.title')}</h1>
        <span className={s.hint}>{t('kb.inbox.hint')}</span>
        <span className={s.count}>
          {t('kb.inbox.pending')} {count}
        </span>
        <button
          type="button"
          className={`${s.tool} ${s.toolPrimary}`}
          disabled={busy || count === 0}
          onClick={() => void acceptAll()}
        >
          {t('kb.inbox.acceptAll')}
        </button>
      </div>

      {error !== null && <p className={s.error}>{error}</p>}

      <div className={s.list}>
        {items !== null && items.length === 0 && <p className={s.empty}>{t('kb.inbox.empty')}</p>}
        {kinds.map((kind) => {
          const group = items?.filter((p) => p.kind === kind) ?? []
          return (
            <section key={kind} className={s.group}>
              <div className={s.groupHead}>
                <span className={s.groupBar} />
                <span>{t(`kb.inbox.kind.${kind}`)}</span>
                <span className={s.groupN}>{group.length}</span>
              </div>
              {group.map((p) => (
                <div key={p.id} className={s.row}>
                  <div className={s.rowMain}>
                    <div className={s.forLine}>
                      <span>{t('kb.inbox.for')}</span>
                      <button
                        type="button"
                        className={s.docLink}
                        title={p.docTitle}
                        onClick={() => ctx.emit(OPEN_DOC, { id: p.docId })}
                      >
                        {p.docTitle}
                      </button>
                    </div>
                    <div className={s.what}>{describe(p)}</div>
                    {p.reason !== '' && <div className={s.reason}>{p.reason}</div>}
                  </div>
                  <div className={s.actions}>
                    <button
                      type="button"
                      className={`${s.act} ${s.actAccept}`}
                      disabled={busy}
                      onClick={() => void decide(p.id, true)}
                    >
                      {t('kb.inbox.accept')}
                    </button>
                    <button
                      type="button"
                      className={s.act}
                      disabled={busy}
                      onClick={() => void decide(p.id, false)}
                    >
                      {t('kb.inbox.reject')}
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
