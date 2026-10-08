/**
 * 选中文字时浮出的行内格式工具栏（P1-6）：B / I / U / S / 行内代码 / 链接 / 高亮 / 字色 / 评论。
 *
 * 定位自己算（`view.coordsAtPos`），不引第三方浮层库（CONVENTIONS §6.7）。
 * 没有文字选区就整体藏起来 —— 选块（图片那种 NodeSelection）不走这条。样式在同目录的 `.css.ts`。
 */
import { toggleMark } from 'prosemirror-commands'
import type { MarkType } from 'prosemirror-model'
import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import { selectionAnchor } from '../comment'
import { schema } from '../schema'
import './inline-toolbar.css'

/** 工具条离选区多远；上方留不够这么多就翻到选区下面去。 */
const GAP = 8
const ROOM = 52

type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'code'
type ColorKind = 'highlight' | 'textColor'

const TEXT_MARKS: ReadonlyArray<{ name: MarkName; text: string; cls: string }> = [
  { name: 'bold', text: 'B', cls: 'sn-itb-b' },
  { name: 'italic', text: 'I', cls: 'sn-itb-i' },
  { name: 'underline', text: 'U', cls: 'sn-itb-u' },
  { name: 'strike', text: 'S', cls: 'sn-itb-s' },
  { name: 'code', text: '</>', cls: 'sn-itb-code' },
]

/** 色板：Notion 那套默认色，空串 = 默认（等于清除）。 */
const COLORS: Readonly<Record<ColorKind, readonly string[]>> = {
  textColor: ['', '#e03e3e', '#d9730d', '#dfab01', '#0f7b6c', '#0b6e99', '#6940a5', '#ad1a72', '#64473a', '#9b9a97'],
  highlight: ['', '#ffe2dd', '#fadec9', '#fdecc8', '#dbeddb', '#d3e5ef', '#e8deee', '#f5e0e9', '#e3e2e0'],
}

/**
 * 上一次用过的那个色 —— **⌘⇧H** 刷的就是它（`kind` 一起记：上次可能是底纹，也可能是字色）。
 * 内存态、不落库：它是「刚才那一下」的手感，不是文档内容。
 */
let lastColor: { kind: ColorKind; color: string } | undefined

const LINK_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6.6 9.4 9.4 6.6"/><path d="M7 4.4 8.2 3.2a2.5 2.5 0 0 1 3.6 3.6L10.6 8"/><path d="M9 11.6 7.8 12.8a2.5 2.5 0 0 1-3.6-3.6L5.4 8"/></svg>'

const HL_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10.9 2.4 13.6 5.1 7 11.7 4.3 9z"/><rect x="2" y="12.1" width="12" height="1.9" rx=".6"/></svg>'

const COMMENT_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.3a1.8 1.8 0 0 1-1.8 1.8H5l-2.7 2V4.1a1.8 1.8 0 0 1 1.8-1.8h7.6a1.8 1.8 0 0 1 1.8 1.8z"/></svg>'

/**
 * 评论那颗按钮点下去交出去的编号 —— 跟 `comment.ts` 的 `CommentHooks.selection` 同形
 * （`TextAnchorInfo` 去掉 `rect`）。语法上没法共享那个类型（它没导出），只能照抄一份。
 */
type CommentAnchor = { blockId: string; index: number; length: number; quote: string }

export function inlineToolbarPlugin(onComment?: (at: CommentAnchor) => void): Plugin {
  return new Plugin({
    props: {
      // ⌘⇧H / Ctrl+⇧H：抄 Notion 的「上次用过的颜色」。没选中文字就不认，交回给别的处理者
      // （这个键位在浏览器里另有含义，别抢）。
      handleKeyDown: (view, e) =>
        e.key.toLowerCase() === 'h' && e.shiftKey && (e.metaKey || e.ctrlKey) && lastColorShortcut(view),
    },
    view: (view) => {
      const bar = createBar(view, onComment)
      document.body.appendChild(bar.el)
      bar.sync()
      return { update: () => bar.schedule(), destroy: () => bar.destroy() }
    },
  })
}

