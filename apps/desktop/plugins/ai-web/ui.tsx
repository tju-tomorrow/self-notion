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
      // 抓带在左缘：往左拖 = 变宽
      const move = (ev: globalThis.PointerEvent) => setWidth(clamp(startWidth - (ev.clientX - startX)))
      document.body.style.userSelect = 'none'
      const up = () => {
        document.body.style.userSelect = ''
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [width],
  )

  useEffect(() => {
    const el = screen.current
    if (!st.open || st.docId === null || !el) return
    let dead = false
    /** 上一次摆到哪儿了 —— `follow` 靠它判断「挪没挪」。 */
    let last: Box | null = null
    let raf = 0

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
     */
    const put = async (box: Box): Promise<void> => {
      if (st.mode === 'voice') {
        await ctx.rpc.call('aiweb:voice-show', box)
        await ctx.rpc.call('aiweb:hide')
        return
      }
      await ctx.rpc.call('aiweb:show', { url: siteUrl(st.site), ...box })
      await ctx.rpc.call('aiweb:voice-hide')
    }

    const place = async (): Promise<void> => {
      const box = measure()
      if (!box) return
      last = box
      await put(box)
    }

    /**
     * ★ **跟着走**（2026-10-07 修的）：原生子 webview 不吃 CSS，它在屏幕上就是钉死的矩形，
     *   只能我们自己盯着那块占位框搬。`ResizeObserver` **只报尺寸不报位置** —— 隔壁那一列
     *   开关、侧栏折叠，都会让这块**只挪不缩**，它一声不吭，view 就留在原地盖住邻居
     *   （用户截图那次：网页版 AI 压在「内置助手」上面）。窗口 resize 那条同样不够 ——
     *   它只覆盖窗口变大变小，覆盖不了内部布局改宽度。
     *   所以逐帧比矩形，**变了才发 IPC**：没变的时候一帧只有一次 `getBoundingClientRect`。
     */
    const follow = (): void => {
      if (dead) return
      const box = measure()
      if (box && (last === null || box.x !== last.x || box.y !== last.y || box.w !== last.w || box.h !== last.h)) {
        last = box
        void put(box).catch((e) => reportError('webai', e))
      }
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)

    void (async () => {
      try {
        // 先把面板摆出来（webview 建好），再注入 —— 反过来的话 webview 还不存在，注入扑空。
        await place()
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
      cancelAnimationFrame(raf)
      // 面板没了就把子 webview 收起来（**只是 hide，不销毁** —— 登录和当前对话都留着）。
      // 关面板那条路自己会调，这里是兜底：哪条路径漏了 hide，原生 view 就会留在屏幕上没人管。
      const now = getWebAiState()
      if (!now.open || now.docId === null) {
        void ctx.rpc.call('aiweb:hide').catch((e) => reportError('webai', e))
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
