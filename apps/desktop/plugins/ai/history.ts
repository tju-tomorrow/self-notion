/**
 * 助手的历史落盘 —— 会话存在 `settings` 的 `agent.sessions` 那个键里（`meta` 表，
 * `shell-tabs.session` 也是这么存的）。
 *
 * ★ 为什么不用库：历史是**界面状态**，不是笔记。写进 `documents` 会混进搜索、标签、回收站。
 * ★ 读回来的那份**不可信**（用户手改过、版本回滚过），所以逐字段校验，坏的丢掉 ——
 *   宁可从零开始，也不要往界面上塞半条坏会话（`shell-tabs/tabs.ts` 的 `restore` 同理）。
 */
import type { Context } from 'cordis'

import type { AiMessage, AiToolCall } from '../../src/kernel/contract'
import { loadScopes, type RagChunk, type RagScope, type RagTrace } from './rag'
import { REF_CAP, SESSIONS_KEY, addRefs, getAiState, isThinkLevel, restoreSessions, setThinkLevel, subscribeState, type DocAnchor, type Line, type Session, type ToolMark } from './state'

const THINK_KEY = 'agent.think'
/** 老会话的 refs 只补一次。 */
const BACKFILL_KEY = 'agent.refsBackfilled'

const ROLES: readonly Line['role'][] = ['user', 'ai', 'note']

export function installHistory(ctx: Context): () => void {
  /** 上一次读/写过的原文。它的全部作用：打断「自己写回 → onChange 通知 → 又拿回来写一次」那个圈。 */
  let lastRaw = ''
  /** 老会话的 refs 只补一次；失败就下次启动再试。 */
  let backfillStarted = false
  const maybeBackfill = (): void => {
    if (backfillStarted || ctx.settings.get<string>(BACKFILL_KEY) === '1') return
    // 设置是异步预热的：还没读到原文时别急着判定「没有老会话」。
    const raw = ctx.settings.get<string>(SESSIONS_KEY)
    if (typeof raw !== 'string' || raw === '') return
    if (!getAiState().sessions.some((sess) => sess.lines.length > 0 && !sess.refs?.length)) {
      ctx.settings.set(BACKFILL_KEY, '1')
      return
    }
    backfillStarted = true
    void backfillRefs(ctx)
      .then((done) => {
        if (done) ctx.settings.set(BACKFILL_KEY, '1')
      })
      .catch(() => {
        backfillStarted = false
      })
  }

  // 流式草稿不在 sessions 里。引用没变就别整包 stringify —— 每个 token 都写一遍会卡。
  let seenSessions = getAiState().sessions
  let seenId = getAiState().currentId
  const save = (): void => {
    const st = getAiState()
    if (st.sessions === seenSessions && st.currentId === seenId) return
    seenSessions = st.sessions
    seenId = st.currentId
    const raw = JSON.stringify({ currentId: st.currentId, sessions: st.sessions })
    if (raw === lastRaw) return
    lastRaw = raw
    ctx.settings.set(SESSIONS_KEY, raw)
  }

  const pull = (): void => {
    const raw = ctx.settings.get<string>(SESSIONS_KEY)
    if (typeof raw !== 'string' || raw === '' || raw === lastRaw) return
    lastRaw = raw
    const restored = parse(raw)
    if (restored) {
      restoreSessions(restored.sessions, restored.currentId)
      maybeBackfill()
    }
  }

  // 装的时候多半还读不到 —— `plugin-settings` 的预热是异步的，预热完它会 notify 一次。
  pull()
  maybeBackfill()
  const offChange = ctx.settings.onChange(SESSIONS_KEY, pull)
  const offSub = subscribeState(save)
  const offThink = installThink(ctx)

  return () => {
    offThink()
    offSub()
    offChange()
  }
}

/** 思考强度跟会话分开存。会话一多，不该为了拨一下档把整包历史重写一遍。 */
function installThink(ctx: Context): () => void {
  let last = getAiState().think
  const pull = (): void => {
    const raw = ctx.settings.get<string>(THINK_KEY)
    if (!isThinkLevel(raw) || raw === last) return
    last = raw
    setThinkLevel(raw)
  }
  const save = (): void => {
    const level = getAiState().think
    if (level === last) return
    last = level
    ctx.settings.set(THINK_KEY, level)
  }
  pull()
  const offChange = ctx.settings.onChange(THINK_KEY, pull)
  const offSub = subscribeState(save)
  return () => {
    offSub()
    offChange()
  }
}

