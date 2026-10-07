/**
 * 写工具的底层 —— 「库里的字节 → 活的 Y.Doc → 只动该动的块 → 落库」。
 *
 * ★ **不做整篇覆盖**（`docs/ai.md` 第五节）：整篇重新生成会把块 id、折叠状态、行内元数据
 *   全丢掉，那是**丢数据的形状**。所以每次都把库里的字节原样装回来，只增删该增删的块
 *   —— 块 id 活在 Yjs 里，跟着一起回去。
 *
 * ★ 自己搭一个**临时工作区**（和 `import-notion` 同一套路）：插件之间不许互相 import
 *   内部文件（CONVENTIONS §6.2），块 schema 只能从 `ctx.editor.blocks()` 现拿 ——
 *   少一个 flavour，那种块就写不进去（D-0064）。
 *
 * ★ 这条路是**懒装载**的：`plugins/tools/index.ts` 在 `run()` 里才 `import('./doc')` ——
 *   不写文档的人不该为这几 MB 的块包付冷启动的解析费。
 *
 * ★ **先 checkpoint 是调用方的纪律**（`docs/ai.md` 第六节第二层）：这个文件只管搬字节，
 *   一句版本点都不打 —— `index.ts` 那六条工具里，写工具进来的第一件事就是它。
 */
import { MarkdownAdapter } from '@blocksuite/affine/shared/adapters'
import { StoreExtensionManager, StoreExtensionProvider } from '@blocksuite/affine/ext-loader'
import { NoteDisplayMode } from '@blocksuite/affine/model'
import { Text, Transformer, type BlockModel, type Store } from '@blocksuite/affine/store'
import { TestWorkspace } from '@blocksuite/affine/store/test'
import type { Context } from 'cordis'
import * as Y from 'yjs'

import {
  DOCS_CHANGED,
  type DocHandle,
  type DocMeta,
} from '../../src/kernel/contract'

type StoreProvider = typeof StoreExtensionProvider

/** 临时工作区的 id。和编辑器那个（`self-notion`）分开 —— 两边各有各的 doc 表。 */
const WORKSPACE = 'self-notion-ai'
/** 探针文档：schema 和 DI provider 都从它身上拿（adapter 靠 provider 找块的 matcher）。 */
const PROBE = 'self-notion-ai-probe'

/** 一次写的结果。`blocks` 让模型知道有没有真写进去（0 = 只建了空文档 / 没匹配上）。 */
export interface WriteResult {
  id: string
  title: string
  blocks: number
}

interface Bench {
  doc: { spaceDoc: Y.Doc }
  store: Store
  adapter: MarkdownAdapter
  transformer: Transformer
}

/* ─────────────────────────── 装配 ─────────────────────────── */

/**
 * 从**库里的字节**撑起一个工作台。
 *
 * ★ 第一句是必须的（D-0087 补的）：编辑器每 300ms 才落一次库，而这里读完就把用户那篇
 *   重做一遍、末尾 `commit` 还会 `reload` 掉活文档 —— 不先 flush，用户最后敲的那 ≤300ms
 *   就随着"读旧字节 + 丢活文档"一起没了。三处读都走这个入口，漏一处就是一次静默丢字。
 */
async function benchFromStore(ctx: Context, id: string): Promise<Bench> {
  await ctx.editor.flush(id)
  return bench(ctx, id, await ctx.docs.load(id))
}

