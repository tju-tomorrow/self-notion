/**
 * 外部文件那一页（挂在 `main.home` 槽，跟 `vfs/page.tsx` 一个形状）。
 *
 * ★ 这一页列的是**挂载的文件夹**（D-0138 §1.1），不是「最近打开的文件」——
 *   展开就是磁盘上真实的目录树，`file:list` 一次只列一层。
 * ★ 界面上**如实不见**那些没有的东西（D-0140）：没有评论、没有版本历史、不进搜索、
 *   不进备份、AI 写不了它。所以这一页只有「列、开、建、挂」四件事，一件装饰都没有
 *   （用户 2026-10-07：「不要装饰，不要没作用的」）。
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Context } from 'cordis'
import { FileIconMdIcon, RemoveFolderIcon } from '@blocksuite/icons/rc'
import { OPEN_DOC, fileId, type FileEntry } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import * as s from './page.css'
import {
  addRoot,
  baseName,
  createMd,
  dirOf,
  listDir,
  loadRoots,
  refresh,
  removeRoot,
  setOpen,
  snapshot,
  subscribe,
} from './tree'

/* ── 这一页显不显：模块级状态 + 订阅（侧栏 → SHOW_LIST → 这里）。
 * 状态放模块级而不是组件里：事件可能在首页还没挂载时发（用户正在看编辑器时点侧栏）。 ── */

let on = false
const subs = new Set<() => void>()

export function setFilesPage(next: boolean) {
  if (next === on) return
  on = next
  for (const cb of subs) cb()
}

function subscribePage(cb: () => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}

const readPage = () => on

function errText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
}

