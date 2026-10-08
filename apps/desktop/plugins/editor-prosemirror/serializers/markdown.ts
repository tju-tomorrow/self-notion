/**
 * PM doc ↔ markdown（架构 §7）。正向喂 `DocHandle.md`（搜索 / 摘要 / 出链吃它）；
 * 反向给 tools 的写工具、import-notion 用（模型 / Notion 导出给的是 markdown）。
 *
 * ★ **markdown 和我们的块树形状不一样**：markdown 的列表是 `bullet_list > list_item > paragraph`，
 *   引用是 `blockquote > paragraph`；我们的是 `blockContainer > (内容 | children)`。所以这里有两步：
 *   先用一个**临时 schema**（按 markdown 的形状）解析，再把树**转**成我们的块树。
 *   attrs 名（heading.level / codeBlock.language / image.blobId）两侧对齐，转的时候不用改名。
 */
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  type MarkdownSerializerState,
} from 'prosemirror-markdown'
import {
  Schema,
  type Mark as PMMark,
  type Node as PMNode,
  type NodeSpec,
} from 'prosemirror-model'

import { reportError } from '../../../src/kernel/errors'
import { schema } from '../schema'

/** 块 id（架构 §3.1，跟 editor.ts 的 blockId() 同一条规矩）—— 别造出 `id: ''` 的块。 */
function blockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

const BLOB_PREFIX = 'self-notion://blob/'
// 文档引用（subpage / mention）的链接前缀 —— markdown 没有「页面提及」这回事，用内部 scheme 保住 docId。
const DOC_PREFIX = 'self-notion://doc/'

/* ─────────────────────────── 解析：markdown → 临时 schema → 块树 ─────────────────────────── */

// 只供解析用的 schema，形状照 markdown（有 bulletList / listItem 这层包装）。marks 只用名字 —— 转的时候重建。
const mdNodes: Record<string, NodeSpec> = {
  doc: { content: 'mdBlock+' },
  paragraph: { content: 'inline*', group: 'mdBlock' },
  heading: { content: 'inline*', group: 'mdBlock', attrs: { level: { default: 1 } } },
  codeBlock: { content: 'text*', group: 'mdBlock', attrs: { language: { default: '' } } },
  divider: { atom: true, group: 'mdBlock' },
  // 行内图片（markdown 就是这么给的）—— 转的时候按「整段只有图」拆成块。
  image: { atom: true, inline: true, group: 'inline', attrs: { src: { default: '' }, alt: { default: '' } } },
  hardbreak: { atom: true, inline: true, group: 'inline' },
  mdQuote: { content: 'mdBlock+', group: 'mdBlock' },
  bulletList: { content: 'listItem+', group: 'mdBlock' },
  orderedList: { content: 'listItem+', group: 'mdBlock' },
  listItem: { content: 'mdBlock+' },
  text: { group: 'inline' },
}

const mdSchema = new Schema({
  nodes: mdNodes,
  marks: {
    bold: {},
    italic: {},
    strike: {},
    underline: {},
    code: {},
    link: { attrs: { href: { default: '' } } },
    highlight: { attrs: { color: { default: '' } } },
    textColor: { attrs: { color: { default: '' } } },
  },
})

// tokenizer 复用官方默认 parser 那个（commonmark + html:false）—— `markdown-it` 是
// prosemirror-markdown 的**传递依赖**，pnpm 严格模式下裸 import 解不出来。
const parser = new MarkdownParser(mdSchema, defaultMarkdownParser.tokenizer, {
  paragraph: { block: 'paragraph' },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: mdLevel(Number(tok.tag.slice(1))) }) },
  code_block: { block: 'codeBlock', noCloseToken: true },
  fence: {
    block: 'codeBlock',
    getAttrs: (tok) => ({ language: (tok.info || '').trim().split(/\s+/)[0] || '' }),
    noCloseToken: true,
  },
  blockquote: { block: 'mdQuote' },
  bullet_list: { block: 'bulletList' },
  ordered_list: { block: 'orderedList' },
  list_item: { block: 'listItem' },
  hr: { node: 'divider' },
  image: {
    node: 'image',
    getAttrs: (tok) => ({ src: tok.attrGet('src') ?? '', alt: tok.children?.[0]?.content ?? '' }),
  },
  hardbreak: { node: 'hardbreak' },

  em: { mark: 'italic' },
  strong: { mark: 'bold' },
  link: { mark: 'link', getAttrs: (tok) => ({ href: tok.attrGet('href') ?? '' }) },
  code_inline: { mark: 'code', noCloseToken: true },
})

