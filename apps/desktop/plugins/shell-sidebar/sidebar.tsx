/**
 * 侧栏：工作区行 + 搜索行 + 五个导航项（全部文档 / 最近 / 收藏 / 置顶 / 回收站），
 * 可滚区是四段可折叠分组（收藏 / 文件夹 / 标签 / 合集）+ 文档树。
 *
 * 形状**照 AFFiNE 的 `RootAppSidebar`**：上不滚的那截（工作区 / 搜索 / 导航）
 * 加下面可滚的那截（分组标题 + 树）。原来那种「四个小胶囊按钮切分组」不是人家的做法 ——
 * AFFiNE 是一行一个图标 + 文字，30 高、圆角 4，选中那行才压一层底色。
 *
 * 数据全部来自 `ctx.rpc.call('doc:list', { includeTrashed: true })` 一次全量，
 * 分组与树在前端切；写操作走 `doc:create` / `doc:rename` / `doc:trash` /
 * `doc:restore` / `doc:favorite`（命令表见 docs/execution-plan.md §6.2）。
 * **硬删除（`doc:remove`）不在这儿** —— 回收站整页在主区（`plugins/home`），侧栏不再列它。
 *
 * 「点了某篇文档」**不直接调标签条** —— 用契约里的 `ctx.emit(OPEN_DOC, { id })` 广播。
 *
 * 树怎么搭 / 分组怎么筛在 `./tree.ts`（纯函数，能单独断言）；怎么画在这里。
 */
import type { Context } from 'cordis'
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import {
  AllDocsIcon,
  ArrowDownSmallIcon,
  CodeIcon,
  CollectionsIcon,
  DeleteTemporarilyIcon,
  FileIconMdIcon,
  FolderIcon,
  HistoryIcon,
  PageIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  TagsIcon,
  ToggleRightIcon,
} from '@blocksuite/icons/rc'
import { CLOSE_ALL, DOCS_CHANGED, OPEN_DOC, SHOW_LIST, type ListGroup } from '../../src/kernel/contract'
import { reportError, reportNote } from '../../src/kernel/errors'
import { readLocal, writeLocal } from '../../src/kernel/local'
import { DocMenu, useDocMenu } from '../../src/ui/doc-menu'
import { toast } from '../../src/ui/toast'
import { buildTree, favorites, pinned, recent, type DocMeta, type DocNode } from './tree'
import * as s from './sidebar.css'

type Group = 'tree' | 'recent' | 'favorite' | 'pinned' | 'trash'

/** 拖到一行上松手会干什么：插到它前面 / 后面（同层），或者**成为它的子页面**。 */
type DropMode = 'before' | 'after' | 'child'

const GROUPS: readonly Group[] = ['tree', 'recent', 'favorite', 'pinned', 'trash']

/** 拖拽时跟着光标的那张浮动卡片。拖完（`dragend`）才收 —— **拖拽中途不能删它**：
 *  WebKit 里把拖影节点从 DOM 里拿掉，这一整次拖拽可能当场被取消（落点事件就全没了）。 */
let dragGhost: HTMLElement | null = null

function dropGhost(): void {
  dragGhost?.remove()
  dragGhost = null
}

/** 导航项的图标 —— 一个分组一个，跟 AFFiNE 的 MenuItem 同一个位置。 */
const GROUP_ICON: Readonly<Record<Group, typeof AllDocsIcon>> = {
  tree: AllDocsIcon,
  recent: HistoryIcon,
  favorite: StarIcon,
  pinned: PinIcon,
  trash: DeleteTemporarilyIcon,
}

const GROUP_KEY = 'sidebar.group'

const ICON = 20

/** 上次停在哪个分组。settings 的 `get` 是同步的，装载时不回读（见 plugin-settings 的注释），
 *  所以这里主要是「同一次会话里卸载再装回来还停在原处」，不是持久化保证。 */
function readGroup(ctx: Context): Group {
  const saved = ctx.settings.get<Group>(GROUP_KEY)
  return saved && GROUPS.includes(saved) ? saved : 'tree'
}

