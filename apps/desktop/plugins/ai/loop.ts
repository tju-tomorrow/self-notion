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
 *
 * 跨回合的上下文是会话上的 transcript，不是从气泡重拼的。系统提示每回合现写，不进那份记录。
 */
import type { Context } from 'cordis'

import type {
  AiImage,
  AiMessage,
  AiService,
  AiToolCall,
  ToolSpec,
  VersionMeta,
} from '../../src/kernel/contract'
import { DOCS_CHANGED } from '../../src/kernel/contract'
import { reportError, reportNote } from '../../src/kernel/errors'
import {
  packContext,
  runLoop,
  type AssistantTurn,
  type HarnessTool,
  type StreamTurn,
  type ToolOutput,
} from './harness'
import { placeOf, whereNow } from './place'
import {
  emptyPrompt,
  mergeTraces,
  scopeLabel,
  searchScope,
  sourcesBlock,
  type RagScope,
  type RagTrace,
} from './rag'
import {
  addSpend,
  askApproval,
  cancelApproval,
  clearUndo,
  finishRag,
  finishTool,
  getAiState,
  onStopRequest,
  pushLine,
  queueSteer,
  setAiState,
  setDraft,
  setThink,
  setTranscript,
  takeSteers,
  type Session,
  type Undo,
} from './state'
import { estimateTokens, requestTokens } from './tokens'

/** 写工具的名字 —— 只有它们会动库，也只有它们不许和别的调用并发。正文改动才进撤销条。 */
const WRITES = new Set([
  'doc_create',
  'doc_append',
  'doc_replace',
  'doc_blocks',
  'doc_rename',
  'doc_move',
  'doc_tag',
  'notes_familiarity',
])

const BASE_PROMPT = [
  '你是这个笔记应用里的助手。先给结论，再按需要展开；用户要求短就短。用用户提问的语言。',
  '思考放在思维链里。回答正文不要复述检索步骤，也不要写「我先看看」。',
  '定位用 notes_find。读正文用 vfs_read（默认一段，长文用 offset 续读）。列目录用 vfs_list。主题分布用 notes_map。关联用 notes_related。',
  '学习数据（打开次数、阅读时长、深度、行为分、熟悉度）用 notes_learn。打熟悉度用 notes_familiarity（1 不熟 / 2 略懂 / 3 熟悉 / 4 很熟，0 清除）。',
  '颜色和评论：当前这篇用 doc_annotations；在多篇里找用 doc_marks。vfs_read 只有纯文字。',
  '笔记里的图片会随 vfs_read 一起给你，正文里对应 [图片 N]。',
  '要写就用 Markdown：新建 doc_create，追加 doc_append，改一小段 doc_replace。结构化块用 doc_blocks（或 doc_create 的 blocks）。',
  '结构化块每项 {type, text, …}。type = paragraph / heading(level 1-3) / quote / callout(icon) / codeBlock(language) / equation(tex) / divider / ' +
    'bulletedListItem / numberedListItem(start) / todoItem(checked) / toggle(open) / table(rows，第一行表头) / ' +
    'image(blobId,caption) / video|audio|file(blobId,name) / subpage(docId) / columnList(columns，每列一个块数组) / ' +
    'tableOfContents / breadcrumb。text 支持行内 markdown，children 是嵌套块，color / bg 是块级文字色和背景色。',
  '改标题 doc_rename，移动 doc_move，改标签 doc_tag（整组替换）。',
  '用户贴了图片就看图，结合他的问题和圈定的笔记一起答。',
  '圈了一个或多个范围时，只根据那些笔记和资料里的【相关笔记】回答，并标明哪句来自相关笔记。没圈范围、也不是在问当前这篇时，就正常聊天，不要主动翻库。',
  '用户消息里 """ 圈起来的是他划出的原文。追问接着上面的对话和工具结果，不要换一批笔记重答。',
  '工具够用就停并回答。用户要总结成笔记时，资料齐了就写。不要删除文档。不要用 vfs_grep 扫整库，除非 notes_find 明确不够。',
].join('\n')

/** 用户划线送进来的那段正文。`path` 拿不到就只说「当前笔记」。 */
export interface Quote {
  text: string
  path: string | null
  /** 划线所在文档 —— 检索时给它加权，而不是把整段引用词塞进查询。 */
  id: string | null
}

