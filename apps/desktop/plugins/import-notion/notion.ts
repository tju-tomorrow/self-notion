/**
 * Notion 导出的 zip → 我们库里的文档。
 *
 * ★ 换基座后（D-0128）这里**没有 BlockSuite 了**：一篇 HTML 先翻成 **markdown**，再交给
 *   编辑器 `ctx.editor.docFromMarkdown` 变成 PM doc JSON，最后 `doc:apply` 落库。这一层做四件事：
 *
 *   1. 解压（fflate）
 *   2. 按 zip 里的文件夹层级算出父子（`Parent abc.html` + 文件夹 `Parent abc/` 就是 Notion 的嵌套形状）
 *   3. 图片进 `blob:put`，markdown 里写 `self-notion://blob/<id>`
 *   4. HTML → markdown（`parseNotionPage`，自己走 DOM —— 不给第三方 html→md 库）
 *
 * ★ 认不出的块（数据库 / 书签 / 附件 / 嵌入）**文字照常进来，块本身降级**：书签 / 嵌入降成
 *   一行链接，其余认不出的容器往里递归掏文字 —— 跟老 Adapter 那套 `stripUnknown` 一个意思。
 *
 * ponytail: 整包在内存里解（`unzipSync` + 全部条目 map）。几百 MB 的导出会吃内存，
 *   到那天再换流式解压，接口不用动。
 */
import { unzipSync } from 'fflate'

import type { DocMeta, EditorService, RpcService } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'

const IMAGE_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic', 'bmp', 'tif', 'tiff', 'ico',
])

const MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
}

