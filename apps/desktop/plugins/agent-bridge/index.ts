/**
 * 外部 agent 写请求的执行端（D-0191）。
 *
 * MCP 只读进程把请求落进 `agent_request`；这里每 500ms 取一次，用编辑器自己的
 * markdown 解析器（`doc-write` service）执行，再回写结果。
 *
 * ★ 写要求 app 开着 —— 不绕过编辑器；读那侧仍然离线可用。
 */
import type { Context } from 'cordis'
import {
  DOCS_CHANGED,
  type DocMeta,
  type DocWriteService,
  type EditorService,
  type LearnRow,
} from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'

export const name = 'agent-bridge'

// rpc：agent:pending / agent:finish / doc:* / version:*；doc-write 是软依赖。
export const inject = ['rpc']

const TICK_MS = 500

interface Pending {
  id: string
  action: string
  args: string
}

export function apply(ctx: Context) {
  let busy = false

  const tick = async (): Promise<void> => {
    if (busy) return
    // tools 插件还没就绪时先别取 —— 取到手也执行不了，留在队列里下一拍再说。
    if (!ctx.get('doc-write')) return
    busy = true
    try {
      const list = await ctx.rpc.call<Pending[]>('agent:pending')
      for (const req of list) await handle(ctx, req)
    } catch (err) {
      reportError('agent-bridge', err)
    } finally {
      busy = false
    }
  }

  void tick()
  const timer = setInterval(() => void tick(), TICK_MS)
  ctx.effect(() => () => clearInterval(timer))
}

async function handle(ctx: Context, req: Pending): Promise<void> {
  try {
    const args = JSON.parse(req.args) as Record<string, unknown>
    const result = await run(ctx, req.action, args, `agent-${req.id}`)
    await ctx.rpc.call('agent:finish', {
      id: req.id,
      ok: true,
      result: JSON.stringify(result),
    })
    ctx.emit(DOCS_CHANGED)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    reportError('agent-bridge', err)
    await ctx.rpc
      .call('agent:finish', { id: req.id, ok: false, error: message })
      .catch((e) => reportError('agent-bridge', e))
  }
}

async function run(
  ctx: Context,
  action: string,
  args: Record<string, unknown>,
  groupId: string,
): Promise<Record<string, unknown>> {
  const id = str(args, 'id')
  const docWrite = ctx.get('doc-write') as DocWriteService | undefined

  switch (action) {
    case 'create': {
      if (!docWrite) throw new Error('doc-write 没就绪（tools 插件没装？）')
      const made = await docWrite.create(
        str(args, 'title'),
        str(args, 'content'),
        groupId,
      )
      const parentId = str(args, 'parentId')
      if (parentId) await ctx.rpc.call('doc:move', { id: made.id, parentId })
      const tags = strs(args, 'tags')
      if (tags.length) await ctx.rpc.call('doc:tags', { id: made.id, tags })
      return { id: made.id, title: made.title, blocks: made.blocks }
    }
    case 'append': {
      if (!docWrite) throw new Error('doc-write 没就绪（tools 插件没装？）')
      const made = await docWrite.append(id, str(args, 'content'), groupId)
      return { id: made.id, title: made.title, blocks: made.blocks }
    }
    case 'replace': {
      if (!docWrite) throw new Error('doc-write 没就绪（tools 插件没装？）')
      const title = str(args, 'title')
      const made = await docWrite.replaceAll(
        id,
        str(args, 'content'),
        groupId,
        title || undefined,
      )
      return { id: made.id, title: made.title, blocks: made.blocks }
    }
    case 'rename': {
      const meta = await ctx.rpc.call<DocMeta>('doc:rename', {
        id,
        title: str(args, 'title'),
      })
      return { id: meta.id, title: meta.title }
    }
    case 'move': {
      const parentId = str(args, 'parentId')
      const meta = await ctx.rpc.call<DocMeta>('doc:move', {
        id,
        parentId: parentId || null,
      })
      return { id: meta.id, title: meta.title }
    }
    case 'trash':
      await ctx.rpc.call('doc:trash', { id })
      return { id }
    case 'restore':
      await ctx.rpc.call('doc:restore', { id })
      return { id }
    case 'tag': {
      const meta = await ctx.rpc.call<DocMeta>('doc:tags', {
        id,
        tags: strs(args, 'tags'),
      })
      return { id: meta.id, title: meta.title }
    }
    case 'familiarity': {
      const row = await ctx.rpc.call<LearnRow>('learn:familiarity', {
        id,
        level: levelOf(args.level),
      })
      return { id: row.docId, familiarity: row.familiarity, score: row.score }
    }
    case 'undo': {
      const versions = await ctx.rpc.call<{ id: number }[]>('version:list', {
        id,
        limit: 1,
      })
      const target = versions[0]
      if (!target) throw new Error('没有可撤销的版本')
      await ctx.rpc.call('version:restore', { id, versionId: target.id })
      const editor = ctx.get('editor') as EditorService | undefined
      await editor?.reload(id)
      return { id }
    }
    default:
      throw new Error(`不认识的 action：${action}`)
  }
}

function levelOf(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' && v >= 1 && v <= 4) return v
  throw new Error('familiarity 只能是 1–4，或 null 清除')
}

function str(a: Record<string, unknown>, key: string): string {
  const v = a[key]
  return typeof v === 'string' ? v : ''
}

function strs(a: Record<string, unknown>, key: string): string[] {
  const v = a[key]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