/** 一个回合一个。`crypto.randomUUID` 要安全上下文，自建一个更省心。 */
function newGroupId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 这一轮还在跑的时候插一句。气泡先挂着，工具跑完才进模型（`harness.ts` 的 `takeSteering`）。 */
export function steer(
  prompt: string,
  quote?: Quote,
  images?: AiImage[],
  scopes?: readonly RagScope[],
): void {
  const sessionId = getAiState().runningId
  if (!sessionId) return
  const where = scopes?.length ? `\n（这一句圈了：${scopes.map((s) => `《${scopeLabel(s)}》`).join('、')}）` : ''
  queueSteer({
    text: prompt,
    content: withQuote(prompt, quote) + where,
    quote: quote?.text,
    images: images?.length ? images : undefined,
  })
}

/**
 * 跑一个回合。
 *
 * 模型看到的是这条会话的 transcript（之前的问、答、工具回执），不是从气泡里重拼的几句。
 */
export async function runTurn(
  ctx: Context,
  ai: AiService,
  prompt: string,
  quote?: Quote,
  scopes?: RagScope[],
  images?: AiImage[],
): Promise<void> {
  const state = getAiState()
  if (state.busy) return
  // 开头就钉死：跑的过程中人可以切到别的会话，字不能写错地方。
  const sessionId = state.currentId
  const session = state.sessions.find((s) => s.id === sessionId)
  const groupId = newGroupId()
  const written = new Set<string>()
  const specs: ToolSpec[] = ctx.get('tools')?.list() ?? []
  const controller = new AbortController()
  onStopRequest(() => controller.abort())

  setDraft('')
  setThink('')
  setAiState({
    busy: true,
    busySince: Date.now(),
    runningId: sessionId,
    error: '',
    errorFor: null,
    stopRequested: false,
  })
  const picked = await focusScopes(ctx, prompt, quote, scopes ?? [])
  pushLine(
    {
      role: 'user',
      text: prompt,
      scope: picked[0],
      scopes: picked.length ? picked : undefined,
      quote: quote?.text,
      images: images?.length ? images : undefined,
    },
    sessionId,
  )

  let messages: AiMessage[] | null = null
  let answered = false
  try {
    // 只有圈了范围、划了字、或这句话是在问当前这篇时才检索。普通闲聊不翻库。
    const found = picked.length ? await retrieve(ctx, picked, prompt, quote, groupId, sessionId) : null
    const trace = found?.trace ?? null
    const rules = scopeRules(ctx, picked, trace, found?.related ?? '')
    const system = await systemPrompt(ctx, picked.length > 0)
    const user: AiMessage = {
      role: 'user',
      content: userContent(prompt, quote, trace, found?.related ?? ''),
    }
    if (images?.length) user.images = images
    messages = [
      { role: 'system', content: rules === '' ? system : `${system}\n\n${rules}` },
      ...seed(session),
      user,
    ]

    await runLoop(
      messages,
      {
        tools: toolsFor(ctx, specs, groupId, written, picked, found?.extra ?? []),
        takeSteering: () => takeSteers(sessionId),
        onAssistant: (turn) => {
          const text = turn.content.trim()
          const think = turn.reasoning?.trim()
          if (!text && !think) return
          if (text) answered = true
          pushLine({ role: 'ai', text, think: think || undefined }, sessionId)
        },
        onToolStart: (call) =>
          pushLine(
            {
              role: 'note',
              text: call.name,
              tool: { id: call.id, name: call.name, detail: detailOf(argsOf(call)), start: Date.now(), ms: null },
            },
            sessionId,
          ),
        onToolEnd: (call, isError) => finishTool(call.id, isError, sessionId),
      },
      controller.signal,
      makeStreamTurn(ctx, ai, specs, sessionId),
    )
    if (!answered && !controller.signal.aborted) {
      pushLine({ role: 'note', text: ctx.i18n.t('agent.noAnswer') }, sessionId)
    }
  } finally {
    if (messages) {
      const rest = takeSteers(sessionId)
      if (rest.length) messages.push(...rest)
      remember(sessionId, messages)
    }
    onStopRequest(null)
    if (controller.signal.aborted) pushLine({ role: 'note', text: ctx.i18n.t('agent.stopped') }, sessionId)
    setDraft('')
    setThink('')
    setAiState({ busy: false, runningId: null, stopRequested: false })
    if (written.size) {
      setAiState({ undo: [...getAiState().undo, { groupId, docs: [...written] }] })
    }
  }
}

