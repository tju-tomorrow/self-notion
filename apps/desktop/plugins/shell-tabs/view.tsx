/**
 * 标签条的视图。**只画，不改状态** —— 状态机在 `./tabs.ts`，`ctx` 只用来取 i18n 和广播事件。
 *
 * 拖拽重排用**原生 HTML5 draggable**（任务约束：不引 dnd 库）。
 */
import { type DragEvent, type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from 'cordis'
import { CloseIcon, FileIconMdIcon, PageIcon, PinIcon, PlusIcon } from '@blocksuite/icons/rc'
import {
  AGENT_TAB_ID,
  CLOSE_ALL,
  DOCS_CHANGED,
  OPEN_DOC,
  SPLIT_VIEW,
  fileTitleOf,
  isDrawioTab,
  type DocMeta,
  type SplitViewEvent,
} from '../../src/kernel/contract'
import type { TabsStore } from './tabs'
import { activateTab } from './activate'
import { PagePicker } from './page-picker'
import * as s from './tabs.css'

/** 标签要的元数据（标题 + 图标）。契约里没有「文档列表」服务，只能问 rpc —— 和侧栏/首页同一条路。
 *  `key` 变了就重取（标签增删、改名都靠它）。 */
function useDocMeta(ctx: Context, key: string): ReadonlyMap<string, DocMeta> {
  const [docs, setDocs] = useState<ReadonlyMap<string, DocMeta>>(() => new Map())
  const [nonce, setNonce] = useState(0)
  // 别的插件改完库会广播 DOCS_CHANGED —— 改名之后标题条要跟着变（B10）。
  // 原来是「只有标签集合（key）变了才重取」，于是改名永远不刷新。
  useEffect(() => {
    const off = ctx.on(DOCS_CHANGED, () => setNonce((n) => n + 1))
    return () => void off()
  }, [ctx])
  useEffect(() => {
    let live = true
    // 失败不吞：让 rejection 冒到全局处理器，落进 errors.log（D-0045）
    void ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: true }).then((all) => {
      if (live) setDocs(new Map(all.map((doc) => [doc.id, doc])))
    })
    return () => {
      live = false
    }
  }, [ctx, key, nonce])
  return docs
}

/** 主区现在几栏。**值的家在编辑器插件那边**，这里只接它广播的镜像（跟顶栏那颗分屏按钮同一条路）。 */
function usePaneCount(ctx: Context): number {
  const [panes, setPanes] = useState(1)
  useEffect(() => {
    const off = ctx.on(SPLIT_VIEW, ({ panes: n }: SplitViewEvent) => setPanes(n))
    return () => void off()
  }, [ctx])
  return panes
}

export function TabBar({ ctx, store }: { ctx: Context; store: TabsStore }) {
  const snap = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.snapshot(),
    () => store.snapshot(), // SSR / renderToString 要第三个参数，否则直接抛
  )
  const meta = useDocMeta(ctx, snap.tabs.map((tab) => tab.id).join(','))
  const panes = usePaneCount(ctx)

  /** 「+」：出一张页面选择器，挑一篇现有页面打开（标签由 index.ts 那条监听自己加）。 */
  const [picking, setPicking] = useState(false)
  const pick = (id: string) => {
    setPicking(false)
    ctx.emit(OPEN_DOC, { id })
  }

  return (
    <div className={s.bar}>
      <div className={s.strip}>
        {snap.tabs.map((tab, i) => (
          <TabItem
            key={tab.id}
            ctx={ctx}
            store={store}
            id={tab.id}
            doc={meta.get(tab.id)}
            index={i}
            active={tab.id === snap.activeId}
            pinned={tab.pinned}
            panes={panes}
          />
        ))}
      </div>
      <div className={s.spacer}>
        <button
          type="button"
          className={s.addTab}
          title={ctx.i18n.t('shell-tabs.open')}
          aria-label={ctx.i18n.t('shell-tabs.open')}
          onClick={() => setPicking(true)}
        >
          <PlusIcon width={20} height={20} />
        </button>
        {picking ? (
          <PagePicker ctx={ctx} docs={meta} onPick={pick} onClose={() => setPicking(false)} />
        ) : null}
      </div>
    </div>
  )
}

