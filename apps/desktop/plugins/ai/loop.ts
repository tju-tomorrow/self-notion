/**
 * 一个回合：把「契约里那条流」（`ctx.ai.chat`）、「六个工具」（`ctx.tools`）和
 * 「那套循环」（`harness.ts`，移植自 pi）接起来，外加撤销条。
 *
 * 循环**跑在前端**（`docs/ai.md` 第五节）：它要调 `ctx.tools`（工具执行在插件里）、
 * 要知道哪个回合动了哪些文档（撤销条要按 `group_id` 分组）。Rust 只管把 HTTP 和 SSE 讲完。
 *
 * ★ 工具结果回给模型是**原生的两段**：先一条 `assistant` 带 `toolCalls`，再一批 `role: 'tool'`
 *   带 `toolCallId`（少了前者，模型看不到自己刚提过什么，会把同一个工具反复调）。
 *   provider 的线上形状（`tool_calls[].function.arguments` 那套嵌套）由 Rust 拼
 *   （`src-tauri/src/ai/chat.rs` 的 `wire`）—— 前端不认识它。
 *
 * ★ **一次问答一个回合**（`groupId` 一个回合生成一个）：模型改了三篇 = 三篇各一个版本点、
 *   同一个 group —— 撤销一下全退回去（`docs/ai.md` 第六节）。
 */
import type { Context } from 'cordis'

import type { AiMessage, AiService, AiToolCall, ToolSpec, VersionMeta } from '../../src/kernel/contract'
import { DOCS_CHANGED } from '../../src/kernel/contract'
import { reportError, reportNote } from '../../src/kernel/errors'
import {
  runLoop,
  type AssistantTurn,
  type HarnessTool,
  type StreamTurn,
} from './harness'
import { whereNow } from './place'
import {
  addSpend,
  clearUndo,
  finishTool,
  getAiState,
  onStopRequest,
  pushLine,
  setAiState,
  type Undo,
} from './state'
import { estimateTokens, requestTokens } from './tokens'

/** 一次回答最多转几轮工具。够解「先 grep 再读再写」这种；再长就是模型在绕圈。 */
const MAX_ROUNDS = 6

/** 写工具的名字 —— 只有它们会动库（进撤销条），也只有它们不许和别的调用并发。 */
const WRITES = new Set(['doc_create', 'doc_append', 'doc_replace'])

const BASE_PROMPT = [
  '你是这个笔记应用里的助手。你能读（vfs_list / vfs_grep / vfs_read）也能写（doc_create / doc_append / doc_replace）。',
  '读写都走一棵虚拟目录：先看 /index.md 拿全局地图，用 vfs_grep 定位，再 vfs_read 读正文（长文用 offset / limit 分页，别一次灌满）。',
  '要写就用 Markdown：新建一篇用 doc_create，往已有的末尾加用 doc_append，改一小段用 doc_replace。',
  '不要尝试删除文档 —— 没有这个工具。回答用用户提问的语言，简短。',
].join('\n')

/** 一个回合一个。`crypto.randomUUID` 要安全上下文，自建一个更省心。 */
function newGroupId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 跑一个回合。
 *
 * 历史**只带这一回合**（system + 用户这句 + 中间几轮工具），不跨回合攒 ——
 * 单人应用、你问它才答（`docs/ai.md` 第十一节），攒历史只会把上下文喂爆。
 */
export async function runTurn(ctx: Context, ai: AiService, prompt: string): Promise<void> {
  const state = getAiState()
  if (state.busy) return
  const groupId = newGroupId()
  const written = new Set<string>()
  const specs: ToolSpec[] = ctx.get('tools')?.list() ?? []
  // 中断：界面那颗按钮按下去 → `state.stop()` 走到这儿 abort（`onStopRequest` 是那条线）。
  const controller = new AbortController()
  onStopRequest(() => controller.abort())

  setAiState({
    busy: true,
    busySince: Date.now(),
    error: '',
    draft: '',
    stopRequested: false,
  })
  pushLine({ role: 'user', text: prompt })

  const messages: AiMessage[] = [
    { role: 'system', content: await systemPrompt(ctx) },
    { role: 'user', content: prompt },
  ]

  try {
    await runLoop(
      messages,
      {
        tools: toolsFor(specs, groupId, written),
        maxRounds: MAX_ROUNDS,
        onAssistant: (turn) => {
          if (turn.content.trim()) pushLine({ role: 'ai', text: turn.content.trim() })
        },
        onToolStart: (call) =>
          pushLine({
            role: 'note',
            text: call.name,
            tool: { id: call.id, name: call.name, detail: detailOf(argsOf(call)), start: Date.now(), ms: null },
          }),
        onToolEnd: (call, isError) => finishTool(call.id, isError),
      },
      controller.signal,
      makeStreamTurn(ctx, ai, specs),
    )
  } finally {
    onStopRequest(null)
    // 中断留一行字：不然对话里看着跟「说完了」一样（已流出的那半句还在上面）。
    if (controller.signal.aborted) pushLine({ role: 'note', text: ctx.i18n.t('agent.stopped') })
    setAiState({ busy: false, draft: '', stopRequested: false })
    // 一回合一条撤销条。没写过东西就不给（`doc_create` 也进 —— 新建的那篇同样要能退）。
    if (written.size) {
      setAiState({ undo: [...getAiState().undo, { groupId, docs: [...written] }] })
    }
  }
}

