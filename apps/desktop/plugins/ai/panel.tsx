/**
 * 内置助手的两块地儿，共用同一条对话：
 *   - **整页**（`main.page` 槽）—— 左历史、右对话，D-0095；
 *   - **右侧那一列**（`doc.aside.agent` 槽）—— 只有对话，D-0098：用户要的是
 *     「边聊边看到笔记」，所以正文留着，助手挤在右边，跟评论列、网页版 AI 列能同时开着。
 *
 * ★ 开整页 = 往标签条里开一个虚拟标签（`AGENT_TAB_ID`），外壳见到那个 id 就让出主区。
 *   右侧那一列不占标签 —— 它是个开关（顶栏那颗宠物的按钮，`agent.tsx`）。
 * ★ **它是活的**（用户：「claude code 那样 动态的」）：工具行跑着转圈 + 计时，跑完留
 *   `⏺ vfs_read(路径) (0.4s)`，连调同一个工具合堆成 `×4`；在想的后面挂秒数。
 * ★ 模型回的字走 `md.tsx` 那套极简 markdown（那段字里 `**加粗**` 满屏都是）。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react'
import type { Context } from 'cordis'
import { ArrowUpBigIcon, CloseIcon, PageIcon, PlusIcon, SidebarIcon, StopIcon } from '@blocksuite/icons/rc'

import { AGENT_TAB_ID, CLOSE_TAB, type AiService } from '../../src/kernel/contract'
import { readLocal, writeLocal } from '../../src/kernel/local'
import * as s from './ai.css'
import { runTurn } from './loop'
import { Markdown } from './md'
import { placeOf, type Place } from './place'
import {
  closeDock,
  currentSession,
  openDock,
  newSession,
  openSession,
  sessionsByRecency,
  stop,
  useAiState,
  type Line,
  type ToolMark,
} from './state'
import { formatTokens, sessionTokens } from './tokens'

/** 空对话里那三句点一下就能问的示例。 */
const TIPS = ['agent.tip1', 'agent.tip2', 'agent.tip3'] as const

/** Claude Code 那个转圈：八点盲文，一格一格转。 */
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** 右侧那一列的宽度。默认 380、能拖，落在 `localStorage`（跟网页版 AI 面板一个套路）。 */
const DOCK_W = 380
const DOCK_MIN_W = 300
const DOCK_MAX_W = 900
const DOCK_KEY = 'sn.agent.width'

/* ────────────────────────── 整页：左历史 + 右对话 ────────────────────────── */

export function AiPanel({ ctx, ai }: { ctx: Context; ai: AiService }) {
  const pet = ctx.get('mascot')

  /** 把整页收成右边一列（D-0104 续）：**先离开这个标签**（标签条自己会把邻居顶上来），
   *  再把右侧那一列打开 —— 用户点「收」，期望的是「变成一个右侧边栏」，不是什么都不发生。 */
  const collapse = () => {
    ctx.emit(CLOSE_TAB, { id: AGENT_TAB_ID })
    openDock()
  }

  return (
    <div className={s.page}>
      <aside className={s.side}>
        <div className={s.brand}>
          {pet ? <span className={s.mark}>{pet.face(24) as ReactNode}</span> : null}
          {ctx.i18n.t('agent.title')}
        </div>
        <button type="button" className={s.newChat} onClick={() => newSession()}>
          <PlusIcon width={16} height={16} />
          {ctx.i18n.t('agent.new')}
        </button>
        <div className={s.historyLabel}>{ctx.i18n.t('agent.history')}</div>
        <ThreadList ctx={ctx} />
      </aside>
      <section className={s.chat}>
        {/* 右上角那一颗：收进右侧栏。位置是用户圈的（就在这一页的右上角）。 */}
        <div className={s.chatBar}>
          <button
            type="button"
            className={s.dockIcon}
            title={ctx.i18n.t('agent.collapse')}
            aria-label={ctx.i18n.t('agent.collapse')}
            onClick={collapse}
          >
            <span style={{ display: 'flex', transform: 'scaleX(-1)' }}>
              <SidebarIcon width={20} height={20} />
            </span>
          </button>
        </div>
        <ChatBody ctx={ctx} ai={ai} />
      </section>
    </div>
  )
}