/** 分组里的每一项都当成「没有子节点」的行来画 —— 复用同一个 renderRow。 */
const asLeaf = (doc: DocMeta): DocNode => ({ ...doc, children: [] })

/** 侧栏的分组名和主区列表页的名字不是一套：`tree` 在列表页那边叫 `all`。 */
function toListGroup(g: Group): ListGroup {
  return g === 'tree' ? 'all' : g
}

/* ── 可滚区那四段（照 AFFiNE 的 CollapsibleSection + CategoryDivider + EmptySection）── */

type SectionId = 'favorites' | 'organize' | 'tags' | 'collections'

/** 展开/收起状态存 settings；读不到默认展开（跟 AFFiNE 的默认一致）。 */
function readCollapsed(ctx: Context, id: SectionId): boolean {
  return ctx.settings.get<boolean>(`sidebar.section.${id}`) ?? false
}

function Section({
  title,
  collapsed,
  onToggle,
  action,
  children,
}: {
  title: string
  collapsed: boolean
  onToggle: () => void
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className={s.sectionHeader} onClick={onToggle}>
        <span className={s.sectionLabel}>
          {title}
          <ToggleRightIcon
            width={16}
            height={16}
            className={collapsed ? s.sectionTwistyOff : s.sectionTwisty}
          />
        </span>
        {action !== undefined && (
          <span className={s.sectionActions} onClick={(e) => e.stopPropagation()}>
            {action}
          </span>
        )}
      </div>
      {!collapsed && <div className={s.sectionBody}>{children}</div>}
    </div>
  )
}

/** 分组空态：圆底图标 + 一行灰字。 Tags / Collections 现在恒空 —— 它们还没有数据模型。 */
function Empty({ Icon, text }: { Icon: typeof StarIcon; text: string }) {
  return (
    <div className={s.emptyBox}>
      <span className={s.emptyIcon}>
        <Icon width={20} height={20} />
      </span>
      <span className={s.emptyText}>{text}</span>
    </div>
  )
}