/** 老会话没有 transcript 时，用气泡里的问和答垫一句，好让「继续」接得上。 */
function seed(session: Session | undefined): AiMessage[] {
  if (!session) return []
  if (session.transcript.length) {
    return session.transcript.map((m) => ({
      ...m,
      images: m.images?.slice(),
      toolCalls: m.toolCalls?.map((c) => ({ ...c })),
    }))
  }
  const out: AiMessage[] = []
  for (const line of session.lines) {
    if (line.role === 'user' && line.text) {
      out.push({
        role: 'user',
        content: line.quote
          ? withQuote(line.text, { text: line.quote, path: null, id: null })
          : line.text,
        images: line.images,
      })
    } else if (line.role === 'ai' && line.text) {
      out.push({ role: 'assistant', content: line.text })
    }
  }
  return out.slice(-8)
}

function remember(sessionId: string, messages: readonly AiMessage[]): void {
  const body = packContext(messages.filter((m) => m.role !== 'system')).map(bare)
  setTranscript(sessionId, body)
}

function bare(m: AiMessage): AiMessage {
  const msg: AiMessage = { role: m.role, content: m.content }
  if (m.images?.length) msg.images = m.images
  if (m.toolCalls?.length) {
    msg.toolCalls = m.toolCalls.map(({ id, name, args }) => ({ id, name, args }))
  }
  if (m.toolCallId) msg.toolCallId = m.toolCallId
  return msg
}

/** 这句话是在问笔记，而不是闲聊或让它新写一篇。 */
function aboutNotes(prompt: string): boolean {
  if (prompt.length < 4) return false
  if (/新建|写一篇|日记/.test(prompt) && !/[?？]/.test(prompt)) return false
  return /[?？]|什么|为何|为什么|怎么|哪些|总结|解释|区别|这篇|这里|这段|相关/.test(prompt)
}

/** `@` 优先。没圈时，划线或「在问当前这篇」才锁到那一篇。 */
async function focusScopes(
  ctx: Context,
  prompt: string,
  quote: Quote | undefined,
  picked: readonly RagScope[],
): Promise<RagScope[]> {
  if (picked.length) return [...picked]
  if (quote?.id && quote.path) {
    return [{ kind: 'doc', id: quote.id, path: quote.path, title: quote.path }]
  }
  if (!aboutNotes(prompt)) return []
  const id = getAiState().viewingDoc
  if (!id) return []
  const place = await placeOf(ctx, id)
  if (!place) return []
  return [{ kind: 'doc', id, path: place.path, title: place.title }]
}

/** 划线段只进给模型这一轮 —— 气泡里还是用户自己问的那句话（他选的）。 */
function withQuote(prompt: string, quote?: Quote): string {
  if (!quote) return prompt
  const where = quote.path ? `《${quote.path}》` : '当前笔记'
  return `用户选中了${where}里的这一段：\n"""\n${quote.text}\n"""\n\n${prompt}`
}

interface Found {
  trace: RagTrace | null
  related: string
  /** 相关笔记的路径。范围门放行这些，否则模型读不到圈外的关联。 */
  extra: string[]
}

/** 每个范围各检索一次，再按问题的相关度合成。命中的笔记再拉关联。 */
async function retrieve(
  ctx: Context,
  scopes: readonly RagScope[],
  prompt: string,
  quote: Quote | undefined,
  groupId: string,
  sessionId: string,
): Promise<Found> {
  const id = `rag-${groupId}`
  const detail = scopes.map(scopeLabel).join(' · ')
  pushLine(
    {
      role: 'note',
      text: 'rag_search',
      tool: { id, name: 'rag_search', detail, start: Date.now(), ms: null },
    },
    sessionId,
  )
  try {
    const traces = await Promise.all(
      scopes.map((scope) => searchScope(ctx, scope, prompt, quote?.id)),
    )
    const trace = mergeTraces(traces)
    const related = await relatedBlock(ctx, scopes, trace, quote?.id)
    if (trace) finishRag(id, trace, sessionId)
    else finishTool(id, true, sessionId)
    return { trace, related: related.text, extra: related.paths }
  } catch (err) {
    reportError('ai.rag', err)
    finishTool(id, true, sessionId)
    return { trace: null, related: '', extra: [] }
  }
}

