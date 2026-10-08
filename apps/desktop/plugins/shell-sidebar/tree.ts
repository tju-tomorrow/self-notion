/**
 * `doc:list` 的投影 —— 一棵树 + 三个分组。**纯函数**：不碰 ctx、不碰 React。
 *
 * 拆出来的理由只有一个：纯函数好打印着看，组件那边只剩「怎么画」。
 */

import type { DocMeta } from '../../src/kernel/contract'

/**
 * `doc:list` 的返回形状 —— **类型源是 `contract.ts` 的 `DocMeta`**（D-0049 那条升级路径已经走完了：
 * 它早就在契约里）。这里只转出去一手，让 `DocNode` 和下游还从同一处拿。
 *
 * ★ 原来这儿手抄了一份（注释里自己写了「这正是 CONVENTIONS §10 禁的」）。加 `tags` 时两边对不上，
 * 编译器把这份重复照出来了 —— 所以删掉抄本，不再各写一份。
 */
export type { DocMeta }

export interface DocNode extends DocMeta {
  children: DocNode[]
}

/** 平铺的 `DocMeta[]` → 父子树。Rust 已按 `sort_order, created_at` 排好，这里**只搭结构、不重排**（Map 保插入序）。 */
export function buildTree(docs: readonly DocMeta[]): DocNode[] {
  const nodes = new Map<string, DocNode>()
  for (const doc of docs) nodes.set(doc.id, { ...doc, children: [] })

  const roots: DocNode[] = []
  for (const node of nodes.values()) {
    // 父不在**这一份**集合里（父进了回收站 / 被硬删 / 是别的窗口删的）时当成根留着。
    // 不这么做的话整棵子树会凭空消失，而它明明还在库里 —— 宁可挂错一层，不可丢。
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** 「最近」显示几条。 */
export const RECENT_LIMIT = 10

/**
 * 最近：按「上次打开」排。
 * 从没打开过的退回 `updatedAt` —— 否则新建出来还没点过的文档永远垫在最后，看着像丢了。
 */
export function recent(docs: readonly DocMeta[], limit: number = RECENT_LIMIT): DocMeta[] {
  return docs
    .filter((doc) => doc.deletedAt === null)
    .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt))
    .slice(0, limit)
}

export function favorites(docs: readonly DocMeta[]): DocMeta[] {
  return docs.filter((doc) => doc.isFavorite && doc.deletedAt === null)
}

/** 置顶：后置顶的在前 —— `pinnedAt` 记的是置顶那一刻，它自己就是排序键。 */
export function pinned(docs: readonly DocMeta[]): DocMeta[] {
  return docs
    .filter((doc) => doc.pinnedAt !== null && doc.deletedAt === null)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
}

export function trashed(docs: readonly DocMeta[]): DocMeta[] {
  return docs.filter((doc) => doc.deletedAt !== null)
}