function parse(raw: string): { sessions: Session[]; currentId: string } | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const box = value as { sessions?: unknown; currentId?: unknown }
  if (!Array.isArray(box.sessions)) return null

  const sessions: Session[] = []
  for (const item of box.sessions) {
    if (typeof item !== 'object' || item === null) continue
    const one = item as Partial<Session>
    if (typeof one.id !== 'string' || !Array.isArray(one.lines)) continue
    sessions.push({
      id: one.id,
      title: typeof one.title === 'string' ? one.title : '',
      at: typeof one.at === 'number' ? one.at : Date.now(),
      // 老会话（D-0096 之前存的）没有这个字段 —— 当 0，不丢那整条。
      spent: typeof one.spent === 'number' && one.spent >= 0 ? one.spent : 0,
      origin: anchorOf(one.origin),
      refs: anchorsOf(one.refs),
      transcript: messagesOf(one.transcript),
      lines: one.lines.flatMap((line) => {
        if (typeof line !== 'object' || line === null) return []
        const l = line as Partial<Line>
        if (typeof l.text !== 'string' || !ROLES.includes(l.role as Line['role'])) return []
        // 工具那一行那份现场（转圈 / 耗时）是 D-0097 之后才存的 —— 老行没它，不影响。
        return [{
          role: l.role as Line['role'],
          text: l.text,
          tool: toolOf(l.tool),
          scope: scopeOf(l.scope),
          scopes: scopesOf(l.scopes) ?? (scopeOf(l.scope) ? [scopeOf(l.scope)!] : undefined),
          quote: typeof l.quote === 'string' && l.quote !== '' ? l.quote : undefined,
          images: imagesOf(l.images),
          think: typeof l.think === 'string' && l.think !== '' ? l.think.slice(0, 8_000) : undefined,
          rag: traceOf(l.rag),
        }]
      }),
    })
  }
  if (!sessions.length) return null

  const currentId =
    typeof box.currentId === 'string' && sessions.some((s) => s.id === box.currentId)
      ? box.currentId
      : sessions[0].id
  return { sessions, currentId }
}

/** 老会话的 refs 从已经存下来的检索轨迹、圈定范围和工具路径里补一次。
 *  `origin` 不补 —— 那时候没记「按下发送时在看哪篇」，猜不出来。 */
async function backfillRefs(ctx: Context): Promise<boolean> {
  const docs: { id: string; title: string; path: string }[] = []
  for (const item of await loadScopes(ctx)) {
    if (item.kind === 'doc' && item.id) {
      docs.push({ id: item.id, title: item.title, path: item.path })
    }
  }
  if (!docs.length) return false

  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  const byShort = new Map(docs.map((doc) => [doc.id.slice(0, 8), doc]))
  const byPath = new Map<string, (typeof docs)[number]>()
  for (const doc of docs) {
    byPath.set(doc.path, doc)
    if (doc.path.startsWith('/tree/')) byPath.set(`/outline/${doc.path.slice(6)}`, doc)
  }

  for (const session of getAiState().sessions) {
    if (session.refs?.length) continue
    const refs: DocAnchor[] = []
    for (const line of session.lines) {
      for (const used of line.rag?.usedDocs ?? []) {
        refs.push({ id: used.id, title: used.title, path: used.path })
      }
      for (const scope of line.scopes ?? (line.scope ? [line.scope] : [])) {
        if (scope.kind === 'doc' && scope.id) {
          refs.push({ id: scope.id, title: scope.title, path: scope.path })
        }
      }
      const detail = line.tool?.detail ?? ''
      const hit = byPath.get(detail) ?? byId.get(detail) ?? byShort.get(detail)
      if (hit) refs.push(hit)
    }
    if (refs.length) addRefs(session.id, refs)
  }
  return true
}

/** 读回来的那一份不可信：缺 id 的锚点整颗丢掉，重复的引用只留第一颗。 */
function anchorOf(raw: unknown): DocAnchor | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Partial<DocAnchor>
  if (typeof value.id !== 'string' || value.id === '') return undefined
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : '',
    path: typeof value.path === 'string' ? value.path : '',
  }
}

function anchorsOf(raw: unknown): DocAnchor[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: DocAnchor[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const anchor = anchorOf(item)
    if (!anchor || seen.has(anchor.id)) continue
    seen.add(anchor.id)
    out.push(anchor)
    if (out.length >= REF_CAP) break
  }
  return out.length ? out : undefined
}

function messagesOf(raw: unknown): AiMessage[] {
  if (!Array.isArray(raw)) return []
  const out: AiMessage[] = []
  const ids = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const m = item as Partial<AiMessage>
    if ((m.role !== 'user' && m.role !== 'assistant' && m.role !== 'tool') || typeof m.content !== 'string') {
      continue
    }
    const msg: AiMessage = { role: m.role, content: m.content.slice(0, 8_000) }
    const images = imagesOf(m.images)
    if (images) msg.images = images
    if (m.role === 'assistant') {
      const calls = callsOf(m.toolCalls)
      if (calls) {
        msg.toolCalls = calls
        for (const call of calls) ids.add(call.id)
      }
    }
    if (m.role === 'tool') {
      if (typeof m.toolCallId !== 'string' || !ids.has(m.toolCallId)) continue
      msg.toolCallId = m.toolCallId
    }
    out.push(msg)
    if (out.length >= 40) break
  }
  return out
}

