/**
 * 内置助手的模块级状态 —— 页面（左历史右对话）和撤销条两处共用一份。
 *
 * 订阅放插件层、组件只读这里，理由同 `comment/state.ts` / `version-history/state.ts`：
 * 组件的挂载晚于第一次点击，组件自己监听就永远错过那一下。
 *
 * 「一次对话」就是一个 `Session`（左侧历史列的就是它们）。**行都住在会话里**，
 * `currentId` 指哪一条，页面上就画哪一条 —— 来回切会话只是换个指针，不搬家。
 */
import { useSyncExternalStore } from 'react'

/** 页面上的一行。`note` 是「调用了哪个工具」这类过程记录，不是对话。 */
export interface Line {
  role: 'user' | 'ai' | 'note'
  text: string
  /** 只有 `note` 那一行有：界面上要转圈、要计时、要合堆，光有工具名不够。 */
  tool?: ToolMark
}

/** 一次工具调用的现场。跑完的留着耗时 —— Claude Code 那样在名字后面挂个 `(1.2s)`。 */
export interface ToolMark {
  /** 模型给的那次调用的 id —— 一批里会**并发**跑好几个同名的（D-0108），只能按它对号。 */
  id: string
  name: string
  /** 参数里那点能认出来的东西（路径 / 关键词）—— 名字后面括号里的那个。 */
  detail: string
  start: number
  /** 跑完了是毫秒数，还在跑是 null。 */
  ms: number | null
  failed?: boolean
}

/** 一次对话。左侧历史那一列列的就是它。 */
export interface Session {
  id: string
  /** 空串 = 还没说过话，界面上显示「新对话」 */
  title: string
  /** 最后一次说话的时间 —— 历史按它倒序 */
  at: number
  lines: Line[]
  /** 这条会话**累计烧掉的 token 估数**（`tokens.ts`）—— 不算它，历史那一列没东西可标。 */
  spent: number
}

/** 一个待撤销的回合（`docs/ai.md` 第六节：**撤销的单位是回合，不是文档**）。 */
export interface Undo {
  groupId: string
  /** 这一回合动过的文档 —— 撤销时一篇一篇按 groupId 回退。 */
  docs: string[]
}

export interface AiUiState {
  sessions: Session[]
  currentId: string
  /** 右侧那一列开着没有（D-0098）。它**不是**标签页 —— 只占右边一列，正文留在旁边看得见。 */
  docked: boolean
  /** 用户此刻在**看哪一篇**（文档 id）。提问时拿它拼「用户在看这个文件」那段上下文
   *  （`place.ts`）。助手自己那一页不算 —— 那不是笔记。 */
  viewingDoc: string | null
  busy: boolean
  /** 用户按了中断 —— `loop.ts` 每一轮、每一片字之间都看它一眼（D-0103）。 */
  stopRequested: boolean
  /** 这一回合什么时候开始的 —— 「正在想…」后面那个活计时从它算。 */
  busySince: number
  /** 正在生成的那一段（流式的字先落这儿，说完了才进会话）。 */
  draft: string
  error: string
  /** 撤销条：一个回合一条。 */
  undo: Undo[]
}

/** 落盘的键。**带插件名前缀** —— `meta` 表是全局的（同 `shell-tabs.session`）。 */
export const SESSIONS_KEY = 'agent.sessions'

function makeId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function blank(): Session {
  return { id: makeId(), title: '', at: Date.now(), lines: [], spent: 0 }
}

const first = blank()
let state: AiUiState = {
  sessions: [first],
  currentId: first.id,
  docked: false,
  viewingDoc: null,
  busy: false,
  stopRequested: false,
  busySince: 0,
  draft: '',
  error: '',
  undo: [],
}

const subs = new Set<() => void>()

export function getAiState(): AiUiState {
  return state
}

export function setAiState(patch: Partial<AiUiState>): void {
  state = { ...state, ...patch }
  for (const cb of subs) cb()
}

