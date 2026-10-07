/**
 * Notion 导出的 zip → 我们库里的文档。
 *
 * **解析不自己写** —— 走 BlockSuite 自带的 `NotionHtmlAdapter`（跟 AFFiNE 用的是同一份代码：
 * 标题、列表、代码块语言、折叠、提示块、图片、页内链接全归它管）。这一层只做四件事：
 *
 *   1. 解压（fflate，BlockSuite 自己就带的那个）
 *   2. 按 zip 里的文件夹层级算出父子（`Parent abc.html` + 文件夹 `Parent abc/` 就是 Notion 的嵌套形状）
 *   3. 图片进 `blob:put`，把 `路径 → blob id` 喂给 adapter 的 assetsManager
 *   4. 解析出来的文档编码成 Yjs，走 `ctx.docs.save` 落库
 *
 * ★ 只给 adapter 传**编辑器有的块**（清单来自 `ctx.editor.blocks()`）：Notion 里的数据库、书签、
 *   附件解析出来会变成我们不认识的 flavour，`Transformer` 遇到不认识的 flavour 直接抛 ——
 *   所以落库前先剪掉（`stripUnknown`），被剪掉的内容不会变成半篇烂文档。
 *
 * ponytail: 整包在内存里解（`unzipSync` + 全部条目 map）。几百 MB 的导出会吃内存，
 *   到那天再换流式解压，接口不用动。
 */
import { FULL_FILE_PATH_KEY, NotionHtmlAdapter } from '@blocksuite/affine/shared/adapters'
import { type BlockSnapshot, type DocSnapshot, Transformer } from '@blocksuite/affine/store'
import { TestWorkspace } from '@blocksuite/affine/store/test'
import { StoreExtensionManager, StoreExtensionProvider } from '@blocksuite/affine/ext-loader'
import { unzipSync } from 'fflate'
import * as Y from 'yjs'

import type { DocMeta, DocsService, RpcService } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'

type StoreProvider = typeof StoreExtensionProvider

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

/** 内容的 sha，纯给 FTS 当正文用不到 —— 这儿只是给 `blob:put` 铺路。 */
const CHUNK = 0x8000 // 32768，`String.fromCharCode(...)` 一次喂太多会爆栈
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

/** 不认识的块（Notion 的数据库 / 书签 / 附件）直接剪掉，别让 Transformer 抛。 */
function stripUnknown(block: BlockSnapshot, known: (flavour: string) => boolean): number {
  let dropped = 0
  block.children = block.children.filter(child => {
    if (!known(child.flavour)) {
      dropped++
      return false
    }
    dropped += stripUnknown(child, known)
    return true
  })
  return dropped
}

function countFlavour(block: BlockSnapshot, flavour: string): number {
  let n = block.flavour === flavour ? 1 : 0
  for (const child of block.children) n += countFlavour(child, flavour)
  return n
}

/** 正文纯文本：给 Rust 喂 FTS 和首页摘要（`doc_text`）。只认 BlockSuite 的 text 编码。 */
function collectText(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  // marker 和 delta 是兄弟（TextSnapshot 的形状）—— 把 marker 当 delta 的父节点永远取不到字。
  if (obj['$blocksuite:internal:text$'] === true) {
    for (const op of (obj['delta'] ?? []) as { insert?: unknown }[]) {
      if (typeof op.insert === 'string') out.push(op.insert)
    }
    return
  }
  for (const value of Object.values(obj)) collectText(value, out)
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
  docs: DocsService
  /**
   * `ctx.editor.blocks()` —— **和编辑器同一套**块注册表（契约里那条 `blocks()`）。
   * schema 少一个 flavour，对应那种块就写不进去（`Transformer` 直接抛），
   * 所以这份清单不能拄、只能拿现场的。
   */
  extensions: readonly unknown[]
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

  // 临时工作区：解析出来的块先落这儿，编码成 Yjs 之后才算我们的。用完即弃。
  const ws = new TestWorkspace({ id: 'self-notion-import' })
  ws.meta.initialize()
  const extensions = new StoreExtensionManager(deps.extensions as StoreProvider[]).get('store')

  // 探针文档：Schema 和 DI provider 都从它身上拿 —— adapter 要 provider 才找得到各种块的 matcher。
  const probeDoc = ws.createDoc('import-schema')
  if (!probeDoc) throw new Error('导入：临时工作区建不出探针文档')
  probeDoc.load()
  const probe = probeDoc.getStore({ id: 'import-schema', extensions })

  const transformer = new Transformer({
    schema: probe.schema,
    blobCRUD: ws.blobSync,
    docCRUD: {
      create: (id: string) => {
        const doc = ws.createDoc(id)
        if (!doc) throw new Error(`导入：临时工作区建不出文档「${id}」`)
        return doc.getStore({ id, extensions })
      },
      get: (id: string) => ws.getDoc(id)?.getStore({ id, extensions }) ?? null,
      delete: (id: string) => ws.removeDoc(id),
    },
  })
  // 图片的 `src` 是相对路径，adapter 拿这张表把它翻成 blob id（→ 图片块的 sourceId）。
  for (const [path, id] of assetIds) transformer.assetsManager.getPathBlobIdMap().set(path, id)

  // 页内链接：Notion 的 href 是导出包里的相对路径，把每条路径的后缀都登记一遍，
  // 不管 href 是根相对还是同级相对都认得出来。
  const pageMap = new Map<string, string>()
  for (const [path, id] of ids) {
    let rest = path
    while (rest) {
      pageMap.set(rest, id)
      rest = rest.includes('/') ? rest.slice(rest.indexOf('/') + 1) : ''
    }
  }

  const adapter = new NotionHtmlAdapter(transformer, probe.provider)
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
        // 图片的相对路径是相对**这篇 HTML 所在目录**的，一篇一设。
        transformer.adapterConfigs.set(FULL_FILE_PATH_KEY, path)
        const snapshot: DocSnapshot = await adapter.toDocSnapshot({
          file: decoder.decode(bytes),
          pageId: id,
          pageMap,
        })
        const dropped = stripUnknown(snapshot.blocks, flavour => !!probe.schema.get(flavour))
        if (dropped) skipped += dropped
        images += countFlavour(snapshot.blocks, 'affine:image')

        await transformer.snapshotToDoc(snapshot)
        const live = ws.getDoc(id)
        if (!live) throw new Error('导入：文档没落进临时工作区')

        const title = snapshot.meta.title || titleOf(path)
        const text: string[] = []
        collectText(snapshot.blocks, text)
        await deps.docs.save(id, {
          id,
          snapshot: Y.encodeStateAsUpdate(live.spaceDoc),
          updates: [],
          title,
          md: text.join('\n'),
        })
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
