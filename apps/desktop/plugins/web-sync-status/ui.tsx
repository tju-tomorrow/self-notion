import { useSyncExternalStore } from 'react'
import type { Context } from 'cordis'
import type { SyncStatus } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import * as s from './ui.css'

export interface SyncSnapshot {
  available: boolean
  status: SyncStatus | null
  triggered: boolean
}

let snapshot: SyncSnapshot = { available: false, status: null, triggered: false }
const subs = new Set<() => void>()
let triggerTimer: ReturnType<typeof setTimeout> | null = null

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot
}

export function subscribeSync(cb: () => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}

function setSyncSnapshot(patch: Partial<SyncSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const cb of subs) cb()
}

export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribeSync, getSyncSnapshot, getSyncSnapshot)
}

async function refreshSync(ctx: Context): Promise<void> {
  try {
    const status = await ctx.rpc.call<SyncStatus>('sync:status')
    setSyncSnapshot({ available: true, status })
  } catch {
    // 拿不到 = 桌面端没实现，继续轮询等引擎出现。
    setSyncSnapshot({ available: false, status: null })
  }
}

export function startSyncPolling(ctx: Context): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  async function tick(): Promise<void> {
    if (stopped) return
    await refreshSync(ctx)
    if (stopped) return
    const syncing = snapshot.status?.state === 'syncing'
    timer = setTimeout(() => void tick(), syncing ? 2000 : 4000)
  }
  void tick()
  return () => {
    stopped = true
    if (timer !== null) clearTimeout(timer)
    if (triggerTimer !== null) {
      clearTimeout(triggerTimer)
      triggerTimer = null
    }
  }
}

export function runSync(ctx: Context): void {
  setSyncSnapshot({ triggered: true })
  if (triggerTimer !== null) clearTimeout(triggerTimer)
  triggerTimer = setTimeout(() => {
    triggerTimer = null
    setSyncSnapshot({ triggered: false })
  }, 1500)
  void ctx.rpc
    .call('sync:run')
    .then(() => refreshSync(ctx))
    .catch((err: unknown) => {
      setSyncSnapshot({ triggered: false })
      reportError('web-sync-status', err)
    })
}

function labelKey(snap: SyncSnapshot): string {
  if (snap.triggered) return 'sync.triggered'
  const st = snap.status
  if (!st) return 'sync.synced'
  if (!st.online) return 'sync.offline'
  if (st.state === 'error' || st.state === 'unauthorized') return 'sync.error'
  if (st.state === 'syncing') return 'sync.syncing'
  return 'sync.synced'
}

function dotClass(snap: SyncSnapshot): string {
  if (snap.triggered) return s.dotSyncing
  const st = snap.status
  if (!st || !st.online) return s.dotOff
  if (st.state === 'error' || st.state === 'unauthorized') return s.dotError
  if (st.state === 'syncing') return s.dotSyncing
  return s.dotOk
}

export function SyncDot({ ctx }: { ctx: Context }) {
  const snap = useSyncStatus()
  if (!snap.available) return null
  return (
    <button
      type="button"
      className={s.dotBtn}
      title={ctx.i18n.t('sync.run')}
      aria-label={ctx.i18n.t('sync.run')}
      onClick={() => runSync(ctx)}
    >
      <span className={`${s.dot} ${dotClass(snap)}`} />
      <span className={s.dotLabel}>{ctx.i18n.t(labelKey(snap))}</span>
    </button>
  )
}

export function SyncSection({ ctx }: { ctx: Context }) {
  const snap = useSyncStatus()
  const st = snap.status
  if (!snap.available || !st) return null

  const rows: [string, string][] = [
    [
      ctx.i18n.t('sync.lastSync'),
      st.lastSyncAt === null ? ctx.i18n.t('sync.never') : new Date(st.lastSyncAt).toLocaleString(),
    ],
    [ctx.i18n.t('sync.pending'), String(st.pending)],
    [ctx.i18n.t('sync.conflicts'), String(st.conflicts)],
    [ctx.i18n.t('sync.blobs'), `${st.blobs.done} / ${st.blobs.total}${st.blobs.active ? ' …' : ''}`],
  ]
  if (st.error) rows.push([ctx.i18n.t('sync.errorText'), st.error])

  return (
    <div className={s.wrap}>
      {rows.map(([label, value], i) => (
        <div key={i} className={s.row}>
          <span className={s.label}>{label}</span>
          <span className={s.value}>{value}</span>
        </div>
      ))}
      <p className={s.status}>
        <span className={`${s.dot} ${dotClass(snap)}`} />
        {ctx.i18n.t(labelKey(snap))}
      </p>
      {st.online ? null : <p className={s.hint}>{ctx.i18n.t('sync.offlineHint')}</p>}
      <button type="button" className={s.btn} disabled={snap.triggered} onClick={() => runSync(ctx)}>
        {ctx.i18n.t('sync.run')}
      </button>
    </div>
  )
}
