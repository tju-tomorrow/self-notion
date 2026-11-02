/**
 * 导出包里的路径 → 标题 / 父子关系。
 *
 * 子页文件夹叫 `父标题/`，父页文件叫 `父标题 <32位id>.html` —— 文件夹名不带 id，
 * 所以不能按「文件夹名 + .html」找父页；两种形状都认，同层重名的分不出就退回上一层。
 */

const ID_SUFFIX = / [0-9a-f]{32}$/i

export function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

export function baseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

/** 页面文件名就是标题。Notion 会在后面挂 32 位十六进制消歧义，界面上不该看见它。 */
export function titleOf(path: string): string {
  const name = baseOf(path).replace(/\.html$/i, '').replace(ID_SUFFIX, '')
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** 把 `a/../b.png`、`./b.png` 这种收敛成 zip 里那条路径。 */
export function normalize(path: string): string {
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/** `同层目录 \0 标题` → 那一篇；同层重名记成 null（分不出谁是谁，不猜）。 */
export type ParentIndex = Map<string, string | null>

export function parentIndex(paths: Iterable<string>): ParentIndex {
  const index: ParentIndex = new Map()
  for (const path of paths) {
    const key = dirKey(dirOf(path), titleOf(path))
    index.set(key, index.has(key) ? null : path)
  }
  return index
}

function dirKey(dir: string, name: string): string {
  return `${dir}\0${name}`
}

/** 父子靠形状推：`A/B.html` 的父是 `A.html`，`A/` 文件夹的父是 `A <id>.html`。父页被删过的往上找一级。 */
export function parentOf(path: string, known: Set<string>, index: ParentIndex): string | null {
  let dir = dirOf(path)
  while (dir) {
    const exact = `${dir}.html`
    if (known.has(exact)) return exact
    const key = dirKey(dirOf(dir), baseOf(dir))
    if (index.has(key)) {
      const hit = index.get(key)
      return hit && hit !== path ? hit : null
    }
    dir = dirOf(dir)
  }
  return null
}
