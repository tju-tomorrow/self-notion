/**
 * 画布改动的落库闸（D-0221）。
 *
 * 编辑器重读一篇之前必须先 `flushCanvas`：画布的保存有 600ms 防抖，切标签那一瞬间
 * 库里可能还是旧 xml。编辑器照旧内容挂起来，之后整篇写回就把画布的最后一次改动盖掉了。
 * 这里只记「谁还攒着改动」和「怎么立刻落完」，不碰 maxgraph。
 */

type Flush = () => Promise<void>

const flushes = new Map<string, Set<Flush>>()

export function registerCanvasFlush(docId: string, flush: Flush): () => void {
  let set = flushes.get(docId)
  if (!set) {
    set = new Set()
    flushes.set(docId, set)
  }
  set.add(flush)
  return () => {
    const current = flushes.get(docId)
    if (!current) return
    current.delete(flush)
    if (current.size === 0) flushes.delete(docId)
  }
}

/** 关窗口前用：所有还开着的画布都把改动落完（画布不跟着 React 卸载，没人替它落）。 */
export async function flushAllCanvases(): Promise<void> {
  for (const docId of Array.from(flushes.keys())) await flushCanvas(docId)
}

/** 这篇的画布还有没有没落库的改动；有就等它落完（失败由保存自己 reportError）。 */
export async function flushCanvas(docId: string): Promise<void> {
  const set = flushes.get(docId)
  if (!set) return
  // 边等边删是安全的：Set 迭代器跳过已经摘掉的项。
  for (const flush of set) {
    try {
      await flush()
    } catch {
      // 保存那条路已经把错误写进 errors.log 了，这里只负责别把切页卡死。
    }
  }
}
