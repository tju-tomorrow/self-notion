/** 块 id（写进持久化 JSON，架构 §3.1）。PM 自带拆块复制旧 id —— 每个新建块都得走这里。 */
export function newBlockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