/** 系统提示：`/index.md` + `/AGENTS.md` 就是这棵树自己的说明书（`docs/ai.md` 第四节）。 */
async function systemPrompt(ctx: Context): Promise<string> {
  const vfs = ctx.get('vfs')
  const parts = [BASE_PROMPT]
  const where = await whereNow(ctx, getAiState().viewingDoc)
  if (where !== '') parts.push(where)
  if (!vfs) return parts.join('\n\n')
  for (const path of ['/index.md', '/AGENTS.md']) {
    try {
      parts.push(`# ${path}\n${await vfs.read(path)}`)
    } catch {
      // 目录里没有这一篇就不塞 —— 提示词少一段好过整轮起不来。
    }
  }
  return parts.join('\n\n')
}

/**
 * Rust 那条流 → 循环要的 `StreamTurn`。
 *
 * ★ 中断的落点就在这儿：`for await` 一 `break`，`chat.ts` 的 `finally` 就把三个监听退掉，
 *   后面到的 `ai:delta` 没人收（Rust 那条线程自己会跑到干，它不占 IPC）。
 */
function makeStreamTurn(ctx: Context, ai: AiService, specs: readonly ToolSpec[]): StreamTurn {
  return async (messages, signal) => {
    // ★ 这一轮真发出去的那一包（含系统提示）。每转一轮就要重发一遍，所以**每轮各计一次**
    //   —— 那正是账单上的样子。
    const spent = requestTokens(messages, specs)
    let text = ''
    const calls: AiToolCall[] = []
    let stop = 'stop'
    try {
      for await (const chunk of ai.chat([...messages], [...specs])) {
        if (chunk.type === 'text') {
          text += chunk.text
          setAiState({ draft: text })
        } else if (chunk.type === 'tool') {
          calls.push(chunk.call)
        } else {
          stop = chunk.reason
        }
        if (signal.aborted) break
      }
    } catch (err) {
      reportError('ai', err)
      setAiState({ error: `${ctx.i18n.t('agent.failed')}：${message(err)}` })
      stop = 'error'
    }
    setAiState({ draft: '' })
    // 这轮产出的字和工具参数也算（它们下一轮就是输入，最后一轮则是纯输出）。
    addSpend(spent + estimateTokens(text) + estimateTokens(JSON.stringify(calls)))
    if (signal.aborted) stop = 'aborted'
    return { role: 'assistant', content: text, toolCalls: calls, stop } satisfies AssistantTurn
  }
}

/** 契约里的 `ToolSpec` → 循环要的 `HarnessTool`。**读并发、写串行**。 */
function toolsFor(specs: readonly ToolSpec[], groupId: string, written: Set<string>): HarnessTool[] {
  return specs.map((spec) => ({
    name: spec.name,
    executionMode: WRITES.has(spec.name) ? 'sequential' : 'parallel',
    async run(call) {
      // `groupId` 是**调用方加的**，不在工具的 JSON Schema 里（模型看不见它）。
      try {
        const result = await spec.run({ ...parseArgs(call.args), groupId })
        const id = (result as { id?: unknown } | null)?.id
        if (WRITES.has(spec.name) && typeof id === 'string') written.add(id)
        return typeof result === 'string' ? result : JSON.stringify(result)
      } catch (err) {
        // 工具失败是常态（模型给错参数），不当故障报 —— 但得能查到（AGENTS.md §3）。
        reportNote('ai', `工具 ${spec.name} 失败：${message(err)}`)
        throw err
      }
    },
  }))
}

/** 模型给的参数是**一段 JSON 文本**。不合法就响亮报错，让它自己重来。 */
function parseArgs(raw: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    throw new Error('参数不是合法 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('参数不是一个对象')
  return parsed as Record<string, unknown>
}

/** 同上，但**只给界面看** —— 拼不出来就空着，不打断这一轮。 */
function argsOf(call: AiToolCall): Record<string, unknown> {
  try {
    return parseArgs(call.args)
  } catch {
    return {}
  }
}

/** 参数里那句能认出来的话 —— 名字后面括号里显示的（`vfs_read(/tree/我与我.md)`）。 */
function detailOf(args: Record<string, unknown>): string {
  for (const key of ['path', 'query', 'title', 'id']) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

/**
 * 撤销一个回合（`docs/ai.md` 第六节）。
 *
 * 每一篇各回退一次：在 `version:list` 里找 `groupId` 等于这一回合的那些版本点，
 * 取**最早**那个（列表是 `at DESC`，最早 = 动它之前那一刻），`version:restore` 回去。
 * 恢复本身无损（Rust 先把现在记成一个新版本），所以这一下随时还能再退回来。
 */
export async function undo(ctx: Context, entry: Undo): Promise<void> {
  clearUndo(entry.groupId)
  try {
    for (const id of entry.docs) {
      const versions = await ctx.rpc.call<VersionMeta[]>('version:list', { id })
      const mine = versions.filter((v) => v.groupId === entry.groupId)
      const target = mine.reduce<VersionMeta | null>(
        (a, b) => (a === null || b.id < a.id ? b : a),
        null,
      )
      // 这一篇在这一回合里没留下版本点（比如写工具没打成点）→ 退不了，跳过而不是报错。
      if (!target) continue
      await ctx.rpc.call('version:restore', { id, versionId: target.id })
      // 顺序照 `version-history/actions.ts`：改完库立刻 reload，抢在 300ms 落库之前。
      await ctx.editor.reload(id)
    }
    ctx.emit(DOCS_CHANGED)
  } catch (err) {
    reportError('ai', err)
    setAiState({ error: `${ctx.i18n.t('agent.undoFailed')}：${message(err)}` })
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
