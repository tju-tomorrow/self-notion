/**
 * `ctx.ai` —— 契约里那个 `AiService`。**它的全部内容是「Rust 的流 → 前端的 async 迭代器」**。
 *
 * HTTP、key、SSE 的解析全在 Rust（`src-tauri/src/ai/chat.rs`），这里只做两件事：
 *   1. 给这条流编一个 `requestId`，订阅三个事件（`ai:delta` / `ai:done` / `ai:error`）；
 *   2. 把「事件到了」翻成一个能 `for await` 的队列 —— 契约里 `chat()` 的返回是
 *      `AsyncIterable<AiChunk>`，而 Tauri 的事件是回调，中间必须有这一层。
 *
 * ★ 带上 `requestId` 挑自己的那条流：同一时刻可能不止一条（用户手快点了两下）。
 * ★ `ToolSpec.run` 是函数，**过不了线**，所以送出去之前把 `run` 剥掉。
 */
import { listen } from '@tauri-apps/api/event'
import type { Context } from 'cordis'

import type { AiChunk, AiMessage, AiService, ToolSpec } from '../../src/kernel/contract'

interface DeltaEvent {
  requestId: string
  chunk: AiChunk
}

interface DoneEvent {
  requestId: string
  reason: string
}

interface ErrorEvent {
  requestId: string
  message: string
}

let seq = 0

export function makeAi(ctx: Context): AiService {
  return {
    // `ask` 是 D-0042 留下的老形状（一次纯文本问答），一个消费者都没有了。
    // 不装死，也不另开一条路 —— 架在 `chat` 上：拿它的 `text` 片（契约里它回的是 Promise）。
    ask: async (messages: AiMessage[]) => ask(ctx, messages),
    chat: (messages: AiMessage[], tools?: ToolSpec[]) => chat(ctx, messages, tools),
  }
}

async function* ask(ctx: Context, messages: AiMessage[]): AsyncGenerator<string> {
  for await (const chunk of chat(ctx, messages)) {
    if (chunk.type === 'text') yield chunk.text
  }
}

async function* chat(
  ctx: Context,
  messages: AiMessage[],
  tools?: ToolSpec[],
): AsyncGenerator<AiChunk> {
  const requestId = `chat-${++seq}-${Date.now()}`
  // 状态装在一个对象里而不是三个 `let` —— 三个 `let` 会在闭包里被 TS 收窄成初始字面量。
  const flow = { ended: false, failure: '', wake: null as (() => void) | null }
  const queue: AiChunk[] = []
  const kick = () => {
    const w = flow.wake
    flow.wake = null
    w?.()
  }

  const offs = await Promise.all([
    listen<DeltaEvent>('ai:delta', (e) => {
      if (e.payload.requestId !== requestId) return
      queue.push(e.payload.chunk)
      kick()
    }),
    listen<DoneEvent>('ai:done', (e) => {
      if (e.payload.requestId !== requestId) return
      flow.ended = true
      kick()
    }),
    listen<ErrorEvent>('ai:error', (e) => {
      if (e.payload.requestId !== requestId) return
      flow.failure = e.payload.message
      flow.ended = true
      kick()
    }),
  ])

  try {
    // 这一句**立刻**回来（Rust 那边把整段往返扔给了自己的线程），后面的字节从事件来。
    await ctx.rpc.call('ai:chat', {
      requestId,
      messages,
      tools: (tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    })

    while (!flow.ended || queue.length > 0) {
      const next = queue.shift()
      if (next) {
        yield next
        continue
      }
      if (flow.ended) break
      await new Promise<void>((resolve) => {
        flow.wake = () => {
          resolve()
        }
      })
    }
    // 流中途断了（HTTP 错 / 没配 / 网关把错误塞在 200 里）—— 命令早就返回了，只能从这儿抛。
    if (flow.failure !== '') throw new Error(flow.failure)
  } finally {
    for (const off of offs) off()
  }
}
