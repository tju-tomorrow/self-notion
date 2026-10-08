/**
 * 应用外壳：顶栏 + 侧栏 + 主区。只搭骨架、只挂槽位，里面全由插件塞。
 * 结构照 AFFiNE 的 `app-container`：上面一条通栏，下面才左右分栏。
 */
import { useCallback, useEffect, useState, type CSSProperties, type PointerEvent } from 'react'
import type { Context } from 'cordis'
import { SidebarIcon } from '@blocksuite/icons/rc'
import { AGENT_TAB_ID, CLOSE_ALL, OPEN_DOC, SHOW_LIST, isFileId } from '../kernel/contract'
import * as s from './shell.css'
import * as motion from '../ui/motion.css'
import { readLocal, writeLocal } from '../kernel/local'
import { SlotHost } from './slot-host'

/** 主区显示哪一页。放外壳是因为只有外壳知道主区该给谁。 */
type MainView = 'home' | 'doc' | 'agent'

function useDocView(ctx: Context): { view: MainView; id: string | null } {
  const [state, setState] = useState<{ view: MainView; id: string | null }>({
    view: 'home',
    id: null,
  })
  useEffect(() => {
    // 助手那个虚拟标签（D-0095）也走 OPEN_DOC —— 外壳靠 id 分流，不走第二个事件。
    const offOpen = ctx.on(OPEN_DOC, ({ id }) =>
      setState({ view: id === AGENT_TAB_ID ? 'agent' : 'doc', id }),
    )
    // 「回首页」有两条路：关光标签（CLOSE_ALL）+ 侧栏点了某个列表页（SHOW_LIST）。
    const home = () => setState({ view: 'home', id: null })
    const offClose = ctx.on(CLOSE_ALL, home)
    const offList = ctx.on(SHOW_LIST, home)
    // ctx.on 的逆函数返回 boolean，React 要 void —— 包一层（D-0033）
    return () => {
      void offOpen()
      void offClose()
      void offList()
    }
  }, [ctx])
  return state
}

function TitleBar({
  ctx,
  collapsed,
  onToggle,
}: {
  ctx: Context
  collapsed: boolean
  onToggle: () => void
}) {
  const label = ctx.i18n.t('sidebar.toggle')
  return (
    // ★ 必须 `="deep"`：裸属性只认直接点在元素上的那次（drag.js: `el === composedPath[0]`），
    //   而这格里塞了三个 div，点哪儿都是内层元素 → 拖不动。
    <header className={s.titlebar} data-tauri-drag-region="deep">
      {/* 红绿灯占位 + 侧栏折叠开关（B9）。折叠后这格收窄，标签条从侧栏原位置起。 */}
      <div className={collapsed ? `${s.headerLeft} ${s.headerLeftCollapsed}` : s.headerLeft}>
        <button
          type="button"
          className={s.sidebarSwitch}
          title={label}
          aria-label={label}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {/* 折叠后翻过来 —— 同一个图标两个方向不分状态，用户看不出点它是开还是关。 */}
          <span style={{ display: 'flex', transform: collapsed ? 'rotate(180deg)' : undefined }}>
            <SidebarIcon width={20} height={20} />
          </span>
        </button>
        {/* 紧挨折叠开关右边：前进/后退（`shell-nav`，D-0119）。开关自己顶在左缘，
            所以这一格天然落在它右边。 */}
        <SlotHost ctx={ctx} name="titlebar.left" />
      </div>
      <div className={s.titlebarCenter}>
        <SlotHost ctx={ctx} name="titlebar.center" />
      </div>
      <div className={s.titlebarRight}>
        <SlotHost ctx={ctx} name="titlebar.right" />
      </div>
    </header>
  )
}

