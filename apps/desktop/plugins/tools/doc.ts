/**
 * 写工具的底层 —— 「库里的 JSON → 活的 doc → 只动该动的块 → 落库」。
 *
 * ★ **不做整篇覆盖**（`docs/ai.md` 第五节）：整篇重新生成会把块 id 一起换掉，那是**丢数据的形状**。
 *   所以把库里的 JSON 原样装回来，只用 `Transform` 增删该增删的块 —— 没碰到的块 id 原样回去。
 *
 * ★ markdown → 块走契约 `ctx.editor.docFromMarkdown`：解析器住在编辑器那一侧（它拥有
 *   「schema 节点名 ↔ markdown 语法」这份映射），别处再抄一份就会漂。
 *
 * ★ 这条路是**懒装载**的：`plugins/tools/index.ts` 在 `run()` 里才 `import('./doc')` ——
 *   不写文档的人不该为解析费付冷启动。
 *
 * ★ **先 flush 是必须的**（D-0087）：编辑器每 300ms 才落一次库，这里读完就把用户那篇
 *   重做一遍、末尾还 `reload` 掉活文档 —— 不先 flush，用户最后敲的那 ≤300ms 就随着
 *   「读旧字节 + 丢活文档」一起没了。三个入口都走 `loadDoc`，漏一处就是一次静默丢字。
 *
 * ★ **`links` 故意不送**（D-0085）：`doc:apply` 少这个字段的语义是「别动已有的边」。
 *   送空数组才是「把边全删了」—— 那会把这篇的反向链接一次抹掉。
 */
import type { Context } from 'cordis'
import { Node as PMNode, type Schema } from 'prosemirror-model'
import { Transform } from 'prosemirror-transform'

import { DOCS_CHANGED, type DocMeta } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'

/** 一次写的结果。`blocks` 让模型知道有没有真写进去（0 = 只建了空文档 / 没匹配上）。 */
export interface WriteResult {
  id: string
  title: string
  blocks: number
}

interface BlockHit {
  node: PMNode
  pos: number
}

/* ─────────────────────────── 装配 ─────────────────────────── */

/**
 * 读库里的字节 → PM doc（顺手把 schema 带出来，调用方马上要拿它解 markdown）。
 *
 * 第一句 `flush` 的理由见文件头。库里还没这一篇 → 造一份空的，别让下游踩 null。
 */
async function loadDoc(ctx: Context, id: string): Promise<{ doc: PMNode; schema: Schema }> {
  await ctx.editor.flush(id)
  await ctx.editor.ready()
  const schema = ctx.editor.schema() as Schema
  const { content } = await ctx.docs.load(id)
  const doc = content === null ? emptyDoc(schema) : PMNode.fromJSON(schema, JSON.parse(content))
  return { doc, schema }
}

/** 空文档：一个空的段落块 —— `blockGroup` 至少要一个 `blockContainer`。 */
function emptyDoc(schema: Schema): PMNode {
  return makeDoc(schema, '', [newBlock(schema)])
}

/** 一个空的段落块（`create` 建新篇时也用它兜 schema 的 `blockContainer+`）。 */
function newBlock(schema: Schema): PMNode {
  return schema.node('blockContainer', { id: blockId() }, schema.node('paragraph'))
}

function makeDoc(schema: Schema, title: string, blocks: PMNode[]): PMNode {
  const group = schema.node('blockGroup', null, blocks.length ? blocks : [newBlock(schema)])
  return schema.node('doc', { title }, group)
}

/** 块 id（写进持久化 JSON，架构 §3.1）。生成法跟编辑器那侧一致（跨插件不 import 内部）。 */
function blockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** markdown → 块数组。`docFromMarkdown` 回的是一整篇 doc：`content[0]` 是那个 `blockGroup`，它的 children 才是块。 */
function blocksFrom(ctx: Context, schema: Schema, markdown: string): PMNode[] {
  const whole = JSON.parse(ctx.editor.docFromMarkdown(markdown)) as {
    content?: { content?: unknown[] }[]
  }
  const raw = whole.content?.[0]?.content ?? []
  return raw.map((b) => freshIds(PMNode.fromJSON(schema, b)))
}

/** 给插入的子树换一批新块 id —— id 是评论 / 拖拽 / 落库对齐的唯一锚点，重复的 id 会让定位对不上。 */
function freshIds(node: PMNode): PMNode {
  if (node.isText) return node
  const attrs = node.type.name === 'blockContainer' ? { ...node.attrs, id: blockId() } : node.attrs
  const kids: PMNode[] = []
  node.forEach((child) => kids.push(freshIds(child)))
  return node.type.create(attrs, kids)
}

/* ─────────────────────────── 落库 ─────────────────────────── */

/**
 * 把改完的 doc 写回库，并让开着的编辑器重读。
 *
 * ★ 顺序照 `version-history/actions.ts`：先改库，再 `reload`（它第一句就把落库闸门关上）。
 * ★ 版本点不用在这儿打 —— 走的是 `doc:apply`，Rust 侧 `origin != 'user'` 时**强制**先快照（D-0043）。
 */
