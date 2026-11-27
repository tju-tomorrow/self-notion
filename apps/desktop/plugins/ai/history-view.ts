/**
 * 历史那一列的投影：会话的 `origin + refs` 就是关系图，这里只回答
 * 「这条在不在当前范围里 / 有没有命中这段字」。
 */
import type { RagScopeItem } from '../../src/kernel/contract'
import type { DocAnchor, Session } from './state'

export type HistoryScope = 'related' | 'folder' | 'all'

export interface HistoryHere {
  id: string | null
  dir: string | null
}

export interface HistoryFilter {
  scope: HistoryScope
  query: string
  pick: RagScopeItem | null
}

export interface Snippet {
  text: string
  hit: number
  len: number
}

const haystacks = new WeakMap<Session, string>()

/** 没选中候选就留在输入里的 `@某某`，按正文搜「某某」—— 别让一个 @ 把结果全挡掉。 */
function textQuery(query: string): string {
  return query.trim().replace(/^@+/, '').trim()
}

/** 搜索面：标题、气泡、工具那一行的路径/关键词、以及记下来的文档标题和路径。 */
function haystack(session: Session): string {
  const cached = haystacks.get(session)
  if (cached !== undefined) return cached
  const parts: string[] = [session.title]
  if (session.origin) parts.push(session.origin.title, session.origin.path)
  for (const ref of session.refs ?? []) parts.push(ref.title, ref.path)
  for (const line of session.lines) {
    parts.push(line.text)
    if (line.quote) parts.push(line.quote)
    if (line.tool?.detail) parts.push(line.tool.detail)
  }
  const text = parts.join('\n').toLowerCase()
  haystacks.set(session, text)
  return text
}

export function sessionNodes(session: Session): DocAnchor[] {
  const out: DocAnchor[] = []
  if (session.origin) out.push(session.origin)
  for (const ref of session.refs ?? []) out.push(ref)
  return out
}

export function inDir(path: string, dir: string): boolean {
  if (!path || !dir) return false
  return path.startsWith(dir.endsWith('/') ? dir : `${dir}/`)
}

function matchPick(session: Session, pick: RagScopeItem): boolean {
  const nodes = sessionNodes(session)
  if (pick.kind === 'dir') return nodes.some((node) => inDir(node.path, pick.path))
  if (pick.id) return nodes.some((node) => node.id === pick.id)
  return nodes.some((node) => node.path === pick.path)
}

export function matchSession(
  session: Session,
  filter: HistoryFilter,
  here: HistoryHere,
): boolean {
  const query = textQuery(filter.query).toLowerCase()
  if (query && !haystack(session).includes(query)) return false
  if (filter.pick && !matchPick(session, filter.pick)) return false
  if (filter.scope === 'all') return true
  const nodes = sessionNodes(session)
  if (filter.scope === 'related') {
    const id = here.id
    return id !== null && nodes.some((node) => node.id === id)
  }
  const dir = here.dir
  return dir !== null && nodes.some((node) => inDir(node.path, dir))
}

/** 关系标记：发起于当前范围，还是只在对话里碰到过当前范围。 */
export function relationOf(
  session: Session,
  scope: HistoryScope,
  here: HistoryHere,
): 'origin' | 'ref' | null {
  if (scope === 'related') {
    const id = here.id
    if (id !== null && session.origin?.id === id) return 'origin'
    if (id !== null && (session.refs ?? []).some((ref) => ref.id === id)) return 'ref'
    return null
  }
  if (scope === 'folder') {
    const dir = here.dir
    if (dir !== null && session.origin && inDir(session.origin.path, dir)) return 'origin'
    if (dir !== null && (session.refs ?? []).some((ref) => inDir(ref.path, dir))) {
      return 'ref'
    }
    return null
  }
  return null
}

/** 第一条命中正文的片段；命中只在标题/路径上时返回 null，界面退回显示发起锚点。 */
export function snippetOf(session: Session, query: string): Snippet | null {
  const needle = textQuery(query)
  if (!needle) return null
  const lower = needle.toLowerCase()
  for (const line of session.lines) {
    const at = line.text.toLowerCase().indexOf(lower)
    if (at < 0) continue
    const start = Math.max(0, at - 12)
    const end = Math.min(line.text.length, at + needle.length + 12)
    const prefix = start > 0 ? '…' : ''
    const suffix = end < line.text.length ? '…' : ''
    return {
      text: `${prefix}${line.text.slice(start, end)}${suffix}`,
      hit: prefix.length + (at - start),
      len: needle.length,
    }
  }
  return null
}

export function nameOf(anchor: DocAnchor): string {
  return (
    anchor.title ||
    anchor.path.split('/').pop()?.replace(/\.md$/i, '') ||
    ''
  )
}

/** 悬停里列「读过哪些」，不算发起锚点自己。 */
export function refCountOf(session: Session): number {
  const origin = session.origin?.id
  return (session.refs ?? []).filter((ref) => ref.id !== origin).length
}