/** 命中的那几篇（加上圈定的单篇）各拉一截关联。路径从结果里抠出来，给范围门用。 */
async function relatedBlock(
  ctx: Context,
  scopes: readonly RagScope[],
  trace: RagTrace | null,
  focusId?: string | null,
): Promise<{ text: string; paths: string[] }> {
  const ids: string[] = []
  const push = (id: string) => {
    if (id && !ids.includes(id) && ids.length < 3) ids.push(id)
  }
  if (focusId) push(focusId)
  for (const scope of scopes) if (scope.kind === 'doc') push(scope.id)
  for (const chunk of trace?.chunks ?? []) push(chunk.docId)
  const parts: string[] = []
  const paths: string[] = []
  for (const id of ids) {
    try {
      const text = await ctx.rpc.call<string>('notes:related', { id, limit: 4 })
      if (!text || text.includes('暂无关联')) continue
      parts.push(text.trim())
      for (const match of text.matchAll(/^\s+(\/\S+\.md)\s*$/gm)) {
        const path = match[1]
        if (path && !paths.includes(path)) paths.push(path)
      }
    } catch (err) {
      reportError('ai.related', err)
    }
  }
  return { text: parts.join('\n\n'), paths }
}

/** 有范围时多一段规则：按用户的问题用这些笔记和它们的关联来答。 */
function scopeRules(
  ctx: Context,
  scopes: readonly RagScope[],
  trace: RagTrace | null,
  related: string,
): string {
  if (!scopes.length) return ''
  const names = scopes.map((scope) => `《${scopeLabel(scope)}》`).join('、')
  const head =
    scopes.length === 1
      ? `本轮用户把检索范围圈在了${names}。按他的原问题使用这些资料。`
      : `本轮用户在同一句话里圈了${names}。按他的原问题把这些范围合在一起答，不要逐个范围各写一篇无关的综述。`
  const tail = related
    ? '资料后面的【相关笔记】是从这些篇链出去的，可以用，但要说清那是相关笔记而不是范围内的原文。补读可以读范围内的路径，也可以读相关笔记给出的路径。'
    : '需要补读时只读这些范围里的路径（vfs_list / vfs_read）。'
  if (!trace) return `${head}预检索失败了，按没有资料处理。${tail}`
  if (trace.empty || trace.chunks.length === 0) return `${head}${emptyPrompt(ctx, trace)}`
  return [
    `${head}下面的【检索资料】是主要依据。`,
    '- 先用 2-3 句给结论，再分节讲；每节先说是什么/为什么，再给依据。',
    '- 每个事实性结论后标 [n]，n 是资料编号。',
    '- 资料不够或互相矛盾就直说，不要补片段里没有的事实。',
    `- ${tail}`,
  ].join('\n')
}

/** 资料在前、问题在后 —— 模型先看到依据和相关笔记，再看到他怎么问的。 */
function userContent(
  prompt: string,
  quote: Quote | undefined,
  trace: RagTrace | null,
  related: string,
): string {
  const question = withQuote(prompt, quote)
  const blocks = [
    trace && trace.chunks.length ? sourcesBlock(trace) : '',
    related ? `【相关笔记】\n${related}` : '',
  ].filter((part) => part !== '')
  if (!blocks.length) return question
  return `${blocks.join('\n\n')}\n\n我的问题：${question}`
}

/** 系统提示：`/index.md` + `/AGENTS.md` 就是这棵树自己的说明书（`docs/ai.md` 第四节）。
 *  ★ 圈了范围就不再塞那两份 —— 范围已经锁死，索引省下来的两千字给资料。 */
