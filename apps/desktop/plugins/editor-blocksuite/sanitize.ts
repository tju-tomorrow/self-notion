/**
 * 正文里**不许出现的字符**：C0 控制符（`\n` / `\t` 除外）与 C1 控制符。
 *
 * 为什么在模型这层堵：这些字符**不是我们任何代码写的** —— 仓库和全部依赖的 src/dist
 * 都扫过（原始字节、转义串、`fromCharCode` 三种写法），一处都没有。它们是**从 DOM 那侧
 * 进来的**：现场包（D-0127）里，每按一次 `→` 正文就多一个 `U+001D`，DOM 和模型同时有。
 * 渲染出来就是**一排缺字方框**。
 *
 * 所以这里不猜来源（输入法？WebKit？），只守住**结果**：谁往这段文本里写了这种字符，
 * 当场按位置删掉。删了会触发重渲染，DOM 跟着干净。
 *
 * ★ 按**位置**删，不是整段重写：整段 `delete + insert` 会把行内格式（粗体 / 链接 / 颜色）
 *   一起抹掉；从后往前删保证索引不漂。
 */
import type { Store, Text } from '@blocksuite/affine/store'
import type * as Y from 'yjs'
import { withoutHistory } from './history'

/** 控制符（`\n`=0a / `\t`=09 留着，它们在正文里是正常排版）。 */
function bad(code: number): boolean {
  return (code < 0x20 && code !== 0x0a && code !== 0x09) || (code >= 0x7f && code <= 0x9f)
}

/** 把这段文本里所有控制符按位置删掉。没有就什么都不做。 */
function clean(store: Store, ytext: Y.Text): void {
  const s = ytext.toString()
  const at: number[] = []
  for (let i = 0; i < s.length; i += 1) {
    if (bad(s.charCodeAt(i))) at.push(i)
  }
  if (at.length === 0) return
  // 放到微任务里改：observer 回调里就地改同一段文本是重入，Yjs 会闹。
  queueMicrotask(() => {
    try {
      // 不进撤销栈：⌘Z 该撤销用户自己敲的字，不是这个。
      withoutHistory(store, () => {
        for (let k = at.length - 1; k >= 0; k -= 1) {
          const index = at[k]
          if (index === undefined || index >= ytext.length) continue
          ytext.delete(index, 1)
        }
      })
    } catch {
      // 删不动就算了 —— 这种事不该把编辑器的正常路径带崩（下一轮还会再试）。
    }
  })
}

/** 盯着这一篇里每一段文本。挂一次就够 —— 新块由 `blockUpdated` 补挂。 */
export function watchControlChars(store: Store): () => void {
  const watched = new Map<Y.Text, () => void>()

  const attach = (text: Text | undefined): void => {
    const ytext = text?.yText
    if (!ytext || watched.has(ytext)) return
    const onChange = (): void => clean(store, ytext)
    watched.set(ytext, onChange)
    clean(store, ytext)
    ytext.observe(onChange)
  }

  /** 只用到这两样：能往下走、可能带一段文本。 */
  interface Textual {
    readonly children: readonly unknown[]
    readonly text?: Text
  }
  const walk = (model: Textual): void => {
    attach(model.text)
    for (const child of model.children) walk(child as Textual)
  }
  for (const model of store.root?.children ?? []) walk(model as Textual)

  const off = store.slots.blockUpdated.subscribe((payload) => {
    if (payload.type === 'add') attach(store.getBlock(payload.id)?.model.text)
  })

  return () => {
    off.unsubscribe()
    for (const [ytext, onChange] of watched) ytext.unobserve(onChange)
    watched.clear()
  }
}
