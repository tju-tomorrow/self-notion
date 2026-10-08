/**
 * 虚拟目录那一页（挂在 `main.home` 槽，D-0094）。
 *
 * ★ 这一页只是**看**的：`docs/vfs.md` 明说那棵目录树是给 agent grep 用的（D-0040），
 *   真正的消费者是 MCP 与内置 AI。这里把同一个投影画出来 —— 它是**核对面**：
 *   agent 看到的世界长什么样，人能自己看一眼，不用信别人的转述。
 *
 * ★ 只放**真东西**（用户 2026-10-07：「不要装饰，不要没作用的」）：
 *   - 大小列 = 投影出来的正文字节数（真的）；
 *   - 展开三层 / 收起 / 刷新 = 真的去列目录（`list`）；
 *   - 筛名字 = 真的在筛已经画出来的那些行（界面上如实写着）；
 *   - L1 / L2 = 真的换一条路径读（`/tree/x.md` ↔ `/outline/x.md`）。
 *   ✗ 没有权限位：投影没有权限，`drwxr-xr-x` 是我编的。
 *   ✗ 没有 `total`：`ls` 的 total 是那个目录的块数，这棵树上数不出那个数。
 *
 * 数据只走契约里的 `ctx.vfs`（list / read / grep），不碰 Rust 命令字符串。
 * 目录**按需展开**：`/` 只列一层，点开才 `list` 下一层。
 */
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Context } from 'cordis'
import { CodeIcon } from '@blocksuite/icons/rc'
import { DOCS_CHANGED, type VfsEntry, type VfsHit, type VfsService } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import * as s from './page.css'

/** 「展开三层」那个 3：层数有界，所以不会把整个库拉下来。 */
const LEVELS = 3

/* ── 页面级状态放模块级：离开这一页时组件会卸载，状态留在组件里就全丢了
 *  （回来得重新点一遍「展开三层」）。跟 `home.tsx` 的 `group` 一个套路。 ── */

let on = false
const subs = new Set<() => void>()

export function setVfsPage(next: boolean) {
  if (next === on) return
  on = next
  for (const cb of subs) cb()
}

function subscribe(cb: () => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}

const read = () => on

interface Tree {
  /** 已经列过的目录 → 它的直接子项。 */
  dirs: Readonly<Record<string, VfsEntry[]>>
  /** 展开着的目录。 */
  open: ReadonlySet<string>
}

let tree: Tree = { dirs: {}, open: new Set(['/tree']) }
const treeSubs = new Set<() => void>()

function publish(next: Tree) {
  tree = next
  for (const cb of treeSubs) cb()
}

function subscribeTree(cb: () => void): () => void {
  treeSubs.add(cb)
  return () => void treeSubs.delete(cb)
}

const readTree = () => tree

interface Shown {
  path: string
  text: string
}

export function VfsPage({ ctx, vfs }: { ctx: Context; vfs: VfsService }) {
  const active = useSyncExternalStore(subscribe, read, read)
  return active ? <Browser ctx={ctx} vfs={vfs} /> : null
}

