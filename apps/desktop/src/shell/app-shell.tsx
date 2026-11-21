/**
 * 应用外壳：顶栏 + 侧栏 + 主区。只搭骨架、只挂槽位，里面全由插件塞。
 * 结构照 AFFiNE 的 `app-container`：上面一条通栏，下面才左右分栏。
 */
import { useCallback, useEffect, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import type { Context } from 'cordis'
import { PageIcon, PlusIcon, SearchIcon, SettingsIcon, SidebarIcon } from '@blocksuite/icons/rc'
import { AGENT_TAB_ID, CLOSE_ALL, DOCS_CHANGED, OPEN_DOC, SHOW_LIST, isFileId } from '../kernel/contract'
import * as s from './shell.css'
import * as motion from '../ui/motion.css'
import { readLocal, writeLocal } from '../kernel/local'
import { reportError } from '../kernel/errors'
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

/** 手机断点（D-0195）。侧栏从「占一列」变成「抽屉」。 */
function useIsMobile(): boolean {
  // ★ 不只信宽度：iPhone 上偶尔会拿到一个比 720 宽的布局视口（旧缓存 / 缩放），
  //   那时候桌面侧栏会把正文挤成一条，所以 UA 也一起看。
  const uaMobile =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  const [mobile, setMobile] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches) || uaMobile,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)')
    const on = () => setMobile(uaMobile || mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [uaMobile])
  return mobile
}

function TitleBar({
  ctx,
  collapsed,
  mobile,
  onToggle,
}: {
  ctx: Context
  collapsed: boolean
  mobile: boolean
  onToggle: () => void
}) {
  const label = ctx.i18n.t('sidebar.toggle')
  return (
    // ★ 必须 `="deep"`：裸属性只认直接点在元素上的那次（drag.js: `el === composedPath[0]`），
    //   而这格里塞了三个 div，点哪儿都是内层元素 → 拖不动。
    <header
      className={mobile ? `${s.titlebar} ${s.titlebarMobile}` : s.titlebar}
      data-tauri-drag-region={mobile ? undefined : 'deep'}
    >
      {/* 红绿灯占位 + 侧栏折叠开关（B9）。折叠后这格收窄，标签条从侧栏原位置起。 */}
      <div
        className={
          mobile
            ? `${s.headerLeft} ${s.headerLeftCollapsed} ${s.headerLeftMobile}`
            : collapsed
              ? `${s.headerLeft} ${s.headerLeftCollapsed}`
              : s.headerLeft
        }
      >
        <button
          type="button"
          className={s.sidebarSwitch}
          title={`${label} · Ctrl+B`}
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
        {/* 搜索在手机底部导航里；顶栏不再重复一颗。 */}
        <SlotHost ctx={ctx} name="titlebar.right" />
      </div>
    </header>
  )
}

/** 手机底部导航：把「文档 / 搜索 / 新建 / 设置」放到拇指够得着的地方。 */
function MobileBar({ ctx, view }: { ctx: Context; view: MainView }) {
  const create = () => {
    void ctx.rpc
      .call<{ id: string }>('doc:create', { parentId: null, title: '' })
      .then((doc) => {
        ctx.emit(DOCS_CHANGED)
        ctx.emit(OPEN_DOC, { id: doc.id })
      })
      .catch((err: unknown) => reportError('mobile-bar', err))
  }
  const settings = () => {
    const cmd = ctx.command.list().find((c) => c.id === 'settings.open')
    if (cmd) void cmd.run()
  }
  const item = (
    key: string,
    label: string,
    icon: ReactNode,
    onTap: () => void,
    on = false,
  ) => (
    <button
      key={key}
      type="button"
      className={on ? `${s.mobileBarBtn} ${s.mobileBarBtnOn}` : s.mobileBarBtn}
      onClick={onTap}
      aria-label={label}
    >
      {icon}
      <span className={s.mobileBarLabel}>{label}</span>
    </button>
  )
  return (
    <nav className={s.mobileBar}>
      {item('docs', ctx.i18n.t('mobile.tab.docs'), <PageIcon width={22} height={22} />, () => ctx.emit(SHOW_LIST, { group: 'all' }), view === 'home')}
      {item('search', ctx.i18n.t('mobile.tab.search'), <SearchIcon width={22} height={22} />, () => {
        window.dispatchEvent(new CustomEvent('sn:open-search'))
      })}
      {item('new', ctx.i18n.t('mobile.tab.new'), <PlusIcon width={22} height={22} />, create)}
      {item('settings', ctx.i18n.t('mobile.tab.settings'), <SettingsIcon width={22} height={22} />, settings)}
    </nav>
  )
}

