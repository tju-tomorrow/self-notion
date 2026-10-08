/**
 * web 版 AI 的两块 UI：顶栏入口（`doc.header.right`）+ 右侧那一列面板（`doc.aside.right`）。
 *
 * ★ 选中浮出的「问 AI」**已经不在这个文件里**：D-0079 把它挪进了编辑器那条工具条
 *   （跟 B / I / U 同一条），走 `ctx.editor` 的工具栏 action → `ctx.get('webai').askSelection`。
 *
 * ★ 面板里那块 `screen` **会被原生子 webview 整个盖住** —— 它只是个占位框，子 webview 就量它
 *   的矩形来摆。所以头（标题 / 站点切换）和脚（状态）必须在 `screen` 外面，不然一起被盖掉。
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Context } from 'cordis'
import { ChatWithAiIcon, CloseIcon, StopIcon, VoiceIcon } from '@blocksuite/icons/rc'
import { reportError } from '../../src/kernel/errors'
import { readLocal, writeLocal } from '../../src/kernel/local'
import { Hint } from '../../src/ui/hint'
import { closePanel, openPanel, setSite, siteUrl } from './actions'
import { getWebAiState, SITE_ORDER, SITES, useWebAiState } from './state'
import { toggleSpeak, useVoicePhase } from './voice'
import * as watch from './watch'
import * as s from './ai-web.css'

/* ────────────────────────── 顶栏入口 ────────────────────────── */

/** 朗读那颗（`doc.header.right` 那一格里）。点下去会把右边那一列切到**朗读那个页面**
 *  （D-0113，看得见它在念什么）；那个页面是另一个 webview（`voice.ts`），关掉不丢声音。 */
export function WebAiHeader({ ctx }: { ctx: Context }) {
  const st = useWebAiState()
  const reading = useVoicePhase() === 'running'
  const label = reading ? ctx.i18n.t('voice.stop') : ctx.i18n.t('voice.start')

  return (
    <div className={s.entryBar}>
      <Hint text={label}>
        <button
          type="button"
          className={s.iconButton}
          aria-label={label}
          disabled={st.docId === null}
          onClick={() => toggleSpeak(ctx, st.docId)}
        >
          {reading ? <StopIcon width={18} height={18} /> : <VoiceIcon width={18} height={18} />}
        </button>
      </Hint>
    </div>
  )
}

/** 网页版 AI 那颗（`doc.header.leading`，动作区**最左端**）。 */
export function WebAiEntry({ ctx }: { ctx: Context }) {
  return (
    <div className={s.entryBar}>
      <Hint text={ctx.i18n.t('webai.open')}>
        <button
          type="button"
          className={s.iconButton}
          aria-label={ctx.i18n.t('webai.open')}
          onClick={() => openPanel()}
        >
          <ChatWithAiIcon width={18} height={18} />
        </button>
      </Hint>
    </div>
  )
}

/* ────────────────────────── 右侧那一列面板 ────────────────────────── */

