/**
 * 外部文件那一页的状态：挂载的根 + 真实目录树（**按需展开**，跟 `vfs/page.tsx` 一个手感）。
 *
 * 状态放模块级而不是组件里：`index.ts` 那条 `FILE_OPENED` 的路要读**同一份**根列表 ——
 * 「这个文件在不在已挂载的根之下」只该有一处答案。这一页卸载了状态也还在（回来不用重列）。
 *
 * 数据只走 `file:*`（`docs/external-md.md` §5.2 冻结的那张表），这一层是薄封装。
 */
import type { FileEntry, RpcService } from '../../src/kernel/contract'

export interface Tree {
  /** 挂载的根（`file:roots`）。`null` = 还没取过。 */
  roots: FileEntry[] | null
  /** 列过的目录 → 它的直接子项。没列过的就是没展开过。 */
  dirs: Readonly<Record<string, FileEntry[]>>
  /** 展开着的目录。 */
  open: ReadonlySet<string>
}

let tree: Tree = { roots: null, dirs: {}, open: new Set() }

const subs = new Set<() => void>()

function publish(next: Tree): void {
  tree = next
  for (const cb of subs) cb()
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb)
  return () => void subs.delete(cb)
}

export function snapshot(): Tree {
  return tree
}

/** 路径最后一段 —— 显示名。 */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** 文件所在目录。根下面那个 `/x.md` 回 `/`。 */
export function dirOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut <= 0 ? '/' : path.slice(0, cut)
}

/** ★ 前缀比对待上分隔符 —— 否则 `/notes2/a.md` 会被认成挂载根 `/notes` 的子项。 */
export function under(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/** 当前挂载的根里有没有一个罩得住它。 */
export function underRoot(path: string): boolean {
  return (tree.roots ?? []).some((root) => under(path, root.path))
}

export async function loadRoots(rpc: RpcService, force = false): Promise<FileEntry[]> {
  if (tree.roots !== null && !force) return tree.roots
  const roots = await rpc.call<FileEntry[]>('file:roots')
  publish({ ...tree, roots })
  return roots
}

export async function listDir(rpc: RpcService, path: string): Promise<FileEntry[]> {
  const entries = await rpc.call<FileEntry[]>('file:list', { path })
  publish({ ...tree, dirs: { ...tree.dirs, [path]: entries } })
  return entries
}

export function setOpen(next: ReadonlySet<string>): void {
  publish({ ...tree, open: next })
}

export async function addRoot(rpc: RpcService, path: string): Promise<FileEntry> {
  const root = await rpc.call<FileEntry>('file:addRoot', { path })
  await loadRoots(rpc, true)
  return root
}

export async function removeRoot(rpc: RpcService, path: string): Promise<void> {
  await rpc.call('file:removeRoot', { path })
  const dirs: Record<string, FileEntry[]> = {}
  for (const [dir, entries] of Object.entries(tree.dirs)) if (!under(dir, path)) dirs[dir] = entries
  publish({
    roots: (tree.roots ?? []).filter((root) => root.path !== path),
    dirs,
    open: new Set([...tree.open].filter((dir) => !under(dir, path))),
  })
}

/** 把**已经列过的**那些目录重新列一遍 —— 别处（别的编辑器 / git）改过盘之后，缓存就过期了。 */
export async function refresh(rpc: RpcService): Promise<void> {
  const roots = await loadRoots(rpc, true)
  const paths = [...new Set([...roots.map((root) => root.path), ...Object.keys(tree.dirs)])]
  const listed = await Promise.all(
    paths.map(async (path) => [path, await rpc.call<FileEntry[]>('file:list', { path })] as const),
  )
  const dirs: Record<string, FileEntry[]> = {}
  for (const [path, entries] of listed) dirs[path] = entries
  publish({ ...tree, dirs })
}

export async function createMd(rpc: RpcService, dir: string, name: string): Promise<FileEntry> {
  const entry = await rpc.call<FileEntry>('file:create', { dir, name })
  await listDir(rpc, dir)
  return entry
}