/** 中断这一回合。举旗子（界面那颗按钮读它）+ 拉一下循环挂进来的取消开关（`loop.ts`）。 */
export function stop(): void {
  if (!state.busy || state.stopRequested) return
  setAiState({ stopRequested: true })
  cancel?.()
}

/** 循环挂进来的那一根线：它一响，`AbortController.abort()`。每回合开始挂、结束摘。 */
let cancel: (() => void) | null = null

export function onStopRequest(fn: (() => void) | null): void {
  cancel = fn
}

/** 插件层用它落盘（`history.ts`）。 */
export function subscribeState(cb: () => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}

export function currentSession(): Session {
  return state.sessions.find((sess) => sess.id === state.currentId) ?? state.sessions[0]
}

/** 历史按最近说话倒序 —— 刚聊过的在最上面。 */
export function sessionsByRecency(): Session[] {
  return [...state.sessions].sort((a, b) => b.at - a.at)
}

/** 右侧那一列的开关。**不落盘** —— 它跟窗口大小一样，是这一次坐下来的事。 */
export function toggleDock(): void {
  setAiState({ docked: !state.docked })
}

export function openDock(): void {
  setAiState({ docked: true })
}

export function closeDock(): void {
  setAiState({ docked: false })
}

/** 一次工具调用跑完 —— 按 `id` 认领那一行（并发时同名的那几条只能靠它分）。耗时从那一行
 *  自己记的 `start` 算，调用方不用传。 */
export function finishTool(id: string, failed: boolean): void {
  const { currentId, sessions } = state
  setAiState({
    sessions: sessions.map((sess) => {
      if (sess.id !== currentId) return sess
      const at = sess.lines.findLastIndex((line) => line.tool?.id === id && line.tool.ms === null)
      if (at < 0) return sess
      const lines = sess.lines.slice()
      const tool = lines[at]?.tool
      if (tool) lines[at] = { ...lines[at], tool: { ...tool, ms: Date.now() - tool.start, failed } }
      return { ...sess, lines }
    }),
  })
}

/** 往**当前**这条会话末尾加一行。第一句话顺手当标题（左侧列表要显示它）。 */
export function pushLine(line: Line): void {
  const { currentId, sessions } = state
  setAiState({
    sessions: sessions.map((sess) =>
      sess.id !== currentId
        ? sess
        : {
            ...sess,
            title: sess.title || (line.role === 'user' ? line.text.slice(0, 24) : ''),
            at: Date.now(),
            lines: [...sess.lines, line],
          },
    ),
  })
}

/** 一轮烧掉多少 —— 循环每转一轮报一次（输入那包 + 这轮产出的字）。 */
export function addSpend(tokens: number): void {
  if (tokens <= 0) return
  const { currentId, sessions } = state
  setAiState({
    sessions: sessions.map((sess) =>
      sess.id !== currentId ? sess : { ...sess, spent: sess.spent + tokens },
    ),
  })
}

/** 新开一条。**当前这条本来就空就不动** —— 否则连点几下就攒出一串空会话。 */
export function newSession(): void {
  if (currentSession().lines.length === 0) return
  const fresh = blank()
  setAiState({ sessions: [...state.sessions, fresh], currentId: fresh.id, draft: '', error: '' })
}

export function openSession(id: string): void {
  if (id === state.currentId) return
  if (!state.sessions.some((sess) => sess.id === id)) return
  setAiState({ currentId: id, draft: '', error: '' })
}

export function clearUndo(groupId: string): void {
  setAiState({ undo: state.undo.filter((u) => u.groupId !== groupId) })
}

/** 从盘上读回来的那一份（`history.ts` 校验过形状了）。 */
export function restoreSessions(sessions: Session[], currentId: string): void {
  setAiState({ sessions, currentId })
}

export function useAiState(): AiUiState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    () => state,
    () => state,
  )
}