/* ────────────────────────── 右侧那一列 ────────────────────────── */

/** 只装对话，正文留在旁边看得见（用户：「边聊 边看到 笔记」）。
 *  历史不丢：头上一颗按钮把对话换成历史列，点一条就换过去。 */
export function AgentDock({ ctx, ai }: { ctx: Context; ai: AiService }) {
  const pet = ctx.get('mascot')
  const st = useAiState()
  const [width, setWidth] = useState(() => readLocal(DOCK_KEY, DOCK_W))
  const [history, setHistory] = useState(false)

  useEffect(() => {
    writeLocal(DOCK_KEY, width)
  }, [width])

  /** 拖左缘改宽度。监听挂 window —— 指针跑出那 4px 也得跟着走（同网页版 AI 面板）。 */
  const onResizeStart = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width
      const clamp = (w: number) => Math.min(DOCK_MAX_W, Math.max(DOCK_MIN_W, w))
      // 抓带在左缘：往左拖 = 变宽
      const move = (ev: globalThis.PointerEvent) =>
        setWidth(clamp(startWidth - (ev.clientX - startX)))
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

  // 关着就什么都不画。**必须在这儿判**，不能在注册槽位那一头 —— 槽宿主不看 `docked`。
  if (!st.docked) return null

  return (
    <aside className={s.dock} style={{ width }}>
      <div
        className={s.dockResizer}
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
      />
      <div className={s.dockHead}>
        {pet ? <span className={s.mark}>{pet.face(20) as ReactNode}</span> : null}
        <span className={s.dockTitle}>{ctx.i18n.t('agent.title')}</span>
        <button
          type="button"
          className={s.dockButton}
          title={ctx.i18n.t('agent.history')}
          aria-label={ctx.i18n.t('agent.history')}
          aria-pressed={history}
          onClick={() => setHistory((v) => !v)}
        >
          {/* 一个沙漏式的图标意思不明确，用文字：「历史」/「对话」来回切。 */}
          {ctx.i18n.t(history ? 'agent.chat' : 'agent.history')}
        </button>
        <button
          type="button"
          className={s.dockIcon}
          title={ctx.i18n.t('agent.new')}
          aria-label={ctx.i18n.t('agent.new')}
          onClick={() => {
            newSession()
            setHistory(false)
          }}
        >
          <PlusIcon width={16} height={16} />
        </button>
        <button
          type="button"
          className={s.dockIcon}
          title={ctx.i18n.t('agent.close')}
          aria-label={ctx.i18n.t('agent.close')}
          onClick={() => closeDock()}
        >
          <CloseIcon width={16} height={16} />
        </button>
      </div>
      {history ? (
        <div className={s.dockListWrap}>
          <ThreadList ctx={ctx} picked={() => setHistory(false)} />
        </div>
      ) : (
        <ChatBody ctx={ctx} ai={ai} compact />
      )}
    </aside>
  )
}

/* ────────────────────────── 两处共用的两块 ────────────────────────── */

