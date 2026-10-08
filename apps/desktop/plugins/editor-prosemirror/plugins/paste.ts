/**
 * ⌘V —— **只接文件**，其余（纯文本 / HTML / 跨文档的块）全放行给 PM 默认。
 *
 * PM 自带富文本和块的粘贴，我们自己写不出更好的；唯独「剪贴板里是文件」它不认 ——
 * 默认 parse 只看 `text/html` / `text/plain`，一张图会整个丢掉。所以这里只抢「有文件」那一类：
 * 存进库（`putBlob`）、在当前块处插 image / file 块。旧插件那一大坨调度（`editor-blocksuite/paste.ts`）不用搬。
 */
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model'
import { Plugin, Selection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { putBlob } from '../blob'
import { newBlockId } from '../commands'
import { blockAt, type BlockRef } from '../commands/block'
import { schema } from '../schema'

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

export function pastePlugin(): Plugin {
  return new Plugin({
    props: {
      // 跨文档贴块走 PM 默认那一路（我们不拦文本 / HTML），但它会**带着原块 id** ——
      // 插进来就是两个同 id 的块，评论锚点 / 拖拽定位 / `metaOf` 对齐全乱（架构 §3.1）。
      // 这条钩子是 PM 自己调的（`parseFromClipboard` 末尾），所以 PM 默认那条路也管得住。
      // ★ 内部拖拽也走这条钩子：**移动**时源块同时被删、id 得留着（评论锚点跟着块走）；
      //   只有「非移动」（真粘贴 / 复制 / 外部拖入）才换新。`view.dragging.move` 就是 PM 说的
      //   「移动 vs 复制」（见 `prosemirror-view` 的 `dragging` 类型注释）。
      transformPasted: (slice, view) => (view.dragging?.move === true ? slice : freshIds(slice)),
      handlePaste: (view, event) => {
        const data = event.clipboardData
        if (!data) return false

        const files = Array.from(data.files)
        const sources = files.length
          ? files.map(sourceOfFile)
          : imageOnlyHtml(data.getData('text/html')).map(sourceOfDataUrl)
        // 纯文本 / HTML / 块 → 交回 PM 默认。
        if (sources.length === 0) return false

        const targets = targetsFor(view)
        if (!targets) return false

        // 落点**现在**算：上传是异步的，等回来时选区早就变了。
        void insert(view, targets, sources).catch((err: unknown) => reportError('paste', err))
        return true
      },
    },
  })
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
