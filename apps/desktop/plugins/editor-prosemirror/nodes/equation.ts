/**
 * `equation` / `inlineEquation` 的 NodeView —— KaTeX 渲染，点一下进编辑态。
 *
 * ★ 老教训 D-0127：**`tex` 只在 attrs 里**，渲染绝不往正文补任何字符。那次的坑就是
 *   行内 latex 每次渲染往正文写占位符、还写进模型，直接把编辑器搞坏了。
 * ★ 编辑态是一个**游离的 `<input>`**（在 contentDOM 之外）：atom 节点自带 `contenteditable=false`，
 *   输入框照样能聚焦。输入框里的按键必须 `stopPropagation`，不然 Backspace 会被 PM 当成删块。
 */
import { renderToString } from 'katex'
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { asString } from './attrs'

function makeView(display: boolean): NodeViewConstructor {
  return (node, view, getPos) => {
    const dom = document.createElement(display ? 'div' : 'span')
    dom.className = display ? 'sn-equation' : 'sn-inline-equation'

    const rendered = document.createElement(display ? 'div' : 'span')
    rendered.className = 'sn-eq-rendered'
    dom.appendChild(rendered)

    let input: HTMLInputElement | null = null
    let tex = asString(node.attrs.tex)

    const paint = (n: PMNode) => {
      tex = asString(n.attrs.tex)
      rendered.replaceChildren()
      if (tex.trim() === '') {
        dom.dataset.empty = 'true'
        rendered.textContent = display ? '添加公式' : '公式'
        return
      }
      dom.dataset.empty = 'false'
      try {
        rendered.innerHTML = renderToString(tex, { displayMode: display, throwOnError: false })
      } catch (err) {
        // throwOnError:false 一般不会抛；真抛了也别把整个编辑器带崩（错走唯一出口）。
        reportError('editor-prosemirror', err)
        rendered.textContent = tex
      }
    }
    paint(node)

    const commit = () => {
      if (!input) return
      const value = input.value
      input.remove()
      input = null
      dom.dataset.editing = 'false'
      const pos = getPos()
      const cur = pos === undefined ? undefined : view.state.doc.nodeAt(pos)
      if (cur && asString(cur.attrs.tex) !== value) {
        // 只改 attrs；正文一个字都不碰（D-0127）。
        view.dispatch(view.state.tr.setNodeMarkup(pos as number, undefined, { tex: value }))
      }
    }

    const enterEdit = () => {
      if (input) return
      const pos = getPos()
      const cur = pos === undefined ? undefined : view.state.doc.nodeAt(pos)
      const el = document.createElement('input')
      el.type = 'text'
      el.className = 'sn-eq-input'
      el.value = cur ? asString(cur.attrs.tex) : tex
      el.placeholder = display ? 'E = mc^2' : 'a^2 + b^2'
      el.addEventListener('mousedown', (e) => e.stopPropagation())
      el.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault()
          el.blur()
          // 键盘退出后焦点别掉在 body 上（不然接着敲字没反应）；点走的那种不抢回来。
          view.focus()
        }
      })
      el.addEventListener('blur', commit)
      input = el
      dom.appendChild(el)
      dom.dataset.editing = 'true'
      el.focus()
      el.select()
    }

    // 渲染态按下先 preventDefault：不然点一下会拖出一段 DOM 选区、还把焦点抢走。
    dom.addEventListener('mousedown', (e) => {
      if (!input) e.preventDefault()
    })
    dom.addEventListener('click', () => {
      if (!input) enterEdit()
    })

    return {
      dom,
      update: (next) => {
        if (next.type !== node.type) return false
        // 编辑中别重画（输入框里的字还没提交）。
        if (!input) paint(next)
        return true
      },
      // 输入框 / 渲染出来的 katex 全归我们管，编辑器不用看（atom 没有可编辑内容）。
      ignoreMutation: () => true,
      stopEvent: (e) => e.target instanceof Node && dom.contains(e.target),
    }
  }
}

export const equationView = makeView(true)
export const inlineEquationView = makeView(false)
