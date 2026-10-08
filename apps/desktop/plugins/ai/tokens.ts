/**
 * 估 token —— 给历史列表标「这条会话一共烧了多少」。
 *
 * 口径：中日韩的字和全角标点按 1 个算，其余按 4 个字符 1 个。为什么能这么粗：
 * 要回答的是「这条是不是该开新的了」，一位有效数字就够。
 *
 * ★ 数的是**真发出去的那些**：每一轮请求的整包 `messages`（含系统提示 —— `/index.md`
 *   + `/AGENTS.md` 就在 `messages[0]` 里）+ 这一轮产出的字和工具参数 + 每轮都随包走的工具说明。
 *   转几轮就重发几遍，所以同一个上下文会被重复计入 —— 那正是它在账单上的样子。
 */
import type { AiMessage, ToolSpec } from '../../src/kernel/contract'
import type { Session } from './state'

export function estimateTokens(text: string): number {
  let cjk = 0
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e80) cjk++
  }
  return cjk + Math.ceil((text.length - cjk) / 4)
}

/** 一轮请求的输入：整包消息（含系统提示）+ 工具说明（每轮都发）。 */
export function requestTokens(messages: readonly AiMessage[], tools: readonly ToolSpec[]): number {
  let sum = 0
  for (const m of messages) {
    sum += estimateTokens(m.content)
    if (m.toolCalls?.length) sum += estimateTokens(JSON.stringify(m.toolCalls))
  }
  if (tools.length) {
    // `run` 是函数，过不了线（`chat.ts` 的 `wire` 会剥掉）—— 计数也照剥掉的那份数。
    sum += estimateTokens(
      JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))),
    )
  }
  return sum
}

/** 这条会话累计烧掉的估数。没问过就是 0。 */
export function sessionTokens(session: Session): number {
  return session.spent
}

/** `12.3k` / `860`。四位数以上就别摆全了，列表那一列放不下。 */
export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
