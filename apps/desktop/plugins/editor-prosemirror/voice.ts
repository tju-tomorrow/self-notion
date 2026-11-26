/**
 * 语音笔记的 rpc 口子（D-0215）—— 跟 `blob.ts` 一个形状：编辑器不认识 ctx，由 `index.ts` 装载时接上。
 */
export interface VoiceStatus {
  ready: boolean
  downloading: boolean
  received: number
  total: number
  error: string
}

export interface VoiceApi {
  start(): Promise<void>
  stop(): Promise<{ id: string; duration: number }>
  cancel(): Promise<void>
  transcribe(id: string): Promise<string>
  status(): Promise<VoiceStatus>
  download(): Promise<void>
}

let api: VoiceApi | undefined

/** 斜杠菜单插进来的语音块要**直接开始录**：记下块 id，NodeView 挂载时自己认领。 */
const autoRecord = new Set<string>()

export function markAutoRecord(blockId: string): void {
  if (blockId) autoRecord.add(blockId)
}

export function takeAutoRecord(blockId: string): boolean {
  if (!blockId || !autoRecord.has(blockId)) return false
  autoRecord.delete(blockId)
  return true
}

export function setVoiceApi(next: VoiceApi): void {
  api = next
}

/** 还没接上（网页版 / 装载途中）→ undefined，调用方自己降级。 */
export function getVoiceApi(): VoiceApi | undefined {
  return api
}
