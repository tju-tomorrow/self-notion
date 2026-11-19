/**
 * 跨窗口 / 跨标签页事件。桌面走 Tauri 事件（多窗口共享一个 Rust 进程），
 * 网页走 BroadcastChannel（同一浏览器里的多个标签页）。
 *
 * ★ 只是**通道**，不是业务事件总线。进程内的事件仍然走 `ctx.emit`。
 */
import { isWeb } from './env'

type Un = () => void

const local = typeof EventTarget === 'undefined' ? null : new EventTarget()
let channel: BroadcastChannel | null = null
if (isWeb && typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel('self-notion')
  } catch {
    // 隐私模式 / 老浏览器：同一标签页内的事件仍然能用（local EventTarget）。
    channel = null
  }
}

if (channel) {
  channel.onmessage = (e: MessageEvent<{ name: string; payload: unknown }>) => {
    local?.dispatchEvent(new CustomEvent(e.data.name, { detail: e.data.payload }))
  }
}

export async function appListen(name: string, cb: (payload: unknown) => void): Promise<Un> {
  if (!isWeb) {
    const { listen } = await import('@tauri-apps/api/event')
    return listen(name, (e) => cb(e.payload))
  }
  const handler = (e: Event) => cb((e as CustomEvent).detail)
  local?.addEventListener(name, handler)
  return () => local?.removeEventListener(name, handler)
}

export async function appEmit(name: string, payload?: unknown): Promise<void> {
  if (!isWeb) {
    const { emit } = await import('@tauri-apps/api/event')
    await emit(name, payload)
    return
  }
  local?.dispatchEvent(new CustomEvent(name, { detail: payload }))
  channel?.postMessage({ name, payload })
}
