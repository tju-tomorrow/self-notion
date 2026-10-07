/**
 * 真正的槽位宿主 —— 取代 S2 留在 `kernel/` 里那个最小版（THROWAWAY，Stage 3 由 owner 删）。
 *
 * ★ 只走契约（`ctx.slot.list` / `ctx.slot.subscribe`）拿数据，**不 import 内核内部**。
 *   这正是 D-0048 把读接口补进契约的原因：宿主和实现在不同目录里。
 */
import type { Context } from 'cordis'
import { Component, type ComponentType, type ReactNode, useSyncExternalStore } from 'react'
import type { SlotName } from '../kernel/contract'
import { reportError } from '../kernel/errors'

/**
 * 每个槽项包一层 ErrorBoundary：插件抛错只降级**这一个**槽，不带走整个界面（D-0039）。
 *
 * ponytail: 只降级 + console.error，没有通知。契约里 `'toast'` 槽有名字但没有 `ctx.toast`
 * 服务（D-0048 明说等 Stage 2 有会抛错的真插件再加）。升级路径：往契约加 `ctx.toast`，
 * 在 componentDidCatch 里发一条。
 */
export class SlotBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  // 降级要留痕：静默吞掉插件异常正是 D-0045 要防的那类"看着没事其实死了"。
  componentDidCatch(error: unknown) {
    reportError('槽位', error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * 把槽位里的东西包成元素。**一项一个边界** —— 这就是"只降级那一个"的全部机关，
 * 所以单独拎出来，跟订阅那一坨分开。
 */
export function slotItems(list: readonly unknown[], fallback?: ReactNode): ReactNode {
  if (!list.length) return fallback ?? null
  return list.map((raw, i) => {
    // 契约里 component 是 unknown（内核不认识 React）。到宿主这一步才收窄。
    const Plugin = raw as ComponentType
    return (
      <SlotBoundary key={i}>
        <Plugin />
      </SlotBoundary>
    )
  })
}

/** 渲染一个槽位。订阅槽位变化，插件的装载 / 卸载即时反映到界面上（热装载，扩展架构 §7）。 */
export function SlotHost({
  ctx,
  name,
  fallback,
}: {
  ctx: Context
  name: SlotName
  /** 槽里一个东西都没有时显示什么（空的主区不能是一片白） */
  fallback?: ReactNode
}) {
  const list = useSyncExternalStore(
    (cb) => ctx.slot.subscribe(name, cb),
    () => ctx.slot.list(name),
    () => ctx.slot.list(name), // 没有第三个参数 renderToString 直接抛
  )
  return slotItems(list, fallback)
}
