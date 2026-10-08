/**
 * localStorage 的 JSON 读写。外壳与列表的视图状态（侧栏宽度 / 折叠 / 展开 / 首页视图）用它。
 * 不用 `ctx.settings`：那个的预热是异步的，装载时读一次必然拿到 undefined。
 */

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式 / 配额满了：落不了盘不是功能问题，静默
  }
}