/** 左侧历史那一列。`picked` 是右侧那一列用的：点完一条就切回对话。 */
function ThreadList({ ctx, picked }: { ctx: Context; picked?: () => void }) {
  const st = useAiState()
  return (
    <div className={s.historyList}>
      {sessionsByRecency().map((sess) => {
        const tokens = sessionTokens(sess)
        return (
          <button
            key={sess.id}
            type="button"
            className={sess.id === st.currentId ? s.threadOn : s.thread}
            title={sess.title || ctx.i18n.t('agent.untitled')}
            onClick={() => {
              openSession(sess.id)
              picked?.()
            }}
          >
            <span className={s.threadLabel}>{sess.title || ctx.i18n.t('agent.untitled')}</span>
            {tokens > 0 ? (
              <span className={s.threadTok} title={ctx.i18n.t('agent.tokens', { n: tokens })}>
                {formatTokens(tokens)}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** 对话本身：上面那些行 + 下面那个输入胶囊。整页和右侧那一列都是它。
 *  `compact` = 右边那一列里那份（窄，边距收一半）。 */
/** 「用户在看哪一篇」：id → 树里的路径（`place.ts`）。换文档才重算。 */
function usePlace(ctx: Context, id: string | null): Place | null {
  const [place, setPlace] = useState<Place | null>(null)
  useEffect(() => {
    let alive = true
    if (id === null) {
      setPlace(null)
      return
    }
    placeOf(ctx, id).then((next) => {
      if (alive) setPlace(next)
    })
    return () => {
      alive = false
    }
  }, [ctx, id])
  return place
}

function ChatBody({ ctx, ai, compact }: { ctx: Context; ai: AiService; compact?: boolean }) {
  const st = useAiState()
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const lines = currentSession().lines
  const pet = ctx.get('mascot')
  const place = usePlace(ctx, st.viewingDoc)

  // ★ 只在**用户本来就在底下**的时候才跟着滚。上一版每次都 `scrollTop = scrollHeight`：
  //   用户往回翻想读上面那段时会被一次次拽回底部（「他会强行带我走」「无法拉到最下面」）。
  const stick = useRef(true)
  const onScroll = () => {
    const el = list.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  useEffect(() => {
    const el = list.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines.length, st.draft])

  // 换会话 = 从头看：回到最底下并重新跟上。
  useEffect(() => {
    stick.current = true
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [st.currentId])

  // ★ 行只跟 `lines` 走，**不跟时钟走**。转圈和计时各自在那一行里（`ToolRow` / `ThinkingRow`）
  //   —— 不然每 80ms 一次的重渲染会把整屏 markdown 重新解析一遍（用户：「非常卡」）。
  const rendered = useMemo(() => rows(lines), [lines])

  const ask = (prompt: string) => {
    const q = prompt.trim()
    if (!q || st.busy) return
    setText('')
    stick.current = true
    void runTurn(ctx, ai, q)
  }

  return (
    <>
      <div className={compact ? s.dockStream : s.stream} ref={list} onScroll={onScroll}>
        {lines.length === 0 && !st.busy ? (
          <div className={s.welcome}>
            {pet ? <span className={s.mark}>{pet.face(72) as ReactNode}</span> : null}
            <h2 className={s.welcomeTitle}>{ctx.i18n.t('agent.welcome')}</h2>
            <div className={s.suggest}>
              {TIPS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={s.suggestChip}
                  onClick={() => ask(ctx.i18n.t(key))}
                >
                  {ctx.i18n.t(key)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {rendered}
            {/* 生成中：光标跟着字长，一段还没定稿的文本就是这个样子。 */}
            {st.draft ? (
              <div className={s.bubbleAi}>
                <Markdown text={st.draft} />
                <span className={s.cursor} />
              </div>
            ) : null}
            {st.busy && !st.draft ? (
              <ThinkingRow since={st.busySince} label={ctx.i18n.t('agent.thinking')} />
            ) : null}
            {st.error ? <p className={s.error}>{st.error}</p> : null}
          </>
        )}
      </div>

      <div className={compact ? s.dockFoot : s.foot}>
        {/* 「在看哪一篇」看得见的一颗（用户红框：输入框上面、靠左）。系统提示里也带同一条
            （D-0107），这颗是给人看的：让他知道 AI 这会儿把「这篇」当成哪一篇。 */}
        {place ? (
          <div className={s.place} title={`${place.path} · ${ctx.i18n.t('agent.placeHint')}`}>
            <PageIcon width={12} height={12} />
            <span>{place.path}</span>
          </div>
        ) : null}
        <div className={s.box}>
          <textarea
            className={s.input}
            value={text}
            rows={1}
            placeholder={ctx.i18n.t('agent.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter 送、Shift+Enter 换行（备注：输入法是 composition，`nativeEvent.isComposing` 时别拦）。
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                ask(text)
              }
            }}
          />
          {/* 忙着的时候同一颗位置换成中断（Claude Code 那样）—— 它一直在转圈不动，得有个出口。 */}
          <button
            type="button"
            className={st.busy ? s.stopButton : s.send}
            title={ctx.i18n.t(st.busy ? 'agent.stop' : 'agent.send')}
            aria-label={ctx.i18n.t(st.busy ? 'agent.stop' : 'agent.send')}
            disabled={!st.busy && text.trim() === ''}
            onClick={() => (st.busy ? stop() : ask(text))}
          >
            {st.busy ? (
              <StopIcon width={16} height={16} />
            ) : (
              <ArrowUpBigIcon width={18} height={18} />
            )}
          </button>
        </div>
        <span className={s.hint}>{ctx.i18n.t('agent.hint')}</span>
      </div>
    </>
  )
}

/* ────────────────────────── 把行摊成 React 节点 ────────────────────────── */

/** 用户靠右的圆气泡、助手走 markdown、工具那几行按名字合堆。 */
function rows(lines: Line[]): ReactNode[] {
  const out: ReactNode[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (line.role === 'user') {
      out.push(
        <p key={i} className={s.bubbleUser}>
          {line.text}
        </p>,
      )
      continue
    }
    if (!line.tool) {
      // 老会话里工具行没有 `tool`（D-0097 之前存的）—— 当一句淡字画出来。
      out.push(
        <p key={i} className={s.note}>
          <span className={s.noteDot} />
          {line.text}
        </p>,
      )
      continue
    }
    // 连着调同一个工具就合成一条 —— 一屏五个「vfs_list」谁也不看。
    const marks = [line.tool]
    while (i + 1 < lines.length) {
      const next = lines[i + 1]?.tool
      const tail = marks[marks.length - 1]
      if (!next || next.name !== line.tool.name || next.ms === null || tail?.ms === null) break
      marks.push(next)
      i++
    }
    out.push(<ToolRow key={i} marks={marks} />)
  }
  return out
}

/** 工具那一行：`⏺ vfs_read(/tree/我与我.md) (0.4s)` / 跑着的时候是个转圈 + 活计时。 */
function ToolRow({ marks }: { marks: ToolMark[] }) {
  const first = marks[0]
  // 只有还在跑的那一行自己走时钟 —— 跑完的行一次都不重画。
  const now = useClock(first?.ms === null)
  if (!first) return null
  const running = first.ms === null
  const failed = marks.some((mark) => mark.failed)
  const spent = marks.reduce((sum, mark) => sum + (mark.ms ?? Math.max(0, now - mark.start)), 0)

  return (
    <p className={running ? `${s.tool} ${s.toolOn}` : s.tool}>
      <span className={s.toolMark}>{running ? frame(now) : failed ? '✕' : '⏺'}</span>
      <span className={s.toolName}>{first.name}</span>
      {first.detail ? <span className={s.toolDetail}>({first.detail})</span> : null}
      {marks.length > 1 ? <span className={s.toolDetail}>×{marks.length}</span> : null}
      <span className={s.toolTime}>({secs(spent)})</span>
    </p>
  )
}

/** 「正在想…」后面那个计时：自己走，不拖着整屏一起重画。 */
function ThinkingRow({ since, label }: { since: number; label: string }) {
  const now = useClock(true)
  return (
    <p className={s.tool}>
      <span className={s.toolMark}>{frame(now)}</span>
      <span>{label}</span>
      <span className={s.toolTime}>({secs(now - since)})</span>
    </p>
  )
}

/** `0.4s` / `1m03s`。 */
function secs(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  return `${m}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`
}

function frame(now: number): string {
  return SPIN[Math.floor(now / 80) % SPIN.length] ?? '⠋'
}

/** 有东西在转的时候每 80ms 走一格（转圈和计时都靠它）。停下来就不再有定时器。 */
function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 80)
    return () => window.clearInterval(id)
  }, [active])
  return now
}