/** `String.fromCharCode(...bytes)` 一次喂太多会爆栈，按块切。 */
const CHUNK = 0x8000
function b64(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    raw += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(raw)
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

const junk = (path: string) =>
  path.startsWith('__MACOSX/') || path.includes('DS_Store') || path.endsWith('/')

/**
 * 摊平成「路径 → 字节」。**内层 zip 也要展开** —— 导出太大时 Notion 会切块，
 * 切出来的 `Part 2.zip` 里还是完整的页面树。
 */
function flatten(zip: Uint8Array, into: Map<string, Uint8Array>, depth = 0): void {
  for (const [path, bytes] of Object.entries(unzipSync(zip))) {
    if (junk(path)) continue
    if (depth < 3 && path.toLowerCase().endsWith('.zip')) {
      try {
        flatten(bytes, into, depth + 1)
      } catch {
        // 内层不是 zip（用户自己塞的文件）→ 当普通文件留着，不值得整单导入失败
        into.set(path, bytes)
      }
      continue
    }
    into.set(path, bytes)
  }
}

/** 页面文件名就是标题。Notion 会在后面挂 32 位十六进制消歧义，界面上不该看见它。 */
function titleOf(path: string): string {
  const name = baseOf(path).replace(/\.html$/i, '').replace(/ [0-9a-f]{32}$/i, '')
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** 父子靠形状推：`A/B.html` 的父是 `A.html`。父页被删过的往上找一级。 */
function parentOf(path: string, known: Set<string>): string | null {
  let dir = dirOf(path)
  while (dir) {
    const candidate = `${dir}.html`
    if (known.has(candidate)) return candidate
    dir = dirOf(dir)
  }
  return null
}

/** 把 `a/../b.png`、`./b.png` 这种收敛成 zip 里那条路径。 */
function normalize(path: string): string {
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/* ─────────────────────────── HTML → markdown ─────────────────────────── */

export interface ParsedPage {
  /** 页面标题（`<h1 class="page-title">`），拿不到就是空串，调用方回退到文件名。 */
  title: string
  markdown: string
  /** 这篇里认出来的图片数（走 blob 那条路的）。 */
  images: number
}

/**
 * 一篇 Notion 页面 HTML → markdown。
 *
 * `resolve` 把图片的相对 `src` 翻成 `self-notion://blob/<id>`（翻不出来返回 null = 丢这一张）。
 * 返回的 markdown 喂 `ctx.editor.docFromMarkdown` —— 只吐标准 markdown，节点名与 attrs 归编辑器那侧管。
 */
export function parseNotionPage(
  html: string,
  pagePath: string,
  assetIds: Map<string, string>,
): ParsedPage {
  const dom = new DOMParser().parseFromString(html, 'text/html')
  const article = dom.querySelector('article') ?? dom.body
  const title =
    article.querySelector('header .page-title')?.textContent?.trim() ||
    article.querySelector('h1.page-title')?.textContent?.trim() ||
    ''

  const dir = dirOf(pagePath)
  const resolve = (src: string): string | null => {
    const joined = normalize(dir ? `${dir}/${src}` : src)
    let decoded = joined
    try {
      decoded = decodeURIComponent(joined)
    } catch {
      // 不是合法编码就按原样查
    }
    const id = assetIds.get(joined) ?? assetIds.get(decoded) ?? assetIds.get(src)
    return id ? `self-notion://blob/${id}` : null
  }

  const { walk } = makeConverter(resolve)
  const body = article.querySelector('.page-body') ?? article
  const out: string[] = []
  walk(body, out, 0)
  const markdown = out.join('\n\n')
  const images = (markdown.match(/!\[[^\]]*\]\(/g) ?? []).length
  return { title, markdown, images }
}

function makeConverter(resolve: (src: string) => string | null): {
  walk(parent: Element, out: string[], indent: number): void
} {
  /** 行内：text / strong / em / code / s / a / img / br。认不出的一律掏子节点。 */
  const inline = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? ''
    if (node.nodeType !== 1) return ''
    const el = node as Element
    const kids = () => Array.from(el.childNodes).map(inline).join('')
    const tag = el.tagName.toLowerCase()
    switch (tag) {
      case 'br':
        return '\n'
      case 'strong':
      case 'b': {
        const t = kids()
        return t ? `**${t}**` : ''
      }
      case 'em':
      case 'i': {
        const t = kids()
        return t ? `*${t}*` : ''
      }
      case 'code':
        return `\`${el.textContent ?? ''}\``
      case 's':
      case 'del':
      case 'strike': {
        const t = kids()
        return t ? `~~${t}~~` : ''
      }
      case 'a': {
        // 外部链接才写成 markdown 链接；页内链接的 href 是导出包里的相对路径，解析不了 → 只留文字
        const href = el.getAttribute('href') ?? ''
        const t = kids()
        return /^https?:\/\//i.test(href) && t ? `[${t}](${href})` : t
      }
      case 'img': {
        const src = el.getAttribute('src')
        const url = src ? resolve(src) : null
        if (!url) return ''
        const alt = (el.getAttribute('alt') ?? '').replace(/[[\]]/g, '')
        return `![${alt}](${url})`
      }
      case 'div':
        if (el.classList.contains('checkbox')) return ''
        return kids()
      default:
        return kids()
    }
  }

  const pushImage = (img: Element, out: string[], indent: number): void => {
    const src = img.getAttribute('src')
    const url = src ? resolve(src) : null
    if (!url) return
    const alt = (img.getAttribute('alt') ?? '').replace(/[[\]]/g, '')
    out.push('  '.repeat(indent) + `![${alt}](${url})`)
  }

  const isChecked = (box: Element): boolean => {
    const input = box as HTMLInputElement
    if (input.checked === true) return true
    if (box.hasAttribute('checked')) return true
    return box.classList.contains('checkbox-on')
  }

  /** 列表项的**自身文字**：跳过嵌套的 ul/ol 和那个 checkbox 方块。 */
  const liText = (li: Element): string => {
    let s = ''
    for (const node of Array.from(li.childNodes)) {
      if (node.nodeType === 3) {
        s += node.textContent ?? ''
        continue
      }
      if (node.nodeType !== 1) continue
      const el = node as Element
      const tag = el.tagName.toLowerCase()
      if (tag === 'ul' || tag === 'ol' || el.classList.contains('checkbox')) continue
      s += inline(el)
    }
    return s.trim()
  }

  const list = (el: Element, out: string[], indent: number, ordered: boolean): void => {
    const pad = '  '.repeat(indent)
    let n = 0
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== 'li') continue
      n++
      const box = li.querySelector('input[type="checkbox"], .checkbox')
      const marker = box
        ? `- [${isChecked(box) ? 'x' : ' '}]`
        : ordered
          ? `${n}.`
          : '-'
      const text = liText(li)
      out.push(text ? `${pad}${marker} ${text}` : `${pad}${marker}`)
      // 嵌套列表降一级
      for (const child of Array.from(li.children)) {
        const tag = child.tagName.toLowerCase()
        if (tag === 'ul' || tag === 'ol') list(child, out, indent + 1, tag === 'ol')
      }
    }
  }

  const table = (el: Element, out: string[], indent: number): void => {
    const rows = Array.from(el.querySelectorAll('tr')).map(tr =>
      Array.from(tr.children).map(td => inline(td).replace(/\s*\n\s*/g, ' ').trim()),
    )
    if (!rows.length) return
    const width = Math.max(...rows.map(r => r.length))
    for (const r of rows) while (r.length < width) r.push('')
    const pad = '  '.repeat(indent)
    const line = (cells: string[]) => `${pad}| ${cells.join(' | ')} |`
    out.push(line(rows[0]!))
    out.push(line(rows[0]!.map(() => '---')))
    for (let i = 1; i < rows.length; i++) out.push(line(rows[i]!))
  }

  const emit = (el: Element, out: string[], indent: number): void => {
    const tag = el.tagName.toLowerCase()
    const pad = '  '.repeat(indent)

    if (/^h[1-6]$/.test(tag)) {
      const text = inline(el).trim()
      if (text) out.push(`${'#'.repeat(Number(tag[1]))} ${text}`)
      return
    }

    switch (tag) {
      case 'p': {
        if (el.classList.contains('page-title') || el.classList.contains('page-description')) return
        const text = inline(el).trim()
        if (text) out.push(pad + text)
        return
      }
      case 'ul':
      case 'ol':
        list(el, out, indent, tag === 'ol')
        return
      case 'blockquote':
      case 'aside': {
        const text = inline(el).trim()
        if (text) out.push(pad + text.split('\n').map(l => `> ${l}`).join('\n'))
        return
      }
      case 'pre': {
        const code = el.querySelector('code') ?? el
        const cls = code.getAttribute('class') ?? el.getAttribute('class') ?? ''
        const lang = (/language-([\w+#-]+)/.exec(cls)?.[1] ?? '').trim()
        out.push(`${pad}\`\`\`${lang}\n${code.textContent ?? ''}\n${pad}\`\`\``)
        return
      }
      case 'hr':
        out.push(`${pad}---`)
        return
      case 'img':
        pushImage(el, out, indent)
        return
      case 'figure': {
        const cls = el.getAttribute('class') ?? ''
        const media = /(^|\s)(image|img)(\s|$)/.test(cls)
        const embed = /(embed|video|bookmark|file|audio)/.test(cls)
        const img = el.querySelector('img')
        if (img && (media || !embed)) {
          pushImage(img, out, indent)
          return
        }
        // 书签 / 嵌入 / 附件：降成一行（有链接就写成链接，文字不丢）
        const a = el.querySelector('a[href]')
        const href = a?.getAttribute('href') ?? ''
        const text = inline(el).replace(/\s*\n\s*/g, ' ').trim()
        if (/^https?:\/\//i.test(href) && text) out.push(`${pad}[${text}](${href})`)
        else if (text) out.push(pad + text)
        return
      }
      case 'table':
        table(el, out, indent)
        return
      case 'details': {
        const summary = el.querySelector('summary')
        const label = summary ? inline(summary).trim() : ''
        if (label) out.push(`${pad}- ${label}`)
        for (const child of Array.from(el.children)) {
          if (child === summary) continue
          emit(child, out, indent + 2)
        }
        return
      }
      default: {
        // 认不出的块（分栏 / 数据库 / 嵌入…）：能往下走就往下走，别把文字丢了
        if (el.children.length) {
          for (const child of Array.from(el.children)) emit(child, out, indent)
        } else {
          const text = inline(el).trim()
          if (text) out.push(pad + text)
        }
      }
    }
  }

  return {
    walk(parent: Element, out: string[], indent: number) {
      for (const child of Array.from(parent.children)) emit(child, out, indent)
    },
  }
}

/** 库里那篇的标题是 doc 的 attr（架构 §3.3）—— 落库前把它写进正文 JSON，编辑器才读得到。 */
function withTitle(content: string, title: string): string {
  try {
    const json = JSON.parse(content) as { attrs?: Record<string, unknown> }
    json.attrs = { ...json.attrs, title }
    return JSON.stringify(json)
  } catch {
    return content
  }
}

export interface Summary {
  pages: number
  images: number
  /** 认不出、故意没收的条目（markdown / csv / 附件 / 工作区首页） */
  skipped: number
  entryId: string | null
  /** 用户中途按了取消：已经导入的那些留在库里，剩下的不做。 */
  cancelled: boolean
}

export interface ImportDeps {
  rpc: RpcService
  /**
   * `ctx.editor` —— markdown → doc JSON 走契约那条 `docFromMarkdown`（要**先 `await ready()`**，
   * 编辑器本体是懒装载的）。schema 归编辑器那侧管，这里只吐标准 markdown。
   */
  editor: EditorService
  onProgress?(done: number, total: number): void
  /** 每篇之间问一句 —— 几百篇的库要能中途停手。 */
  shouldCancel?(): boolean
}

export async function importNotionZip(deps: ImportDeps, file: File): Promise<Summary> {
  const flat = new Map<string, Uint8Array>()
  flatten(new Uint8Array(await file.arrayBuffer()), flat)

  const pageFiles: [string, Uint8Array][] = []
  const assetIds = new Map<string, string>()
  let skipped = 0

  for (const [path, bytes] of flat) {
    const name = baseOf(path).toLowerCase()
    if (name.endsWith('.html')) {
      // `index.html` 是导出包的工作区首页（`Export-<uuid>/index.html`），里面只有骨架，不是一页
      if (name === 'index.html') skipped++
      else pageFiles.push([path, bytes])
      continue
    }
    if (IMAGE_EXT.has(extOf(path))) {
      const meta = await deps.rpc.call<{ id: string }>('blob:put', {
        bytes: b64(bytes),
        mime: MIME[extOf(path)] ?? 'application/octet-stream',
      })
      assetIds.set(path, meta.id)
      continue
    }
    skipped++
  }

  if (!pageFiles.length) throw new Error('这个包里没有 Notion 的 HTML 页面')

  // 父先子后：`doc:create` 要知道父级 id，父没建出来就只能落成顶层。
  const known = new Set(pageFiles.map(([path]) => path))
  const ordered = pageFiles
    .map(([path]) => path)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))

  const ids = new Map<string, string>()
  let entryId: string | null = null
  for (const path of ordered) {
    const parentPath = parentOf(path, known)
    const meta = await deps.rpc.call<DocMeta>('doc:create', {
      parentId: parentPath ? (ids.get(parentPath) ?? null) : null,
      title: titleOf(path),
    })
    ids.set(path, meta.id)
    if (!parentPath && !entryId) entryId = meta.id
  }

  const decoder = new TextDecoder()
  let images = 0
  let pages = 0
  let done = 0
  let cancelled = false

  for (const [path, bytes] of pageFiles) {
    if (deps.shouldCancel?.()) {
      cancelled = true
      break
    }
    const id = ids.get(path)
    if (id) {
      try {
        const parsed = parseNotionPage(decoder.decode(bytes), path, assetIds)
        const title = parsed.title || titleOf(path)
        images += parsed.images
        if (parsed.markdown.trim()) {
          // `origin: 'import'` 让 Rust 落库前先打版本点（D-0043）—— 别改成 'user'。
          const content = withTitle(deps.editor.docFromMarkdown(parsed.markdown), title)
          await deps.rpc.call('doc:apply', {
            id,
            content,
            origin: 'import',
            title,
            md: parsed.markdown,
          })
        }
        pages++
      } catch (err) {
        // 一篇解析不了不该带走整单 —— 记下来，继续下一篇（错误也进 errors.log）。
        reportError('import-notion', err)
        skipped++
      }
    }
    deps.onProgress?.(++done, pageFiles.length)
  }

  return { pages, images, skipped, entryId, cancelled }
}
