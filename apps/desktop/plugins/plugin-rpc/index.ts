/**
 * `ctx.rpc` —— 桥到 Tauri / Rust 的**唯一**通道。
 *
 * 契约（`contract.ts`）上只有一个方法：`call(method, args)`。Rust 侧是**一个通用入口**
 * `invoke('api', { req: { method, args } })`（D-0049：拓扑上 method 是 args 里的字符串，
 * 拿不到跨线编译期检查，换来的是「加方法 = 加一个 match 分支」）。
 *
 * 这里只做两件事：**转发** + **把 `ApiError` 还原成 Error**。
 * 不做重试 / 超时 / 缓存 / 拦截器 —— 要加时也要先有一个非加不可的消费者。
 */
import { invoke } from '@tauri-apps/api/core'
import type { Context } from 'cordis'
import { DOCS_CHANGED, type RpcService } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { noteSlow } from '../../src/kernel/rpc-timing'
import { isWeb } from '../../src/platform/env'
import { createWebRpc } from '../../src/platform/web/rpc'

export const name = 'plugin-rpc'

/** Rust 的 `ApiError`（`commands/mod.rs`）序列化之后的形状。 */
export interface ApiError extends Error {
  code: string
}

/**
 * `invoke` reject 出来的是 serde 序列化后的 `ApiError` **普通对象** `{ code, message }`，
 * 不是 Error。就这么往外抛，调用方 `catch (e)` 拿到的东西 `e instanceof Error === false`、
 * `e.message === undefined`，`code` 也没个类型 —— 只能靠猜。
 *
 * 所以在这里还原：包成真 Error，`code` 原样挂回去（`error.code === 'not_found'`）。
 *
 * ponytail: 只认 `{ code, message }` 这一种非 Error 形状；别的形状（Tauri 换了包装、
 * 或我们自己代码抛的普通 Error）原样放行 —— 不吞、不猜，报错信息里还看得见。
 */
function restore(err: unknown): unknown {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const { code, message } = err as { code: unknown; message?: unknown }
    return Object.assign(new Error(typeof message === 'string' ? message : String(code)), { code })
  }
  return err
}

/**
 * 会联网 / 拉模型的方法，几秒级。它们必须走 `api_bg`（Rust 侧扔阻塞池）——
 * 同步的 `api` 在主线程上跑，GitHub 备份那 5–8 秒会把窗口帧一起冻住。
 */
const SLOW = /^(?:backup:|kb:|voice:download$|ai:(?:models|summarize|chat)$|agent:pending$|doc:marks$)/

export function apply(ctx: Context) {
  const rpc: RpcService = {
    async call<T = unknown>(method: `${string}:${string}`, args?: unknown): Promise<T> {
      const at = performance.now()
      try {
        const command = SLOW.test(method) ? 'api_bg' : 'api'
        return (await invoke(command, { req: { method, args } })) as T
      } catch (err) {
        throw restore(err)
      } finally {
        // 监控自己的调用不记 —— 否则日志里全是自己的噪音。
        if (!method.startsWith('perf:') && method !== 'log:error') {
          noteSlow(method, performance.now() - at)
        }
      }
    },
  }

  // 网页端（D-0197）：同一个 `RpcService` 形状，底下换成 IndexedDB + 同步引擎。
  const web: RpcService | null = isWeb
    ? createWebRpc({ onChange: () => ctx.emit(DOCS_CHANGED) })
    : null

  // `provide` 自己就登记在 fiber 的 effect 账本上（cordis `reflect.provide`），
  // 卸载即撤销 —— 所以逆函数不用手写，这就是它（D-0033）。
  ctx.effect(() => ctx.provide('rpc', web ?? rpc))

  if (web) {
    void import('../../src/platform/web/sync')
      .then((m) => m.startSync(ctx))
      .catch((err: unknown) => reportError('sync', err))
  }
}