export function AppShell({ ctx }: { ctx: Context }) {
  const { view, id } = useDocView(ctx)
  const [collapsed, setCollapsed] = useState(() => readLocal('sn.shell.collapsed', false))
  const [width, setWidth] = useState(() => readLocal('sn.shell.width', s.SIDEBAR_W))

  // 宽度和折叠都落盘 —— 拖一次、收一次，重开还得是这个样子。
  useEffect(() => {
    writeLocal('sn.shell.collapsed', collapsed)
    writeLocal('sn.shell.width', width)
  }, [collapsed, width])

  /** 拖右缘改宽度。监听挂在 window 上而不是抓带上 —— 指针跑出那 4px 也得跟着走。
   *  宽度只活在内存里（跟 `collapsed` 一样），重开回默认值。 */
  const onResizeStart = useCallback((e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const clamp = (w: number) => Math.min(s.SIDEBAR_MAX_W, Math.max(s.SIDEBAR_MIN_W, w))
    const move = (ev: globalThis.PointerEvent) => setWidth(clamp(startWidth + ev.clientX - startX))
    // 拖动时别选中文字/触发拖拽
    document.body.style.userSelect = 'none'
    const up = () => {
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [width])

  return (
    <div className={`${s.root} ${motion.fadeIn}`} style={{ '--shell-sidebar-w': `${width}px` } as CSSProperties}>
      <TitleBar ctx={ctx} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className={s.body}>
        <aside className={collapsed ? `${s.sidebar} ${s.sidebarCollapsed}` : s.sidebar}>
          <SlotHost ctx={ctx} name="sidebar.item" />
          {/* 最底下那格：宠物（D-0072）。折叠了就不画 —— 0 宽的侧栏里塞一只 48 像素的
              小人，它会顺着边溢出去。 */}
          {!collapsed && <SlotHost ctx={ctx} name="sidebar.foot" />}
          {/* 折叠了就没有宽度可拖 */}
          {!collapsed && (
            <div
              className={s.resizer}
              role="separator"
              aria-orientation="vertical"
              onPointerDown={onResizeStart}
            />
          )}
        </aside>
        <main className={s.main}>
          {/* ★ 两个分支各套一层带 `key` 的 `view`：换页时 React 重挂它，
              入场动画（`motion.fadeIn`）于是每次切换都重放 —— 不套这一层的话，
              换页是「啪」一下直接顶上来。 */}
          {view !== 'home' ? (
            <div key={view} className={`${s.view} ${motion.fadeIn}`}>
              {view === 'agent' ? (
                // 助手那一页（D-0095）：整块主区，自己带左历史右对话
                <SlotHost ctx={ctx} name="main.page" />
              ) : (
                <>
              {/* 页面顶栏（面包屑 + 页面操作）。壳只负责渲染这个槽，里面由插件塞。
                  ★ 槽本身是**一行**（不是一列）：往里注册两项就是并排两个按钮，
                  不是叠成两行 —— 高亮和底线由壳出。 */}
              <div className={s.docHeader}>
                <SlotHost ctx={ctx} name="doc.header" />
                {/* 最右端那一格：评论入口（D-0070）。它是单独一格 — 谁先装谁先渲染，
                    靠 DOM 顺序抢右端是不靠靠的。
                    ★ 外部文件（D-0137）整格不画：评论 / 版本历史 / web AI 三个入口都住这儿，
                      而这条路上它们真的没有（D-0140）—— 画出来点了没反应比不画更糟。 */}
                {!(id !== null && isFileId(id)) && <SlotHost ctx={ctx} name="doc.header.right" />}
              </div>
              {/* 正文 + 右侧评论栏。`doc.aside` 空着时里面一个节点都没有 → 宽度 0，不占地方
                  （槽宿主不给插件包壳，见 slot-host.tsx）。 */}
              <div className={s.docBody}>
                <SlotHost ctx={ctx} name="main.view" />
                <SlotHost ctx={ctx} name="doc.aside" />
                {/* 再往外那一列：web 版 AI 面板（D-0074）。和评论那一列能同时开着。 */}
                <SlotHost ctx={ctx} name="doc.aside.right" />
                {/* 再再往外那一列：内置助手的侧栏（D-0098）。关着的时候它自己返回 null，
                    这里就一个节点都没有 → 宽度 0，不占地方。 */}
                <SlotHost ctx={ctx} name="doc.aside.agent" />
                  </div>
                </>
              )}
            </div>
          ) : (
            // 没开文档就给主页。插件没装时退到那句话 —— 空的主区不能是一片纯黑，那看起来就是「坏了」。
            <div key="home" className={`${s.view} ${motion.fadeIn}`}>
              <SlotHost
                ctx={ctx}
                name="main.home"
                fallback={<p className={s.empty}>{ctx.i18n.t('main.empty')}</p>}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