async function commit(
  ctx: Context,
  id: string,
  doc: PMNode,
  groupId: string,
  label: string,
): Promise<string> {
  const title = String(doc.attrs.title ?? '')
  await ctx.rpc.call('doc:apply', {
    id,
    content: JSON.stringify(doc.toJSON()),
    origin: 'ai',
    groupId,
    label,
    title,
    md: textOf(doc),
  })
  await ctx.editor.reload(id)
  // 标题 / 更新时间可能变了 —— 侧栏、标签条、首页靠这条事件重取（D-0073）。
  ctx.emit(DOCS_CHANGED)
  return title
}

/** 正文投影（纯文本，按块树顺序摊平）—— Rust 拿它喂 FTS / 首页摘要（`doc_text`）。 */
function textOf(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, '\n\n')
}

/* ─────────────────────────── 三个动作 ─────────────────────────── */

/** 新建一篇（`doc:create` 先落库里的那条记录，正文随后跟着写）。 */
export async function create(
  ctx: Context,
  title: string,
  markdown: string,
  groupId: string,
): Promise<WriteResult> {
  try {
    const meta = await ctx.rpc.call<DocMeta>('doc:create', { title })
    if (!markdown.trim()) {
      // 空文档也要说一声 —— 侧栏 / 首页靠这条事件重取列表，不然新建的那篇看不见。
      ctx.emit(DOCS_CHANGED)
      return { id: meta.id, title, blocks: 0 }
    }
    await ctx.editor.ready()
    const schema = ctx.editor.schema() as Schema
    const blocks = blocksFrom(ctx, schema, markdown)
    // 正文顶上那个大标题就是这篇的名字（D-0073）—— 标题是 doc 的 attr（架构 §3.3），和正文一起落库。
    await commit(ctx, meta.id, makeDoc(schema, title, blocks), groupId, labelOf(markdown, title))
    return { id: meta.id, title, blocks: blocks.length }
  } catch (err) {
    reportError('tools', err)
    throw err
  }
}

/** 追加到末尾。 */
export async function append(
  ctx: Context,
  id: string,
  markdown: string,
  groupId: string,
): Promise<WriteResult> {
  try {
    if (!markdown.trim()) throw new Error('doc_append：markdown 是空的，没什么可加')
    const { doc, schema } = await loadDoc(ctx, id)
    const blocks = blocksFrom(ctx, schema, markdown)
    const tr = new Transform(doc)
    // 根 `blockGroup` 内容区的末尾：doc 的内容就那一个 blockGroup，它内容区收在 content.size - 1。
    if (blocks.length) tr.insert(doc.content.size - 1, blocks)
    const title = await commit(ctx, id, tr.doc ?? doc, groupId, labelOf(markdown, ''))
    return { id, title, blocks: blocks.length }
  } catch (err) {
    reportError('tools', err)
    throw err
  }
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
  try {
    if (!markdown.trim()) throw new Error('doc_replace：markdown 是空的，没什么可换')
    const { doc, schema } = await loadDoc(ctx, id)

    const hits = collectBlocks(doc, blockIds)
    if (!hits.length) throw new Error('doc_replace：这些块 id 一个都不在这篇里')

    const blocks = blocksFrom(ctx, schema, markdown)
    const tr = new Transform(doc)
    // 从后往前删：留下的位置不受影响，于是 hits[0].pos 删完还是那个锚点。
    for (let i = hits.length - 1; i >= 0; i--) tr.delete(hits[i].pos, hits[i].pos + hits[i].node.nodeSize)
    if (blocks.length) tr.insert(hits[0].pos, blocks)

    const title = await commit(ctx, id, tr.doc ?? doc, groupId, labelOf(markdown, ''))
    return { id, title, blocks: blocks.length }
  } catch (err) {
    reportError('tools', err)
    throw err
  }
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
  try {
    const { doc } = await loadDoc(ctx, id)
    const out: string[] = []
    doc.descendants((node) => {
      if (node.type.name !== 'blockContainer') return
      const bid = String(node.attrs.id)
      // 只看块**自己**的内容（`blockContent` 那一层），不看它 children 的文字 —— 跟块手柄选中的是同一个块。
      const text = node.firstChild?.textContent ?? ''
      if (bid && text !== '' && text.includes(needle)) out.push(bid)
    })
    return out
  } catch (err) {
    reportError('tools', err)
    throw err
  }
}

/* ─────────────────────────── 小东西 ─────────────────────────── */

/** 按 id 找块，位置按文档顺序（`descendants` 保证）。 */
function collectBlocks(doc: PMNode, ids: string[]): BlockHit[] {
  const want = new Set(ids)
  const out: BlockHit[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'blockContainer' && want.has(String(node.attrs.id))) {
      out.push({ node, pos })
    }
  })
  return out
}

/** 版本点上那句说明 —— 取正文第一句，用户翻版本历史时知道这一笔是干嘛的。 */
function labelOf(markdown: string, fallback: string): string {
  const line = markdown
    .split('\n')
    .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
    .find((l) => l !== '')
  return (line ?? fallback).slice(0, 60)
}
