/**
 * 图片插入的唯一入口（D-0199）：占位 → 选文件 → 压缩 → 上传 → 回填 blobId。
 * 块手柄菜单 / slash / FAB 都只调 insertImageAt。
 */
import type { Node as PMNode } from 'prosemirror-model'
import { TextSelection, type EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { putBlob } from '../blob'
import { blockAt } from '../commands/block'
import { newBlockId } from '../commands/id'
import { bodyEnd, isTrailingEmpty } from './trailing-block'

type Opts = { afterBlockId?: string; fillBlockId?: string }

interface Placement {
  id: string
  mode: 'fill' | 'insert'
}

const MAX_BYTES = 1.2 * 1024 * 1024
const MAX_EDGE = 2000

function findBlock(doc: PMNode, id: string): { pos: number; node: PMNode } | null {
  let found: { pos: number; node: PMNode } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'blockContainer' && String(node.attrs.id) === id) {
      found = { pos, node }
      return false
    }
    return true
  })
  return found
}

function placeImage(view: EditorView, o: Opts): Placement | null {
  const state: EditorState = view.state
  const { schema } = state
  const imageType = schema.nodes.image
  const containerType = schema.nodes.blockContainer
  if (!imageType || !containerType) return null
  const image = imageType.create({ blobId: '' })
  const tr = state.tr
  let placement: Placement

  if (o.fillBlockId) {
    const found = findBlock(state.doc, o.fillBlockId)
    if (!found || found.node.childCount === 0) return null
    const start = found.pos + 1
    tr.replaceWith(start, start + found.node.child(0).nodeSize, image)
    placement = { id: o.fillBlockId, mode: 'fill' }
  } else {
    const ref = o.afterBlockId ? findBlock(state.doc, o.afterBlockId) : blockAt(state.selection.$from)
    const at = ref ? ref.pos + ref.node.nodeSize : bodyEnd(state.doc)
    const id = newBlockId()
    tr.insert(at, containerType.create({ id }, image))
    placement = { id, mode: 'insert' }
  }

  const placed = findBlock(tr.doc, placement.id)
  if (placed) {
    const at = placed.pos + placed.node.nodeSize
    // 图片是 atom；补一个空段落垫底，也保证文档里始终有能落光标的 textblock。
    if (!isTrailingEmpty(tr.doc.resolve(at).nodeAfter)) {
      const para = schema.nodes.paragraph.createAndFill()
      if (para) tr.insert(at, schema.nodes.blockContainer.create({ id: newBlockId() }, para))
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2), 1))
  }
  tr.scrollIntoView()
  view.dispatch(tr)
  return placement
}

function revert(view: EditorView, p: Placement): void {
  const found = findBlock(view.state.doc, p.id)
  if (!found || found.node.childCount === 0) return
  if (p.mode === 'fill') {
    const start = found.pos + 1
    const para = view.state.schema.nodes.paragraph.createAndFill()
    if (!para) return
    view.dispatch(view.state.tr.replaceWith(start, start + found.node.child(0).nodeSize, para))
  } else {
    view.dispatch(view.state.tr.delete(found.pos, found.pos + found.node.nodeSize))
  }
}

function fillBlobId(view: EditorView, id: string, blobId: string): void {
  const found = findBlock(view.state.doc, id)
  if (!found || found.node.childCount === 0) return
  const at = found.pos + 1
  const node = view.state.doc.nodeAt(at)
  if (!node || node.type.name !== 'image') return
  view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, blobId }))
}

/** 图片是 atom，下面补一个空段落让光标有地方落。 */
function addTrailingParagraph(view: EditorView, id: string): void {
  const found = findBlock(view.state.doc, id)
  if (!found) return
  const { schema } = view.state
  const at = found.pos + found.node.nodeSize
  if (isTrailingEmpty(view.state.doc.resolve(at).nodeAfter)) return
  const para = schema.nodes.paragraph.createAndFill()
  if (!para) return
  const empty = schema.nodes.blockContainer.create({ id: newBlockId() }, para)
  const tr = view.state.tr.insert(at, empty)
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2), 1))
  view.dispatch(tr)
}

function chooseImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    // 藏到视口外，比 display:none 在 iOS 上更稳
    input.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;opacity:0'
    document.body.appendChild(input)
    let settled = false
    let timer = 0
    function settle(file: File | null): void {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(file)
    }
    function onFocus(): void {
      window.clearTimeout(timer)
      // 老浏览器取消文件框不派发 change，焦点回来兜一手
      timer = window.setTimeout(() => settle(null), 1000)
    }
    input.addEventListener('change', () => settle(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => settle(null))
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

async function prepare(file: File): Promise<Blob> {
  if (/gif|svg/i.test(file.type) || /\.(gif|svg)$/i.test(file.name)) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // 解不了就原样传
    return file
  }
  const long = Math.max(bitmap.width, bitmap.height)
  if (file.size <= MAX_BYTES && long <= MAX_EDGE) {
    bitmap.close()
    return file
  }
  const scale = Math.min(1, MAX_EDGE / long)
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  // JPEG 没有透明通道，先铺白底免得透明 PNG 变黑块
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  return out ?? file
}

async function finish(view: EditorView, p: Placement, file: File | null): Promise<void> {
  if (!file) {
    revert(view, p)
    return
  }
  try {
    const blob = await prepare(file)
    const blobId = await putBlob(blob)
    fillBlobId(view, p.id, blobId)
    addTrailingParagraph(view, p.id)
  } catch (err) {
    reportError('editor-prosemirror', err)
    revert(view, p)
  }
}

// 第一签是冻结接口；第二签兼容 docs/mobile-optimize.md 里的位置参数写法（A1 的块菜单可能照那条写）。
export function insertImageAt(
  view: EditorView,
  opts?: { afterBlockId?: string; fillBlockId?: string },
): Promise<void>
export function insertImageAt(view: EditorView, afterBlockId?: string): Promise<void>
export function insertImageAt(view: EditorView, opts?: Opts | string): Promise<void> {
  const o: Opts = typeof opts === 'string' ? { afterBlockId: opts } : opts ?? {}
  const p = placeImage(view, o)
  if (!p) return Promise.resolve()
  // input.click 必须留在点击手势里同步跑，不能挪到 await 之后
  return chooseImage()
    .then((file) => finish(view, p, file))
    .catch((err: unknown) => reportError('editor-prosemirror', err))
}
