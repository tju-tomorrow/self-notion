/**
 * `web_search` / `web_read` —— 给内置助手的联网能力（D-0217）。
 *
 * 网络在 Rust（`src-tauri/src/web/`，搜索后端是开源的 SearXNG），这里只把结果拼成
 * 模型看得懂的几行。命令立刻返回，结果从事件来（同 `ai/chat.ts`）。
 * 读完不缓存：第二次读同一页再走一次网络，换来的是「读到的是现在」。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Context } from 'cordis'
import type { ToolSpec } from '../../src/kernel/contract'

interface Hit {
  title: string
  url: string
  snippet: string
  published?: string
}

interface SearchDone {
  requestId: string
  hits: Hit[]
  engine: string
}

interface ReadDone {
  requestId: string
  url: string
  title: string
  text: string
  total: number
  offset: number
}

interface Failed {
  requestId: string
  message: string
}

/** 和 Rust 那边 `time_range` 的取值对齐。 */
const FRESHNESS = ['day', 'week', 'month', 'year'] as const
type Freshness = (typeof FRESHNESS)[number]

/** Rust 侧每个实例 6 秒、整轮有上限；这里再兜一层，防风真的断在半路。 */
const TIMEOUT_MS = 30_000
const QUERY_MAX = 400

let seq = 0

/** 一次「命令立刻返回、结果从事件来」的往返 —— 搜索和读网页共用这一层。 */
function exec<T>(
  ctx: Context,
  method: `${string}:${string}`,
  payload: Record<string, unknown>,
  doneEvent: `${string}:${string}`,
  errorEvent: `${string}:${string}`,
  signal: AbortSignal | undefined,
): Promise<T> {
  const requestId = `web-${++seq}-${Date.now()}`
  return new Promise((resolve, reject) => {
    let closed = false
    let offs: UnlistenFn[] = []
    const finish = (act: () => void): void => {
      if (closed) return
      closed = true
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      for (const off of offs) off()
      offs = []
      act()
    }
    const onAbort = () => finish(() => reject(new Error('已中断')))
    const timer = window.setTimeout(() => finish(() => reject(new Error('联网超时（30 秒）'))), TIMEOUT_MS)
    if (signal?.aborted) {
      finish(() => reject(new Error('已中断')))
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    void Promise.all([
      listen<T & { requestId: string }>(doneEvent, (e) => {
        if (e.payload.requestId === requestId) finish(() => resolve(e.payload))
      }),
      listen<Failed>(errorEvent, (e) => {
        if (e.payload.requestId === requestId) {
          finish(() => reject(new Error(e.payload.message)))
        }
      }),
    ]).then((fns) => {
      if (closed) {
        for (const off of fns) off()
        return
      }
      offs = fns
      ctx.rpc
        .call(method, { ...payload, requestId })
        .catch((err: unknown) =>
          finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
        )
    })
  })
}

export function webSearchTool(ctx: Context): ToolSpec {
  return {
    name: 'web_search',
    description:
      '联网搜索（SearXNG）。问最新消息、外面的资料，或你不确定的事实时用；笔记里查得到的先查笔记。' +
      '回答里只引用这次返回的链接，别自己编 URL；搜不到就照实说，最多换一次关键词。' +
      '摘要不够回答时，用 web_read 读具体的链接。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词，像在搜索框里打的那样' },
        count: { type: 'number', description: '要几条结果，默认 6，最多 10' },
        freshness: {
          type: 'string',
          enum: FRESHNESS,
          description: '只要最近的结果时给：day / week / month / year',
        },
      },
      required: ['query'],
    },
    async run(args, signal) {
      const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
      const query = typeof a['query'] === 'string' ? a['query'].trim().slice(0, QUERY_MAX) : ''
      if (!query) throw new Error('query 不能为空')
      const raw = a['count']
      const count = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 6
      const fresh = typeof a['freshness'] === 'string' ? a['freshness'] : ''
      const freshness = (FRESHNESS as readonly string[]).includes(fresh)
        ? (fresh as Freshness)
        : undefined

      const res = await exec<SearchDone>(
        ctx,
        'web:search',
        { query, count, ...(freshness ? { freshness } : {}) },
        'web:done',
        'web:error',
        signal,
      )
      if (!res.hits.length) return `搜了「${query}」，没有结果。`
      const lines = res.hits.map((hit, at) => {
        const when = hit.published ? `（${hit.published}）` : ''
        return `${at + 1}. ${hit.title}${when}\n${hit.url}${hit.snippet ? `\n${hit.snippet}` : ''}`
      })
      return `搜索「${query}」（${res.engine}）：\n\n${lines.join('\n\n')}`
    },
  }
}

export function webReadTool(ctx: Context): ToolSpec {
  return {
    name: 'web_read',
    description:
      '读一个网页的正文（去标签、只留文字，默认 6000 字）。搜索结果摘要不够、' +
      '或用户给了链接时用。只读 http / https，本机和内网地址会被拒绝。' +
      '正文太长时用 offset 续读。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要读的网页地址（http / https）' },
        offset: { type: 'number', description: '从第几个字开始续读，默认 0' },
      },
      required: ['url'],
    },
    async run(args, signal) {
      const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
      const url = typeof a['url'] === 'string' ? a['url'].trim() : ''
      if (!/^https?:\/\//i.test(url)) throw new Error('url 要是 http(s) 地址')
      const raw = a['offset']
      const offset = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0

      const page = await exec<ReadDone>(
        ctx,
        'web:read',
        { url, offset },
        'web:read:done',
        'web:read:error',
        signal,
      )
      if (!page.text) return `《${page.title || page.url}》从第 ${page.offset} 字起没有正文了（共 ${page.total} 字）。`
      const head = page.title ? `《${page.title}》\n${page.url}` : page.url
      const end = page.offset + [...page.text].length
      const tail =
        end < page.total ? `\n\n（共 ${page.total} 字，这里到第 ${end} 字；要后面就说 offset=${end}）` : ''
      return `${head}\n\n${page.text}${tail}`
    },
  }
}
