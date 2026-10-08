/**
 * `syncedBlock` 的 NodeView —— 引用式同步块：节点只存 `srcId`，内容在源里（`../sync`）。
 * 就地可编辑 = 架构 §5 的变通 A：挂一个小的 PM 编辑器，改完失焦把整份 JSON `put` 回源。
 *
 * ★ 边界：小编辑器的编辑**只写回源**，不进主文档、也不进主文档的撤销栈 —— 内容本来就不在
 *   主文档里（节点是 atom）。源的编辑在源那一侧可撤销，主文档的 ⌘Z 管不到同步块里的字。
 *   `stopEvent` 必须挡住主编辑器，否则同步块里的按键会被当成在编辑正文（Backspace 会删块）。
 */
import { baseKeymap } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { EditorView, type NodeViewConstructor } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { schema } from '../schema'
import { asString } from './attrs'
import { getSrc, putSrc, subscribeSrc } from '../sync'
import './synced-block.css'

/** 新块的 id —— 跟 editor.ts / slash.ts 同名同形，这层不 import 编辑器。 */
function blockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** 刚建的源是空的 —— 给一行空段落，小编辑器才有地方落光标。 */
function emptyDoc(): PMNode {
  return schema.nodeFromJSON({
    type: 'doc',
    content: [
      {
        type: 'blockGroup',
        content: [{ type: 'blockContainer', attrs: { id: blockId() }, content: [{ type: 'paragraph' }] }],
      },
    ],
  })
}

function parseContent(raw: string): PMNode | null {
  if (raw.trim() === '') return emptyDoc()
  try {
    return schema.nodeFromJSON(JSON.parse(raw))
  } catch (err) {
    // 坏字节（手改库之类）降级成一句提示，别把整个编辑器带崩。
    reportError('editor-prosemirror', err)
    return null
  }
}

export const syncedBlockView: NodeViewConstructor = (node) => {
  const dom = document.createElement('div')
  dom.className = 'sn-synced'

  const tag = document.createElement('div')
  tag.className = 'sn-synced-tag'
  tag.textContent = '同步块'
  const body = document.createElement('div')
  body.className = 'sn-synced-body'
  dom.append(tag, body)

  let srcId = asString(node.attrs.srcId)
  let inner: EditorView | null = null
  let offSrc: (() => void) | null = null
  /** 失焦提交时跟它比：没变就别写库、别广播。 */
  let loaded = ''
  /** 小编辑器拿着焦点时别重画 —— 重画会把正在编辑的框拆掉。 */
  let editing = false

  /** 拆掉小编辑器（换内容 / 降级都要先拆，不然旧的 EditorView 会漏）。订阅不动。 */
  const clearInner = () => {
    const v = inner
    inner = null
    v?.destroy()
    body.replaceChildren()
  }

  const hint = (text: string) => {
    clearInner()
    dom.dataset.state = 'empty'
    body.textContent = text
  }

  const teardown = () => {
    clearInner()
    offSrc?.()
    offSrc = null
  }

  const commit = () => {
    if (!inner || !srcId) return
    const next = JSON.stringify(inner.state.doc.toJSON())
    if (next === loaded) return
    loaded = next
    void putSrc(srcId, next).catch((err: unknown) => reportError('editor-prosemirror', err))
  }

  const mount = (doc: PMNode, initial: string) => {
    clearInner()
    const view = new EditorView(body, {
      state: EditorState.create({
        doc,
        schema,
        plugins: [
          history(),
          keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
          keymap(baseKeymap),
        ],
      }),
      dispatchTransaction(tr) {
        if (inner) inner.updateState(inner.state.apply(tr))
      },
    })
    inner = view
    loaded = initial
    dom.dataset.state = 'ready'
    // focus / blur 不冒泡，捕获才收得到；根就是那个 contenteditable。
    view.dom.addEventListener('focus', () => (editing = true), true)
    view.dom.addEventListener(
      'blur',
      () => {
        editing = false
        commit()
      },
      true,
    )
  }

  /** 重读源。跟手里那份一样就什么都不做（自己是刚 `put` 的那一方时尤其重要）。 */
  const refresh = async (): Promise<void> => {
    let raw = ''
    try {
      raw = await getSrc(srcId)
    } catch (err) {
      reportError('editor-prosemirror', err)
      hint('同步块：源不可用')
      return
    }
    if (raw === loaded) return
    const doc = parseContent(raw)
    if (doc === null) {
      hint('同步块：内容读不出来')
      return
    }
    mount(doc, raw.trim() === '' ? JSON.stringify(doc.toJSON()) : raw)
  }

  const load = async (): Promise<void> => {
    if (!srcId) {
      hint('同步块：源未创建')
      return
    }
    teardown()
    dom.dataset.srcId = srcId
    hint('同步块：加载中…')
    await refresh()
    // 源没读出来（降级中）就别订 —— 订了也是空转。
    if (!inner) return
    offSrc = subscribeSrc(srcId, () => {
      if (editing) return
      void refresh()
    })
  }

  void load()

  return {
    dom,
    update: (next) => {
      if (next.type !== node.type) return false
      const id = asString(next.attrs.srcId)
      // srcId 换了（斜杠菜单建完源回填的那一拍）：整块重来。
      if (id !== srcId) {
        srcId = id
        dom.dataset.srcId = srcId
        void load()
      }
      return true
    },
    // 小编辑器 / 提示文字全归我们管 —— 主编辑器一路放行（atom 没有可编辑内容）。
    stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
    ignoreMutation: () => true,
    destroy: () => teardown(),
  }
}
