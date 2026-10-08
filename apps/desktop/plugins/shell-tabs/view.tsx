/**
 * 标签条的视图。**只画，不改状态** —— 状态机在 `./tabs.ts`，`ctx` 只用来取 i18n 和广播事件。
 *
 * 拖拽重排用**原生 HTML5 draggable**（任务约束：不引 dnd 库）。
 */
import { type DragEvent, type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from 'cordis'
import { CloseIcon, FileIconMdIcon, PageIcon, PlusIcon } from '@blocksuite/icons/rc'
import { AGENT_TAB_ID, CLOSE_ALL, DOCS_CHANGED, OPEN_DOC, fileTitleOf, type DocMeta } from '../../src/kernel/contract'
import type { TabsStore } from './tabs'
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

export function TabBar({ ctx, store }: { ctx: Context; store: TabsStore }) {
  const snap = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.snapshot(),
    () => store.snapshot(), // SSR / renderToString 要第三个参数，否则直接抛
  )
  const meta = useDocMeta(ctx, snap.tabs.map((tab) => tab.id).join(','))

  /** 「+」：建一篇空文档再走 OPEN_DOC —— 标签由 index.ts 那条监听自己加，这里不碰 store。
   *  `DOCS_CHANGED` 得跟着发，否则侧栏的树不知道多了一篇。 */
  const create = () => {
    void ctx.rpc.call<DocMeta>('doc:create', { parentId: null, title: '' }).then((doc) => {
      ctx.emit(OPEN_DOC, { id: doc.id })
      ctx.emit(DOCS_CHANGED)
    })
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
          />
        ))}
      </div>
      <div className={s.spacer}>
        <button
          type="button"
          className={s.addTab}
          title={ctx.i18n.t('shell-tabs.new')}
          aria-label={ctx.i18n.t('shell-tabs.new')}
          onClick={create}
        >
          <PlusIcon width={20} height={20} />
        </button>
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
}: {
  ctx: Context
  store: TabsStore
  id: string
  doc: DocMeta | undefined
  index: number
  active: boolean
}) {
  const agent = id === AGENT_TAB_ID
  // 助手那一个不是文档：库里查不到它的名字和图标，所以名字和图标都自己给（D-0095）。
  // 外部文件同理（D-0137）：库里没有它，名字就是文件名。
  const fileTitle = fileTitleOf(id)
  const title = agent ? ctx.i18n.t('agent.title') : (fileTitle ?? doc?.title ?? '')
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
    ctx.emit(OPEN_DOC, { id })
  }

  const close = (e: { stopPropagation(): void }) => {
    e.stopPropagation() // 别让点 × 顺带走一遍 activate
    const before = store.snapshot().activeId
    store.close(id)
    const after = store.snapshot().activeId
    // 关光了就回首页 —— 否则主区停在编辑器上，里面却什么都没有（一片黑，像坏了）。
    if (after === null) ctx.emit(CLOSE_ALL)
    // 关的正是激活那个 → 邻居上位，得让编辑器换过去
    else if (after !== before) ctx.emit(OPEN_DOC, { id: after })
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
        {agent ? (
          // 助手那个标签的图标也是**那只宠物**（D-0095 续）。拿不到就不画 —— 名字还在。
          (ctx.get('mascot')?.face(16) as ReactNode) ?? null
        ) : fileTitle !== null ? (
          <FileIconMdIcon width={16} height={16} />
        ) : (
          (doc?.icon ?? <PageIcon width={16} height={16} />)
        )}
      </span>
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
                store.closeOthers(id)
                ctx.emit(OPEN_DOC, { id })
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
                ctx.emit(CLOSE_ALL)
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