function createBar(view: EditorView, onComment?: (at: CommentAnchor) => void) {
  const root = document.createElement('div')
  root.className = 'sn-itb'

  const markBtns = new Map<MarkName, HTMLButtonElement>()
  for (const { name, text, cls } of TEXT_MARKS) {
    const btn = mkButton(text, cls)
    btn.addEventListener('click', () => {
      toggleMark(schema.marks[name])(view.state, view.dispatch, view)
      after()
    })
    root.appendChild(btn)
    markBtns.set(name, btn)
  }

  root.appendChild(mkSeparator())

  const linkBtn = mkButton(LINK_ICON, 'sn-itb-icon')
  const hlBtn = mkButton(HL_ICON, 'sn-itb-icon')
  const colorBtn = mkButton('A', 'sn-itb-color')
  const colorBar = document.createElement('span')
  colorBar.className = 'sn-itb-bar'
  colorBtn.appendChild(colorBar)
  root.append(linkBtn, hlBtn, colorBtn)

  // 评论：装了回调才在（协调者没接线时点不动，不如不显示）。整条工具条本来就只在有文字选区时出现。
  if (onComment) {
    root.appendChild(mkSeparator())
    const commentBtn = mkButton(COMMENT_ICON, 'sn-itb-icon')
    commentBtn.title = '评论'
    commentBtn.addEventListener('click', () => {
      // 现量当时的选区（跟 `comment.ts` 的 `textSelection()` 同一套换算）—— 量不出来就什么都不做。
      const at = selectionAnchor(view.state)
      if (!at) return
      closePopovers()
      onComment(at)
    })
    root.appendChild(commentBtn)
  }

  const palette = document.createElement('div')
  palette.className = 'sn-itb-palette'
  root.appendChild(palette)

  const linkRow = document.createElement('div')
  linkRow.className = 'sn-itb-linkrow'
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'sn-itb-input'
  input.placeholder = '粘贴链接后回车'
  input.tabIndex = -1
  linkRow.appendChild(input)
  root.appendChild(linkRow)

  // 按在工具条上不能把正文的选区弄没了（选区一没，这一条下一帧就消失）。
  root.addEventListener('mousedown', (e) => {
    if (e.target !== input) e.preventDefault()
  })

  let open: 'link' | ColorKind | null = null

  function closePopovers(): void {
    open = null
    palette.style.display = 'none'
    linkRow.style.display = 'none'
  }

  function showPalette(kind: ColorKind): void {
    closePopovers()
    open = kind
    const active = activeColor(view.state, schema.marks[kind])
    palette.replaceChildren()
    for (const color of COLORS[kind]) {
      const sw = document.createElement('button')
      sw.type = 'button'
      sw.tabIndex = -1
      sw.className = color ? 'sn-itb-swatch' : 'sn-itb-swatch sn-itb-swatch-none'
      if (color) sw.style.background = color
      if ((active ?? '') === color) sw.dataset.on = 'true'
      sw.addEventListener('click', () => {
        applyColor(kind, (active ?? '') === color ? '' : color)
        closePopovers()
      })
      palette.appendChild(sw)
    }
    palette.style.display = ''
  }

  function showLink(): void {
    const current = linkHref(view.state)
    if (open === 'link') {
      closePopovers()
      view.focus()
      return
    }
    closePopovers()
    open = 'link'
    input.value = current ?? ''
    linkRow.style.display = ''
    input.focus()
    input.select()
  }

  linkBtn.addEventListener('click', showLink)
  hlBtn.addEventListener('click', () => (open === 'highlight' ? closePopovers() : showPalette('highlight')))
  colorBtn.addEventListener('click', () => (open === 'textColor' ? closePopovers() : showPalette('textColor')))

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      setLink(view, input.value.trim())
      closePopovers()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closePopovers()
      view.focus()
    }
  })

  function after(): void {
    view.focus()
    sync()
  }

  function hide(): void {
    root.classList.remove('sn-itb-on')
    closePopovers()
  }

  function sync(): void {
    const { state } = view
    const sel = state.selection
    const text = sel instanceof TextSelection && state.doc.textBetween(sel.from, sel.to)
    if (!(sel instanceof TextSelection) || sel.empty || !text || !view.hasFocus()) return hide()

    root.classList.add('sn-itb-on')
    const start = view.coordsAtPos(sel.from)
    const end = view.coordsAtPos(sel.to)
    const half = root.offsetWidth / 2
    const mid = (start.left + end.left) / 2
    const left = Math.min(window.innerWidth - half - 4, Math.max(half + 4, mid))
    const above = start.top > ROOM

    root.style.left = `${left}px`
    root.style.top = above ? `${start.top - GAP}px` : `${start.bottom + GAP}px`
    root.style.transform = above ? 'translate(-50%, -100%)' : 'translateX(-50%)'
    refresh(state)
  }

  function refresh(state: EditorState): void {
    const { from, to } = state.selection
    for (const [name, btn] of markBtns) {
      btn.dataset.active = String(state.doc.rangeHasMark(from, to, schema.marks[name]))
    }
    linkBtn.dataset.active = String(state.doc.rangeHasMark(from, to, schema.marks.link))
    const hl = activeColor(state, schema.marks.highlight)
    hlBtn.dataset.active = String(hl !== null)
    const tc = activeColor(state, schema.marks.textColor)
    colorBtn.dataset.active = String(tc !== null)
    colorBar.style.background = tc || 'currentColor'
  }

  /** 工具条上点一块色：刷完把工具条收一下（快捷那条路不走这儿 —— 它不该动焦点，也不该挪浮层）。 */
  function applyColor(kind: ColorKind, color: string): void {
    setColor(view, kind, color)
    after()
  }

  function setLink(target: EditorView, href: string): void {
    const mark = schema.marks.link
    const { from, to } = target.state.selection
    const tr = target.state.tr.removeMark(from, to, mark)
    if (href) tr.addMark(from, to, mark.create({ href }))
    target.dispatch(tr)
    after()
  }

  let raf = 0
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0
      sync()
    })
  }
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)

  return {
    el: root,
    sync,
    schedule,
    destroy(): void {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      root.remove()
    },
  }
}

