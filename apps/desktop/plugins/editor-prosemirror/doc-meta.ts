/**
 * 给 NodeView 用的、**关于别的文档**的两件事：它的元数据（标题 / 图标）、以及打开它。
 *
 * ★ 为什么是独立一个模块：NodeView（`nodes/*.ts`）要读它，而 `index.ts` 要写它 ——
 *   放任何一边都会绕成循环 import（`editor.ts` → `nodes/` → `editor.ts`）。
 *   这一层没有任何依赖，谁都能 import。
 *
 * ★ 数据源只有一个：`doc:list`（Rust 是文档树的真相）。刷新时机由 `index.ts` 定
 *   —— 装载时一次 + 每次 `DOCS_CHANGED`。
 */
import type { DocMeta } from '../../src/kernel/contract'

let byId = new Map<string, DocMeta>()

const subs = new Set<() => void>()

export function setDocs(list: readonly DocMeta[]): void {
  byId = new Map(list.map((m) => [m.id, m]))
  for (const cb of subs) cb()
}

/** 全库元数据换了（新建 / 改名 / 改图标）。页面头靠它跟着改。 */
export function subscribe(cb: () => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}

/** 拿一篇别的文档的元数据。不在库里（删了 / 还没落库）→ undefined，调用方自己兜底。 */
export function metaOf(id: string): DocMeta | undefined {
  return byId.get(id)
}

/** 全库文档的元数据快照（只读）。`@` 提及的候选列表要用 —— 按库里给的顺序。 */
export function allDocs(): readonly DocMeta[] {
  return [...byId.values()]
}

let loadDocFn: ((id: string) => Promise<string | null>) | undefined

export function setLoadDoc(fn: (id: string) => Promise<string | null>): void {
  loadDocFn = fn
}

/** 读一篇文档的正文 JSON（模板按钮要把它的块拷一份进来）。读不到 → null，调用方兜底。 */
export async function contentOf(id: string): Promise<string | null> {
  if (!loadDocFn) return null
  return loadDocFn(id)
}

let openDocFn: ((id: string) => void) | undefined

export function setOpenDoc(fn: (id: string) => void): void {
  openDocFn = fn
}

/** 打开一篇文档（子页面卡片、@提及、面包屑点一条都走这儿）。 */
export function openDoc(id: string): void {
  openDocFn?.(id)
}

let createDocFn: ((title: string, parentId: string | null) => Promise<string>) | undefined

export function setCreateDoc(fn: (title: string, parentId: string | null) => Promise<string>): void {
  createDocFn = fn
}

/** 新建一篇文档，回它的 id（斜杠菜单的「子页面」要用）。`parentId` 给了就挂在那篇底下。 */
export async function createDoc(title: string, parentId: string | null = null): Promise<string> {
  if (!createDocFn) throw new Error('新建文档的口子没接上 —— 要先 await ctx.editor.ready()')
  return createDocFn(title, parentId)
}