function callsOf(raw: unknown): AiToolCall[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: AiToolCall[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as Partial<AiToolCall>
    if (typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.args !== 'string') continue
    out.push({ id: c.id, name: c.name, args: c.args.slice(0, 8_000) })
  }
  return out.length ? out : undefined
}

function scopesOf(raw: unknown): RagScope[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.map(scopeOf).filter((s): s is RagScope => s !== undefined)
  return out.length ? out : undefined
}

function imagesOf(raw: unknown): { mime: string; data: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: { mime: string; data: string }[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as { mime?: unknown; data?: unknown }
    if (typeof v.mime !== 'string' || !v.mime.startsWith('image/')) continue
    if (typeof v.data !== 'string' || v.data.length < 16 || v.data.length > 1_200_000) continue
    out.push({ mime: v.mime, data: v.data })
    if (out.length >= 4) break
  }
  return out.length ? out : undefined
}

/** 范围签。路径和标题有一个坏的，整颗丢掉（半颗更难看）。 */
function scopeOf(raw: unknown): RagScope | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const v = raw as Record<string, unknown>
  if (typeof v['path'] !== 'string' || typeof v['title'] !== 'string') return undefined
  if (v['kind'] === 'dir') return { kind: 'dir', path: v['path'], title: v['title'] }
  if (v['kind'] === 'doc' && typeof v['id'] === 'string') {
    return { kind: 'doc', id: v['id'], path: v['path'], title: v['title'] }
  }
  return undefined
}

/** 检索结果。片段坏一条就丢一条 —— 来源卡宁缺勿错。 */
function traceOf(raw: unknown): RagTrace | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const t = raw as Partial<RagTrace>
  const scope = scopeOf(t.scope)
  if (!scope || !Array.isArray(t.chunks) || !Array.isArray(t.usedDocs)) return undefined
  const chunks: RagChunk[] = []
  for (const item of t.chunks) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as unknown as Record<string, unknown>
    if (typeof c['n'] !== 'number' || typeof c['text'] !== 'string') continue
    chunks.push({
      n: c['n'],
      docId: typeof c['docId'] === 'string' ? c['docId'] : '',
      title: typeof c['title'] === 'string' ? c['title'] : '',
      path: typeof c['path'] === 'string' ? c['path'] : '',
      heading: typeof c['heading'] === 'string' ? c['heading'] : null,
      text: c['text'],
      anchor: typeof c['anchor'] === 'string' ? c['anchor'] : '',
      score: typeof c['score'] === 'number' ? c['score'] : 0,
      reason: reasonOf(c['reason']),
    })
  }
  return {
    scope,
    query: typeof t.query === 'string' ? t.query : '',
    terms: Array.isArray(t.terms) ? t.terms.filter((x): x is string => typeof x === 'string') : [],
    semantic: t.semantic === true,
    docsTotal: numOr0(t.docsTotal),
    docsScanned: numOr0(t.docsScanned),
    docsHit: numOr0(t.docsHit),
    docsSkipped: numOr0(t.docsSkipped),
    chunksScored: numOr0(t.chunksScored),
    chars: numOr0(t.chars),
    tookMs: numOr0(t.tookMs),
    chunks,
    usedDocs: t.usedDocs.filter(
      (d): d is RagTrace['usedDocs'][number] =>
        typeof d === 'object' && d !== null && typeof (d as { path?: unknown }).path === 'string',
    ),
    docScores: Array.isArray(t.docScores)
      ? t.docScores.filter(
          (d): d is RagTrace['docScores'][number] =>
            typeof d === 'object' &&
            d !== null &&
            typeof (d as { id?: unknown }).id === 'string' &&
            typeof (d as { score?: unknown }).score === 'number',
        )
      : [],
    empty:
      t.empty === 'no_docs' || t.empty === 'no_projection' || t.empty === 'no_match'
        ? t.empty
        : undefined,
  }
}

function reasonOf(raw: unknown): RagChunk['reason'] {
  return raw === 'title' || raw === 'heading' || raw === 'summary' || raw === 'doc' || raw === 'fallback'
    ? raw
    : 'body'
}

function numOr0(raw: unknown): number {
  return typeof raw === 'number' && raw >= 0 ? raw : 0
}

/** 工具那一行那份现场。**跑完与否认不出来就不要它**（另一半是残的）—— 宁可当一个纯字行。 */
function toolOf(raw: unknown): ToolMark | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const t = raw as Partial<ToolMark>
  if (typeof t.name !== 'string' || typeof t.start !== 'number') return undefined
  return {
    id: typeof t.id === 'string' ? t.id : '',
    name: t.name,
    detail: typeof t.detail === 'string' ? t.detail : '',
    start: t.start,
    ms: typeof t.ms === 'number' ? t.ms : null,
    failed: t.failed === true,
  }
}