/** 一行的名字 = 路径最后一段。 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** 字节 → `4.2K` 这种。 */
function size(bytes: number | undefined): string {
  if (bytes === undefined) return '-'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / 1048576).toFixed(1)}M`
}

/** `/tree/x.md` ↔ `/outline/x.md`：同一篇文档的两层，L1 只有标题行。 */
function twin(path: string): string | null {
  if (path.startsWith('/tree/')) return `/outline${path.slice('/tree'.length)}`
  if (path.startsWith('/outline/')) return `/tree${path.slice('/outline'.length)}`
  return null
}

function Browser({ ctx, vfs }: { ctx: Context; vfs: VfsService }) {
  const { dirs, open } = useSyncExternalStore(subscribeTree, readTree, readTree)
  const [shown, setShown] = useState<Shown | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  /** grep 结果。null = 没在搜（左边显示树）。 */
  const [hits, setHits] = useState<VfsHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** 失败要响亮 —— 静默空着会被当成「目录里什么都没有」（D-0045）。 */
  const fail = useCallback((err: unknown) => {
    reportError('vfs', err)
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  const readDir = useCallback(
    async (path: string) => {
      try {
        const entries = await vfs.list(path)
        publish({ dirs: { ...tree.dirs, [path]: entries }, open: tree.open })
        setError(null)
      } catch (err) {
        fail(err)
      }
    },
    [vfs, fail],
  )

  /** 把**已经列过的**那些目录重新列一遍 —— 库里改了东西之后，缓存的目录列表会过期。 */
  const refresh = useCallback(async () => {
    const paths = [...new Set(['/', '/tree', ...Object.keys(tree.dirs)])]
    try {
      const listed = await Promise.all(
        paths.map(async (path) => [path, await vfs.list(path)] as const),
      )
      const next: Record<string, VfsEntry[]> = {}
      for (const [path, entries] of listed) next[path] = entries
      publish({ dirs: next, open: tree.open })
      setError(null)
    } catch (err) {
      fail(err)
    }
  }, [vfs, fail])

  // 第一次进来才去列根和 `/tree`；之后靠缓存（状态在模块级，离开再回来还在）。
  useEffect(() => {
    if (!tree.dirs['/']) void readDir('/')
    if (!tree.dirs['/tree']) void readDir('/tree')
  }, [readDir])

  // 库里改了东西 → 重列已经展开的那些，别让这棵树停在旧形状上。
  useEffect(() => {
    const off = ctx.on(DOCS_CHANGED, () => void refresh())
    return () => void off()
  }, [ctx, refresh])

  const toggle = (path: string) => {
    const next = new Set(open)
    if (next.has(path)) next.delete(path)
    else {
      next.add(path)
      if (!dirs[path]) void readDir(path)
    }
    publish({ dirs: tree.dirs, open: next })
  }

  /** 一次铺三层：真的去列那些目录（不是假装展开）。 */
  const expandAll = useCallback(async () => {
    try {
      const next: Record<string, VfsEntry[]> = { ...tree.dirs }
      const nextOpen = new Set(tree.open)
      let frontier = ['/']
      for (let level = 0; level < LEVELS && frontier.length > 0; level++) {
        const listed = await Promise.all(
          frontier.map(async (path) => [path, next[path] ?? (await vfs.list(path))] as const),
        )
        for (const [path, entries] of listed) next[path] = entries
        const children = listed.flatMap(([, entries]) =>
          entries.filter((entry) => entry.kind === 'dir').map((entry) => entry.path),
        )
        for (const path of children) nextOpen.add(path)
        frontier = children
      }
      publish({ dirs: next, open: nextOpen })
      setError(null)
    } catch (err) {
      fail(err)
    }
  }, [vfs, fail])

  const show = useCallback(
    async (path: string) => {
      try {
        setShown({ path, text: await vfs.read(path) })
        setError(null)
      } catch (err) {
        fail(err)
      }
    },
    [vfs, fail],
  )

  const runGrep = useCallback(async () => {
    try {
      setHits(query === '' ? null : await vfs.grep(query))
      setError(null)
    } catch (err) {
      fail(err)
    }
  }, [vfs, query, fail])

  const needle = filter.trim().toLowerCase()
  const rows: ReactNode[] = []
  /** 层级靠**前缀字符串**（`├─ ` / `│  ` / `└─ `）画，不靠 padding —— 这样深层子项才对得齐。 */
  const walk = (path: string, prefix: string) => {
    // 目录永远画（它们是路径），只有文件被筛掉 —— 连接线才不会错位。
    const entries = (dirs[path] ?? []).filter(
      (entry) =>
        entry.kind === 'dir' || needle === '' || baseName(entry.path).toLowerCase().includes(needle),
    )
    entries.forEach((entry, i) => {
      const last = i === entries.length - 1
      const isDir = entry.kind === 'dir'
      const expanded = isDir && open.has(entry.path)
      rows.push(
        <button
          key={entry.path}
          type="button"
          className={`${s.row} ${shown?.path === entry.path ? s.rowOn : ''}`}
          onClick={() => (isDir ? toggle(entry.path) : void show(entry.path))}
        >
          <span className={s.branch}>
            {prefix}
            {last ? '└─ ' : '├─ '}
          </span>
          <span className={isDir ? s.dir : s.name}>
            {baseName(entry.path)}
            {isDir ? '/' : ''}
          </span>
          <span className={s.sizeCol}>{size(entry.size)}</span>
        </button>,
      )
      if (expanded) walk(entry.path, prefix + (last ? '   ' : '│  '))
    })
  }
  walk('/', '')

  const back = shown === null ? null : twin(shown.path)

  return (
    <div className={s.page}>
      <div className={s.header}>
        <h1 className={s.title}>
          <CodeIcon width={20} height={20} />
          {ctx.i18n.t('vfs.nav')}
        </h1>
        <span className={s.hint}>{ctx.i18n.t('vfs.hint')}</span>
        <div className={s.searchBox}>
          <input
            className={s.search}
            value={query}
            placeholder={ctx.i18n.t('vfs.search')}
            onChange={(e) => {
              setQuery(e.currentTarget.value)
              if (e.currentTarget.value === '') setHits(null)
            }}
            // Enter 才搜：每敲一个字就全扫一遍太吵，而且 agent 那边也是「一次一个查询」。
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runGrep()
            }}
          />
        </div>
        <button type="button" className={s.tool} onClick={() => void expandAll()}>
          {ctx.i18n.t('vfs.expand')}
        </button>
        <button type="button" className={s.tool} onClick={() => publish({ dirs, open: new Set() })}>
          {ctx.i18n.t('vfs.collapse')}
        </button>
        <button type="button" className={s.tool} onClick={() => void refresh()}>
          {ctx.i18n.t('vfs.refresh')}
        </button>
      </div>

      <div className={s.body}>
        <div className={s.tree}>
          <input
            className={s.filter}
            value={filter}
            placeholder={ctx.i18n.t('vfs.filter')}
            onChange={(e) => setFilter(e.currentTarget.value)}
          />
          {error !== null && <p className={s.error}>{error}</p>}
          {hits === null ? (
            rows.length ? (
              rows
            ) : (
              <p className={s.note}>{ctx.i18n.t('vfs.empty')}</p>
            )
          ) : hits.length ? (
            hits.map((hit, i) => (
              <button
                key={`${hit.path}:${hit.line}:${i}`}
                type="button"
                className={s.hit}
                onClick={() => void show(hit.path)}
              >
                <span className={s.hitPath}>
                  {hit.path}:{hit.line}
                </span>
                <span className={s.hitText}>{hit.text.trim()}</span>
              </button>
            ))
          ) : (
            <p className={s.note}>{ctx.i18n.t('vfs.noHit')}</p>
          )}
        </div>

        <div className={s.pane}>
          <div className={s.paneHead}>
            {shown === null ? (
              ctx.i18n.t('vfs.pick')
            ) : (
              <>
                <span className={s.panePath}>{shown.path}</span>
                <span className={s.paneMeta}>{size(shown.text.length)}</span>
              </>
            )}
            {/* L1 / L2：`/tree/` 与 `/outline/` 互为镜像，换的是路径，不是新接口。 */}
            {back !== null && (
              <button type="button" className={s.paneBtn} onClick={() => void show(back)}>
                {shown?.path.startsWith('/outline/') ? ctx.i18n.t('vfs.l2') : ctx.i18n.t('vfs.l1')}
              </button>
            )}
          </div>
          <pre className={s.text}>{shown?.text ?? ''}</pre>
        </div>
      </div>
    </div>
  )
}