/** 子 webview 的落点（逻辑像素，相对窗口）。字段名要和 Rust `aiweb::Rect` 对上。 */
interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function WebAiPanel({ ctx }: { ctx: Context }) {
  const st = useWebAiState()
  const screen = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(() => readLocal('sn.webai.width', s.PANEL_W))

  useEffect(() => {
    writeLocal('sn.webai.width', width)
  }, [width])

  /** 拖左缘改宽度。监听挂 window —— 指针跑出那 4px 也得跟着走。 */
  const onResizeStart = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width
      const clamp = (w: number) =>
        Math.min(s.PANEL_MAX_W, Math.max(s.PANEL_MIN_W, w))
      // 抓带在左缘：往左拖 = 变宽。
      // ★ 松手时指针可能已经飘到原生子 webview 上（`mouseup` 被那个 view 吃掉），
      //   `pointerup` 就永远不来 —— 这条抓带会一直跟着鼠标、`userSelect` 一直是 none：
      //   整个应用跟着一起不对劲。所以 `buttons` 掉到 0 就当松开。
      const move = (ev: globalThis.PointerEvent) => {
        if (ev.buttons === 0) {
          up()
          return
        }
        setWidth(clamp(startWidth - (ev.clientX - startX)))
      }
      document.body.style.userSelect = 'none'
      const up = () => {
        document.body.style.userSelect = ''
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [width],
  )

  useEffect(() => {
    const el = screen.current
    if (!st.open || st.docId === null || !el) return
    let dead = false
    /** 上一次摆到哪儿了。 */
    let last: Box | null = null
    let raf = 0
    /** 最近一次「挪了」的时刻 —— 刚挪过才逐帧跟（见下）。 */
    let movedAt = 0

    /** 这一块当前的矩形（就是子 webview 该占的地方）。量不到（还没布局）给 null。 */
    const measure = (): Box | null => {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return null
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
    }

    /**
     * 只负责「把子 webview 摆到这块的矩形上」。**不含注入** —— 它会被反复调。
     *
     * ★ 两个 webview 抢同一列：按 `mode` 摆一个、把另一个收起来（D-0113）。
     *   聊天那个收起来是 `hide`（页面留着）；朗读那个收起来是 `voice-hide`（挪窗口外）——
     *   藏起来会把声音一起掍掉。
     *   收「另一个」只在**切过模式**的那一发上做：常态下两个 `aiweb:*` 命令都在主线程上跑，
     *   每帧白搭一发攒起来就是整个应用没响应。
     */
    let placed: 'chat' | 'voice' | null = null
    const put = async (box: Box): Promise<void> => {
      if (st.mode === 'voice') {
        await ctx.rpc.call('aiweb:voice-show', box)
        if (placed !== 'voice') await ctx.rpc.call('aiweb:hide')
        placed = 'voice'
        return
      }
      await ctx.rpc.call('aiweb:show', { url: siteUrl(st.site), ...box })
      if (placed !== 'chat') await ctx.rpc.call('aiweb:voice-hide')
      placed = 'chat'
    }

    /**
     * 摆位**串成一条链**：同一时刻只有一发 IPC 在飞，中间叠上来的矩形只留最新那个。
     *
     * ★ 不这样做的话，拖面板 / 折叠侧栏那种「每帧都在挪」的动作会一口气发几十发
     *   （`aiweb:*` 是主线程命令，每发都动一次原生 view）—— 队列越堆越长，越堆越慢，
     *   于是**整个应用**跟着没有响应。丢中间帧、只发最新，才是把代价关在这一个插件里。
     */
    let waiting: Box | null = null
    let chain: Promise<void> = Promise.resolve()
    const push = (box: Box): Promise<void> => {
      waiting = box
      chain = chain.then(async () => {
        const b = waiting
        waiting = null
        if (dead || b === null) return
        const t0 = performance.now()
        try {
          await put(b)
          watch.put(performance.now() - t0, `${b.x},${b.y} ${b.w}×${b.h}`)
        } catch (e) {
          reportError('webai', e)
        }
      })
      return chain
    }

    /**
     * ★ **跟着走**（2026-10-07 修的）：原生子 webview 不吃 CSS，它在屏幕上就是钉死的矩形，
     *   只能我们自己盯着那块占位框搬。`ResizeObserver` **只报尺寸不报位置** —— 隔壁那一列
     *   开关、侧栏折叠，都会让这块**只挪不缩**，它一声不吭，view 就留在原地盖住邻居
     *   （用户截图那次：网页版 AI 压在「内置助手」上面）。窗口 resize 那条同样不够 ——
     *   它只覆盖窗口变大变小，覆盖不了内部布局改宽度。
     *
     * ★ **不逐帧常驻**：这个面板是常驻的（D-0074），逐帧的循环会一直占着主线程 ——
     *   静止时只剩一条 250ms 的心跳（`beat`：量一次矩形，没变就一个 IPC 都不发），
     *   谁报信（`ResizeObserver` / 窗口尺寸）才起一段逐帧追。
     */
    const look = (): void => {
      const box = measure()
      if (!box || (last !== null && box.x === last.x && box.y === last.y && box.w === last.w && box.h === last.h)) return
      last = box
      movedAt = performance.now()
      void push(box)
    }

    /** 逐帧追一段，静止就停 —— 心跳那条一直兜着。 */
    const chase = (): void => {
      raf = 0
      if (dead) return
      watch.frame(16)
      look()
      if (performance.now() - movedAt < 500) raf = requestAnimationFrame(chase)
    }

    /** 有人报信（尺寸 / 窗口变了）→ 起一段逐帧追。rAF 不响也不打紧，心跳还在。 */
    const kick = (): void => {
      if (dead || raf !== 0) return
      raf = requestAnimationFrame(chase)
    }

    /**
     * ★ **心跳**：一个永不自停的 250ms 定时器；rAF 只当「刚挪过」时的加速。
     *
     * 原来两条路是**串**起来的（逐帧追完才转定时器）：页面一旦被 WebKit 判成不可见 / 被遮住，
     * rAF 直接不响，那一串就断在这儿 —— 定时器从来没被排上，**子 webview 从此再没人摆**，
     * 钉在上一处不走。日志里那一串「主线程迟到 750ms、摆位 0 次」就是它：定时器被节流到
     * 1Hz（不是主线程真被占住），而用户看到的就是「打开 webai 以后 webview 卡在那里」。
     */
    const beat = window.setInterval(() => {
      if (dead) return
      watch.frame(250)
      look()
      if (performance.now() - movedAt < 500) kick()
    }, 250)

    const ro = new ResizeObserver(kick)
    ro.observe(el)
    window.addEventListener('resize', kick)
    movedAt = performance.now()
    watch.reset()
    kick()

    void (async () => {
      try {
        // 先把面板摆出来（webview 建好），再注入 —— 反过来的话 webview 还不存在，注入扑空。
        const box = measure()
        if (box) {
          last = box
          movedAt = performance.now()
          await push(box)
        }
        if (dead) return
        if (st.mode === 'voice') return
        const text = getWebAiState().pending
        if (text !== '') await ctx.rpc.call('aiweb:inject', { text })
      } catch (err) {
        reportError('webai', err)
      }
    })()

    return () => {
      dead = true
      if (raf !== 0) cancelAnimationFrame(raf)
      clearInterval(beat)
      ro.disconnect()
      window.removeEventListener('resize', kick)
      // 面板没了就把子 webview 收起来（**只是 hide，不销毁** —— 登录和当前对话都留着）。
      // 关面板那条路自己会调，这里是兜底：哪条路径漏了 hide，原生 view 就会留在屏幕上没人管。
      const now = getWebAiState()
      if (!now.open || now.docId === null) {
        // ★ 必须接在摆位链**末尾**：飞在半路的那一发 `show` 会比 hide 晚落地，落地就把刚收起来的
        //   原生 view 又摆回来了 —— 而且从那一刻起再没人收它。两个都收：聊天 hide、
        //   朗读挪回窗口外（挪回去不掐声音）。
        chain = chain.then(async () => {
          await ctx.rpc.call('aiweb:hide')
          await ctx.rpc.call('aiweb:voice-hide')
        })
        void chain.catch((e) => reportError('webai', e))
      }
    }
  }, [ctx, st.open, st.docId, st.site, st.mode])

  if (!st.open || st.docId === null) return null

  return (
    <aside className={s.panel} style={{ width }}>
      <div
        className={s.resizer}
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
      />
      <div className={s.head}>
        <span className={s.headTitle}>
          {ctx.i18n.t(st.mode === 'voice' ? 'voice.panel' : 'webai.title')}
        </span>
        <button
          type="button"
          className={s.iconButton}
          title={ctx.i18n.t('webai.close')}
          aria-label={ctx.i18n.t('webai.close')}
          onClick={() => closePanel(ctx)}
        >
          <CloseIcon width={18} height={18} />
        </button>
      </div>

      {st.mode === 'voice' ? null : (
        <div className={s.siteBar}>
          {SITE_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              className={key === st.site ? s.siteOn : s.site}
              onClick={() => setSite(key)}
            >
              {SITES[key].label}
            </button>
          ))}
        </div>
      )}

      {/* 这块被原生 webview 盖住 —— 里面写什么用户都看不见。 */}
      <div className={s.screen} ref={screen} />

      <div className={s.foot}>
        {st.mode === 'voice'
          ? ctx.i18n.t('voice.panelHint')
          : st.status || ctx.i18n.t('webai.hint')}
      </div>
    </aside>
  )
}