/** 架构 §2.2 的 heading 只认 1|2|3 —— markdown 的 h4-h6 落到 h3。 */
function mdLevel(level: number): 1 | 2 | 3 {
  return level >= 3 ? 3 : level === 2 ? 2 : 1
}

/** Mark 是绑 schema 的，不能跨 schema 搬 —— 按名字在我们 schema 上重建（attrs 原样带过去）。 */
function ourMarks(marks: readonly PMMark[]): PMMark[] {
  const out: PMMark[] = []
  for (const mark of marks) {
    const type = schema.marks[mark.type.name]
    if (type) out.push(type.create(mark.attrs))
  }
  return out
}

/** 一个块在原文里的行区间（markdown-it token 的 `map`）—— 外部文件那条路靠它记每块的原文（D-0142）。 */
export interface SourceRange {
  start: number
  end: number
  children: SourceRange[]
}

/** 没有原文区间（库文档那条路 / 行内推出来的块）—— 不记 side table，保存时走序列化。 */
const NO_RANGE: SourceRange = { start: -1, end: -1, children: [] }

/** 解析时造块顺手记下它的行区间（按节点身份）—— `docFromRaw` 造完 doc 再按 id 收进 side table。 */
let spans: WeakMap<PMNode, SourceRange> | null = null

/** 一个块 = blockContainer(id) > 内容 (+ 可选 children 的 blockGroup)。 */
function container(content: PMNode, children: readonly PMNode[] = [], range?: SourceRange): PMNode {
  const inner: PMNode[] = [content]
  if (children.length) inner.push(schema.nodes.blockGroup.create(null, children))
  const node = schema.nodes.blockContainer.create({ id: blockId() }, inner)
  if (range && spans) spans.set(node, range)
  return node
}

/** md 的行内流 → 我们 schema 的行内节点（图片归调用方；行内没地方放块级原子）。 */
function inlineOf(node: PMNode): PMNode[] {
  const out: PMNode[] = []
  node.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? ''
      if (text) out.push(schema.text(text, ourMarks(child.marks)))
    } else if (child.type.name === 'hardbreak') {
      out.push(schema.text('\n'))
    }
  })
  return out
}

function pushImage(node: PMNode, out: PMNode[], range: SourceRange): void {
  const src = String(node.attrs.src ?? '')
  if (src.startsWith(BLOB_PREFIX)) {
    out.push(container(schema.nodes.image.create({ blobId: src.slice(BLOB_PREFIX.length) }), [], range))
    return
  }
  // 不是 blob（外链图）：留一行 alt，不把字丢了
  const alt = String(node.attrs.alt ?? '').trim()
  if (alt) out.push(container(schema.nodes.paragraph.create(null, schema.text(alt)), [], range))
}

/** 段落：里面夹图片就拆成「段落 / 图片 / 段落」几个块（架构里 image 是块级原子，不能待在段落里）。 */
function convertParagraph(node: PMNode, out: PMNode[], range: SourceRange): void {
  const start = out.length
  let buf: PMNode[] = []
  const flush = (): void => {
    if (!buf.length) return
    out.push(container(schema.nodes.paragraph.create(null, buf), [], range))
    buf = []
  }
  node.forEach((child) => {
    if (child.type.name === 'image') {
      flush()
      pushImage(child, out, range)
    } else if (child.isText) {
      const text = child.text ?? ''
      if (text) buf.push(schema.text(text, ourMarks(child.marks)))
    } else if (child.type.name === 'hardbreak') {
      buf.push(schema.text('\n'))
    }
  })
  flush()
  if (out.length === start) out.push(container(schema.nodes.paragraph.create(), [], range))
}