async function bench(ctx: Context, id: string, handle: DocHandle): Promise<Bench> {
  // `blocks()` 有前置条件（契约里那条：先 `await ready()`）。
  await ctx.editor.ready()
  const extensions = new StoreExtensionManager(ctx.editor.blocks() as StoreProvider[]).get('store')

  const ws = new TestWorkspace({ id: WORKSPACE })
  // 不调 `meta.initialize()` 的话 `createDoc` 会**静默**回 null（`import-notion` 踩过）。
  ws.meta.initialize()
  ws.storeExtensions = extensions

  const probeDoc = ws.createDoc(PROBE)
  if (!probeDoc) throw new Error('AI 写文档：临时工作区建不出探针文档')
  probeDoc.load()
  const probe = probeDoc.getStore({ id: PROBE, extensions })

  const doc = ws.createDoc(id)
  if (!doc) throw new Error(`AI 写文档：建不出临时文档「${id}」`)
  doc.load()
  // 契约规定的顺序：先 snapshot，再按 seq 依次 updates（同 `editor-blocksuite/doc-source.ts`）。
  if (handle.snapshot) Y.applyUpdate(doc.spaceDoc, handle.snapshot)
  for (const update of handle.updates) Y.applyUpdate(doc.spaceDoc, update)

  let store = doc.getStore({ id, extensions })
  // Store 按 id 缓存、先到先得：缓存里坐着没 schema 的那家，之后补不进去 —— 认出来就重开。
  if (!store.schema.flavourSchemaMap.has('affine:page')) {
    doc.removeStore({ id })
    store = doc.getStore({ id, extensions })
  }

  const transformer = new Transformer({
    schema: probe.schema,
    blobCRUD: ws.blobSync,
    docCRUD: {
      create: (did: string) => {
        const made = ws.createDoc(did)
        if (!made) throw new Error(`AI 写文档：临时工作区建不出文档「${did}」`)
        return made.getStore({ id: did, extensions })
      },
      get: (did: string) => ws.getDoc(did)?.getStore({ id: did, extensions }) ?? null,
      delete: (did: string) => ws.removeDoc(did),
    },
  })

  return { doc, store, adapter: new MarkdownAdapter(transformer, probe.provider), transformer }
}

/** 种一棵能装字的空树。返回 note 的 id（`addBlock` 回的是 id 不是模型）。 */
function seed(store: Store): string {
  const root = store.addBlock('affine:page', { title: new Text('') })
  return store.addBlock('affine:note', { displayMode: NoteDisplayMode.DocAndEdgeless }, root)
}

/** 往哪儿追加：最后一棵 note。一篇都没有就先种一棵。 */
function tailNote(store: Store): string {
  const notes = store.getModelsByFlavour('affine:note')
  const last = notes[notes.length - 1]
  if (last) return last.id
  return seed(store)
}

/** Markdown → 块，插进 `parent` 的第 `index` 位。返回插了几个。 */
async function insert(
  b: Bench,
  parent: string,
  index: number,
  markdown: string,
): Promise<number> {
  const snap = await b.adapter.toBlockSnapshot({ file: markdown })
  // `toBlockSnapshot` 的根是一整棵 `affine:note` —— 只要它的孩子，**不要**那层 note 壳：
  // 插进 note 里的东西才该是段落（note 套 note 不合 schema），插进页面的才是 note 本身。
  let at = index
  let n = 0
  for (const child of snap.children) {
    const made = await b.transformer.snapshotToBlock(child, b.store, parent, at)
    if (!made) continue
    at++
    n++
  }
  return n
}

/* ─────────────────────────── 落库 ─────────────────────────── */

/**
 * 把改完的 Y.Doc 写回库，并让开着的编辑器重读。
 *
 * ★ `links` **故意不送**（D-0085）：`doc:apply` 少这个字段的语义是「别动已有的边」。
 *   送空数组才是「把边全删了」—— 那会把这篇的反向链接一次抹掉。
 * ★ 顺序照 `version-history/actions.ts`：先改库，再 `reload`（它第一句就把落库闸门关上）。
 */
async function commit(
  ctx: Context,
  b: Bench,
  id: string,
  groupId: string,
  label: string,
): Promise<string> {
  const bytes = Y.encodeStateAsUpdate(b.doc.spaceDoc)
  const { title, md } = project(b.store)
  await ctx.rpc.call('doc:apply', {
    id,
    snapshot: b64(bytes),
    origin: 'ai',
    groupId,
    label,
    title,
    md,
  })
  await ctx.editor.reload(id)
  // 标题 / 更新时间可能变了 —— 侧栏、标签条、首页靠这条事件重取（D-0073）。
  ctx.emit(DOCS_CHANGED)
  return title
}

/** 正文投影：把块树的 text 摊平 + 那个大标题（Rust 拿它喂 FTS / 首页摘要）。 */
function project(store: Store): { title: string; md: string } {
  const lines: string[] = []
  if (store.root) collectText(store.root, lines)
  const page = store.getModelsByFlavour('affine:page')[0]
  const title = (page?.props as { title?: { toString(): string } } | undefined)?.title
  return { title: title ? title.toString() : '', md: lines.join('\n\n') }
}

function collectText(model: BlockModel, out: string[]): void {
  const text = model.text?.toString().trim()
  if (text) out.push(text)
  for (const child of model.children) collectText(child, out)
}

/* ─────────────────────────── 三个动作 ─────────────────────────── */

