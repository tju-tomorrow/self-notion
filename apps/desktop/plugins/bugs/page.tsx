/**
 * bug 现场那一页（`main.home` 槽，同虚拟目录）。
 *
 * 左边是抓过的现场（时间 / 类型 / 一句话），右边是那一份的全部内容 —— 就是磁盘上那个 JSON，
 * 一个字段都不省：**看到的东西和 AI 读的是同一份**，没有再加工一遍。
 * 底下那条「最近动作」是事件带，抓现场时它也会一起进现场包。
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Context } from 'cordis'
import { timeAgo } from '../../src/ui/timeago'
import { toast } from '../../src/ui/toast'
import { reportError } from '../../src/kernel/errors'
import { currentEvents, currentRevision, subscribeEvents, subscribeRevision } from './state'
import * as s from './page.css'

/** 列表页要的那几个字段（Rust 只挑这几个过桥，整份现场走 `bug:read`）。 */
interface BugSummary {
  name: string
  at: number
  kind: string
  title: string
  detail: string
  doc: string | null
}

let on = false
const subs = new Set<() => void>()

export function setBugsPage(next: boolean): void {
  if (next === on) return
  on = next
  for (const cb of subs) cb()
}

const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}
const read = (): boolean => on

export function BugsPage({ ctx }: { ctx: Context }) {
  const active = useSyncExternalStore(subscribe, read, read)
  return active ? <List ctx={ctx} /> : null
}

function List({ ctx }: { ctx: Context }) {
  const revision = useSyncExternalStore(subscribeRevision, currentRevision, currentRevision)
  const events = useSyncExternalStore(subscribeEvents, currentEvents, currentEvents)
  const [rows, setRows] = useState<readonly BugSummary[]>([])
  const [name, setName] = useState<string | null>(null)
  const [detail, setDetail] = useState<string>('')

  useEffect(() => {
    void ctx.rpc
      .call<BugSummary[]>('bug:list')
      .then((list) => {
        setRows(list)
        // 选中的那份没了（被 prune 掉 / 换了目录）就退回第一份。
        if (name === null || !list.some((r) => r.name === name)) setName(list[0]?.name ?? null)
      })
      .catch((err: unknown) => reportError('bugs', err))
  }, [ctx, revision, name])

  useEffect(() => {
    if (name === null) {
      setDetail('')
      return
    }
    void ctx.rpc
      .call<unknown>('bug:read', { name })
      .then((json) => setDetail(JSON.stringify(json, null, 2)))
      .catch((err: unknown) => reportError('bugs', err))
  }, [ctx, name, revision])

  const capture = useCallback(() => {
    ctx.get('bugs')?.capture()
    toast({ text: ctx.i18n.t('bugs.captured') })
  }, [ctx])

  return (
    <div className={s.page}>
      <div className={s.header}>
        <span className={s.headTitle}>{ctx.i18n.t('bugs.title')}</span>
        <span className={s.hint}>{ctx.i18n.t('bugs.hint')}</span>
        <button type="button" className={s.btn} onClick={capture}>
          {ctx.i18n.t('bugs.capture')}
        </button>
      </div>

      <div className={s.body}>
        <div className={s.rail}>
          {rows.length === 0 ? (
            <p className={s.empty}>{ctx.i18n.t('bugs.empty')}</p>
          ) : (
            rows.map((row) => (
              <button
                key={row.name}
                type="button"
                className={row.name === name ? s.rowOn : s.row}
                onClick={() => setName(row.name)}
              >
                <span className={s.rowTop}>
                  <span className={s.kind}>{row.kind}</span>
                  <span className={s.time}>{timeAgo(row.at, Date.now())}</span>
                </span>
                <span className={s.rowTitle}>{row.title}</span>
                {row.detail !== '' && <span className={s.rowDetail}>{row.detail}</span>}
              </button>
            ))
          )}
        </div>

        <div className={s.main}>
          {detail === '' ? (
            <p className={s.empty}>{ctx.i18n.t('bugs.pick')}</p>
          ) : (
            <pre className={s.pre}>{detail}</pre>
          )}
        </div>
      </div>

      <div className={s.band}>
        <span className={s.bandTitle}>{ctx.i18n.t('bugs.events')}</span>
        <span className={s.bandRows}>
          {events.length === 0
            ? ctx.i18n.t('bugs.events.empty')
            : events
                .slice(-24)
                .map((e, i) => (
                  <span key={`${e.at}-${i}`} className={s.event}>
                    {timeAgo(e.at, Date.now())} {e.what}
                    {e.detail === undefined ? '' : ` · ${e.detail}`}
                  </span>
                ))}
        </span>
      </div>
    </div>
  )
}