/** 引用：第一段升成 quote，其余（嵌套列表 / 更多段落）落成它的 children。 */
function convertQuote(node: PMNode, out: PMNode[], range: SourceRange): void {
  const parts: PMNode[] = []
  node.forEach((child) => parts.push(child))
  const head = parts.shift()
  const kids: PMNode[] = []
  let content = schema.nodes.quote.create()
  if (head && head.type.name === 'paragraph') content = schema.nodes.quote.create(null, inlineOf(head))
  else if (head) convertBlock(head, kids, NO_RANGE)
  for (const rest of parts) convertBlock(rest, kids, NO_RANGE)
  out.push(container(content, kids, range))
}

/** Notion 导出的待办就是 `- [ ]` / `- [x]`（import-notion 的写法和它一致）。 */
const TODO_PREFIX = /^\[([ xX])\]\s+/

function listItemContent(kind: 'bulletedListItem' | 'numberedListItem', head: PMNode): PMNode {
  const inline = inlineOf(head)
  const first = inline[0]
  if (kind === 'bulletedListItem' && first && first.isText) {
    const match = TODO_PREFIX.exec(first.text ?? '')
    if (match) {
      const rest = (first.text ?? '').slice(match[0].length)
      const tail = rest ? [schema.text(rest, first.marks), ...inline.slice(1)] : inline.slice(1)
      return schema.nodes.todoItem.create({ checked: match[1] !== ' ' }, tail)
    }
  }
  return schema.nodes[kind].create(null, inline)
}

/** 列表项：第一个块是列表项本身，往后的块（含嵌套列表）落成它的 children —— 正好对上 Tab 缩进那套模型。 */
function convertListItem(
  item: PMNode,
  kind: 'bulletedListItem' | 'numberedListItem',
  range: SourceRange,
): PMNode {
  const parts: PMNode[] = []
  item.forEach((child) => parts.push(child))
  const head = parts.shift()
  const kids: PMNode[] = []
  let content: PMNode
  if (head && head.type.name === 'paragraph') {
    content = listItemContent(kind, head)
  } else {
    content = schema.nodes[kind].create()
    if (head) convertBlock(head, kids, NO_RANGE)
  }
  for (const rest of parts) convertBlock(rest, kids, NO_RANGE)
  return container(content, kids, range)
}

function convertBlock(node: PMNode, out: PMNode[], range: SourceRange): void {
  switch (node.type.name) {
    case 'paragraph':
      convertParagraph(node, out, range)
      return
    case 'heading':
      out.push(
        container(
          schema.nodes.heading.create({ level: mdLevel(Number(node.attrs.level)) }, inlineOf(node)),
          [],
          range,
        ),
      )
      return
    case 'codeBlock': {
      const text = node.textContent
      out.push(
        container(
          schema.nodes.codeBlock.create(
            { language: String(node.attrs.language ?? '') },
            text ? [schema.text(text)] : [],
          ),
          [],
          range,
        ),
      )
      return
    }
    case 'divider':
      out.push(container(schema.nodes.divider.create(), [], range))
      return
    case 'mdQuote':
      convertQuote(node, out, range)
      return
    case 'bulletList':
      node.forEach((item, _off, i) =>
        out.push(convertListItem(item, 'bulletedListItem', range.children[i] ?? NO_RANGE)),
      )
      return
    case 'orderedList':
      node.forEach((item, _off, i) =>
        out.push(convertListItem(item, 'numberedListItem', range.children[i] ?? NO_RANGE)),
      )
      return
    default: {
      // 认不出（表格 / html）：能掏文字就留一个段落，掏不出就丢
      const text = node.textContent.trim()
      if (text) out.push(container(schema.nodes.paragraph.create(null, schema.text(text)), [], range))
    }
  }
}