/** 字节 → `4.2K`。目录没有大小，回空串。 */
function size(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / 1048576).toFixed(1)}M`
}

const isMd = (path: string) => /\.(md|markdown)$/i.test(path)

export function FilesPage({ ctx }: { ctx: Context }) {
  const active = useSyncExternalStore(subscribePage, readPage, readPage)
  return active ? <Browser ctx={ctx} /> : null
}

function Browser({ ctx }: { ctx: Context }) {
  const t = ctx.i18n.t
  const { roots, dirs, open } = useSyncExternalStore(subscribe, snapshot, snapshot)
  const [selected, setSelected] = useState<FileEntry | null>(null)
  /** 非 null = 「新建 md」那一行开着，值是**建在哪个目录**。 */
  const [creating, setCreating] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  /** 失败要响亮 —— 静默空着会被当成「文件夹里什么都没有」。 */
  const fail = useCallback((err: unknown) => {
    reportError('external-files', err)
    setError(errText(err))
  }, [])

  // 第一次进来才去取挂载的根；状态在模块级，离开再回来还在（跟 vfs 一个套路）。
  useEffect(() => {
    if (snapshot().roots !== null) return
    void loadRoots(ctx.rpc).catch(fail)
  }, [ctx, fail])

  const doRefresh = useCallback(async () => {
    try {
      await refresh(ctx.rpc)
      setError(null)
    } catch (err) {
      fail(err)
    }
  }, [ctx, fail])

  /** 点一行：选中它；是目录就展开/收起（展开时才 `file:list`，不一次拉全）。 */
  const click = useCallback(
    (entry: FileEntry) => {
      setSelected(entry)
      if (entry.kind !== 'dir') return
      const next = new Set(snapshot().open)
      if (next.has(entry.path)) next.delete(entry.path)
      else {
        next.add(entry.path)
        if (!snapshot().dirs[entry.path]) listDir(ctx.rpc, entry.path).catch(fail)
      }
      setOpen(next)
    },
    [ctx, fail],
  )

  /** 双击 `.md` → 进编辑器（`file:/abs/path` 这个 id 由契约给，别处不拼）。 */
  const openEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.kind !== 'dir' && isMd(entry.path)) ctx.emit(OPEN_DOC, { id: fileId(entry.path) })
    },
    [ctx],
  )

  const addFolder = useCallback(async () => {
    // 走系统的选文件夹框 —— dialog 插件已在 Rust 注册、capabilities 里放行了 `dialog:allow-open`。
    try {
      const picked = await invoke<string | string[] | null>('plugin:dialog|open', {
        options: { directory: true, multiple: true, title: t('files.add') },
      })
      if (picked === null) return
      for (const path of Array.isArray(picked) ? picked : [picked]) await addRoot(ctx.rpc, path)
      setError(null)
    } catch (err) {
      fail(err)
    }
  }, [ctx, fail, t])

  const dropRoot = useCallback(
    async (path: string) => {
      try {
        await removeRoot(ctx.rpc, path)
        setError(null)
      } catch (err) {
        fail(err)
      }
    },
    [ctx, fail],
  )

  /** 新文档建在：选中的是目录就建在里面，是文件就建在它旁边，什么都没选就建在第一个根下。 */
  const targetDir = (): string | null => {
    if (selected === null) return roots?.[0]?.path ?? null
    return selected.kind === 'dir' ? selected.path : dirOf(selected.path)
  }

  const create = useCallback(async () => {
    const dir = creating
    const trimmed = name.trim()
    if (dir === null || trimmed === '') return
    try {
      const entry = await createMd(ctx.rpc, dir, trimmed)
      setCreating(null)
      setName('')
      setSelected(entry)
      setError(null)
    } catch (err) {
      fail(err)
    }
  }, [ctx, creating, name, fail])

  /** 层级靠**前缀字符串**画（`├─ ` / `│  `），不靠 padding —— 这样深层子项才对得齐。 */
  const rows: ReactNode[] = []
  const walk = (path: string, prefix: string) => {
    const entries = dirs[path] ?? []
    entries.forEach((entry, i) => {
      const last = i === entries.length - 1
      const expanded = entry.kind === 'dir' && open.has(entry.path)
      rows.push(
        <button
          key={entry.path}
          type="button"
          className={`${s.row} ${selected?.path === entry.path ? s.rowOn : ''}`}
          onClick={() => click(entry)}
          onDoubleClick={() => openEntry(entry)}
          title={entry.path}
        >
          <span className={s.branch}>
            {prefix}
            {last ? '└─ ' : '├─ '}
          </span>
          <span className={entry.kind === 'dir' ? s.dir : s.fname}>
            {entry.name}
            {entry.kind === 'dir' ? '/' : ''}
          </span>
          <span className={s.meta}>{entry.kind === 'dir' ? '' : size(entry.size)}</span>
        </button>,
      )
      if (expanded) walk(entry.path, prefix + (last ? '   ' : '│  '))
    })
  }

  for (const root of roots ?? []) {
    rows.push(
      <button
        key={root.path}
        type="button"
        className={`${s.row} ${selected?.path === root.path ? s.rowOn : ''}`}
        onClick={() => click(root)}
        title={root.path}
      >
        <span className={s.dir}>{root.name}/</span>
        <span className={s.meta}>{root.path}</span>
        <span
          className={s.kill}
          title={t('files.removeRoot')}
          onClick={(e) => {
            // 它在那一行的按钮里面 —— 不拦一下会连带切一次展开。
            e.stopPropagation()
            void dropRoot(root.path)
          }}
        >
          <RemoveFolderIcon width={14} height={14} />
        </span>
      </button>,
    )
    if (open.has(root.path)) walk(root.path, '')
  }

  const target = creating ?? (roots?.length ? targetDir() : null)
  const selectedMd = selected !== null && selected.kind === 'file' && isMd(selected.path)

  return (
    <div className={s.page}>
      <div className={s.header}>
        <h1 className={s.title}>
          <FileIconMdIcon width={20} height={20} />
          {t('files.nav')}
        </h1>
        <span className={s.hint}>{t('files.hint')}</span>
        <button
          type="button"
          className={`${s.tool} ${s.toolPrimary}`}
          onClick={() => void addFolder()}
        >
          {t('files.add')}
        </button>
        <button
          type="button"
          className={s.tool}
          disabled={target === null}
          onClick={() => {
            if (target === null) return
            setName('')
            setCreating(target)
          }}
        >
          {t('files.new')}
        </button>
        <button type="button" className={s.tool} onClick={() => void doRefresh()}>
          {t('files.refresh')}
        </button>
      </div>

      {error !== null && <p className={s.error}>{error}</p>}

      <div className={s.body}>
        <div className={s.tree}>
          {creating !== null && (
            <div className={s.createBar}>
              <span className={s.createWhere} title={creating}>
                {t('files.createIn', { path: baseName(creating) || creating })}
              </span>
              <input
                autoFocus
                className={s.input}
                value={name}
                placeholder={t('files.newName')}
                onChange={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create()
                  if (e.key === 'Escape') setCreating(null)
                }}
              />
              <button type="button" className={s.tool} onClick={() => void create()}>
                {t('common.confirm')}
              </button>
              <button type="button" className={s.tool} onClick={() => setCreating(null)}>
                {t('common.cancel')}
              </button>
            </div>
          )}

          {roots === null ? (
            <p className={s.note}>{t('files.loading')}</p>
          ) : rows.length === 0 ? (
            <p className={s.note}>{t('files.empty')}</p>
          ) : (
            rows
          )}
        </div>

        <div className={s.pane}>
          <div className={s.paneHead}>
            {selected === null ? (
              t('files.pick')
            ) : (
              <>
                <span className={s.panePath}>{selected.path}</span>
                {selectedMd && (
                  <button
                    type="button"
                    className={s.paneBtn}
                    onClick={() => ctx.emit(OPEN_DOC, { id: fileId(selected.path) })}
                  >
                    {t('files.open')}
                  </button>
                )}
              </>
            )}
          </div>
          {selected === null ? (
            <p className={s.note}>{t('files.tradeoff')}</p>
          ) : (
            <dl className={s.facts}>
              <dt className={s.factKey}>{t('files.kind')}</dt>
              <dd className={s.factVal}>
                {selected.kind === 'dir' ? t('files.dir') : t('files.file')}
              </dd>
              <dt className={s.factKey}>{t('files.size')}</dt>
              <dd className={s.factVal}>{size(selected.size) || '—'}</dd>
              <dt className={s.factKey}>{t('files.mtime')}</dt>
              <dd className={s.factVal}>{new Date(selected.mtime).toLocaleString()}</dd>
              <dt className={s.factKey}>{t('files.path')}</dt>
              <dd className={s.factVal}>{selected.path}</dd>
              {selected.kind === 'file' && (
                <>
                  <dt className={s.factKey}>{t('files.open')}</dt>
                  <dd className={s.factVal}>
                    {selectedMd ? t('files.openHint') : t('files.noMd')}
                  </dd>
                </>
              )}
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}
