import { useSyncExternalStore, useState } from 'react'
import type { Context } from 'cordis'
import { strToU8, zipSync, type Zippable } from 'fflate'
import type { DocMeta, DocText } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import * as s from './export.css'

let currentId: string | null = null
const docSubs = new Set<() => void>()

export function setCurrentDoc(id: string | null): void {
  if (id === currentId) return
  currentId = id
  for (const cb of docSubs) cb()
}

function useCurrentDoc(): string | null {
  return useSyncExternalStore(
    (cb) => {
      docSubs.add(cb)
      return () => void docSubs.delete(cb)
    },
    () => currentId,
    () => currentId,
  )
}

function save(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const ILLEGAL = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|'])

function safeName(title: string): string {
  let out = ''
  for (const ch of title) out += ILLEGAL.has(ch) || ch.charCodeAt(0) < 32 ? '_' : ch
  const base = out.trim().replace(/^\.+/, '').replace(/[. ]+$/, '')
  return (base || 'untitled').slice(0, 120)
}

function uniqueNames(titles: string[]): string[] {
  const used = new Set<string>()
  return titles.map((t) => {
    const base = safeName(t)
    let name = `${base}.md`
    let n = 1
    while (used.has(name)) name = `${base} (${n++}).md`
    used.add(name)
    return name
  })
}

async function exportCurrent(ctx: Context, id: string): Promise<void> {
  const docs = await ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false })
  const title = docs.find((d) => d.id === id)?.title || 'untitled'
  const { md } = await ctx.rpc.call<DocText>('doc:text', { id })
  save(`${safeName(title)}.md`, new Blob([md], { type: 'text/markdown;charset=utf-8' }))
}

async function exportAll(ctx: Context): Promise<void> {
  const docs = await ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false })
  const names = uniqueNames(docs.map((d) => d.title || 'untitled'))
  const files: Zippable = {}
  const index: string[] = []
  for (let i = 0; i < docs.length; i++) {
    const { md } = await ctx.rpc.call<DocText>('doc:text', { id: docs[i].id })
    files[names[i]] = strToU8(md)
    index.push(`${names[i]}\t${docs[i].title || ''}`)
  }
  files['index.txt'] = strToU8(index.join('\n'))
  save('self-notion.zip', new Blob([zipSync(files)], { type: 'application/zip' }))
}

export function ExportSection({ ctx }: { ctx: Context }) {
  const id = useCurrentDoc()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    void fn()
      .catch((err: unknown) => {
        reportError('export', err)
        setError(ctx.i18n.t('export.failed'))
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className={s.wrap}>
      <div className={s.row}>
        <div>
          <div className={s.title}>{ctx.i18n.t('export.current')}</div>
          <div className={s.hint}>{ctx.i18n.t('export.currentHint')}</div>
        </div>
        <button
          type="button"
          className={s.btn}
          disabled={!id || busy}
          onClick={() => {
            if (id) run(() => exportCurrent(ctx, id))
          }}
        >
          {ctx.i18n.t('export.export')}
        </button>
      </div>
      <div className={s.row}>
        <div>
          <div className={s.title}>{ctx.i18n.t('export.all')}</div>
          <div className={s.hint}>{ctx.i18n.t('export.allHint')}</div>
        </div>
        <button type="button" className={s.btn} disabled={busy} onClick={() => run(() => exportAll(ctx))}>
          {ctx.i18n.t('export.export')}
        </button>
      </div>
      {error ? <p className={s.error}>{error}</p> : null}
    </div>
  )
}
