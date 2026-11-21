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
import {
  ArrowUpBigIcon,
  CloseIcon,
  FolderIcon,
  PageIcon,
  PlusIcon,
  SidebarIcon,
  StopIcon,
} from '@blocksuite/icons/rc'

import { AGENT_TAB_ID, CLOSE_TAB, type AiService } from '../../src/kernel/contract'
import { readLocal, writeLocal } from '../../src/kernel/local'
import { useImeGuard } from '../../src/ui/ime'
import * as s from './ai.css'
import { runTurn, type Quote } from './loop'
import { Markdown, type CiteCtx } from './md'
import { placeOf, type Place } from './place'
import {
  loadScopes,
  matchesScope,
  revealChunk,
  scopeLabel,
  type RagChunk,
  type RagScope,
  type RagScopeItem,
  type RagTrace,
} from './rag'
import {
  closeDock,
  currentSession,
  openDock,
  newSession,
  openSession,
  resolveApproval,
  sessionsByRecency,
  stop,
  toggleAutoRun,
  useAiState,
  type Approval,
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
  // 正文里划着的文字 = 这一轮要一起送过去的原文（仿 Notion：不按钮，只看有没有选中）。
  const [picked, setPicked] = useState<string | null>(null)
  /** 点过 ✕ 的那一段 —— 选区还在，但用户说了不要，别每帧又冒出来。 */
  const dropped = useRef('')
  /** 这一问圈定的范围（D-0200）。发完清空，不带进下一问。 */
  const [scope, setScope] = useState<RagScope | null>(null)
  /** `@` 选择器。`start` 是那个 `@` 在正文里的位置。 */
  const [picker, setPicker] = useState<{ start: number; q: string; active: number } | null>(null)
  const [scopes, setScopes] = useState<RagScopeItem[]>([])
  const [scopesLoaded, setScopesLoaded] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const ime = useImeGuard()

  useEffect(() => {
    let raf = 0
    const read = () => {
      raf = 0
      const next = ctx.editor.selectedText()
      if (next === null) dropped.current = ''
      setPicked((prev) => (prev === next ? prev : next))
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(read)
    }
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('pointerup', schedule)
    schedule()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('pointerup', schedule)
    }
  }, [ctx])

  const quoted = picked !== null && picked !== dropped.current ? picked : null

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
  const rendered = useMemo(() => rows(lines, ctx), [lines, ctx])

  /** 流式那段也要认引用 —— 从最近一条检索行往回找。 */
  const liveCite = useMemo<CiteCtx | undefined>(() => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const one = lines[i]
      if (one?.rag) return { chunks: one.rag.chunks, open: (chunk) => revealChunk(ctx, chunk) }
      if (one?.role === 'user') break
    }
    return undefined
  }, [lines, ctx])

  const options = picker ? scopes.filter((item) => matchesScope(item, picker.q)).slice(0, 8) : []
  const active = picker ? Math.min(picker.active, Math.max(0, options.length - 1)) : 0

  const syncPicker = (value: string, caret: number) => {
    const token = atToken(value, caret)
    if (!token) {
      setPicker(null)
      return
    }
    if (!scopesLoaded) {
      void loadScopes(ctx)
        .then((items) => setScopes(items))
        .catch(() => setScopes([]))
        .finally(() => setScopesLoaded(true))
    }
    setPicker((prev) =>
      prev && prev.start === token.start
        ? { ...prev, q: token.q, active: 0 }
        : { start: token.start, q: token.q, active: 0 },
    )
  }

  const pick = (item: RagScopeItem) => {
    if (!picker) return
    setText(text.slice(0, picker.start) + text.slice(picker.start + 1 + picker.q.length))
    setScope(
      item.kind === 'doc'
        ? item.id === undefined
          ? null
          : { kind: 'doc', id: item.id, path: item.path, title: item.title }
        : { kind: 'dir', path: item.path, title: item.title },
    )
    setPicker(null)
    requestAnimationFrame(() => input.current?.focus())
  }

  const ask = (prompt: string) => {
    const q = prompt.trim()
    if (!q || st.busy) return
    // 发的那一刻现读一次 —— 「选完立刻回车」不会错过还没跑到的 rAF。
    const now = ctx.editor.selectedText()
    const quote: Quote | undefined =
      now && now !== dropped.current
        ? { text: now, path: place?.path ?? null, id: st.viewingDoc }
        : undefined
    setText('')
    setPicker(null)
    stick.current = true
    void runTurn(ctx, ai, q, quote, scope ?? undefined)
    setScope(null)
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
                <Markdown text={st.draft} cite={liveCite} />
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
        {/* 写操作过闸：模型要改库，卡就贴在这儿等人点（不会被聊天记录滚走）。 */}
        {st.pending ? <ApprovalCard ctx={ctx} pending={st.pending} /> : null}
        {/* 这一问圈定的范围。看得见、可撤 —— 发出去之后这里会清空。 */}
        {scope ? (
          <div className={s.scopeChip} title={scopeLabel(scope)}>
            {scope.kind === 'dir' ? (
              <FolderIcon width={12} height={12} />
            ) : (
              <PageIcon width={12} height={12} />
            )}
            <span className={s.scopePath}>{scopeLabel(scope)}</span>
            <span className={s.scopeKind}>
              {ctx.i18n.t(scope.kind === 'dir' ? 'agent.scopeDir' : 'agent.scopeDoc')}
            </span>
            <button
              type="button"
              className={s.scopeClear}
              title={ctx.i18n.t('agent.scopeRemove')}
              aria-label={ctx.i18n.t('agent.scopeRemove')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setScope(null)}
            >
              <CloseIcon width={12} height={12} />
            </button>
          </div>
        ) : null}
        {/* 「在看哪一篇」看得见的一颗（用户红框：输入框上面、靠左）。系统提示里也带同一条
            （D-0107），这颗是给人看的：让他知道 AI 这会儿把「这篇」当成哪一篇。 */}
        {place && !scope ? (
          <div className={s.place} title={`${place.path} · ${ctx.i18n.t('agent.placeHint')}`}>
            <PageIcon width={12} height={12} />
            <span>{place.path}</span>
          </div>
        ) : null}
        {/* 正文里划着的那段：看得见、可撤，发出去时一起给模型（气泡里只留用户的问题）。 */}
        {quoted ? (
          <div className={s.quote} title={ctx.i18n.t('agent.quote', { n: quoted.length })}>
            <span className={s.quoteText}>「{quoted}」</span>
            <button
              type="button"
              className={s.quoteClear}
              title={ctx.i18n.t('agent.quoteClear')}
              aria-label={ctx.i18n.t('agent.quoteClear')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                dropped.current = quoted
                setPicked(null)
              }}
            >
              <CloseIcon width={12} height={12} />
            </button>
          </div>
        ) : null}
        <div className={s.composer}>
          {/* `@` 选择器：浮在输入胶囊上方。目录在前、单篇在后。 */}
          {picker ? (
            <div className={s.picker} role="listbox" aria-label={ctx.i18n.t('agent.scopePick')}>
              <div className={s.pickHead}>{ctx.i18n.t('agent.scopePick')}</div>
              {options.length === 0 ? (
                <div className={s.pickEmpty}>
                  {!scopesLoaded ? ctx.i18n.t('agent.thinking') : ctx.i18n.t('agent.scopeEmpty')}
                </div>
              ) : (
                options.map((item, at) => (
                  <button
                    key={`${item.kind}\u0000${item.path}`}
                    type="button"
                    role="option"
                    aria-selected={at === active}
                    className={at === active ? s.pickOn : s.pick}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setPicker((p) => (p ? { ...p, active: at } : p))}
                    onClick={() => pick(item)}
                  >
                    {item.kind === 'dir' ? (
                      <FolderIcon width={14} height={14} />
                    ) : (
                      <PageIcon width={14} height={14} />
                    )}
                    <span className={s.pickMain}>
                      <span className={s.pickTitle}>{item.title}</span>
                      <span className={s.pickPath}>{item.path}</span>
                    </span>
                    <span className={s.pickCount}>
                      {ctx.i18n.t('agent.scopeDocs', { n: item.count })}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
          <div className={s.box}>
            <textarea
              ref={input}
              className={s.input}
              value={text}
              rows={1}
              placeholder={ctx.i18n.t('agent.placeholder')}
              onChange={(e) => {
                setText(e.target.value)
                syncPicker(e.target.value, e.target.selectionStart ?? e.target.value.length)
              }}
              onBlur={() => setPicker(null)}
              onCompositionStart={ime.onCompositionStart}
              onCompositionEnd={ime.onCompositionEnd}
              onKeyDown={(e) => {
                // 输入法选词 / 送字时一律不拦。
                if (ime.blocked(e)) return
                // ⇧Tab：本次对话里切「每次确认 / 自动执行」。
                if (e.key === 'Tab' && e.shiftKey) {
                  e.preventDefault()
                  toggleAutoRun()
                  return
                }
                if (picker) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    if (options.length === 0) return
                    const step = e.key === 'ArrowDown' ? 1 : options.length - 1
                    setPicker((p) => (p ? { ...p, active: (active + step) % options.length } : p))
                    return
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const item = options[active]
                    if (item) pick(item)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setPicker(null)
                    return
                  }
                }
                // Enter 送、Shift+Enter 换行。
                if (e.key === 'Enter' && !e.shiftKey) {
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
        </div>
        <div className={s.footRow}>
          <span className={s.hint}>{ctx.i18n.t('agent.hint')}</span>
          <button
            type="button"
            className={st.autoRun ? s.modeOn : s.mode}
            title={ctx.i18n.t(st.autoRun ? 'agent.modeAutoHint' : 'agent.modeAskHint')}
            aria-label={ctx.i18n.t(st.autoRun ? 'agent.modeAuto' : 'agent.modeAsk')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleAutoRun}
          >
            {ctx.i18n.t(st.autoRun ? 'agent.modeAuto' : 'agent.modeAsk')}
            <kbd className={s.modeKey}>⇧Tab</kbd>
          </button>
        </div>
      </div>
    </>
  )
}

/* ────────────────────────── 写操作过闸 ────────────────────────── */

/** 模型要动库时贴出来的那张卡：看清改哪、改什么，再决定。 */
function ApprovalCard({ ctx, pending }: { ctx: Context; pending: Approval }) {
  return (
    <div className={s.approval} role="alertdialog" aria-label={ctx.i18n.t('agent.approveTitle')}>
      <div className={s.approveHead}>
        <span className={s.approveTitle}>{ctx.i18n.t('agent.approveTitle')}</span>
        <span className={s.approveTool}>{pending.name}</span>
        {pending.detail ? <span className={s.approveTarget}>{pending.detail}</span> : null}
      </div>
      {pending.preview ? <pre className={s.approvePreview}>{pending.preview}</pre> : null}
      <div className={s.approveActions}>
        <button
          type="button"
          className={s.approveDeny}
          onClick={() => resolveApproval('deny')}
        >
          {ctx.i18n.t('agent.approveDeny')}
        </button>
        <button
          type="button"
          className={s.approveOnce}
          onClick={() => resolveApproval('once')}
        >
          {ctx.i18n.t('agent.approveOnce')}
        </button>
        <button
          type="button"
          className={s.approveAlways}
          onClick={() => resolveApproval('always')}
        >
          {ctx.i18n.t('agent.approveAlways')}
        </button>
      </div>
    </div>
  )
}

/* ────────────────────────── 把行摊成 React 节点 ────────────────────────── */

/** 用户靠右的圆气泡、助手走 markdown；工具调用按**一轮一组**收进可折叠的思维链（默认折叠）。 */
function rows(lines: Line[], ctx: Context): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line) {
      i++
      continue
    }
    if (line.role === 'user') {
      out.push(
        <div key={i} className={s.userTurn}>
          {line.scope ? <ScopeTag ctx={ctx} scope={line.scope} /> : null}
          <p className={s.bubbleUser}>{line.text}</p>
        </div>,
      )
      i++
      continue
    }
    // 一轮 = 到下一个用户发言为止。这一轮的工具调用合成一块，**摆在第一次调用的位置**，
    // 它前面 / 后面的字各归各位。检索块也在这条线上，答案的 `[n]` 从它取来源。
    const start = i
    const marks: ToolMark[] = []
    const before: ReactNode[] = []
    const after: ReactNode[] = []
    let rag: RagTrace | null = null
    let cite: CiteCtx | undefined
    let seen = false
    while (i < lines.length) {
      const one = lines[i]
      if (!one || one.role === 'user') break
      if (one.rag) {
        rag = one.rag
        cite = { chunks: rag.chunks, open: (chunk) => revealChunk(ctx, chunk) }
        before.push(<RagBlock key={i} ctx={ctx} trace={rag} />)
        seen = true
      } else if (one.tool) {
        marks.push(one.tool)
        seen = true
      } else {
        const node =
          one.role === 'ai' ? (
            <div key={i} className={s.bubbleAi}>
              <Markdown text={one.text} cite={cite} />
            </div>
          ) : (
            // 老会话里工具行没有 `tool`（D-0097 之前存的）—— 当一句淡字画出来。
            <p key={i} className={s.note}>
              <span className={s.noteDot} />
              {one.text}
            </p>
          )
        if (seen) after.push(node)
        else before.push(node)
      }
      i++
    }
    out.push(...before)
    if (marks.length) out.push(<ThoughtBlock key={`t${start}`} ctx={ctx} marks={marks} />)
    out.push(...after)
    if (rag) out.push(<SourceCards key={`s${start}`} ctx={ctx} trace={rag} />)
  }
  return out
}

/** 用户气泡上方那一颗：这一问圈的范围。 */
function ScopeTag({ ctx, scope }: { ctx: Context; scope: RagScope }) {
  return (
    <div className={s.turnScope} title={scope.title}>
      {scope.kind === 'dir' ? (
        <FolderIcon width={12} height={12} />
      ) : (
        <PageIcon width={12} height={12} />
      )}
      <span>{scopeLabel(scope)}</span>
      <span className={s.turnScopeKind}>
        {ctx.i18n.t(scope.kind === 'dir' ? 'agent.scopeDir' : 'agent.scopeDoc')}
      </span>
    </div>
  )
}

/** 检索过程：默认折叠，点开是预算、覆盖和每一段为什么被选中。 */
function RagBlock({ ctx, trace }: { ctx: Context; trace: RagTrace }) {
  const [open, setOpen] = useState(false)
  const failed = trace.empty !== undefined
  const emptyKey =
    trace.empty === 'no_docs'
      ? 'agent.ragEmptyNoDocs'
      : trace.empty === 'no_projection'
        ? 'agent.ragEmptyNoProjection'
        : 'agent.ragEmptyNoMatch'
  const scan = ctx.i18n.t('agent.ragScan', {
    scanned: trace.docsScanned,
    chunks: trace.chunks.length,
    time: secs(trace.tookMs),
  })
  const max = Math.max(1, ...trace.chunks.map((c) => c.score))
  const unused = Math.max(0, trace.docsTotal - trace.usedDocs.length)

  return (
    <div className={s.rag}>
      <button
        type="button"
        className={s.ragHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={s.thoughtChev}>{open ? '▾' : '▸'}</span>
        <span className={s.toolMark}>{failed ? '✕' : '⏺'}</span>
        <span className={s.ragTitle}>
          {ctx.i18n.t('agent.ragSearch', { path: scopeLabel(trace.scope) })}
        </span>
        <span className={s.ragMeta}>{failed ? ctx.i18n.t(emptyKey) : scan}</span>
      </button>
      {open ? (
        <div className={s.ragBody}>
          <p className={s.ragLine}>
            {ctx.i18n.t('agent.ragBudget', {
              chars: trace.chars,
              scored: trace.chunksScored,
              skipped: trace.docsSkipped,
            })}
          </p>
          <p className={s.ragLine}>
            {trace.terms.length
              ? ctx.i18n.t('agent.ragTerms', { terms: trace.terms.join(' · ') })
              : ctx.i18n.t('agent.ragTermsNone')}
            {trace.semantic ? ` · ${ctx.i18n.t('agent.ragSemantic')}` : ''}
          </p>
          <p className={s.ragLine}>
            {ctx.i18n.t('agent.ragCoverage', {
              total: trace.docsTotal,
              hit: trace.docsHit,
              used: trace.usedDocs.length,
            })}
            {unused > 0 ? ` · ${ctx.i18n.t('agent.ragUnused', { n: unused })}` : ''}
          </p>
          {trace.usedDocs.length > 0 ? (
            <div className={s.usedDocs}>
              {trace.usedDocs.map((doc) => (
                <span key={doc.id} className={s.usedDoc} title={doc.path}>
                  {doc.title}
                </span>
              ))}
            </div>
          ) : null}
          {trace.chunks.map((chunk) => (
            <div key={chunk.n} className={s.ragChunk}>
              <span className={s.ragN}>{chunk.n}</span>
              <span className={s.ragChunkMain}>
                <span className={s.ragChunkTitle}>
                  {chunk.title}
                  {chunk.heading ? ` · ${chunk.heading}` : ''}
                </span>
                <span className={s.ragChunkText}>{chunk.text}</span>
              </span>
              <span className={s.ragScore}>
                <i style={{ width: `${Math.round((chunk.score / max) * 100)}%` }} />
              </span>
              <span className={s.ragReason}>{ctx.i18n.t(reasonKey(chunk.reason))}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 回答下面那组来源卡。点卡片 = 点正文里的 `[n]`。 */
function SourceCards({ ctx, trace }: { ctx: Context; trace: RagTrace }) {
  if (trace.chunks.length === 0) return null
  return (
    <div className={s.sources}>
      <div className={s.sourcesHead}>
        {ctx.i18n.t('agent.sources', { n: trace.chunks.length })}
      </div>
      <div className={s.sourceList}>
        {trace.chunks.map((chunk) => (
          <button
            key={chunk.n}
            type="button"
            className={s.sourceCard}
            title={ctx.i18n.t('agent.sourceOpen')}
            onClick={() => revealChunk(ctx, chunk)}
          >
            <span className={s.sourceN}>{chunk.n}</span>
            <span className={s.sourceMain}>
              <span className={s.sourceTitle}>{chunk.title}</span>
              <span className={s.sourcePath}>
                {chunk.path}
                {chunk.heading ? ` · ${chunk.heading}` : ''}
              </span>
              <span className={s.sourceText}>{chunk.text}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function reasonKey(reason: RagChunk['reason']): string {
  switch (reason) {
    case 'title':
      return 'agent.ragReasonTitle'
    case 'heading':
      return 'agent.ragReasonHeading'
    case 'summary':
      return 'agent.ragReasonSummary'
    case 'doc':
      return 'agent.ragReasonDoc'
    case 'fallback':
      return 'agent.ragReasonFallback'
    default:
      return 'agent.ragReasonBody'
  }
}

/** 一轮的工具调用：平时只有一行标题，点开才是每一步。跑着的时候自己走时钟。 */
function ThoughtBlock({ ctx, marks }: { ctx: Context; marks: ToolMark[] }) {
  const [open, setOpen] = useState(false)
  const running = marks.some((mark) => mark.ms === null)
  const now = useClock(running)
  const failed = marks.some((mark) => mark.failed)
  const spent = marks.reduce((sum, mark) => sum + (mark.ms ?? Math.max(0, now - mark.start)), 0)

  return (
    <div className={s.thought}>
      <button
        type="button"
        className={running ? `${s.thoughtHead} ${s.toolOn}` : s.thoughtHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={s.thoughtChev}>{open ? '▾' : '▸'}</span>
        <span className={s.toolMark}>{running ? frame(now) : failed ? '✕' : '⏺'}</span>
        <span className={s.thoughtLabel}>
          {running
            ? ctx.i18n.t('agent.chainRunning', { n: marks.length })
            : ctx.i18n.t('agent.chainDone', { n: marks.length, time: secs(spent) })}
        </span>
        {running ? <span className={s.toolTime}>({secs(spent)})</span> : null}
      </button>
      {open ? (
        <div className={s.thoughtBody}>
          {mergeMarks(marks).map((group, at) => (
            <ToolRow key={at} marks={group} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 连着调同一个工具就合成一条 —— 一屏五个「vfs_list」谁也不看。 */
function mergeMarks(marks: readonly ToolMark[]): ToolMark[][] {
  const out: ToolMark[][] = []
  for (const mark of marks) {
    const last = out[out.length - 1]
    const tail = last?.[last.length - 1]
    if (last && tail && tail.name === mark.name && tail.ms !== null && mark.ms !== null) last.push(mark)
    else out.push([mark])
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

/** 光标前那个没被墙住的 `@` token。空白 / 括号之后才算新 token。 */
function atToken(text: string, caret: number): { start: number; q: string } | null {
  const upto = text.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/[\s（(@]/.test(upto[at - 1] ?? '')) return null
  const q = upto.slice(at + 1)
  if (/\s/.test(q)) return null
  return { start: at, q }
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