/** 块数组 → 整篇 doc JSON。形状 = `{type:'doc',attrs:{title,icon,cover},content:[blockGroup]}`（契约注释）。 */
function toDocJson(blocks: readonly PMNode[]): string {
  const group = schema.nodes.blockGroup.create(null, blocks)
  return JSON.stringify(schema.nodes.doc.create({ title: '' }, group).toJSON())
}

/** markdown → 整篇 doc JSON 字符串。坏输入降级成「一个空段落块」，别让调用方拿到半个文档。 */
export function docFromMarkdown(markdown: string): string {
  const blocks: PMNode[] = []
  try {
    parser.parse(markdown).forEach((block) => convertBlock(block, blocks, NO_RANGE))
  } catch (err) {
    reportError('editor-prosemirror', err)
    blocks.length = 0
  }
  if (blocks.length === 0) blocks.push(container(schema.nodes.paragraph.create()))
  return toDocJson(blocks)
}

/** markdown → 块数组（⌘V 那条路用）。解不出来就 `null` —— 调用方咽回 PM 默认，宁可不解也不许丢字（契约 `docs/paste.md` 的 P3）。 */
export function blocksFromMarkdown(markdown: string): PMNode[] | null {
  try {
    const blocks: PMNode[] = []
    parser.parse(markdown).forEach((block) => convertBlock(block, blocks, NO_RANGE))
    return blocks.length > 0 ? blocks : null
  } catch (err) {
    reportError('editor-prosemirror', err)
    return null
  }
}

/* ───────────────── 外部文件：带原文的解析 + 保真序列化（D-0139 / D-0141 / D-0142）───────────────── */

/** side table 的一条：这块的**原文**（byte 原样，含它后面的空行）+ 打开那一刻的 PM JSON 快照。 */
export interface SideEntry {
  chunk: string
  snapshot: string
}

/** markdown-it 的 token —— 只用得着这几个字段（结构上就是它的 `Token` 的子集）。 */
interface MdToken {
  level: number
  nesting: number
  map: [number, number] | null
}
// 直接用官方默认 parser 那个 tokenizer（不裸 import markdown-it —— 它是传递依赖，pnpm 严格模式解不出来）。
const tokenizer = defaultMarkdownParser.tokenizer

/** 逐层的行区间树：顶层 token 一个一块，容器（列表 / 项 / 引用）的子 token 递归下去。 */
function tokenRanges(tokens: readonly MdToken[]): SourceRange[] {
  const root: SourceRange = { start: 0, end: 0, children: [] }
  const stack: SourceRange[] = [root]
  for (const tok of tokens) {
    if (tok.nesting === 1) {
      const node: SourceRange = { start: tok.map?.[0] ?? -1, end: tok.map?.[1] ?? -1, children: [] }
      stack[stack.length - 1].children.push(node)
      stack.push(node)
    } else if (tok.nesting === -1) {
      if (stack.length > 1) stack.pop()
    } else if (tok.map && tok.level === 0) {
      stack[stack.length - 1].children.push({ start: tok.map[0], end: tok.map[1], children: [] })
    }
  }
  return root.children
}

