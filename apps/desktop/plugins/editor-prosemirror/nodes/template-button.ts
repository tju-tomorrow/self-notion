/**
 * `templateButton` 的 NodeView —— 点一下把那篇模板文档的块**拷一份**插到本块后面（D-0136：模板就是文档）。
 *
 * ★ 拷一份 ≠ 引用：每个块都换新 id —— 同一篇复制两份带同一个 id 会毁掉评论锚点 / 拖拽定位（P2-6 踩过）。
 * ★ 按钮上的字**现读 `metaOf(docId)` 的标题** —— `label` 一般留空，模板改了名按钮上的字跟着变。
 * ★ 插入点按**按钮所在块的 id** 找回（点 DOM 时选区可能不在按钮这儿）—— 跟斜杠菜单填子页面同一套。
 */
import type { Node as PMNode } from 'prosemirror-model'
import { Fragment } from 'prosemirror-model'
import { Selection } from 'prosemirror-state'
import type { EditorView, NodeViewConstructor } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { newBlockId } from '../commands'
import { contentOf, metaOf, subscribe } from '../doc-meta'
import { schema } from '../schema'
import { asString } from './attrs'
import './template-button.css'

export const templateButtonView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div')
  dom.className = 'sn-template'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'sn-template-btn'
  const icon = document.createElement('span')
  icon.className = 'sn-template-icon'
  icon.textContent = '⧉'
  const text = document.createElement('span')
  text.className = 'sn-template-text'
  const hint = document.createElement('span')
  hint.className = 'sn-template-hint'
  btn.append(icon, text)
  dom.append(btn, hint)

  let n = node
  let docId = ''

  const paint = () => {
    docId = asString(n.attrs.docId)
    dom.dataset.docId = docId
    const label = asString(n.attrs.label)
    const meta = docId ? metaOf(docId) : undefined
    // 空 docId = 还没选模板（选完回填）；有 docId 但拿不到 meta = 目标页删了。
    dom.dataset.state = !docId ? 'empty' : meta ? 'ready' : 'missing'
    text.textContent = !docId
      ? label || '模板按钮'
      : meta
        ? label || meta.title || '无标题'
        : label || '已删除的模板'
  }
  paint()
  const off = subscribe(paint)

  /** 按钮所在 blockContainer 的 id —— 异步读模板回来时按它找回插入位置。 */
  const hostId = (): string => {
    const pos = getPos()
    if (typeof pos !== 'number') return ''
    const $pos = view.state.doc.resolve(pos)
    const parent = $pos.node($pos.depth)
    return parent.type.name === 'blockContainer' ? asString(parent.attrs.id) : ''
  }

  const fail = (msg: string): void => {
    dom.dataset.state = 'missing'
    hint.textContent = msg
  }

  btn.addEventListener('click', () => {
    if (!docId) return
    const host = hostId()
    void (async () => {
      try {
        const raw = await contentOf(docId)
        if (raw === null) return fail('模板已删除')
        const blocks = copyBlocks(raw)
        if (blocks === null) return fail('模板内容读不出来')
        if (blocks.length === 0 || !host) return
        insertAfterBlock(view, host, blocks)
        hint.textContent = ''
      } catch (err) {
        reportError('template-button', err)
        fail('模板读不出来')
      }
    })()
  })

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type) return false
      n = next
      hint.textContent = ''
      paint()
      return true
    },
    // 整块归我们管（atom 没有可编辑内容），PM 别接管它的点击 / 变更。
    stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
    ignoreMutation: () => true,
    destroy: off,
  }
}

/** 模板正文 JSON → 一组 blockContainer（已换新 id）。坏字节 → null，空文档 → []。 */
function copyBlocks(raw: string): PMNode[] | null {
  if (raw.trim() === '') return []
  let doc: PMNode
  try {
    doc = schema.nodeFromJSON(JSON.parse(raw))
  } catch (err) {
    reportError('template-button', err)
    return null
  }
  const group = doc.firstChild
  if (!group) return []
  const out: PMNode[] = []
  for (let i = 0; i < group.childCount; i++) out.push(reid(group.child(i)))
  return out
}

/** 递归重建一棵块子树，`blockContainer` 的 id 换新 —— 复制一份不该跟原件撞 id（架构 §3.1）。 */
function reid(node: PMNode): PMNode {
  if (node.isText) return node
  const kids: PMNode[] = []
  node.forEach((child) => kids.push(reid(child)))
  const content = kids.length ? Fragment.fromArray(kids) : node.content
  const attrs =
    node.type === schema.nodes.blockContainer ? { ...node.attrs, id: newBlockId() } : node.attrs
  return node.type.create(attrs, content, node.marks)
}

/** 把拷来的块插到 host 这个 blockContainer 后面 —— 按块 id 找位置，不吃点 DOM 后的选区。 */
function insertAfterBlock(view: EditorView, containerId: string, blocks: readonly PMNode[]): void {
  let at: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (at !== null) return false
    if (node.type.name === 'blockContainer' && node.attrs.id === containerId) {
      at = pos + node.nodeSize
      return false
    }
    return true
  })
  if (at === null) return
  const tr = view.state.tr.insert(at, blocks)
  tr.setSelection(Selection.near(tr.doc.resolve(at + 1), 1))
  view.dispatch(tr.scrollIntoView())
  view.focus()
}
