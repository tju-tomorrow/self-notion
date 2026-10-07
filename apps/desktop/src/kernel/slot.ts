/**
 * `ctx.slot` 的实现 —— 内核侧只管「谁往哪个槽塞了什么」。
 *
 * 这里**只有服务，没有宿主**。宿主在 `src/shell/slot-host.tsx`（S6）：
 * 内核不该 import React，也不该知道一个槽长什么样。S2 最早在这里塞过一个
 * 最小 `SlotHost` 只为了证明「装载 → 侧栏出现一项」，S6 的真宿主落地后删掉了 ——
 * 它从来是脚手架，不是谁的私有财产。
 *
 * 所以这个文件现在是 `.ts` 而不是 `.tsx`：一行 JSX 都没有了。
 */
import type { SlotName, SlotService } from './contract'

const EMPTY: readonly unknown[] = []

export function createSlot(): SlotService {
  const items = new Map<SlotName, readonly unknown[]>()
  const subs = new Map<SlotName, Set<() => void>>()

  const change = (name: SlotName) => {
    subs.get(name)?.forEach((cb) => cb())
  }

  return {
    // 逆函数是显式纪律（D-0033）：register 返回的就是它的 unregister，且幂等。
    register(name, component) {
      items.set(name, [...(items.get(name) ?? EMPTY), component])
      change(name)
      return () => {
        const list = items.get(name) ?? EMPTY
        const at = list.indexOf(component)
        if (at < 0) return
        items.set(name, [...list.slice(0, at), ...list.slice(at + 1)])
        change(name)
      }
    },
    // 下面两个以前是内核私有的扩展接口，现在在冻结契约里（宿主和实现在不同目录）。
    list: (name) => items.get(name) ?? EMPTY,
    subscribe: (name, cb) => {
      let set = subs.get(name)
      if (!set) subs.set(name, (set = new Set()))
      set.add(cb)
      return () => void set.delete(cb)
    },
  }
}
