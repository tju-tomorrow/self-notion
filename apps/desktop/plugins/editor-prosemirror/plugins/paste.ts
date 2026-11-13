/**
 * ⌘V —— 抢两样东西，其余放行给 PM 默认（契约 `docs/paste.md`）。
 *
 * 1. **剪贴板里是文件**：PM 默认只看 `text/html` / `text/plain`，一张图会整个丢掉。
 *    这类存进库（`putBlob`）、在当前块处插 image / file 块。
 * 2. **不带 HTML 的纯文本，且像 markdown**：解成真结构（标题 / 引用 / 列表 / 围栏）。
 *    PM 只会原样吐文本，而解析器我们本来就有（导入那条路在用）。
 *
 * 带 `text/html` 的、跨文档贴的块 —— 全交回 PM，它自己那套比我们写得好。
 * 旧插件那一大坨调度（`editor-blocksuite/paste.ts`）不用搬。
 */
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model'
import { Plugin, Selection, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { putBlob } from '../blob'
import { blocksFromHtml, blocksFromMarkdown, prepPastedHtml, splitMathFragment } from '../serializers/markdown'
import { newBlockId } from '../commands'
import { blockAt, type BlockRef } from '../commands/block'
import { schema } from '../schema'
import { findBlock } from './block-selection'

/** 一个待插入的来源（剪贴板里的文件 / HTML 里的 data: URL）—— 都收敛成「能 load 出一个 Blob」。 */
interface Source {
  load: () => Promise<Blob>
  name: string
  image: boolean
}

/** 落点：`from..to` 是要换掉的那一段（纯插入时 `from === to`）。 */
interface Targets {
  from: number
  to: number
  /** 顶掉了一个空段落 —— 插完得补一个空块垫底，不然图后面没地方落光标。 */
  replace: boolean
}

export interface PasteWiring {
  docId: string
  /** 剪切粘贴 / 移动拖放：把该文档的 `parent_id` 挪到这一篇下面。 */
  moveSubpage?(childId: string, parentId: string): void
  /** 复制粘贴：深拷一份新页面，返回新 id（卡片随后改指它）。 */
  duplicateSubpage?(sourceId: string, parentId: string): Promise<string | null>
}

/** 「刚才剪切的是哪几张卡」—— copy / cut 都是系统剪贴板，区分不开，只能自己记一笔。 */
const CUT_KEY = 'sn-subpage-cut'
const CUT_TTL = 120_000

function recordCut(ids: readonly string[]): void {
  if (ids.length === 0) return
  try {
    localStorage.setItem(CUT_KEY, JSON.stringify({ ids, at: Date.now() }))
  } catch {
    // 私密模式 / 配额满：退化成「当复制处理」
  }
}

function clearCut(): void {
  try {
    localStorage.removeItem(CUT_KEY)
  } catch {
    // 同上
  }
}

/** 剪贴板里这几张卡是不是刚被剪切过 —— 是的话清掉记录（一次剪切只认一次粘贴）。 */
function takeCut(ids: readonly string[]): boolean {
  try {
    const raw = localStorage.getItem(CUT_KEY)
    if (!raw) return false
    const v = JSON.parse(raw) as { ids?: unknown; at?: unknown }
    const saved = Array.isArray(v.ids) ? v.ids.map(String) : []
    const at = typeof v.at === 'number' ? v.at : 0
    const ok = saved.length > 0 && Date.now() - at < CUT_TTL && ids.every((id) => saved.includes(id))
    if (ok) clearCut()
    return ok
  } catch {
    return false
  }
}

function subpageIds(frag: Fragment): string[] {
  const out: string[] = []
  frag.descendants((node) => {
    if (node.type.name !== 'subpage') return
    const id = String(node.attrs.docId ?? '')
    if (id !== '') out.push(id)
  })
  return out
}

interface CardRef {
  blockId: string
  docId: string
}

/** 正文里所有 subpage 卡片（块 id + 指向的文档 id）。 */
function cardsIn(doc: PMNode): CardRef[] {
  const out: CardRef[] = []
  doc.descendants((node) => {
    if (node.type.name !== 'blockContainer') return
    const first = node.firstChild
    if (first?.type.name !== 'subpage') return
    out.push({ blockId: String(node.attrs.id ?? ''), docId: String(first.attrs.docId ?? '') })
  })
  return out
}

export function pastePlugin(wire: PasteWiring): Plugin {
  const docId = wire.docId
  /** 剪切 / 移动：把库里那条文档的 `parent_id` 挪到这一篇下面（面包屑和侧栏读它）。 */
  const adopt = (frag: Fragment): void => {
    if (!wire.moveSubpage) return
    for (const child of subpageIds(frag)) {
      if (child !== docId) wire.moveSubpage(child, docId)
    }
  }

  /** 复制粘贴：卡片已经插进去了，页面的深拷贝回来后再把卡片改指新页面。 */
  const copyCards = (view: EditorView, ids: readonly string[], before: ReadonlySet<string>): void => {
    if (!wire.duplicateSubpage) return
    const fresh = cardsIn(view.state.doc).filter((c) => !before.has(c.blockId) && ids.includes(c.docId))
    if (fresh.length === 0) return
    void (async () => {
      const made = new Map<string, string>()
      for (const oldId of new Set(ids)) {
        const created = await wire.duplicateSubpage?.(oldId, docId)
        if (created) made.set(oldId, created)
      }
      if (made.size === 0) return
      const tr = view.state.tr
      for (const card of fresh) {
        const next = made.get(card.docId)
        const hit = findBlock(view.state.doc, card.blockId)
        if (next && hit) tr.setNodeMarkup(hit.at + 1, undefined, { docId: next })
      }
      if (tr.docChanged) view.dispatch(tr)
    })()
  }

  const insertSlice = (view: EditorView, slice: Slice): void => {
    view.dispatch(
      view.state.tr
        .replaceSelection(slice)
        .scrollIntoView()
        .setMeta('paste', true)
        .setMeta('uiEvent', 'paste'),
    )
  }

  return new Plugin({
    props: {
      // 剪切要记一笔：粘贴时才能分清「移动」和「复制」（剪贴板本身不带这个信息）。
      handleDOMEvents: {
        cut: (view) => {
          const sel = view.state.selection
          const ids: string[] = []
          view.state.doc.nodesBetween(sel.from, sel.to, (node) => {
            if (node.type.name === 'subpage') {
              const id = String(node.attrs.docId ?? '')
              if (id !== '') ids.push(id)
            }
          })
          recordCut(ids)
          return false
        },
        copy: () => {
          clearCut()
          return false
        },
      },
      // 跨文档贴块走 PM 默认那一路（我们不拦文本 / HTML），但它会**带着原块 id** ——
      // 插进来就是两个同 id 的块，评论锚点 / 拖拽定位 / `metaOf` 对齐全乱（架构 §3.1）。
      // 这条钩子是 PM 自己调的（`parseFromClipboard` 末尾），所以 PM 默认那条路也管得住。
      // ★ 内部拖拽也走这条钩子：**移动**时源块同时被删、id 得留着（评论锚点跟着块走）；
      //   只有「非移动」（真粘贴 / 复制 / 外部拖入）才换新。`view.dragging.move` 就是 PM 说的
      //   「移动 vs 复制」（见 `prosemirror-view` 的 `dragging` 类型注释）。
      transformPasted: (slice, view) =>
        withMath(view.dragging?.move === true ? slice : freshIds(slice), view),
      // PM 自己解 HTML 的那条路（没列表的网页内容）：同样先摘空气块、把代码块语言归位。
      transformPastedHTML: (html) => prepPastedHtml(html),
      // 应用内拖放不走 `transformPasted`：移动就改父级，按住 ⌥ 复制就走「深拷一份新页面」。
      handleDrop: (view, _event, slice, moved) => {
        const ids = subpageIds(slice.content)
        if (ids.length === 0) return false
        if (moved) {
          adopt(slice.content)
          return false
        }
        const before = new Set(cardsIn(view.state.doc).map((c) => c.blockId))
        insertSlice(view, slice)
        copyCards(view, ids, before)
        return true
      },
      handlePaste: (view, event, slice) => {
        const data = event.clipboardData
        if (!data) return false

        // subpage 卡片：剪切 = 挪父级（交给 PM 插），复制 = 深拷一份新页面再改指向。
        const ids = subpageIds(slice.content)
        if (ids.length > 0) {
          if (takeCut(ids)) {
            adopt(slice.content)
            return false
          }
          const before = new Set(cardsIn(view.state.doc).map((c) => c.blockId))
          insertSlice(view, slice)
          copyCards(view, ids, before)
          return true
        }

        const html = data.getData('text/html')
        const files = Array.from(data.files)
        const sources = files.length
          ? files.map(sourceOfFile)
          : imageOnlyHtml(html).map(sourceOfDataUrl)

        if (sources.length === 0) {
          // 带列表的 HTML 自己解：`<li>` 里放 `<p>` 时 PM 会把段落甩到列表项外面（一条列表散成空条目 + 段落）。
          // 表格不抢 —— 那份 HTML 里表格的形状我们这边解不出来。
          if (html && /<(?:ol|ul)[\s>]/i.test(html) && !/<table[\s>]/i.test(html)) {
            const fromHtml = blocksFromHtml(html)
            if (fromHtml) {
              insertBlocks(view, fromHtml)
              return true
            }
          }
          // 其余带 HTML 的一律让路：那份 HTML 才是原格式，`text/plain` 只是它的降级版（契约 P2）。
          if (html) return false
          const text = data.getData('text/plain')
          // 选中文字后粘一个网址 = 给这段文字加链接（Notion 同款）。
          if (linkOverSelection(view, text)) return true
          const blocks = markdownBlocks(text)
          // 不像 markdown → 照旧交回 PM。
          if (!blocks) return false
          insertBlocks(view, blocks)
          return true
        }

        const targets = targetsFor(view)
        if (!targets) return false

        // 落点**现在**算：上传是异步的，等回来时选区早就变了。
        void insert(view, targets, sources).catch((err: unknown) => reportError('paste', err))
        return true
      },
    },
  })
}

/** 剪贴板里只有一个网址、而且正选着字 → 给这段字加 link。 */
function linkOverSelection(view: EditorView, text: string): boolean {
  const sel = view.state.selection
  if (!(sel instanceof TextSelection) || sel.empty) return false
  const url = text.trim()
  if (!/^(?:https?:\/\/|www\.)\S+$/.test(url)) return false
  const href = url.startsWith('www.') ? `https://${url}` : url
  view.dispatch(view.state.tr.addMark(sel.from, sel.to, schema.marks.link.create({ href })))
  return true
}

async function insert(view: EditorView, targets: Targets, sources: Source[]): Promise<void> {
  const blocks: PMNode[] = []
  for (const src of sources) {
    try {
      const blobId = await putBlob(await src.load())
      const content = src.image
        ? schema.nodes.image.create({ blobId })
        : schema.nodes.file.create({ blobId, name: src.name })
      blocks.push(schema.nodes.blockContainer.create({ id: newBlockId() }, content))
    } catch (err) {
      reportError('paste', err)
    }
  }
  if (blocks.length === 0) return

  if (targets.replace) blocks.push(emptyParagraphBlock())

  const total = blocks.reduce((n, b) => n + b.nodeSize, 0)
  const tr = view.state.tr.replaceWith(targets.from, targets.to, blocks)
  tr.setSelection(Selection.near(tr.doc.resolve(targets.from + total), 1))
  view.dispatch(tr.scrollIntoView().setMeta('paste', true))
}

/** 行首的块级标记 / 行内的成对标记 —— 见一个就当 markdown（口径「看到就转」，契约 P1）。 */
const BLOCK_MARKER = /^[ \t]{0,3}(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~|\|)/m
const INLINE_MARKER = /\*\*|__|~~|`|\]\(/

function markdownBlocks(text: string): PMNode[] | null {
  if (text.trim() === '') return null
  if (!BLOCK_MARKER.test(text) && !INLINE_MARKER.test(text)) return null
  return blocksFromMarkdown(text)
}

/** markdown 解出来的那几块直接落 —— 全是新块，id 得换新（同 `freshIds` 的道理，契约 P4）。 */
function insertBlocks(view: EditorView, blocks: PMNode[]): void {
  const targets = targetsFor(view)
  if (!targets) return
  const list = targets.replace ? [...blocks, emptyParagraphBlock()] : blocks
  const content = replaceIds(Fragment.fromArray(list))
  const total = content.size
  const tr = view.state.tr.replaceWith(targets.from, targets.to, content)
  tr.setSelection(Selection.near(tr.doc.resolve(targets.from + total), 1))
  view.dispatch(tr.scrollIntoView().setMeta('paste', true))
}

/** 光标所在的块还是个空段落 → 顶掉它；不然插在它后面（跟 Notion 一致）。 */
function targetsFor(view: EditorView): Targets | null {
  const block = blockAt(view.state.selection.$from) ?? lastTopBlock(view.state.doc)
  if (!block) return null
  const after = block.pos + block.node.nodeSize
  const empty = block.content.type === schema.nodes.paragraph && block.content.content.size === 0
  return empty
    ? { from: block.pos, to: after, replace: true }
    : { from: after, to: after, replace: false }
}

/** ⌘A / 光标落在块外面时的兜底：挂到最后一个顶级块后面，总比把图吞掉强。 */
function lastTopBlock(doc: PMNode): BlockRef | null {
  const group = doc.firstChild
  if (!group || group.childCount === 0) return null
  const node = group.lastChild
  if (!node) return null
  return { node, depth: 2, pos: 1 + (group.content.size - node.nodeSize), content: node.child(0) }
}

function emptyParagraphBlock(): PMNode {
  return schema.nodes.blockContainer.create({ id: newBlockId() }, schema.nodes.paragraph.create())
}

function sourceOfFile(file: File): Source {
  return { load: () => Promise.resolve(file), name: file.name, image: file.type.startsWith('image/') }
}

/** 网页复制的图常常是 data: URL 的 `<img>`，schema 的 image parseDOM 不认它 —— 不落库就会丢。 */
function sourceOfDataUrl(url: string): Source {
  return { load: () => fetch(url).then((r) => r.blob()), name: '', image: true }
}

/** 只有 HTML 里**没别的文字**时才抠 data: URL 的图 —— 有文字就让给 PM，抢过来只会把那段文字吞掉。 */
function imageOnlyHtml(html: string): string[] {
  if (!html) return []
  const body = new DOMParser().parseFromString(html, 'text/html').body
  if (body.textContent?.trim()) return []
  return Array.from(body.querySelectorAll('img'))
    .map((img) => img.getAttribute('src') ?? '')
    .filter((src) => src.startsWith('data:image/'))
}

/** 网页复制出来的公式是原样 TeX（`$1024 \times 1024$`）—— PM 默认那条路也得落成公式节点。 */
function withMath(slice: Slice, view: EditorView): Slice {
  // 粘进代码块就是要原样，别把代码里的 `$` 拆了。
  if (view.state.selection.$from.parent.type.spec.code) return slice
  const content = splitMathFragment(slice.content)
  return new Slice(content, slice.openStart, slice.openEnd)
}

/** 把 slice 里所有 `blockContainer` 的 id 换新 —— 复制一份出来不该跟原件撞 id。 */
function freshIds(slice: Slice): Slice {
  return new Slice(replaceIds(slice.content), slice.openStart, slice.openEnd)
}

function replaceIds(frag: Fragment): Fragment {
  const out: PMNode[] = []
  frag.forEach((node) => out.push(replaceId(node)))
  return Fragment.fromArray(out)
}

function replaceId(node: PMNode): PMNode {
  // 文本没有 attrs、也不含块 —— 原样带上（也躲开 `TextNode.create` 跟 `NodeType.create` 不同的签名）。
  if (node.isText) return node
  const content = node.content.size > 0 ? replaceIds(node.content) : node.content
  const attrs =
    node.type === schema.nodes.blockContainer ? { ...node.attrs, id: newBlockId() } : node.attrs
  return node.type.create(attrs, content, node.marks)
}