export function Sidebar({ ctx }: { ctx: Context }) {
  const [docs, setDocs] = useState<readonly DocMeta[]>([])
  const [group, setGroup] = useState<Group>(() => readGroup(ctx))
  /** 主区停在「文档列表」还是「虚拟目录」（D-0094）/「外部文件」（D-0137）。后两个不属于
   *  四个分组 —— 它们是各自的页面，所以单独记，点了分组行就回来。 */
  const [page, setPage] = useState<'list' | 'vfs' | 'files'>('list')
  // 展开集合按 id 记（不看层级）：重建树之后还认得出原来展开的是谁。
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(readLocal<string[]>('sn.sidebar.expanded', [])),
  )
  // 展开着的父页面也落盘 —— 库大起来之后，每次重开都要重新展开一遍很烦。
  useEffect(() => {
    writeLocal('sn.sidebar.expanded', [...expanded])
  }, [expanded])
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 拖拽重排时鼠标停在哪一行（画落点线）。`mode` 决定画什么线、也决定松手后干什么。 */
  const [dragOver, setDragOver] = useState<{ id: string; mode: DropMode } | null>(null)
  /** 可滚区四段的展开/收起。 */
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionId, boolean>>(() => ({
    favorites: readCollapsed(ctx, 'favorites'),
    organize: readCollapsed(ctx, 'organize'),
    tags: readCollapsed(ctx, 'tags'),
    collections: readCollapsed(ctx, 'collections'),
  }))

  // Esc 撤销改名时不能让它顺着 onBlur 落地：先记下「这一篇别提交」，blur 随后到达时吞掉。
  const cancelled = useRef<string | null>(null)

  // 右键 / ⋯ 的菜单。挂哪一行、弹在哪里由它自己记。
  const { menu, openFromEvent, closeMenu } = useDocMenu()

  const fetchDocs = useCallback(async () => {
    const all = await ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: true })
    setDocs(all)
  }, [ctx])

  /** 写完之后刷新：重取列表并广播 —— 首页/标签条跟着变（跨插件，C12/B10）。 */
  const reload = useCallback(async () => {
    await fetchDocs()
    ctx.emit(DOCS_CHANGED)
  }, [fetchDocs, ctx])

  /** 失败要**响亮**：侧栏静默空着，用户会以为整个库空了 —— 正是 D-0045 要防的那种「看着没事」。 */
  const run = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn()
      setError(null)
    } catch (err) {
      reportError('sidebar', err)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void run(fetchDocs)
  }, [run, fetchDocs])

  // 别的插件改完库也会广播 —— 这边跟着重取（用 fetchDocs，别再广播，免得回环）。
  useEffect(() => {
    const off = ctx.on(DOCS_CHANGED, () => void run(fetchDocs))
    return () => void off()
  }, [ctx, run, fetchDocs])

  // 文档不只从侧栏开（首页、标签条、正文里的子页面链接、右键菜单），
  // 别处开的也得跟着高亮；并且把它的上级展开 —— 否则刚建的子页面藏在折叠的父级里，
  // 看起来就是「点了没反应」。
  useEffect(() => {
    const offOpen = ctx.on(OPEN_DOC, ({ id }) => {
      setSelected(id)
      setPage('list')
      const byId = new Map(docs.map((d) => [d.id, d]))
      setExpanded((prev) => {
        const next = new Set(prev)
        for (let p = byId.get(id)?.parentId; p; p = byId.get(p)?.parentId ?? null) next.add(p)
        return next.size === prev.size ? prev : next
      })
    })
    // 主区回到首页（关光标签、点了列表页）就把高亮撤掉 —— 否则侧栏还标着一篇没在看的文档。
    const offClose = ctx.on(CLOSE_ALL, () => {
      setSelected(null)
      setPage('list')
    })
    return () => {
      void offOpen()
      void offClose()
    }
  }, [ctx, docs])

  const select = useCallback(
    (id: string) => {
      setSelected(id)
      // 不直接调标签条 —— 广播契约里的 OPEN_DOC，谁想开谁监听（见 events.ts）。
      ctx.emit(OPEN_DOC, { id })
    },
    [ctx],
  )

  const chooseGroup = (next: Group) => {
    setGroup(next)
    ctx.settings.set(GROUP_KEY, next)
  }

  const toggleSection = (id: SectionId) =>
    setCollapsedSections((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      ctx.settings.set(`sidebar.section.${id}`, next[id])
      return next
    })

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const create = () =>
    run(async () => {
      // ★ 一律建在**顶层**（Notion 侧栏那个 `+` 就是新建顶层页面）。
      //   这里曾经写成「有选中就建在它下面」，结果点 `+` 出来的新页面缩进在当前页里，
      //   顶层看不到它 —— 看起来就是「新建没反应」。子页面另有入口：正文里的 `[[`
      //   和斜杠菜单的「链接页面 → 新建」。
      const doc = await ctx.rpc.call<DocMeta>('doc:create', { parentId: null, title: '' })
      await reload()
      select(doc.id)
    })

  const rename = (doc: DocMeta, value: string) =>
    run(async () => {
      if (cancelled.current === doc.id) {
        cancelled.current = null
        setRenaming(null)
        return
      }
      setRenaming(null)
      if (value !== doc.title) await ctx.rpc.call('doc:rename', { id: doc.id, title: value })
      await reload()
    })

  const favorite = (doc: DocMeta) =>
    run(async () => {
      await ctx.rpc.call('doc:favorite', { id: doc.id, value: !doc.isFavorite })
      await reload()
    })

  const trash = (doc: DocMeta) =>
    run(async () => {
      await ctx.rpc.call('doc:trash', { id: doc.id })
      if (selected === doc.id) setSelected(null)
      await reload()
      // 整棵子树跟着进了回收站，但用户按的是这一篇 —— 提示 + 一条回头的路。
      toast({
        text: ctx.i18n.t('sidebar.trashed'),
        action: { label: ctx.i18n.t('common.undo'), run: () => void restore(doc) },
      })
    })

  const restore = (doc: DocMeta) =>
    run(async () => {
      await ctx.rpc.call('doc:restore', { id: doc.id })
      await reload()
    })

  /** 菜单里点「重命名」：先把这条路径展开，不然输入框长在折叠的子树里，看不见。 */
  const beginRename = (doc: DocMeta) => {
    const byId = new Map(docs.map((d) => [d.id, d]))
    setExpanded((prev) => {
      const next = new Set(prev)
      for (let p = doc.parentId; p; p = byId.get(p)?.parentId ?? null) next.add(p)
      return next
    })
    cancelled.current = null
    setRenaming(doc.id)
  }

  /**
   * 拖到一行上：上缘 1/4 = 插到它**前面**（同层）· 下缘 1/4 = 插到它**后面**（同层）·
   * 中间一半 = **成为它的子页面**（用户：「让这里可以拖动为子页面」）。
   *
   * ★ 父子关系的真相只有一处：库里 `documents.parent_id`。这里只是把这一列写进去 ——
   *   侧栏的树、正文里那几行子页面卡片都是它的**视图**（D-0091 / D-0094）。
   */
  const dropOn = (fromId: string, toId: string, mode: DropMode) => {
    if (fromId === toId) return
    const byId = new Map(docs.map((doc) => [doc.id, doc]))
    const to = byId.get(toId)
    if (!to) return
    // 不能把节点挪进自己的子树 —— 那会在树里成环。
    for (let p = to.parentId; p; p = byId.get(p)?.parentId ?? null) {
      if (p === fromId) return
    }
    const parentId = mode === 'child' ? toId : to.parentId
    const siblings = docs
      .filter((doc) => doc.deletedAt === null && doc.parentId === parentId && doc.id !== fromId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const at = siblings.findIndex((doc) => doc.id === toId)
    let sortOrder = to.sortOrder - 1
    if (mode === 'child') {
      // 当最后一个孩子。
      const last = siblings[siblings.length - 1]
      sortOrder = last ? last.sortOrder + 1 : 0
    } else if (mode === 'after') {
      const next = at >= 0 ? siblings[at + 1] : undefined
      sortOrder = next ? (to.sortOrder + next.sortOrder) / 2 : to.sortOrder + 1
    } else {
      const prev = at > 0 ? siblings[at - 1] : undefined
      sortOrder = prev ? (prev.sortOrder + to.sortOrder) / 2 : to.sortOrder - 1
    }
    void run(async () => {
      await ctx.rpc.call('doc:move', { id: fromId, parentId, sortOrder })
      await reload()
      if (mode !== 'child') return
      // 落到谁名下就展开谁，并且**真的进那一页**（用户：「然后真的会进入这个页面」）——
      // 那一页正文里的子页面卡片就是从库里这张父子表同步出来的。
      setExpanded((prev) => new Set(prev).add(toId))
      ctx.emit(OPEN_DOC, { id: toId })
    })
  }

  /** 一行。`sortable` = 这一行能不能拖拽重排（只有「全部文档」树能）。 */
  const renderRow = (node: DocNode, depth: number, sortable: boolean): ReactNode => {
    const open = expanded.has(node.id)
    const kids = node.children
    // 只有「全部文档」树能拖拽重排；收藏/最近是派生列表，拖了没意义。
    const draggableRow = sortable
    return (
      <Fragment key={node.id}>
        <div
          className={`${s.row} ${selected === node.id ? s.rowOn : ''} ${
            dragOver?.id === node.id ? s.rowDropOn : ''
          }`}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => select(node.id)}
          onContextMenu={(e) => openFromEvent(e, node)}
          {...(draggableRow
            ? {
                draggable: true,
                onDragStart: (e: DragEvent<HTMLDivElement>) => {
                  e.dataTransfer.setData('text/plain', node.id)
                  e.dataTransfer.effectAllowed = 'move'
                  // ★ 拖影：**照这一行克隆**一张浮动卡片（用户要的是 Notion 那种感觉），
                  //   挂在光标右下 —— 浏览器默认那张是整行快照，正好盖住鼠标底下的行和落点线。
                  const row = e.currentTarget
                  dropGhost()
                  const ghost = row.cloneNode(true) as HTMLElement
                  Object.assign(ghost.style, {
                    position: 'fixed',
                    top: '-1000px',
                    left: '-1000px',
                    width: `${row.getBoundingClientRect().width}px`,
                    background: 'var(--affine-v2-layer-background-secondary)',
                    borderRadius: '6px',
                    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.28)',
                  })
                  document.body.appendChild(ghost)
                  dragGhost = ghost
                  e.dataTransfer.setDragImage(ghost, -16, -18)
                },
                onDragOver: (e: DragEvent<HTMLDivElement>) => {
                  // 不 preventDefault 就不允许 drop（HTML5 DnD 的规矩）
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  // 鼠标在这一行的哪个高度：上下缘插到前后，中间就是「当它的子页面」。
                  const r = e.currentTarget.getBoundingClientRect()
                  const ratio = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5
                  const mode: DropMode = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'child'
                  if (dragOver?.id !== node.id || dragOver.mode !== mode) {
                    setDragOver({ id: node.id, mode })
                  }
                },
                // ★ **不听 `dragleave`**：光标在行内子元素之间穿梭就会触发它，而 WebKit 那边
                //   `relatedTarget` 可能是空 —— 一清就把落点线掍掉了（用户：「现在还没有啊」）。
                //   落点归「最后收到 dragover 的那一行」，dragend / drop 再收掉。
                onDragEnd: () => {
                  dropGhost()
                  setDragOver(null)
                },
                onDrop: (e: DragEvent<HTMLDivElement>) => {
                  e.preventDefault()
                  const mode = dragOver?.id === node.id ? dragOver.mode : 'before'
                  setDragOver(null)
                  const from = e.dataTransfer.getData('text/plain')
                  if (!from) return
                  // 一行日记：拖拽没反应时，`pnpm logs` 至少能告诉我们是没触发还是没生效。
                  reportNote('sidebar', `拖放：${from} → ${node.id}（${mode}）`)
                  dropOn(from, node.id, mode)
                },
              }
            : {})}
        >
          {/* 落点线：带左端小圆点，缩进到**它将来的层级**（成为子页面 = 再深一级）—— 一眼看出插到哪儿。 */}
          {dragOver?.id === node.id ? (
            <span
              className={s.dropLine}
              style={{
                left: 6 + (depth + (dragOver.mode === 'child' ? 1 : 0)) * 12,
                ...(dragOver.mode === 'before' ? { top: -1 } : { bottom: -1 }),
              }}
            />
          ) : null}
          {kids.length ? (
            <button
              type="button"
              className={s.twisty}
              title={ctx.i18n.t('sidebar.toggle')}
              onClick={(e) => {
                // 展开 / 折叠只是在看树，不该顺手把这篇文档「打开」（那个事件是给标签条的）。
                e.stopPropagation()
                toggle(node.id)
              }}
            >
              {open ? (
                <ArrowDownSmallIcon width={16} height={16} />
              ) : (
                <ArrowDownSmallIcon width={16} height={16} className={s.twistyClosed} />
              )}
            </button>
          ) : (
            <span className={s.twisty} />
          )}
          <span className={s.docIcon}>{node.icon ?? <PageIcon width={ICON} height={ICON} />}</span>
          {renaming === node.id ? (
            <input
              className={s.input}
              defaultValue={node.title}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => void rename(node, e.currentTarget.value)}
              onKeyDown={(e) => {
                // Enter 交给 onBlur 落地 —— 提交只留一条路径。
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'Escape') {
                  cancelled.current = node.id
                  setRenaming(null)
                }
              }}
            />
          ) : (
            <span
              className={s.label}
              onDoubleClick={() => {
                cancelled.current = null
                setRenaming(node.id)
              }}
            >
              {node.title || ctx.i18n.t('sidebar.untitled')}
            </span>
          )}
          {/* 拖到中间 = 成为子页面并进入它 —— 直接写出来，别让人猜落点（用户：「应该要能看出会进入哪里」）。 */}
          {dragOver?.id === node.id && dragOver.mode === 'child' ? (
            <span className={s.dropHint}>{ctx.i18n.t('sidebar.dropInto')}</span>
          ) : null}
          <button
            type="button"
            className={s.act}
            title={ctx.i18n.t('sidebar.favorite')}
            onClick={(e) => {
              e.stopPropagation()
              void favorite(node)
            }}
          >
            <StarIcon width={16} height={16} />
          </button>
          <button
            type="button"
            className={s.act}
            title={ctx.i18n.t('sidebar.trash')}
            onClick={(e) => {
              e.stopPropagation()
              void trash(node)
            }}
          >
            <DeleteTemporarilyIcon width={16} height={16} />
          </button>
        </div>
        {open && kids.map((kid) => renderRow(kid, depth + 1, sortable))}
      </Fragment>
    )
  }

  const settings = ctx.command.list().find((cmd) => cmd.id === 'settings.open')

  const tree = buildTree(docs.filter((doc) => doc.deletedAt === null))

  /** 最近 / 收藏 / 置顶 是三个派生列表 —— 都是平铺的行（不搭树）。 */
  const listed =
    group === 'recent' ? recent(docs) : group === 'pinned' ? pinned(docs) : favorites(docs)
  const rows: ReactNode[] = listed.map((doc) => renderRow(asLeaf(doc), 0, false))

  /** ★ 回收站选中时侧栏可滚区**整块不画**：主区那一页已经是完整的列表（标题 / 时间 /
   *  恢复 / 删除 / 全部恢复 / 清空）。同一份东西说两遍，左边这份还更残。 */
  const trashSelected = group === 'trash'

  return (
    <>
      {/* 不滚的那截：搜索 / 四个导航项。
          顶部原来有行品牌标识（`S self-notion`）—— 撤了（D-0070）：单人本地应用，
          它既不切工作区也不显示账号，就一行字占着最显眼的位置。 */}
      <div className={s.head}>
        <div className={s.quickRow}>
          {/* 搜索面板的入口只有 ⌘K 一个（它自己在 document 上听）。点这一行就替用户按一下，
              不另开一条「打开面板」的 API —— 那是给这件事加接口。 */}
          <button
            type="button"
            className={s.search}
            onClick={() =>
              document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
              )
            }
          >
            <SearchIcon width={ICON} height={ICON} />
            <span className={s.searchText}>{ctx.i18n.t('search.placeholder')}</span>
          </button>
          <button
            type="button"
            className={s.addPage}
            title={ctx.i18n.t('sidebar.new')}
            onClick={() => void create()}
          >
            <PlusIcon width={ICON} height={ICON} />
          </button>
        </div>

        {GROUPS.map((g) => {
          const Icon = GROUP_ICON[g]
          return (
            <button
              key={g}
              type="button"
              className={`${s.navItem} ${g === group && page === 'list' ? s.navItemOn : ''}`}
              onClick={() => {
                chooseGroup(g)
                setPage('list')
                // AFFiNE 里点导航行是把主区导航到那一页，不只是换个列表 ——
                // 四个分组现在各有一页（C12），发 SHOW_LIST 让主区跟着走。
                ctx.emit(SHOW_LIST, { group: toListGroup(g) })
              }}
            >
              <span className={s.navIcon}>
                <Icon width={ICON} height={ICON} />
              </span>
              <span className={s.navLabel}>{ctx.i18n.t(`sidebar.group.${g}`)}</span>
            </button>
          )
        })}

        {/* 虚拟目录（D-0094）。跟「设置」一样**不占分组**：点它主区换成一棵投影出来的
            目录树，四个分组还留在原处。`vfs` 服务不在（插件被卸了）就整行不画 ——
            不留一个点了没反应的入口。 */}
        {ctx.get('vfs') !== undefined && (
          <button
            type="button"
            className={`${s.navItem} ${page === 'vfs' ? s.navItemOn : ''}`}
            onClick={() => {
              setPage('vfs')
              ctx.emit(SHOW_LIST, { group: 'vfs' })
            }}
          >
            <span className={s.navIcon}>
              <CodeIcon width={ICON} height={ICON} />
            </span>
            <span className={s.navLabel}>{ctx.i18n.t('vfs.nav')}</span>
          </button>
        )}

        {/* 外部文件（D-0137，`plugins/external-files/`）。跟「虚拟目录」同一个形状：
            不占分组，点它主区换成**真实目录树**。`files` 服务不在（插件被卸了）就整行不画。
            ★ 点的时候**再取一次**服务（不是渲染时取一次）—— 软依赖谁先装不定。 */}
        {ctx.get('files') !== undefined && (
          <button
            type="button"
            className={`${s.navItem} ${page === 'files' ? s.navItemOn : ''}`}
            onClick={() => {
              setPage('files')
              ctx.get('files')?.open()
            }}
          >
            <span className={s.navIcon}>
              <FileIconMdIcon width={ICON} height={ICON} />
            </span>
            <span className={s.navLabel}>{ctx.i18n.t('files.nav')}</span>
          </button>
        )}

        {/* 「设置」这一项走**命令**，不是直接去开别人的面板 —— 契约里没有设置窗口，
            shell-settings 自己注册了 `settings.open`（⌘K 面板也是这么找到它的）。
            命令不在（那个插件被卸了）就整行不画，不留一个点了没反应的入口。 */}
        {settings && (
          <button type="button" className={s.navItem} onClick={() => void settings.run()}>
            <span className={s.navIcon}>
              <SettingsIcon width={ICON} height={ICON} />
            </span>
            <span className={s.navLabel}>{ctx.i18n.t('settings.open')}</span>
          </button>
        )}
      </div>

      {/* 可滚的那截。「全部文档」下是 AFFiNE 那四段：收藏 / 文件夹 / 标签 / 合集；
          最近 / 收藏 / 置顶 还是各自的派生列表；**回收站不列**（主区那一页已经有完整列表）。 */}
      <div className={s.scroll}>
        {error !== null && <p className={s.error}>{error}</p>}
        {group === 'tree' ? (
          <>
            <Section
              title={ctx.i18n.t('sidebar.section.organize')}
              collapsed={collapsedSections.organize}
              onToggle={() => toggleSection('organize')}
            >
              {tree.length ? (
                tree.map((node) => renderRow(node, 0, true))
              ) : (
                <Empty Icon={FolderIcon} text={ctx.i18n.t('sidebar.organize.empty')} />
              )}
            </Section>

            <Section
              title={ctx.i18n.t('sidebar.section.tags')}
              collapsed={collapsedSections.tags}
              onToggle={() => toggleSection('tags')}
            >
              <Empty Icon={TagsIcon} text={ctx.i18n.t('sidebar.tags.empty')} />
            </Section>

            <Section
              title={ctx.i18n.t('sidebar.section.collections')}
              collapsed={collapsedSections.collections}
              onToggle={() => toggleSection('collections')}
            >
              <Empty Icon={CollectionsIcon} text={ctx.i18n.t('sidebar.collections.empty')} />
            </Section>
          </>
        ) : trashSelected ? null : (
          <>
            {rows.length ? rows : <p className={s.note}>{ctx.i18n.t('sidebar.empty')}</p>}
          </>
        )}
      </div>

      {/* 菜单 portal 到 body，这点位置只是「归这个插件管」。 */}
      {menu && (
        <DocMenu ctx={ctx} menu={menu} docs={docs} onClose={closeMenu} onRename={beginRename} />
      )}
    </>
  )
}
