/**
 * 撤销那一摊的两个小工具。单独一个文件是为了两边都能用：`editor.ts` 与 `inline-comment.ts`
 * 互相 import 就是环。
 */
import type { Store } from '@blocksuite/affine/store'

/** 上游 `withoutTransact` 里那个私有开关（`_shouldTransact`）。**只读，诊断用**。 */
export function shouldTransact(store: Store): boolean | undefined {
  return (store as unknown as { _shouldTransact?: boolean })._shouldTransact
}

/**
 * `store.withoutTransact` 的护壳。
 *
 * 上游那份**没有 try/finally**：`fn` 一抛，`_shouldTransact` 就永久留在 `false`，
 * 之后每次事务的 origin 都是 `null` —— UndoManager 认 origin 记录，于是一个都不记，
 * `canUndo` 永远是 false（表现就是「⌘Z 按了没反应」，而且再也恢复不了）。
 * 抛了就用一次空调把开关复位，再把异常原样抛出去。
 */
export function withoutHistory(store: Store, fn: () => void): void {
  try {
    store.withoutTransact(fn)
  } catch (err) {
    store.withoutTransact(() => {})
    throw err
  }
}