/** 表格分隔行（GFM）：`|---|:--:|` 这种。 */
const TABLE_DELIM = /^\s{0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * 「我们看不懂」的整块行区间（frontmatter / 表格 / 块级 HTML）→ 整块交 rawBlock（D-0142，架构 §2.2.1）。
 * ★ 只能自己按行认：tokenizer 是 commonmark（`html:false`、无表格、无 frontmatter），这三样它都不认。
 */
function opaqueRegions(lines: readonly string[]): { start: number; end: number }[] {
  const regions: { start: number; end: number }[] = []
  const blank = (i: number): boolean => (lines[i] ?? '').trim() === ''
  // frontmatter 只在文件最开头：`---` 起、下一个 `---` / `...` 止
  if ((lines[0] ?? '').trim() === '---') {
    for (let j = 1; j < lines.length; j += 1) {
      const t = lines[j].trim()
      if (t === '---' || t === '...') {
        regions.push({ start: 0, end: j + 1 })
        break
      }
    }
  }
  const taken = (i: number): boolean => regions.some((r) => i >= r.start && i < r.end)
  for (let i = 0; i < lines.length; i += 1) {
    if (taken(i) || blank(i)) continue
    // 表格：本行有 `|`、下一行是分隔行
    if (lines[i].includes('|') && !blank(i + 1) && TABLE_DELIM.test(lines[i + 1] ?? '')) {
      let j = i + 2
      while (j < lines.length && !blank(j) && lines[j].includes('|')) j += 1
      regions.push({ start: i, end: j })
      i = j - 1
      continue
    }
    // 块级 HTML：行首 `<` 起，到空行止
    if (/^\s{0,3}<[/!a-zA-Z]/.test(lines[i])) {
      let j = i + 1
      while (j < lines.length && !blank(j)) j += 1
      regions.push({ start: i, end: j })
      i = j - 1
    }
  }
  return regions
}

export interface RawDoc {
  doc: PMNode
  side: Map<string, SideEntry>
}

/**
 * 外部文件那条路：原文 → 块树 **并带出 side table**（每块的原文 + 打开那一刻的 PM JSON 快照）。
 * 看不懂的整块落成 rawBlock；正常块按 token 的行区间记原文。★ 与 `docFromMarkdown` 分开 —— 后者把原文扔了。
 */
export function docFromRaw(markdown: string): RawDoc {
  const lines = markdown.split('\n')
  const regions = opaqueRegions(lines)
  const taken = new Set<number>()
  for (const r of regions) for (let i = r.start; i < r.end; i += 1) taken.add(i)
  // 看不懂的行**替成空白行**再喂 tokenizer —— 行号不变，token 的 `map` 直接就是原文行号。
  const masked = lines.map((line, i) => (taken.has(i) ? '' : line)).join('\n')

  spans = new WeakMap()
  const entries: { block: PMNode; range: SourceRange }[] = []
  try {
    const mdDoc = parser.parse(masked)
    const ranges = tokenRanges(tokenizer.parse(masked, {}))
    const blocks: PMNode[] = []
    // ★ 按 token 数取：空输入时 pm-markdown 会 `createAndFill` 塞一个空段落，那不是原文里的东西，别当块。
    const n = Math.min(mdDoc.childCount, ranges.length)
    for (let i = 0; i < n; i += 1) convertBlock(mdDoc.child(i), blocks, ranges[i])
    for (const block of blocks) {
      const range = spans.get(block)
      if (range) entries.push({ block, range })
    }
  } catch (err) {
    reportError('editor-prosemirror', err)
  }
  spans = null

  for (const r of regions) {
    const text = lines.slice(r.start, r.end).join('\n')
    entries.push({
      block: container(schema.nodes.rawBlock.create({ text })),
      range: { start: r.start, end: r.end, children: [] },
    })
  }
  if (entries.length === 0) {
    // 空文件 / 一行都认不出：一个空段落兜底，整篇当它的原文（不碰就不改）。
    entries.push({
      block: container(schema.nodes.paragraph.create()),
      range: { start: 0, end: lines.length, children: [] },
    })
  }
  entries.sort((a, b) => a.range.start - b.range.start)

  // 一行区间 [a,b) 的原文：`lines.slice(a,b).join('\n')` 缺了接下一块的那个换行，补回来（b 到文件尾就不补）。
  const chunkOf = (a: number, b: number): string =>
    lines.slice(a, b).join('\n') + (b < lines.length ? '\n' : '')

  const side = new Map<string, SideEntry>()
  const starts = new Set<number>()
  const dupStart = new Set<number>()
  for (const e of entries) {
    if (starts.has(e.range.start)) dupStart.add(e.range.start)
    starts.add(e.range.start)
  }
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]
    // 行区间重叠（一个 token 拆成多块）/ 拿不到区间 → 不记原文，保存时序列化降级（安全）。
    if (e.range.start < 0 || dupStart.has(e.range.start)) continue
    const from = i === 0 ? 0 : e.range.start
    const to = i + 1 < entries.length ? entries[i + 1].range.start : lines.length
    const id = String(e.block.attrs.id ?? '')
    if (id && to > from) side.set(id, { chunk: chunkOf(from, to), snapshot: '' })
  }

  const doc = schema.nodes.doc.create(
    { title: '' },
    schema.nodes.blockGroup.create(null, entries.map((e) => e.block)),
  )
  // 快照取**建好的 doc 上**的节点（编辑器手里就是它），别拿中间产物 —— 有归一化的可能。
  doc.firstChild?.forEach((block) => {
    const entry = side.get(String(block.attrs.id ?? ''))
    if (entry) entry.snapshot = JSON.stringify(block.toJSON())
  })
  return { doc, side }
}