export function AppShell({ ctx }: { ctx: Context }) {
  const { view, id } = useDocView(ctx)
  const mobile = useIsMobile()
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  // 移动标记也写到 <html>：CSS 移动规则同时认 @media 和这个属性（D-0199）。
  useEffect(() => {
    document.documentElement.dataset.mobile = mobile ? '1' : '0'
  }, [mobile])

  // 软键盘压住的那段高度写进 --sn-keyboard-inset，弹起时收起底部导航。
  useEffect(() => {
    const root = document.documentElement
    const vv = window.visualViewport
    if (!mobile || !vv) {
      root.style.removeProperty('--sn-keyboard-inset')
      setKeyboardOpen(false)
      return
    }
    const update = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      const inset = covered < 80 ? 0 : covered
      root.style.setProperty('--sn-keyboard-inset', `${inset}px`)
      setKeyboardOpen(inset > 0)
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--sn-keyboard-inset')
    }
  }, [mobile])

  const [collapsed, setCollapsed] = useState(
    () =>
      (typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches) ||
      readLocal('sn.shell.collapsed', false),
  )
  const [width, setWidth] = useState(() => readLocal('sn.shell.width', s.SIDEBAR_W))

  // 宽度和折叠都落盘 —— 拖一次、收一次，重开还得是这个样子。
  // 手机上的折叠是**抽屉开合**，不是用户偏好，不写回桌面那份额。
  useEffect(() => {
    if (mobile) return
    writeLocal('sn.shell.collapsed', collapsed)
    writeLocal('sn.shell.width', width)
  }, [collapsed, width, mobile])

  // 手机：换到窄屏自动收起抽屉；点开一篇文档也收起（否则挡住正文）。
  useEffect(() => {
    if (!mobile) return
    setCollapsed(true)
    const off = ctx.on(OPEN_DOC, () => setCollapsed(true))
    return () => {
      void off()
    }
  }, [mobile, ctx])

  // 手机侧滑：左缘往右拉打开侧栏，抽屉上往左推收起。只认明显的横向手势，
  // 竖向滑动（滚正文）不抢。
  useEffect(() => {
    if (!mobile || typeof window === 'undefined') return
    let sx = 0
    let sy = 0
    let active = false
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (t.clientY > window.innerHeight - 64) return
      if (collapsed) {
        active = t.clientX <= 28
      } else {
        active = true
      }
      if (active) {
        sx = t.clientX
        sy = t.clientY
      }
    }
    const onMove = (e: TouchEvent) => {
      if (!active || e.touches.length !== 1) return
      const t = e.touches[0]
      const dx = t.clientX - sx
      const dy = t.clientY - sy
      if (Math.abs(dy) > 28 && Math.abs(dy) > Math.abs(dx)) {
        active = false
        return
      }
      if (collapsed && dx > 56) {
        active = false
        setCollapsed(false)
      } else if (!collapsed && dx < -56) {
        active = false
        setCollapsed(true)
      }
    }
    const onEnd = () => {
      active = false
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [mobile, collapsed])

  // Ctrl+B 开合侧栏。特意不认 Cmd —— Cmd+B 在编辑器里是加粗。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== 'b' || e.repeat) return
      e.preventDefault()
      setCollapsed((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  // `data-sn-shell` / `data-collapsed` 只给 Notion 主题把侧栏拉到窗口顶，原版不读。
  return (
    <div
      className={`${s.root} ${motion.fadeIn}`}
      data-sn-shell=""
      data-collapsed={collapsed ? '1' : '0'}
      data-mobile={mobile ? '1' : '0'}
      style={{ '--shell-sidebar-w': mobile ? 'min(84vw, 320px)' : `${width}px` } as CSSProperties}
    >
      <TitleBar
        ctx={ctx}
        collapsed={collapsed}
        mobile={mobile}
        onToggle={() => setCollapsed((v) => !v)}
      />
      <div className={s.body}>
        {mobile && !collapsed ? (
          <div className={s.scrim} onPointerDown={() => setCollapsed(true)} />
        ) : null}
        {/* 手机收起时**整块不渲染**：只把宽度设成 0 会让里面的文字溢出来盖住首页
            （2026-11-15 真机截图）。桌面照旧。 */}
        {!(mobile && collapsed) ? (
          <aside
            className={
              mobile
                ? `${s.sidebar} ${s.sidebarDrawer}`
                : collapsed
                  ? `${s.sidebar} ${s.sidebarCollapsed}`
                  : s.sidebar
            }
            style={mobile ? { width: 'min(84vw, 320px)' } : undefined}
          >
            <SlotHost ctx={ctx} name="sidebar.item" />
            {/* 折叠了就没有宽度可拖；手机抽屉也不拖 */}
            {!collapsed && !mobile && (
              <div
                className={s.resizer}
                role="separator"
                aria-orientation="vertical"
                onPointerDown={onResizeStart}
              />
            )}
          </aside>
        ) : null}
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
      {mobile && !keyboardOpen ? <MobileBar ctx={ctx} view={view} /> : null}
    </div>
  )
}