async function systemPrompt(ctx: Context, scoped = false): Promise<string> {
  const vfs = ctx.get('vfs')
  const parts = [BASE_PROMPT]
  const where = await whereNow(ctx, getAiState().viewingDoc)
  if (where !== '') parts.push(where)
  if (!vfs || scoped) return parts.join('\n\n')
  for (const path of ['/index.md', '/AGENTS.md']) {
    try {
      parts.push(`# ${path}\n${clip(await vfs.read(path), 1_800)}`)
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
function makeStreamTurn(
  ctx: Context,
  ai: AiService,
  specs: readonly ToolSpec[],
  sessionId: string,
): StreamTurn {
  return async (messages, signal, toolsOn) => {
    const tools = toolsOn ? specs : []
    // 逼它开口的那句只存在这一次请求里，不进 transcript —— 不然下一轮会把它当成用户说的。
    const sent = toolsOn
      ? messages
      : [
          ...messages,
          {
            role: 'user' as const,
            content: '停止调用工具。用已经拿到的资料直接回答；资料不够就说明缺什么。',
          },
        ]
    const packed = packContext(sent)
    const spent = requestTokens(packed, tools)
    let text = ''
    let reasoning = ''
    const calls: AiToolCall[] = []
    let stop = 'stop'
    try {
      for await (const chunk of ai.chat(packed, [...tools], signal)) {
        if (chunk.type === 'text') {
          text += chunk.text
          setDraft(text)
        } else if (chunk.type === 'think') {
          reasoning += chunk.text
          setThink(reasoning)
        } else if (chunk.type === 'tool') {
          calls.push(chunk.call)
        } else {
          stop = chunk.reason
        }
        if (signal.aborted) break
      }
    } catch (err) {
      reportError('ai', err)
      setAiState({ error: `${ctx.i18n.t('agent.failed')}：${message(err)}`, errorFor: sessionId })
      stop = 'error'
    }
    setDraft('')
    setThink('')
    addSpend(
      spent + estimateTokens(text) + estimateTokens(reasoning) + estimateTokens(JSON.stringify(calls)),
      sessionId,
    )
    if (signal.aborted) stop = 'aborted'
    return {
      role: 'assistant',
      content: text,
      reasoning: reasoning || undefined,
      toolCalls: toolsOn ? calls : [],
      stop,
    } satisfies AssistantTurn
  }
}

/** 用户点「不同意」—— 不是故障，别写进 errors.log。 */
class Denied extends Error {}

/**
 * 写工具过闸：等人点头 / 自动放行 / 拒绝。读工具直接放行。
 * 中断时把悬着的卡收掉并当拒绝 —— 循环不能等一个永远不会来的点击。
 */
async function gate(
  ctx: Context,
  spec: ToolSpec,
  call: AiToolCall,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<void> {
  if (!WRITES.has(spec.name)) return
  if (signal.aborted) throw new Denied(`${call.name} 没有执行：这一回合被中断了。`)

  const onAbort = () => cancelApproval()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const choice = await askApproval({
      id: call.id,
      name: spec.name,
      detail: detailOf(args),
      preview: previewOf(ctx, args),
    })
    if (choice !== 'deny') return
    const what = detailOf(args)
    throw new Denied(
      `用户拒绝了这次修改（${spec.name}${what ? `：${what}` : ''}），没有执行。` +
        '不要原样重试；先问清楚用户想怎么改。',
    )
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** 卡片里那句「要写什么」—— 块结构 / markdown / 新标题，截一段就够判断了。 */
function previewOf(ctx: Context, args: Record<string, unknown>): string {
  const quote = typeof args['quote'] === 'string' ? args['quote'] : ''
  const head = quote ? `要替换：${quote}\n\n` : ''
  const blocks = args['blocks']
  if (Array.isArray(blocks)) {
    const label = ctx.i18n.t('agent.approveBlocks', { n: blocks.length })
    return head + `${label}\n${clip(JSON.stringify(blocks, null, 2), 500)}`
  }
  const markdown = args['markdown']
  if (typeof markdown === 'string' && markdown !== '') return head + clip(markdown, 600)
  const title = args['title']
  if (typeof title === 'string' && title !== '') return title
  return head.trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 契约里的 `ToolSpec` → 循环要的 `HarnessTool`。**读并发、写串行**。 */
function toolsFor(
  ctx: Context,
  specs: readonly ToolSpec[],
  groupId: string,
  written: Set<string>,
  scopes: readonly RagScope[],
  extra: readonly string[],
): HarnessTool[] {
  return specs.map((spec) => ({
    name: spec.name,
    executionMode: WRITES.has(spec.name) ? 'sequential' : 'parallel',
    async run(call, signal) {
      // `groupId` 是**调用方加的**，不在工具的 JSON Schema 里（模型看不见它）。
      try {
        const args = {
          ...parseArgs(call.args),
          groupId,
          // 标注是「当前这篇」的查询 —— 模型看不到 viewingDoc，调用方补上。
          ...(spec.name === 'doc_annotations'
            ? { currentDocId: getAiState().viewingDoc ?? '' }
            : {}),
        }
        fillScope(spec.name, args, scopes)
        await assertScope(ctx, scopes, extra, spec.name, args)
        await gate(ctx, spec, call, args, signal)
        const result = await spec.run(args)
        const id = (result as { id?: unknown } | null)?.id
        if (WRITES.has(spec.name) && typeof id === 'string') written.add(id)
        return asToolOutput(result)
      } catch (err) {
        // 工具失败是常态（模型给错参数），不当故障报 —— 但得能查到（AGENTS.md §3）。
        // 用户拒绝不是故障，跳过。
        if (!(err instanceof Denied)) reportNote('ai', `工具 ${spec.name} 失败：${message(err)}`)
        throw err
      }
    },
  }))
}

/** 只圈了一处时，把那一篇或那个目录补进参数。没圈时，关联默认当前正在看的那篇。 */
function fillScope(name: string, args: Record<string, unknown>, scopes: readonly RagScope[]): void {
  const viewing = getAiState().viewingDoc ?? ''
  const scope = scopes.length === 1 ? scopes[0] : undefined
  if (!scope && viewing && name === 'notes_related' && !strArg(args, 'id')) args['id'] = viewing
  if (!scope) return
  if (name === 'doc_marks' && scope.kind === 'dir' && !strArg(args, 'path')) args['path'] = scope.path
  if (name === 'doc_marks' && scope.kind === 'doc') args['ids'] = [scope.id]
  if (name === 'notes_related' && scope.kind === 'doc' && !strArg(args, 'id')) args['id'] = scope.id
  if (name === 'notes_learn' && scope.kind === 'doc' && !strArg(args, 'target')) args['target'] = scope.id
}

/** 范围是门。多个范围取并集，相关笔记的路径也放行。 */
async function assertScope(
  ctx: Context,
  scopes: readonly RagScope[],
  extra: readonly string[],
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  if (!scopes.length) return
  if (name === 'doc_create') return
  const label = scopes.map(scopeLabel).join('、')
  if (name === 'vfs_grep' || name === 'notes_find' || name === 'notes_map') {
    throw new Error(`这一问圈在${label}，不要再做全库检索。用 vfs_read / vfs_list 读这些范围里的路径。`)
  }
  for (const key of ['path', 'id', 'target', 'parent', 'parentId']) {
    const ref = strArg(args, key)
    if (!ref) continue
    if (ref.startsWith('/')) {
      if (!allowedPath(scopes, extra, ref)) throw new Error(`路径 ${ref} 不在这一问的范围里`)
      continue
    }
    if (scopes.some((scope) => scope.kind === 'doc' && scope.id === ref)) continue
    if (scopes.every((scope) => scope.kind === 'doc')) {
      throw new Error(`这一问只许动 ${label}`)
    }
    const place = await placeOf(ctx, ref)
    if (place && !allowedPath(scopes, extra, place.path)) {
      throw new Error(`《${place.path}》不在这一问的范围里`)
    }
  }
}

function allowedPath(scopes: readonly RagScope[], extra: readonly string[], path: string): boolean {
  if (extra.includes(path)) return true
  return scopes.some((scope) => pathInside(scope, path))
}

function pathInside(scope: RagScope, path: string): boolean {
  if (scope.kind === 'doc') return path === scope.path
  const dir = scope.path.endsWith('/') ? scope.path : `${scope.path}/`
  return path === scope.path || path === `${scope.path}.md` || path.startsWith(dir)
}

function strArg(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  return typeof v === 'string' ? v : ''
}

/** 读工具可以带回图片（`{ text, images }`）；其余结果照旧序列化成一句话。 */
function asToolOutput(result: unknown): string | ToolOutput {
  if (result && typeof result === 'object' && 'text' in result) {
    const { text, images } = result as { text?: unknown; images?: unknown }
    if (typeof text === 'string') {
      return { text, images: Array.isArray(images) ? (images as AiImage[]) : [] }
    }
  }
  return typeof result === 'string' ? result : JSON.stringify(result)
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
    setAiState({
      error: `${ctx.i18n.t('agent.undoFailed')}：${message(err)}`,
      errorFor: getAiState().currentId,
    })
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