/* ─────────────────────────── 序列化：块树 → markdown ─────────────────────────── */

const blobUrl = (id: string): string => BLOB_PREFIX + id

/** 有序列表的序号：往前数连续的 numberedListItem（跟 PM 的 render(node, parent, index) 那条对齐）。 */
function numberedAt(parent: PMNode, index: number): number {
  let n = 1
  for (let i = index - 1; i >= 0; i--) {
    const content = parent.child(i).firstChild
    if (!content || content.type.name !== 'numberedListItem') break
    n++
  }
  return n
}

/** 渲染一个块的内容节点。列表 / 待办的标记由 blockContainer 先写，这里只管内容。 */
function renderContent(state: MarkdownSerializerState, node: PMNode): void {
  switch (node.type.name) {
    case 'heading':
      state.write(`${'#'.repeat(Number(node.attrs.level) || 1)} `)
      state.renderInline(node)
      state.closeBlock(node)
      return
    case 'codeBlock':
      state.write(`\`\`\`${String(node.attrs.language ?? '')}\n`)
      state.text(node.textContent, false)
      state.write('\n```')
      state.closeBlock(node)
      return
    case 'divider':
      state.write('---')
      state.closeBlock(node)
      return
    case 'image':
      state.write(`![](${blobUrl(String(node.attrs.blobId ?? ''))})`)
      state.closeBlock(node)
      return
    case 'quote':
    case 'callout':
      state.wrapBlock('> ', '> ', node, () => state.renderInline(node))
      return
    // 块级公式用 `$$…$$`；tex 原样写，别转义。
    case 'equation':
      state.write('$$\n')
      state.text(String(node.attrs.tex ?? ''), false)
      state.write('\n$$')
      state.closeBlock(node)
      return
    // 子页面 / 媒体：markdown 里能落成链接就落，别让 docId / blobId 凭空消失。
    case 'subpage':
      state.write(`[${String(node.attrs.docId ?? '') || 'subpage'}](${DOC_PREFIX}${String(node.attrs.docId ?? '')})`)
      state.closeBlock(node)
      return
    case 'video':
    case 'audio':
      state.write(`![${String(node.attrs.name ?? '')}](${blobUrl(String(node.attrs.blobId ?? ''))})`)
      state.closeBlock(node)
      return
    case 'file':
      state.write(`[${String(node.attrs.name ?? '') || 'file'}](${blobUrl(String(node.attrs.blobId ?? ''))})`)
      state.closeBlock(node)
      return
    // 目录 / 面包屑是现算的页面元素，markdown 里没有对应写法 —— ignore（不 throw、不写占位）。
    case 'tableOfContents':
    case 'breadcrumb':
      return
    // markdown 没有分栏 —— 拍平：各列内容前后相接。
    case 'columnList':
      state.renderContent(node)
      state.closeBlock(node)
      return
    default:
      state.renderInline(node)
      state.closeBlock(node)
  }
}

/** 一个块：写标记 → 渲染内容 → children 缩进两级（markdown 的嵌套就是这么表示的）。 */
function renderBlock(state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number): void {
  const content = node.firstChild
  if (!content) return
  switch (content.type.name) {
    case 'bulletedListItem':
    case 'toggle':
      state.write('- ')
      break
    case 'numberedListItem':
      state.write(`${numberedAt(parent, index)}. `)
      break
    case 'todoItem':
      state.write(content.attrs.checked ? '- [x] ' : '- [ ] ')
      break
  }
  renderContent(state, content)
  const last = node.lastChild
  if (node.childCount > 1 && last && last.type.name === 'blockGroup') {
    state.wrapBlock('  ', null, node, () => state.renderContent(last))
  }
}