/** 新建一篇（`doc:create` 先落库里的那条记录，正文随后跟着写）。 */
export async function create(
  ctx: Context,
  title: string,
  markdown: string,
  groupId: string,
): Promise<WriteResult> {
  const meta = await ctx.rpc.call<DocMeta>('doc:create', { title })
  if (!markdown.trim()) {
    // 空文档也要说一声 —— 侧栏 / 首页靠这条事件重取列表，不然新建的那篇看不见。
    ctx.emit(DOCS_CHANGED)
    return { id: meta.id, title, blocks: 0 }
  }

  const b = await bench(ctx, meta.id, { id: meta.id, snapshot: null, updates: [] })
  // 正文顶上那个大标题就是这篇的名字（D-0073）—— 库里那份是 `doc:create` 写的，两边必须同名。
  const page = b.store.getModelsByFlavour('affine:page')[0]
  if (page) (page.props as { title?: unknown }).title = new Text(title)

  const note = tailNote(b.store)
  const blocks = await insert(b, note, 0, markdown)
  const done = await commit(ctx, b, meta.id, groupId, labelOf(markdown, title))
  return { id: meta.id, title: done, blocks }
}

/** 追加到末尾。 */
export async function append(
  ctx: Context,
  id: string,
  markdown: string,
  groupId: string,
): Promise<WriteResult> {
  if (!markdown.trim()) throw new Error('doc_append：markdown 是空的，没什么可加')
  const b = await benchFromStore(ctx, id)
  const note = tailNote(b.store)
  const at = b.store.getBlock(note)?.model?.children.length ?? 0
  const blocks = await insert(b, note, at, markdown)
  const title = await commit(ctx, b, id, groupId, labelOf(markdown, ''))
  return { id, title, blocks }
}

/**
 * 按块 id 替换一段。新的插在**第一个**被替换的块的位置，旧的四散的话只保这一段的对齐
 *（`docs/ai.md` 第五节就三种动作，不做「按范围任意重排」）。
 */
export async function replace(
  ctx: Context,
  id: string,
  blockIds: string[],
  markdown: string,
  groupId: string,
): Promise<WriteResult> {
  if (!markdown.trim()) throw new Error('doc_replace：markdown 是空的，没什么可换')
  const b = await benchFromStore(ctx, id)

  const models = blockIds
    .map((bid) => b.store.getBlock(bid)?.model)
    .filter((m): m is BlockModel => m !== undefined)
  if (!models.length) throw new Error('doc_replace：这些块 id 一个都不在这篇里')

  const first = models[0]!
  const parent = first.parent
  if (!parent) throw new Error('doc_replace：那个块没有父级，动不了')
  const at = parent.children.findIndex((c) => c.id === first.id)

  const blocks = await insert(b, parent.id, at < 0 ? 0 : at, markdown)
  for (const model of models) b.store.deleteBlock(model)

  const title = await commit(ctx, b, id, groupId, labelOf(markdown, ''))
  return { id, title, blocks }
}

/**
 * 按原文里的一句话找块。
 *
 * ★ 上下文里看不见块 id（`/tree/X.md` 装的是文字，不是带 id 的结构）—— 所以 `doc_replace`
 *   除了一串块 id，还得能按原文定位。找不到就回空，让调用方报一句清楚的话。
 */
export async function findByQuote(
  ctx: Context,
  id: string,
  quote: string,
): Promise<string[]> {
  const needle = quote.trim()
  if (!needle) return []
  const b = await benchFromStore(ctx, id)
  const out: string[] = []
  const walk = (model: BlockModel) => {
    const text = model.text?.toString() ?? ''
    if (text !== '' && text.includes(needle)) out.push(model.id)
    for (const child of model.children) walk(child)
  }
  if (b.store.root) walk(b.store.root)
  return out
}

/* ─────────────────────────── 小东西 ─────────────────────────── */

/** 版本点上那句说明 —— 取正文第一句，用户翻版本历史时知道这一笔是干嘛的。 */
function labelOf(markdown: string, fallback: string): string {
  const line = markdown
    .split('\n')
    .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
    .find((l) => l !== '')
  return (line ?? fallback).slice(0, 60)
}

// `String.fromCharCode(...bytes)` 一次喂太多会爆栈（约 6.5 万参数上限）—— 按块切（同 `notion.ts`）。
const CHUNK = 0x8000
function b64(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    raw += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(raw)
}