function TabItem({
  ctx,
  store,
  id,
  doc,
  index,
  active,
  pinned,
  panes,
}: {
  ctx: Context
  store: TabsStore
  id: string
  doc: DocMeta | undefined
  index: number
  active: boolean
  pinned: boolean
  panes: number
}) {
  const agent = id === AGENT_TAB_ID
  // 助手 / 画布都不是文档：库里查不到它们的名字和图标，所以自己给（D-0095 / D-0216）。
  // 外部文件同理（D-0137）：库里没有它，名字就是文件名。
  const drawio = isDrawioTab(id)
  const fileTitle = fileTitleOf(id)
  const title = drawio
    ? ctx.i18n.t('drawio.tab')
    : agent
      ? ctx.i18n.t('agent.title')
      : (fileTitle ?? doc?.title ?? '')
  // 拖拽悬停的落点高亮（落点用下落当下的下标算，所以只需一个布尔）
  const [over, setOver] = useState(false)
  /** 标签上那个小菜单（关闭其他 / 关闭全部）的位置。null = 没开。 */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // 点别处 / Esc 就收起来。
  useEffect(() => {
    if (!menu) return
    const hide = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', hide)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', hide)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  /** ★ **无条件**广播，不判「激活的有没有变」。标签条上的「激活」不等于主区正在显示它：
   *  点了侧栏的「全部文档」之后主区在列表上，而激活标签没变 —— 这时点它必须能回编辑器。
   *  重复广播是安全的：`ctx.on(OPEN_DOC)` 那边调 `store.open`，对已激活的标签是空操作。 */
  const activate = () => {
    store.activate(id)
    activateTab(ctx, id)
  }

  const close = (e: { stopPropagation(): void }) => {
    e.stopPropagation() // 别让点 × 顺带走一遍 activate
    const before = store.snapshot().activeId
    store.close(id)
    const after = store.snapshot().activeId
    // 关光了就回首页 —— 否则主区停在编辑器上，里面却什么都没有（一片黑，像坏了）。
    if (after === null) ctx.emit(CLOSE_ALL)
    // 关的正是激活那个 → 邻居上位，得让主区换过去。邻居可能是画布标签，所以走 activateTab。
    else if (after !== before) activateTab(ctx, after)
  }

  return (
    <div
      className={[s.tab, active && s.tabActive, over && s.tabOver].filter(Boolean).join(' ')}
      draggable
      title={title || ctx.i18n.t('shell-tabs.untitled')}
      onClick={activate}
      // 中键关标签 —— 浏览器里就是这么用的，试一次就知道。
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        close(e)
      }}
      onDragStart={(e: DragEvent<HTMLDivElement>) => {
        // 源下标走 dataTransfer：dragover 里读不到，drop 里读得到，够用
        e.dataTransfer.setData('text/plain', String(index))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e: DragEvent<HTMLDivElement>) => {
        // 不 preventDefault 就不允许 drop（HTML5 DnD 的规矩）
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDragEnd={() => setOver(false)}
      // Notion 那样：右键或双击标签，问你要不要把别的关掉。
      onDoubleClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        setOver(false)
        const raw = e.dataTransfer.getData('text/plain')
        if (raw === '') return
        const from = Number(raw)
        if (Number.isInteger(from)) store.move(from, index)
      }}
    >
      {/* 图标在前，像浏览器的 favicon —— AFFiNE 的标签也是这么排的 */}
      <span className={s.tabIcon}>
        {drawio ? (
          <span style={{ fontSize: 14, lineHeight: 1 }}>◇</span>
        ) : agent ? (
          // 助手那个标签的图标也是**那只宠物**（D-0095 续）。拿不到就不画 —— 名字还在。
          (ctx.get('mascot')?.face(16) as ReactNode) ?? null
        ) : fileTitle !== null ? (
          <FileIconMdIcon width={16} height={16} />
        ) : (
          (doc?.icon ?? <PageIcon width={16} height={16} />)
        )}
      </span>
      {pinned && (
        <span className={s.pinIcon} aria-hidden>
          <PinIcon width={12} height={12} />
        </span>
      )}
      <span className={s.label}>{title || ctx.i18n.t('shell-tabs.untitled')}</span>
      <button
        type="button"
        className={s.close}
        aria-label={ctx.i18n.t('shell-tabs.close')}
        onClick={close}
      >
        <CloseIcon width={16} height={16} />
      </button>
      {menu &&
        createPortal(
          // 菜单自己的点击不能冒到 window 上 —— 不然刚出来就被那条「点别处收起」关掉。
          <div
            className={s.menu}
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={s.menuItem}
              onClick={() => {
                setMenu(null)
                store.togglePin(id)
              }}
            >
              {ctx.i18n.t(pinned ? 'shell-tabs.unpin' : 'shell-tabs.pin')}
            </button>
            {/* 分屏入口就在标签上：右键哪一篇，就把它放进新开出来的那一栏。
                已经在看的（激活）那一篇不重发 OPEN_DOC —— 否则焦点被拽回旧栏，新栏空着没人管。 */}
            {/* 画布不分屏：编辑器那套分栏只认文档（D-0216）。 */}
            {!drawio && (
              <button
                type="button"
                className={s.menuItem}
                onClick={() => {
                  setMenu(null)
                  const want = panes >= 3 ? 1 : panes + 1
                  ctx.emit(SPLIT_VIEW, { panes: want })
                  if (want > 1 && store.snapshot().activeId !== id) ctx.emit(OPEN_DOC, { id })
                }}
              >
                {ctx.i18n.t(panes >= 3 ? 'shell-tabs.unsplit' : 'shell-tabs.split')}
              </button>
            )}
            <button
              type="button"
              className={s.menuItem}
              onClick={() => {
                setMenu(null)
                store.closeOthers(id)
                activateTab(ctx, id)
              }}
            >
              {ctx.i18n.t('shell-tabs.closeOthers')}
            </button>
            <button
              type="button"
              className={s.menuItem}
              onClick={() => {
                setMenu(null)
                store.closeAll()
                // 固定住的会留下来 —— 只有真的一枚不剩才回首页。
                const after = store.snapshot().activeId
                if (after === null) ctx.emit(CLOSE_ALL)
                else activateTab(ctx, after)
              }}
            >
              {ctx.i18n.t('shell-tabs.closeAll')}
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
