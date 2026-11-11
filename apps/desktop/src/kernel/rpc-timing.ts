/** 前端看到的 RPC 往返耗时（含 IPC / 参数序列化）。只存慢的几十条，快路径不分配。 */
export interface SlowCall {
  method: string
  ms: number
}

let slow: SlowCall[] = []

export function noteSlow(method: string, ms: number): void {
  if (ms < 100) return
  slow.push({ method, ms })
  if (slow.length > 20) slow = slow.slice(slow.length - 20)
}

export function takeSlow(): SlowCall[] {
  const out = slow
  slow = []
  return out
}
