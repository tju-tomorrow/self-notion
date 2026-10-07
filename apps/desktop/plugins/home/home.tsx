/**
 * 列表页 —— 主区在**没有打开文档时**的那一页（`main.home` 槽）。
 *
 * 一页 = 一个分组（`ListGroup`）：全部文档 / 最近 / 收藏 / 置顶 / 回收站。侧栏点导航行会广播
 * `SHOW_LIST`，这里据此换分组（C12）。结构照 AFFiNE 的 `AllDocsHeader` + `ListViewDoc`。
 *
 * 一行一篇文档（图标 / 标题 / 正文摘要 / 更新·创建时间 / 收藏 / ⋯），按更新时间分
 * 「今天 / 更早 / 从未更新」。数据一次全量 `doc:list`，分组与筛选的纯函数在 `./group.ts`。
 *
 * 打开文档走契约里那条广播 `OPEN_DOC` —— 和侧栏同一条路，不直接调标签条。
 */
import type { Context } from 'cordis'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
  type UIEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  AllDocsIcon,
  AutoTidyUpIcon,
  DateTimeIcon,
  DeletePermanentlyIcon,
  FavoriteIcon,
  FavoritedIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PageIcon,
  PlusIcon,
  PropertyIcon,
  ResetIcon,
  ResizeTidyUpIcon,
} from '@blocksuite/icons/rc'
import {
  DOCS_CHANGED,
  OPEN_DOC,
  type DocMeta,
  type DocSummary,
  type ListGroup,
} from '../../src/kernel/contract'
import { buildSections, filterGroup, timeAgo, type OrderKey } from './group'
import { fullTime } from '../../src/ui/timeago'
import { itemHeight, layout, windowRange, type Item } from './virtual'
import { confirmDialog } from '../../src/ui/confirm'
import { readLocal, writeLocal } from '../../src/kernel/local'
import { reportError } from '../../src/kernel/errors'
import { DocMenu, InlineRename, subtreeIds, useDocMenu } from '../../src/ui/doc-menu'
import { toast } from '../../src/ui/toast'
import * as s from './home.css'

/** 行首那颗文档图标 24（AFFiNE 的 `listIcon`）；视图切换的图标 16，塞在 24 的格子里
 *  （它的 `viewToggleItem` 是 `fontSize: 16` + `width: 24`）。两个不是一个尺寸。 */
const ROW_ICON = 24
const VIEW_ICON = 16

/* ── 当前分组：模块级状态 + 订阅（侧栏 → SHOW_LIST → 这里） ──
 * 状态放模块级而不是组件里：事件可能在首页还没挂载时发（用户正在看编辑器时点侧栏），
 * 组件里存就丢了。 */

let group: ListGroup = 'all'
const groupSubs = new Set<() => void>()

/** 侧栏点了导航行 → 换分组。 */
export function setListGroup(next: ListGroup) {
  if (next === group) return
  group = next
  for (const cb of groupSubs) cb()
}

function subscribeGroup(cb: () => void): () => void {
  groupSubs.add(cb)
  return () => void groupSubs.delete(cb)
}

function currentGroup(): ListGroup {
  return group
}

/** 三个视图图标照 AFFiNE 的 `DocListViewIcon`；masonry 走 CSS 多列（C15）。 */
const VIEWS = [
  { key: 'masonry', Icon: AutoTidyUpIcon },
  { key: 'grid', Icon: ResizeTidyUpIcon },
  { key: 'list', Icon: PropertyIcon },
] as const
type View = (typeof VIEWS)[number]['key']

/**
 * 挂在触发元素旁边的小浮层。**portal 到 body**：留在滚动容器里会被 `overflow: auto` 裁掉。
 * 坐标由 JS 算（唯一一处内联样式），点击别处 / Esc 关。
 */