const serializer = new MarkdownSerializer(
  {
    // 根不用 handler —— `serialize()` 渲染的是**根的子节点**，根自己那个函数不会被调。
    blockGroup: (state, node) => state.renderContent(node),
    blockContainer: (state, node, parent, index) => renderBlock(state, node, parent, index),
    // 「看不懂的整块」：原文照写（正常走 side table 的原文，这里是新块 / 被拖走后的兜底）。
    rawBlock: (state, node) => {
      state.write(String(node.attrs.text ?? ''))
      state.closeBlock(node)
    },
    paragraph: (state, node) => {
      state.renderInline(node)
      state.closeBlock(node)
    },
    // 列的内容是 blockGroup —— 直接拍平（markdown 没有分栏）。
    column: (state, node) => state.renderContent(node),
    // 行内原子：renderInline 会对每个子节点调 render，这里得给它们出路，否则整块被丢。
    mention: (state, node) => {
      const id = String(node.attrs.docId ?? '')
      state.write(`[${id || '@'}](${DOC_PREFIX}${id})`)
    },
    inlineEquation: (state, node) => state.write(`$${String(node.attrs.tex ?? '')}$`),
    // `renderInline` 会连 text 也走一遍 render（不是内置处理）—— 少了它就 throw。
    text: (state, node) => state.text(node.text ?? ''),
  },
  {
    bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    code: { open: '`', close: '`', escape: false },
    link: { open: () => '[', close: (_state, mark) => `](${String(mark.attrs.href ?? '')})`, mixable: true },
    // markdown 没有下划线 / 背景色 / 字色的写法 —— 投影里丢掉样式，字不丢（`DocHandle.md` 只喂搜索）。
    underline: { open: '', close: '' },
    highlight: { open: '', close: '' },
    textColor: { open: '', close: '' },
  },
  // 认不出的节点降级成它的内容，别让一次投影失败把整段 markdown 变成空串。
  { strict: false },
)

/** 整篇 doc → markdown（喂 `DocHandle.md`）。序列化失败不能让落库也失败 —— 退化成空投影。 */
export function docToMarkdown(doc: PMNode): string {
  try {
    return serializer.serialize(doc, { tightLists: true })
  } catch (err) {
    reportError('editor-prosemirror', err)
    return ''
  }
}

/** 单块的 markdown —— 变过的块 / 新块走这条（`serialize` 渲染的是根的子节点，所以包一层 blockGroup）。 */
function serializeBlock(block: PMNode): string {
  const one = schema.nodes.blockGroup.create(null, block)
  return serializer.serialize(one, { tightLists: true }).replace(/\s+$/, '')
}

/**
 * 外部文件那条路：整篇 → markdown，**保真**（D-0139 / D-0141）。
 * 逐块和「打开那一刻的快照」比：没变 → 写回原文（byte 原样），变过 / 新块 → 序列化；
 * 顺序按当前块序拼，被删的块那段原文跟着消失。快照对不上就序列化（安全降级）。
 */
export function docToMarkdownFidelity(doc: PMNode, side: ReadonlyMap<string, SideEntry>): string {
  try {
    const root = doc.firstChild
    if (!root) return ''
    const total = root.childCount
    let out = ''
    for (let i = 0; i < total; i += 1) {
      const block = root.child(i)
      const entry = side.get(String(block.attrs.id ?? ''))
      if (entry && entry.snapshot === JSON.stringify(block.toJSON())) {
        out += entry.chunk
        continue
      }
      // 变过的块丢了它原来的尾随空行，自己补一个分隔（最后一块只补一个换行）。
      out += serializeBlock(block) + (i === total - 1 ? '\n' : '\n\n')
    }
    return out
  } catch (err) {
    reportError('editor-prosemirror', err)
    return ''
  }
}
