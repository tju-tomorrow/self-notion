/**
 * 助手的历史落盘 —— 会话存在 `settings` 的 `agent.sessions` 那个键里（`meta` 表，
 * `shell-tabs.session` 也是这么存的）。
 *
 * ★ 为什么不用库：历史是**界面状态**，不是笔记。写进 `documents` 会混进搜索、标签、回收站。
 * ★ 读回来的那份**不可信**（用户手改过、版本回滚过），所以逐字段校验，坏的丢掉 ——
 *   宁可从零开始，也不要往界面上塞半条坏会话（`shell-tabs/tabs.ts` 的 `restore` 同理）。
 */
import type { Context } from 'cordis'

import { SESSIONS_KEY, getAiState, restoreSessions, subscribeState, type Line, type Session, type ToolMark } from './state'

const ROLES: readonly Line['role'][] = ['user', 'ai', 'note']

export function installHistory(ctx: Context): () => void {
  /** 上一次读/写过的原文。它的全部作用：打断「自己写回 → onChange 通知 → 又拿回来写一次」那个圈。 */
  let lastRaw = ''

  const save = (): void => {
    const st = getAiState()
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
    if (restored) restoreSessions(restored.sessions, restored.currentId)
  }

  // 装的时候多半还读不到 —— `plugin-settings` 的预热是异步的，预热完它会 notify 一次。
  pull()
  const offChange = ctx.settings.onChange(SESSIONS_KEY, pull)
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
      lines: one.lines.flatMap((line) => {
        if (typeof line !== 'object' || line === null) return []
        const l = line as Partial<Line>
        if (typeof l.text !== 'string' || !ROLES.includes(l.role as Line['role'])) return []
        // 工具那一行那份现场（转圈 / 耗时）是 D-0097 之后才存的 —— 老行没它，不影响。
        return [{ role: l.role as Line['role'], text: l.text, tool: toolOf(l.tool) }]
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
