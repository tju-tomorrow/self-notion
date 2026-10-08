/**
 * agent 循环 —— 移植自 `@earendil-works/pi-agent-core`（MIT，earendil-works/pi）的
 * `packages/agent/src/agent-loop.ts`，按我们这东西的形状裁到只剩循环（D-0108）。
 *
 * ★ **移植的是循环，不是它的消息对象模型**：一次工具往返的线上形状仍然是我们契约里的
 *   `AiMessage`（`toolCalls` / `toolCallId`，Rust 的 `wire()` 认识它）。换掉那套形状要连带
 *   改 Rust（`src-tauri/src/ai/chat.rs`），而这里要的只是「别绕圈的循环 + 读能并发」。
 *
 * 裁掉的（留在这儿就是死代码）：
 *   · 工具声明的增量（`toToolDeclaration` / `getToolStateChanges`）—— 一次问答里工具面固定；
 *   · typebox 参数校验 —— 六个工具自己兜（`str` / `num` / 一句「参数不是合法 JSON」）；
 *   · `EventStream`、附件、`Agent` 类、会话 / 扩展 / 技能 —— 那是 pi 的壳，不是循环；
 *   · steering / follow-up 队列 —— 界面忙着的时候输入框那颗就是「中断」，没有插话的入口。
 *
 * 留下来的四条，就是移植它的理由：
 *   1. **读并发**：同一批里的读工具一起跑（写工具标 `executionMode: 'sequential'` 会把整批
 *      拉成串行）—— 之前五个 `vfs_list` / `vfs_read` 是一个一个来的；
 *   2. **中断**：`AbortSignal` 串到每一个 await 边界，不再靠一个旗子被轮询；
 *   3. **截断保护**：`stop === 'length'` 的那一批工具**整批不跑** —— 流式拼出来的参数可能是
 *      半句，跑一半写错地方比不写更坏（pi 的 `failToolCallsFromTruncatedMessage`）；
 *   4. **每轮上限**：模型绕圈时有个硬收口（pi 靠 `finishTurn` / `terminate` 收，我们面向单人、
 *      只有「中断」这一个出口，所以留一条硬上限）。
 */
import type { AiMessage, AiToolCall } from '../../src/kernel/contract'

/** 定稿的一条 assistant。`stop` = 这一轮为什么停（就是 `AiChunk` 里 `end.reason` 那个值）。 */
export interface AssistantTurn extends AiMessage {
  role: 'assistant'
  stop: string
}

/** 一次模型往返：键在**流**里（自己往界面上推增量），回一条定稿的 turn。 */
export type StreamTurn = (messages: readonly AiMessage[], signal: AbortSignal) => Promise<AssistantTurn>

/** 循环要的一个工具。比契约里的 `ToolSpec` 窄 —— 循环不看 `description` / `parameters`。 */
export interface HarnessTool {
  name: string
  /** `'sequential'` = 不许和这一批里的别的调用并发。**写工具必须**：两条 `doc_append` 一起跑就是抢同一篇。 */
  executionMode?: 'parallel' | 'sequential'
  /** 回一句给模型看的话。**抛异常也行** —— 循环接着它，当成一次失败的结果回给模型。 */
  run(call: AiToolCall, signal: AbortSignal): Promise<string>
}

export interface HarnessHooks {
  tools: readonly HarnessTool[]
  /** 一次回答最多转几轮。到了就停。 */
  maxRounds: number
  /** 一轮的请求刚发出去 —— 界面上的计时从这儿算。 */
  onRound?(round: number): void
  /** 这一轮的 assistant 定稿了（不管它是说话还是提工具）。 */
  onAssistant?(turn: AssistantTurn): void
  /** 一次工具开始 / 结束。**并发时整批的 `onToolStart` 先一次发完**，界面才画得出一排转圈。 */
  onToolStart?(call: AiToolCall): void
  onToolEnd?(call: AiToolCall, isError: boolean): void
}

/**
 * 跑一个回合。`messages` 是**会被就地追加**的：system + 用户这句 + 中间几轮工具。
 * 循环不攒跨回合的历史（`docs/ai.md` 第十一节）。
 */
export async function runLoop(
  messages: AiMessage[],
  hooks: HarnessHooks,
  signal: AbortSignal,
  streamTurn: StreamTurn,
): Promise<void> {
  for (let round = 1; round <= hooks.maxRounds; round++) {
    if (signal.aborted) return
    hooks.onRound?.(round)

    const turn = await streamTurn(messages, signal)
    messages.push(turn)
    hooks.onAssistant?.(turn)

    // 出错 / 被中断 = **硬退出**：这一轮没有工具要跑，也不该再问一次（同 pi）。
    if (turn.stop === 'error' || turn.stop === 'aborted') return

    const calls = turn.toolCalls ?? []
    if (!calls.length) return

    for (const call of calls) hooks.onToolStart?.(call)
    const results =
      turn.stop === 'length'
        ? calls.map((call) => truncated(call, hooks))
        : await runTools(calls, hooks, signal)
    messages.push(...results)
  }
}

/** 一次工具调用跑完，变成一条 `role: 'tool'` 的回执。`isError` 只给界面看 —— 模型读的是正文。 */
async function runOne(
  call: AiToolCall,
  hooks: HarnessHooks,
  signal: AbortSignal,
): Promise<AiMessage> {
  const tool = hooks.tools.find((one) => one.name === call.name)
  const done = (content: string, isError: boolean): AiMessage => {
    hooks.onToolEnd?.(call, isError)
    return { role: 'tool', toolCallId: call.id, content }
  }
  if (!tool) return done(`没有这个工具：${call.name}`, true)
  if (signal.aborted) return done(`${call.name} 没有执行：这一回合被中断了。`, true)
  try {
    return done(await tool.run(call, signal), false)
  } catch (err) {
    return done(err instanceof Error ? err.message : String(err), true)
  }
}

/** 撞了输出上限的那一批 —— 一个都不跑，逐个报一句（见模块头第 3 条）。 */
function truncated(call: AiToolCall, hooks: HarnessHooks): AiMessage {
  hooks.onToolEnd?.(call, true)
  return {
    role: 'tool',
    toolCallId: call.id,
    content: `${call.name} 没有执行：这一轮的输出撞到了上限，参数可能被切在半句上。请重新提一次。`,
  }
}

async function runTools(
  calls: readonly AiToolCall[],
  hooks: HarnessHooks,
  signal: AbortSignal,
): Promise<AiMessage[]> {
  // 有一条必须串行 → **整批**串行（pi 的 `hasSequentialToolCall`）：读和写混在一批时，
  // 让读去等写，比让写互相踩要安全。
  const oneAtATime = calls.some(
    (call) => hooks.tools.find((one) => one.name === call.name)?.executionMode === 'sequential',
  )
  if (!oneAtATime) return Promise.all(calls.map((call) => runOne(call, hooks, signal)))

  const out: AiMessage[] = []
  for (const call of calls) {
    if (signal.aborted) break
    out.push(await runOne(call, hooks, signal))
  }
  return out
}
