/**
 * `codeBlock` 的 NodeView —— 语言选择器 + 代码区（`content`）。
 *
 * 语法高亮 P1 不做，`language` 只是存进 attr 等以后用。选择器是 `contentDOM` 之外的部件，
 * 自带 `contenteditable="false"`。`pre` 包 `code`：`contentDOM` 是那个 `code`，
 * 位置才落在文本上（架构 §2.3）。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { asString } from './attrs'

/** 常用的一小撮就够挑了 —— 导入进来的别的语言会按原值补一个 option。 */
const LANGUAGES: ReadonlyArray<readonly [value: string, label: string]> = [
  ['', 'Plain text'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['python', 'Python'],
  ['rust', 'Rust'],
  ['go', 'Go'],
  ['java', 'Java'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['shell', 'Shell'],
  ['json', 'JSON'],
  ['yaml', 'YAML'],
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['sql', 'SQL'],
  ['markdown', 'Markdown'],
]

export const codeBlockView: NodeViewConstructor = (node, view, getPos) => {
  const dom = document.createElement('div')
  dom.className = 'sn-codeblock'

  const picker = document.createElement('select')
  picker.className = 'sn-codeblock-lang'
  picker.contentEditable = 'false'
  picker.setAttribute('aria-label', 'Language')
  for (const [value, label] of LANGUAGES) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    picker.appendChild(option)
  }

  const pre = document.createElement('pre')
  pre.className = 'sn-code'
  const code = document.createElement('code')
  code.className = 'sn-code-text'
  pre.appendChild(code)

  dom.append(picker, pre)

  const onPick = () => {
    const pos = getPos()
    if (pos === undefined) return
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { language: picker.value }))
  }
  picker.addEventListener('change', onPick)

  const paint = (n: PMNode) => {
    const language = asString(n.attrs.language)
    picker.value = language
    // 表里没有的语言（导入的）补一个 option —— 否则选择器会显示成空的、一改就把原值丢了。
    if (language !== '' && picker.value !== language) {
      const option = document.createElement('option')
      option.value = language
      option.textContent = language
      picker.appendChild(option)
      picker.value = language
    }
    pre.dataset.language = language
  }
  paint(node)

  return {
    dom,
    contentDOM: code,
    update: (next) => {
      if (next.type !== node.type) return false
      paint(next)
      return true
    },
    // 不吃掉选择器的点击，原生下拉才打得开（也顺手躲开 PM 的选区处理）。
    stopEvent: (e) => e.target instanceof Node && picker.contains(e.target),
    ignoreMutation: (mut) => mut.type !== 'selection' && !code.contains(mut.target),
    destroy: () => picker.removeEventListener('change', onPick),
  }
}