function mkButton(html: string, cls: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.tabIndex = -1
  btn.className = `sn-itb-btn ${cls}`
  btn.innerHTML = html
  return btn
}

function mkSeparator(): HTMLElement {
  const sep = document.createElement('span')
  sep.className = 'sn-itb-sep'
  return sep
}

/**
 * 给选区刷一个色（空串 = 撤掉）。工具条那排色块和 ⌘⇧H 走的是**同一条路** —— 两处行为必须一模一样。
 *
 * 刷之前先按 mark 类型整段清一遍：一个位置只该有一个底纹 / 一个字色（Notion 也是替换不是叠加）。
 */
function setColor(target: EditorView, kind: ColorKind, color: string): void {
  if (color) lastColor = { kind, color }
  const mark = schema.marks[kind]
  const { from, to } = target.state.selection
  const tr = target.state.tr.removeMark(from, to, mark)
  if (color) tr.addMark(from, to, mark.create({ color }))
  target.dispatch(tr)
}

/**
 * Notion 的 **⌘⇧H**：把**上一次用过的那个色**刷到选区上（底纹和字色都算，看上次用的是哪一类）；
 * 选区已经就是这个色，再按一次 = 撤掉 —— 跟工具条上再点一次同一块色是同一个意思。
 * 一次都还没用过色 → 落到默认黄底（Notion 的默认高亮色）。没选中文字就什么都不做。
 */
function lastColorShortcut(view: EditorView): boolean {
  const sel = view.state.selection
  if (!(sel instanceof TextSelection) || sel.empty) return false
  const pick = lastColor ?? { kind: 'highlight' as ColorKind, color: COLORS.highlight[3] ?? '' }
  if (!pick.color) return false
  const now = activeColor(view.state, schema.marks[pick.kind])
  setColor(view, pick.kind, now === pick.color ? '' : pick.color)
  return true
}

/** 整个选区共用同一种颜色才算「激活」，否则返回 null。 */
function activeColor(state: EditorState, mark: MarkType): string | null {
  const { from, to } = state.selection
  const seen = new Set<string>()
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return
    for (const m of node.marks) if (m.type === mark) seen.add(String(m.attrs.color ?? ''))
  })
  return seen.size === 1 ? [...seen][0] : null
}

/** 选区里那条链接的 href（同一条才算），没有则 null。 */
function linkHref(state: EditorState): string | null {
  const { from, to } = state.selection
  const seen = new Set<string>()
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return
    for (const m of node.marks) if (m.type === schema.marks.link) seen.add(String(m.attrs.href ?? ''))
  })
  return seen.size === 1 ? [...seen][0] : null
}

/** 评论锚点的换算在 `comment.ts` 里（`selectionAnchor`）—— 别在这儿再抄一份，会漂。 */
