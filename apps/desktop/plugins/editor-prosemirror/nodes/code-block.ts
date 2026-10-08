/**
 * `codeBlock` 的 NodeView —— 语言选择器 + 代码区（`content`）。
 *
 * 语法高亮 P1 不做，`language` 只是存进 attr 等以后用。选择器是 `contentDOM` 之外的部件，
 * 自带 `contenteditable="false"`。`pre` 包 `code`：`contentDOM` 是那个 `code`，
 * 位置才落在文本上（架构 §2.3）。
 *
 * 语言选到 **mermaid** 时多出一条路（照 Notion）：右边挂一张图 + 第二个下拉
 * Code / Preview / Split。源码区永远是那个 `code`，**不换、不销毁** —— 预览态只是被 CSS 收起来，
 * 切回 Code 光标还在原地（契约 `docs/mermaid.md` 的 D8）。渲染靠 `mermaid.ts`。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { NodeViewConstructor } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { asString } from './attrs'
import { onSchemeChange, renderSvg } from './mermaid'

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
  ['mermaid', 'Mermaid'],
]

/** 第二个下拉只在 mermaid 下露面（Notion 的 Code / Preview / Split）。 */
const VIEWS: ReadonlyArray<readonly [value: string, label: string]> = [
  ['code', 'Code'],
  ['preview', 'Preview'],
  ['split', 'Split'],
]

type BlockView = 'code' | 'preview' | 'split'

/** 打字到图出来之间的静默期 —— 敲一个字就重画一次，mermaid 扛不住。 */
const DEBOUNCE = 300

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

  const viewPicker = document.createElement('select')
  viewPicker.className = 'sn-codeblock-view'
  viewPicker.contentEditable = 'false'
  viewPicker.setAttribute('aria-label', 'View')
  for (const [value, label] of VIEWS) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    viewPicker.appendChild(option)
  }

  const pre = document.createElement('pre')
  pre.className = 'sn-code'
  const code = document.createElement('code')
  code.className = 'sn-code-text'
  pre.appendChild(code)

  const figure = document.createElement('div')
  figure.className = 'sn-mermaid'

  const bar = document.createElement('div')
  bar.className = 'sn-codeblock-bar'
  bar.append(picker, viewPicker)

  dom.append(bar, pre, figure)

  // 显示模式是**内存态**，不落 attr —— 它是看的偏好、不是内容，导出的 markdown 里不该夹这一笔（契约 D3）。
  let blockView: BlockView = 'split'
  dom.dataset.view = blockView

  let isMermaid = false
  let drawn = ''
  let timer: number | undefined
  let token = 0

  const textNow = (): string => {
    const pos = getPos()
    const cur = pos === undefined ? undefined : view.state.doc.nodeAt(pos)
    return cur ? cur.textContent : drawn
  }

  const draw = async () => {
    const mine = ++token
    const text = textNow()
    drawn = text
    if (text.trim() === '') {
      figure.dataset.state = 'empty'
      figure.replaceChildren()
      return
    }
    figure.dataset.state = 'busy'
    try {
      const svg = await renderSvg(text)
      if (mine !== token) return
      figure.dataset.state = 'ready'
      figure.innerHTML = svg
    } catch (err) {
      // 语法错只烂这张图，编辑器照常用（契约 D7）。错走唯一出口。
      if (mine !== token) return
      reportError('editor-prosemirror', err)
      figure.dataset.state = 'error'
      figure.textContent = String((err as Error).message ?? err)
    }
  }

  const schedule = () => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      void draw()
    }, DEBOUNCE)
  }

  const onPick = () => {
    const pos = getPos()
    if (pos === undefined) return
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { language: picker.value }))
  }
  picker.addEventListener('change', onPick)

  const onPickView = () => {
    blockView = viewPicker.value as BlockView
    dom.dataset.view = blockView
  }
  viewPicker.addEventListener('change', onPickView)
  viewPicker.value = blockView

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
    dom.dataset.mermaid = isMermaid ? 'true' : 'false'
  }
  paint(node)

  // 明暗换档要把已经画好的图按新配色重来一遍（契约 D10）。
  const offScheme = onSchemeChange(() => {
    if (isMermaid) void draw()
  })

  return {
    dom,
    contentDOM: code,
    update: (next) => {
      if (next.type !== node.type) return false
      const nextIsMermaid = asString(next.attrs.language) === 'mermaid'
      const entered = nextIsMermaid && !isMermaid
      isMermaid = nextIsMermaid
      paint(next)
      if (!isMermaid) {
        // 切走了：在途的渲染作废，图区腾空（别留上一段的残影）。
        token++
        drawn = ''
        figure.replaceChildren()
        figure.dataset.state = 'empty'
        return true
      }
      const text = next.textContent
      if (entered || text !== drawn) schedule()
      return true
    },
    // 不吃掉选择器的点击，原生下拉才打得开（也顺手躲开 PM 的选区处理）。
    stopEvent: (e) =>
      e.target instanceof Node && (picker.contains(e.target) || viewPicker.contains(e.target)),
    // 图是我们自己画的，编辑器不用管。
    ignoreMutation: (mut) =>
      mut.type !== 'selection' && !code.contains(mut.target) && !figure.contains(mut.target),
    destroy: () => {
      if (timer !== undefined) window.clearTimeout(timer)
      token++
      picker.removeEventListener('change', onPick)
      viewPicker.removeEventListener('change', onPickView)
      offScheme()
    },
  }
}
