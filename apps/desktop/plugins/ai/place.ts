/**
 * 「用户此刻在看哪一篇、在哪一层」—— 拼进系统提示里给模型（用户：「预填充当前用户在看的
 * 文件的地址 告诉他用户在这个目录」）。
 *
 * ★ 这条路径的算法**原本在 Rust 那边**（`src-tauri/src/vfs/mod.rs` 的 `stem` / `file_name` /
 *   `dedup`），这里是**一份镜像**。为什么不问 Rust 要：`vfs:*` 那几个命令只回**路径**、
 *   不带文档 id（列表里没有 id 这一列），拿 id 反查只能自己算。
 *   镜像要守的三条 —— 改 Rust 那边就得改这儿：
 *     1. 名字 = 标题里 `/` `\` 换成 `-`、去掉控制字符、掐掉首尾空白与点，空标题叫 `untitled`；
 *     2. 文件加 `.md`；**有子文档的那一篇同时还是一个目录**（`/tree/金融.md` 和 `/tree/金融/` 都在）；
 *     3. 同一个父亲下重名 → **每一个**都带 `~<id 前 6 位>`（不是只给后来的，见 D-0101）。
 * ★ 它的用途是**给模型的一句上下文**，不是判据：对不上它自己 `vfs_list` 一下就纠正了。
 *   所以这里宁可少说（拼不出来就只说标题），不要猜一条错的路径。
 */
import type { Context } from 'cordis'

import type { DocMeta } from '../../src/kernel/contract'

/** 标题 → 路径段（`stem` 的镜像）。 */
function stem(title: string): string {
  let out = ''
  for (const ch of title) {
    if (ch === '/' || ch === '\\') out += '-'
    else if (ch.codePointAt(0)! >= 0x20) out += ch
  }
  const trimmed = out.trim().replace(/^\.+|\.+$/g, '')
  return trimmed === '' ? 'untitled' : trimmed
}

/** 这一篇在它父亲下的那一段名字（含重名后缀）。 */
function segment(doc: DocMeta, siblings: readonly DocMeta[]): string {
  const name = stem(doc.title)
  const clashes = siblings.filter((one) => stem(one.title) === name).length
  return clashes > 1 ? `${name}~${doc.id.slice(0, 6)}` : name
}

export interface Place {
  /** `/tree/金融/交易概念.md` */
  path: string
  /** `/tree/金融/`（顶层就是 `/tree/`） */
  dir: string
  title: string
}

/** 这一篇此刻在树里叫什么。查不到（回收站里、库里没有）就回 null。 */
export async function placeOf(ctx: Context, id: string): Promise<Place | null> {
  let all: DocMeta[]
  try {
    all = await ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: true })
  } catch {
    return null
  }
  const live = all.filter((doc) => doc.deletedAt === null)
  const byId = new Map(live.map((doc) => [doc.id, doc]))
  const siblingsOf = (parentId: string | null) =>
    live.filter((doc) => doc.parentId === parentId)

  const parts: string[] = []
  let cursor = byId.get(id)
  const title = cursor?.title ?? ''
  while (cursor) {
    parts.unshift(segment(cursor, siblingsOf(cursor.parentId)))
    cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId)
  }
  if (!parts.length) return null

  const dir = `/tree/${parts.slice(0, -1).join('/')}`.replace(/\/$/, '') + '/'
  return { path: `/tree/${parts.join('/')}.md`, dir: dir.replace('//', '/'), title }
}

/** 拼成系统提示里那一段。拿不到就回空串 —— 少一段上下文好过整轮起不来。 */
export async function whereNow(ctx: Context, id: string | null): Promise<string> {
  if (!id) return ''
  const place = await placeOf(ctx, id)
  if (!place) return ''
  return [
    '## 用户此刻在看',
    `${place.path}（它在 ${place.dir} 这一层）`,
    '先按这一篇理解他说的「这个 / 这篇 / 这里」，要改也优先改它；它跟问题无关时再按需要翻别处。',
  ].join('\n')
}