function Popover({
  trigger,
  open,
  onClose,
  children,
}: {
  trigger: ReactNode
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const anchor = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setAt(null)
      return
    }
    const rect = anchor.current?.getBoundingClientRect()
    if (rect) setAt({ top: rect.bottom + 8, right: window.innerWidth - rect.right })

    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      // 触发按钮和菜单本身都不算「别处」，否则点一下会先关再开。
      if (!anchor.current?.contains(target) && !panel.current?.contains(target)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  return (
    <>
      {/* portal 里的事件仍然冒泡回 React 父节点，所以这里要挡住 —— 否则菜单项会顺手把文档打开。 */}
      <div className={s.popWrap} ref={anchor} onClick={(e) => e.stopPropagation()}>
        {trigger}
      </div>
      {open && at
        ? createPortal(
            <div
              className={s.menu}
              ref={panel}
              style={{ top: at.top, right: at.right }}
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

/**
 * 正文摘要：**只给要显示的那几行取**，取过的留在缓存里。
 *
 * 原来一次 batch 当前分组的全部文档 —— 几千篇的库里切一次分组就发一条几千 id 的请求，
 * 回来还得整体重渲。现在跟着窗口走：滚到哪儿取哪儿（C14 的摘要也是这么才有意义）。
 * `DOCS_CHANGED` 一到（别处改过名 / 编辑过正文）整片作废，下次渲染重取可见那几行。
 */
function useSummaries(ctx: Context, ids: readonly string[]): (id: string) => string {
  const cache = useRef(new Map<string, string>())
  /** 问过但库里没有正文的（空文档）—— 记下来，不然每次渲染都要再问一遍。 */
  const asked = useRef(new Set<string>())
  const [, bump] = useState(0)
  // 依赖用 id 串：`ids` 每次渲染都是新数组，直接当依赖会转圈。
  const key = ids.join(',')

  useEffect(() => {
    const off = ctx.on(DOCS_CHANGED, () => {
      cache.current.clear()
      asked.current.clear()
      bump((n) => n + 1)
    })
    return () => void off()
  }, [ctx])

  useEffect(() => {
    const wanted = key === '' ? [] : key.split(',')
    const missing = wanted.filter((id) => !cache.current.has(id) && !asked.current.has(id))
    if (missing.length === 0) return
    for (const id of missing) asked.current.add(id)
    let live = true
    // 失败不吞：让 rejection 冒到全局处理器，落进 errors.log（D-0045）
    void ctx.rpc.call<DocSummary[]>('doc:summary', { ids: missing }).then((rows) => {
      if (!live) return
      for (const row of rows) cache.current.set(row.id, row.body)
      bump((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [ctx, key])

  return (id) => cache.current.get(id) ?? ''
}

/** 勾那块往外放宽的像素：差几个像素不算差。 */
const SLACK = 6

/**
 * 这一下是不是冲左边那一格（勾）来的 —— **算坐标，不认事件的 target**。
 *
 * 为什么不用 `closest('[data-check]')`：那要求指针恰好落在元素盒子上。用户看到的是
 * 16 的方框，点的时候偏几像素就落到行上 —— 行一接就把文档打开了（用户：「点不到，
 * 一点就进入页面」）。按坐标算的话，左边这一段（`SLACK` 以内）全是勾。
 */
function inCheckSlot(e: ReactMouseEvent<HTMLElement>): boolean {
  const box = e.currentTarget.querySelector('[data-check]')
  if (box === null) return false
  const r = box.getBoundingClientRect()
  return (
    e.clientX >= r.left - SLACK &&
    e.clientX <= r.right + SLACK &&
    e.clientY >= r.top - SLACK &&
    e.clientY <= r.bottom + SLACK
  )
}

/**
 * 列表的滚动窗口。行高固定，所以不用量元素，只量容器高度 + scrollTop。
 * 挂在 `attach` 上的 ResizeObserver 要**跟着节点走** —— 列表空 → 有内容是同一个组件
 * 换了一块 DOM，用 `useEffect` 只在挂载时订阅一次就会订阅到已经卸掉的节点。
 */
function useWindow(items: readonly Item[]) {
  // 每帧一次滚动 → 这里也得 memo，不然每帧重算一遍几千条的前缀和
  const { tops, total } = useMemo(() => layout(items), [items])
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)

  const attach = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (el === null) return
    setViewH(el.clientHeight)
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    observer.current = ro
  }, [])

  const { start, end } = windowRange(items, tops, scrollTop, viewH)
  return {
    attach,
    tops,
    total,
    start,
    end,
    onScroll: (e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop),
  }
}

/**
 * `main.home` 这一格的守门人。
 *
 * ★ 同一个槽里的**每一项都会渲染** —— 虚拟目录那一页由 `plugin-vfs` 也注册在这里，
 *   所以停在 `vfs` 分组时这边必须让开，不然两页会叠在一起。
 */
export function HomePage({ ctx }: { ctx: Context }) {
  const active = useSyncExternalStore(subscribeGroup, currentGroup, currentGroup)
  return active === 'vfs' ? null : <Home ctx={ctx} />
}

export function Home({ ctx }: { ctx: Context }) {
  const [docs, setDocs] = useState<readonly DocMeta[]>([])
  const [error, setError] = useState<string | null>(null)
  const active = useSyncExternalStore(subscribeGroup, currentGroup, currentGroup)
  const [view, setView] = useState<View>(() => readLocal('sn.home.view', 'list'))
  const [grouped, setGrouped] = useState(() => readLocal('sn.home.grouped', true))
  const [order, setOrder] = useState<OrderKey>(() => readLocal('sn.home.order', 'updatedAt'))
  const [filter, setFilter] = useState('')

  // 视图 / 分组 / 排序落盘：这仨是「我怎么看我的库」的偏好，不该每次重开重来。
  useEffect(() => {
    writeLocal('sn.home.view', view)
    writeLocal('sn.home.grouped', grouped)
    writeLocal('sn.home.order', order)
  }, [view, grouped, order])
  /** 同时只开一个浮层：`'display'` 或某篇文档的 id。 */
  const [open, setOpen] = useState<string | null>(null)
  /** 正在原地改名的那一行。菜单里点「重命名」也走这里。 */
  const [renaming, setRenaming] = useState<string | null>(null)
  // 右键 / 点 ⋯ 弹的菜单。
  const { menu, openFromEvent, openFromButton, closeMenu } = useDocMenu()
  /** 勾上的那几篇。**没有「选择模式」这道门** —— 勾本身在行/卡片上悬停就出现，入口不占地方。 */
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  /** ⇧ 连选量到哪儿为止（上一颗碰过的）。放 ref：它只是计算的起点，变了不用重画。 */
  const anchor = useRef<string | null>(null)

  // 一次取全量（含回收站），分组在前端切 —— 这样切分组不用再往返一次。
  const reload = useCallback(async () => {
    setDocs(await ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: true }))
  }, [ctx])

  /** 失败要响亮：静默空着会被当成「库空了」。 */
  const run = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn()
      setError(null)
    } catch (err) {
      reportError('home', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  /**
   * 合并一串刷新请求。`DOCS_CHANGED` 是**没带载荷**的广播，写库的人可能连着发很多条
   * （导入几百篇、批量删除），每条都去 `doc:list` 拉一次全量纯属浪费 —— 攒到这一轮
   * 事件循环末尾再拉一次，结果一样。
   */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reloadSoon = useCallback(() => {
    if (pending.current !== null) return
    pending.current = setTimeout(() => {
      pending.current = null
      void run(reload)
    }, 0)
  }, [run, reload])

  useEffect(() => {
    return () => {
      if (pending.current !== null) clearTimeout(pending.current)
    }
  }, [])

  /** 写完之后刷新并广播 —— 侧栏/标签条跟着变（跨插件）。自己的广播同样落到 `reloadSoon`。 */
  const refresh = useCallback(() => {
    ctx.emit(DOCS_CHANGED)
    reloadSoon()
  }, [ctx, reloadSoon])

  useEffect(() => {
    void run(reload)
  }, [run, reload])

  // 别处写库（侧栏改名 / 删除…）也广播 —— 首页跟着重取。
  useEffect(() => {
    const off = ctx.on(DOCS_CHANGED, reloadSoon)
    return () => void off()
  }, [ctx, reloadSoon])

  /**
   * ★ 这三层必须 memo：滚动是**每帧一次 setState**，不 memo 的话每帧都要重排一遍
   *   整个文档库（几千条 sort + 分组），滚动就废了。
   *   `Date.now()` 进不了依赖（每秒都变）—— 分组只看「今天 / 今天之前」这条界，
   *   换成下次数据变化时再重算，用户看不出来。
   */
  const visible = useMemo(() => {
    const base = filterGroup(docs, active)
    const q = filter.trim().toLowerCase()
    return q === '' ? base : base.filter((doc) => doc.title.toLowerCase().includes(q))
  }, [docs, active, filter])

  const close = useCallback(() => setOpen(null), [])
  const toggle = useCallback((key: string) => setOpen((cur) => (cur === key ? null : key)), [])

  /**
   * 选中的那几行 —— **按当前列表算**，不是按 id 集合算：筛选框一改，屏幕上没有的行就
   * 自动掉出选中（否则「全选 + 删除」会把看不见的篇也删了）。侧栏换分组时整组清空。
   */
  const pickedDocs = useMemo(() => visible.filter((doc) => picked.has(doc.id)), [visible, picked])
  const allPicked = pickedDocs.length > 0 && pickedDocs.length === visible.length

  const clearPick = useCallback(() => {
    anchor.current = null
    setPicked(new Set())
  }, [])

  useEffect(() => clearPick(), [active, clearPick])

  // Esc 清掉选中的那几篇 —— 跟其它浮层同一个键。
  useEffect(() => {
    if (picked.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearPick()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [picked, clearPick])

  const togglePick = useCallback((id: string) => {
    anchor.current = id
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** ⇧ 连选：从「上一颗碰过的」到这一行，**整段替掉**当前选中（Finder / Notion 同一条规矩）。
   *  没碰过任何一颗就当成选它一个。锚点不动 —— 所以再 ⇧ 点别处是从同一头重新量。 */
  const pickRange = useCallback(
    (id: string) => {
      const to = visible.findIndex((doc) => doc.id === id)
      if (to < 0) return
      // 锚点已经不在这一页了（筛掉了 / 换了分组）——就当没锚点，选它一个。
      const from = anchor.current === null ? to : visible.findIndex((d) => d.id === anchor.current)
      if (from < 0) {
        anchor.current = id
        setPicked(new Set([id]))
        return
      }
      const [lo, hi] = from <= to ? [from, to] : [to, from]
      anchor.current = anchor.current ?? id
      setPicked(new Set(visible.slice(lo, hi + 1).map((doc) => doc.id)))
    },
    [visible],
  )

  const toggleAll = useCallback(() => {
    setPicked((cur) =>
      visible.every((doc) => cur.has(doc.id)) ? new Set() : new Set(visible.map((doc) => doc.id)),
    )
  }, [visible])

  /** ⌘A 全选。**光标在输入框里就不抢**（筛选框、正在改名的那个输入框都要能用 ⌘A）。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a') return
      const el = document.activeElement
      if (
        el instanceof HTMLElement &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      ) {
        return
      }
      if (visible.length === 0) return
      e.preventDefault()
      setPicked(new Set(visible.map((doc) => doc.id)))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [visible])

  const create = () =>
    void run(async () => {
      const doc = await ctx.rpc.call<DocMeta>('doc:create', { parentId: null, title: '' })
      refresh()
      ctx.emit(OPEN_DOC, { id: doc.id })
    })

  const favorite = (doc: DocMeta) =>
    run(async () => {
      await ctx.rpc.call('doc:favorite', { id: doc.id, value: !doc.isFavorite })
      refresh()
    })

  const restore = (doc: DocMeta) =>
    void run(async () => {
      await ctx.rpc.call('doc:restore', { id: doc.id })
      refresh()
    })

  /** 硬删除 —— **不落回收站，没有撤销这条路**，所以拦一道确认。 */
  const remove = async (doc: DocMeta) => {
    const name = doc.title || ctx.i18n.t('sidebar.untitled')
    const kids = subtreeIds(docs, doc.id).size - 1
    const ok = await confirmDialog({
      title:
        kids > 0
          ? ctx.i18n.t('sidebar.confirm-remove-sub', { title: name, n: kids })
          : ctx.i18n.t('sidebar.confirm-remove', { title: name }),
      ok: ctx.i18n.t('common.delete'),
      danger: true,
    })
    if (!ok) return
    void run(async () => {
      await ctx.rpc.call('doc:remove', { id: doc.id })
      refresh()
      toast({ text: ctx.i18n.t('sidebar.removed', { title: name }) })
    })
  }

  /**
   * 批量删除。逐条发 `doc:trash` / `doc:remove` —— 那两条命令本身就是**按子树**改的，
   * 父与子同时在选中里也只是各跑一遍（第二遍是空集），所以不用去重、不用排顺序。
   * 篇数多的时候会慢一点（一条一个小事务），好处是库不被一把大事务按着不放。
   */
  const removeMany = async () => {
    const targets = pickedDocs
    if (targets.length === 0) return
    // 回收站里没有「回收」这道缓冲 —— 这里是真删，词也跟着换。
    const hard = active === 'trash'
    const ok = await confirmDialog({
      title: ctx.i18n.t(hard ? 'home.select.confirm-remove' : 'home.select.confirm-trash', {
        n: targets.length,
      }),
      ok: ctx.i18n.t(hard ? 'common.delete' : 'sidebar.trash'),
      danger: true,
    })
    if (!ok) return
    void run(async () => {
      for (const doc of targets) {
        await ctx.rpc.call(hard ? 'doc:remove' : 'doc:trash', { id: doc.id })
      }
      clearPick()
      refresh()
      toast({
        text: ctx.i18n.t(hard ? 'home.select.removed' : 'home.select.trashed', { n: targets.length }),
      })
    })
  }

  /** 回收站整仓操作（原来只在侧栏那个分组里，主区这一页反而没有）。 */
  const emptyTrash = async () => {
    const n = docs.filter((doc) => doc.deletedAt !== null).length
    const ok = await confirmDialog({
      title:
        n > 0 ? ctx.i18n.t('sidebar.confirm-empty-count', { n }) : ctx.i18n.t('sidebar.confirm-empty'),
      ok: ctx.i18n.t('common.emptyTrash'),
      danger: true,
    })
    if (!ok) return
    void run(async () => {
      await ctx.rpc.call('doc:emptyTrash')
      refresh()
      toast({ text: ctx.i18n.t('sidebar.emptied', { n }) })
    })
  }

  const restoreTrash = () =>
    void run(async () => {
      await ctx.rpc.call('doc:restoreTrash')
      refresh()
    })

  const now = Date.now()
  const groupedNow = grouped && active === 'all'
  // 「全部文档」才按更新时间分组；其余分组本身就是一种筛选，再分组没意义。
  const sections = useMemo(
    () => buildSections(visible, order, groupedNow, Date.now()),
    [visible, order, groupedNow],
  )

  /** 列表视图拍平成一维（分组标题也是其中一条）—— 虚拟滚动只认这个数组。 */
  const items = useMemo(() => {
    const out: Item[] = []
    if (view !== 'list') return out
    if (groupedNow) {
      for (const section of sections) {
        if (section.key !== null) {
          out.push({
            kind: 'head',
            key: `head:${section.key}`,
            section: section.key,
            count: section.docs.length,
          })
        }
        for (const doc of section.docs) out.push({ kind: 'doc', key: doc.id, doc })
      }
    } else {
      for (const doc of visible) out.push({ kind: 'doc', key: doc.id, doc })
    }
    return out
  }, [view, sections, groupedNow, visible])

  const win = useWindow(items)
  const shown = items.slice(win.start, win.end)
  // 摘要只问窗口里这几行的；卡片视图没有窗口，退回整页
  const summaryOf = useSummaries(
    ctx,
    view === 'list'
      ? shown.flatMap((item) => (item.kind === 'doc' ? [item.doc.id] : []))
      : visible.map((doc) => doc.id),
  )

  const label = (doc: DocMeta) => doc.title || ctx.i18n.t('sidebar.untitled')
  const bodyOf = (doc: DocMeta) => summaryOf(doc.id)
  const favLabel = (doc: DocMeta) =>
    ctx.i18n.t(doc.isFavorite ? 'home.unfavorite' : 'sidebar.favorite')

  /** 一行/一张卡上的标题。正在改名就换成输入框（菜单里点「重命名」也会到这儿）。 */
  const titleOf = (doc: DocMeta, cls: string) =>
    renaming === doc.id ? (
      <InlineRename ctx={ctx} doc={doc} className={cls} onDone={() => setRenaming(null)} />
    ) : (
      <span className={cls}>{label(doc)}</span>
    )

  /** 星标 + ⋯。⋯ 弹的是**跟右键同一个菜单**（`src/ui/doc-menu.tsx`），不再各攒一份。 */
  const rowActions = (doc: DocMeta) => (
    <span className={s.rowActions}>
      <button
        type="button"
        className={doc.isFavorite ? s.starOn : s.iconBtn}
        title={favLabel(doc)}
        onClick={(e) => {
          e.stopPropagation()
          void favorite(doc)
        }}
      >
        {doc.isFavorite ? (
          <FavoritedIcon width={16} height={16} />
        ) : (
          <FavoriteIcon width={16} height={16} />
        )}
      </button>
      <button
        type="button"
        className={s.iconBtn}
        title={ctx.i18n.t('home.more')}
        onClick={(e) => openFromButton(e, doc)}
      >
        <MoreHorizontalIcon width={16} height={16} />
      </button>
    </span>
  )

  /** 回收站里的行：只有恢复 / 删除两个动作（那两行的意义就是它们）。 */
  const trashActions = (doc: DocMeta) => (
    <span className={s.rowActions}>
      <button
        type="button"
        className={s.iconBtn}
        title={ctx.i18n.t('sidebar.restore')}
        onClick={(e) => {
          e.stopPropagation()
          void restore(doc)
        }}
      >
        <ResetIcon width={16} height={16} />
      </button>
      <button
        type="button"
        className={s.iconBtn}
        title={ctx.i18n.t('sidebar.remove')}
        onClick={(e) => {
          e.stopPropagation()
          remove(doc)
        }}
      >
        <DeletePermanentlyIcon width={16} height={16} />
      </button>
    </span>
  )

  const actionsFor = (doc: DocMeta) => (active === 'trash' ? trashActions(doc) : rowActions(doc))

  /**
   * 那一格。外面这层只管「看得见、鼠标在那块儿」，**点一下归谁管不靠它**
   * （见 `openOrPick`：按坐标判）—— 依赖「点中了哪个元素」太脆：偏几个像素
   * 落到行上就把文档打开了，用户看到的就是「点不到，一点就进页面」。
   */
  const check = (doc: DocMeta) => (
    <span
      className={`${s.checkHit} ${picked.has(doc.id) ? s.checkOn : ''}`}
      data-check=""
    >
      <input
        type="checkbox"
        className={s.check}
        checked={picked.has(doc.id)}
        aria-label={label(doc)}
        onChange={() => togglePick(doc.id)}
      />
    </span>
  )

  // 图标跟勾同一格 —— 勾露出来的时候图标让位（`iconYield`），已经勾上的就一直让着。
  const icon = (doc: DocMeta, size: number) => (
    <span
      className={`${s.rowIcon} ${s.iconYield} ${picked.has(doc.id) ? s.iconGone : ''}`}
    >
      {doc.icon ?? <PageIcon width={size} height={size} />}
    </span>
  )

  /**
   * 点一行 / 一张卡干什么 —— **全按坐标和修饰键判，不看事件打在哪个元素上**：
   *  - ⇧ = 从上一颗连选到这儿；
   *  - 点在左边那一格（勾那块，四周再放宽 `SLACK`）/ ⌘⌃ / **已经在批量里了**（已选 ≥1）
   *    = 加一颗或减一颗；
   *  - 其余 = 打开这篇。
   * 「进批量」就是 ⇧ / ⌘A / 悬停那一下勾 —— 进了之后点哪儿都是在选（要打开先 esc 退出）。
   */
  const openOrPick = (e: ReactMouseEvent<HTMLElement>, doc: DocMeta) => {
    if (e.shiftKey) pickRange(doc.id)
    else if (inCheckSlot(e) || e.metaKey || e.ctrlKey || picked.size > 0) togglePick(doc.id)
    else ctx.emit(OPEN_DOC, { id: doc.id })
  }

  const row = (doc: DocMeta) => (
    <div
      key={doc.id}
      className={s.row}
      onClick={(e) => openOrPick(e, doc)}
      onContextMenu={(e) => openFromEvent(e, doc)}
    >
      {check(doc)}
      {icon(doc, ROW_ICON)}
      <span className={s.rowBrief}>
        {titleOf(doc, s.rowTitle)}
        {bodyOf(doc) !== '' && <span className={s.rowSummary}>{bodyOf(doc)}</span>}
      </span>
      <span className={s.rowDates}>
        <span
          className={s.rowDate}
          title={`${ctx.i18n.t('home.updatedAt')} ${fullTime(doc.updatedAt)}`}
        >
          {/* 图标认时间、文字认哪个时间 ——「更新 / 创建」这两个字必须写出来（用户）。 */}
          <HistoryIcon className={s.rowDateIcon} width={14} height={14} />
          <span className={s.rowDateLabel}>{ctx.i18n.t('home.updatedShort')}</span>
          <span className={s.rowDateValue}>{timeAgo(doc.updatedAt, now)}</span>
        </span>
        <span
          className={s.rowDate}
          title={`${ctx.i18n.t('home.createdAt')} ${fullTime(doc.createdAt)}`}
        >
          <DateTimeIcon className={s.rowDateIcon} width={14} height={14} />
          <span className={s.rowDateLabel}>{ctx.i18n.t('home.createdShort')}</span>
          <span className={s.rowDateValue}>{timeAgo(doc.createdAt, now)}</span>
        </span>
      </span>
      {actionsFor(doc)}
    </div>
  )

  const card = (doc: DocMeta, cls: string = s.card) => (
    <div
      key={doc.id}
      className={cls}
      onClick={(e) => openOrPick(e, doc)}
      onContextMenu={(e) => openFromEvent(e, doc)}
    >
      <div className={s.cardHead}>
        {check(doc)}
        {icon(doc, 24)}
        {titleOf(doc, s.cardTitle)}
        {actionsFor(doc)}
      </div>
      {bodyOf(doc) !== '' && <div className={s.cardBody}>{bodyOf(doc)}</div>}
    </div>
  )

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div className={s.tabs}>
          {/* 列表页标题 = 当前分组名。分组名跟侧栏同一套词条（all 那一页侧栏叫 tree）。 */}
          <span className={s.headTitle}>
            {ctx.i18n.t(`sidebar.group.${active === 'all' ? 'tree' : active}`)}
          </span>
        </div>

        <div className={s.actions}>
          {/* 筛选：库里几百篇时只靠滚动找太累，⌘K 又得先想起关键词。 */}
          <input
            className={s.filter}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={ctx.i18n.t('home.filter')}
            spellCheck={false}
          />
          {active === 'trash' && visible.length > 0 ? (
            <>
              <button type="button" className={s.ghostBtn} onClick={restoreTrash}>
                {ctx.i18n.t('sidebar.trash.restoreAll')}
              </button>
              <button type="button" className={s.ghostBtn} onClick={() => void emptyTrash()}>
                {ctx.i18n.t('sidebar.trash.empty')}
              </button>
            </>
          ) : null}
          <div className={s.viewToggle}>
            {VIEWS.map(({ key, Icon }) => (
              <button
                key={key}
                type="button"
                className={view === key ? s.viewOn : s.iconBtn}
                title={ctx.i18n.t(`home.view.${key}`)}
                onClick={() => setView(key)}
              >
                <Icon width={VIEW_ICON} height={VIEW_ICON} />
              </button>
            ))}
          </div>

          <Popover
            open={open === 'display'}
            onClose={close}
            trigger={
              <button type="button" className={s.ghostBtn} onClick={() => toggle('display')}>
                {ctx.i18n.t('home.display')}
              </button>
            }
          >
            <span className={s.menuLabel}>{ctx.i18n.t('home.display.group')}</span>
            <span className={s.segRow}>
              <button
                type="button"
                className={grouped ? s.segOn : s.seg}
                onClick={() => setGrouped(true)}
              >
                {ctx.i18n.t('home.display.group.on')}
              </button>
              <button
                type="button"
                className={grouped ? s.seg : s.segOn}
                onClick={() => setGrouped(false)}
              >
                {ctx.i18n.t('home.display.group.off')}
              </button>
            </span>
            <span className={s.menuLabel}>{ctx.i18n.t('home.display.order')}</span>
            <span className={s.segRow}>
              <button
                type="button"
                className={order === 'updatedAt' ? s.segOn : s.seg}
                onClick={() => setOrder('updatedAt')}
              >
                {ctx.i18n.t('home.display.order.updated')}
              </button>
              <button
                type="button"
                className={order === 'createdAt' ? s.segOn : s.seg}
                onClick={() => setOrder('createdAt')}
              >
                {ctx.i18n.t('home.display.order.created')}
              </button>
            </span>
          </Popover>

          {/* 「收藏」「置顶」和「回收站」是**从已有的来**的列表（用户：收藏不需要可以新建）——
              这几页不给新建按钮。全部文档 / 最近照旧。 */}
          {active === 'favorite' || active === 'pinned' || active === 'trash' ? null : (
            <button type="button" className={s.newDocBtn} onClick={create}>
              <PlusIcon width={16} height={16} />
              {ctx.i18n.t('home.new')}
            </button>
          )}
        </div>
      </div>

      <div className={s.body}>
        {error !== null && <p className={s.error}>{error}</p>}
        {visible.length === 0 ? (
          <div className={s.empty}>
            <AllDocsIcon width={64} height={64} />
            <p className={s.emptyText}>
              {ctx.i18n.t(active === 'all' ? 'home.empty' : `home.empty.${active}`)}
            </p>
          </div>
        ) : (
          <div
            className={`${s.scroll} ${pickedDocs.length > 0 ? s.scrollPicked : ''}`}
            ref={win.attach}
            onScroll={win.onScroll}
          >
            {view === 'list' ? (
              // 只挂窗口里这几条，用 `top` 摆到位（间隔已经算进 `top` 里了）
              <div className={s.window} style={{ height: win.total }}>
                {shown.map((item, i) => (
                  <div
                    key={item.key}
                    className={s.slot}
                    style={{ top: win.tops[win.start + i], height: itemHeight(item) }}
                  >
                    {item.kind === 'head' ? (
                      <div className={s.groupHead}>
                        <span className={s.groupBar} />
                        <span className={s.groupLabel}>
                          {ctx.i18n.t(`home.group.${item.section}`)}
                        </span>
                        <span className={s.groupCount}>{item.count}</span>
                        <span className={s.groupRule} />
                      </div>
                    ) : (
                      row(item.doc)
                    )}
                  </div>
                ))}
              </div>
            ) : view === 'masonry' ? (
              <div className={s.masonry}>{visible.map((doc) => card(doc, s.masonryCard))}</div>
            ) : (
              <div className={s.grid}>{visible.map((doc) => card(doc))}</div>
            )}
          </div>
        )}
      </div>

      {/* 选中 ≥1 篇才冒出来的那一条。它就在光标附近、不占工具栏的位，
          也不跟右下的 toast 撞 —— 删完它自己就漏了。 */}
      {pickedDocs.length > 0 ? (
        <div className={s.picker}>
          <div className={s.pickerBar} title={ctx.i18n.t('home.select.hint')}>
            <span className={s.selectCount}>
              {ctx.i18n.t('home.select.count', { n: pickedDocs.length })}
            </span>
            <button
              type="button"
              className={s.ghostBtn}
              title="⌘A"
              onClick={toggleAll}
            >
              {ctx.i18n.t(allPicked ? 'home.select.none' : 'home.select.all')}
            </button>
            <button type="button" className={s.dangerBtn} onClick={() => void removeMany()}>
              {ctx.i18n.t(active === 'trash' ? 'home.select.remove' : 'home.select.trash')}
            </button>
            <button type="button" className={s.ghostBtn} title="esc" onClick={clearPick}>
              {ctx.i18n.t('common.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {menu && (
        <DocMenu
          ctx={ctx}
          menu={menu}
          docs={docs}
          onClose={closeMenu}
          onRename={(doc) => setRenaming(doc.id)}
        />
      )}
    </div>
  )
}
