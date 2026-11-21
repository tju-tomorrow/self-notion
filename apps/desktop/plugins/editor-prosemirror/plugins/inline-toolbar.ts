/**
 * 选中文字时浮出的行内格式工具栏（P1-6）：B / I / U / S / 行内代码 / 链接 / 高亮 / 字色 / 评论。
 *
 * 定位自己算（`view.coordsAtPos`），不引第三方浮层库（CONVENTIONS §6.7）。
 * 没有选区就整体藏起来。整块选中（图片 / 代码块 / 表格）也出这条 —— 格式按钮对块没用，
 * 但「评论」那颗走块级锚点（`blockAnchor`）。
 * 格子多选（CellSelection）要出：加粗和字色得能刷到选中的那些格。
 * 选中文字时还可以「转换」成有序列表 / 标题这些块（Notion 的 Turn into），字留着。样式在同目录的 `.css.ts`。
 */
import { toggleMark } from 'prosemirror-commands'
import type { MarkType, Node as PMNode } from 'prosemirror-model'
import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { CellSelection } from 'prosemirror-tables'

import { blockAnchor, selectionAnchor } from '../comment'
import { newBlockId } from '../commands'
import { BlockSelection } from './block-selection'
import { schema } from '../schema'
import './inline-toolbar.css'

/** 工具条离选区多远；上方留不够这么多就翻到选区下面去。 */
const GAP = 8
const ROOM = 52

/** 浮层定位优先取可视视口：软键盘弹起时 innerHeight 不缩，只有它缩。 */
function viewport(): { width: number; height: number; top: number; left: number } {
  const v = window.visualViewport
  return v
    ? { width: v.width, height: v.height, top: v.offsetTop, left: v.offsetLeft }
    : { width: window.innerWidth, height: window.innerHeight, top: 0, left: 0 }
}

type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'code'
export type ColorKind = 'highlight' | 'textColor'

const TEXT_MARKS: ReadonlyArray<{ name: MarkName; text: string; cls: string }> = [
  { name: 'bold', text: 'B', cls: 'sn-itb-b' },
  { name: 'italic', text: 'I', cls: 'sn-itb-i' },
  { name: 'underline', text: 'U', cls: 'sn-itb-u' },
  { name: 'strike', text: 'S', cls: 'sn-itb-s' },
  { name: 'code', text: '&lt;/&gt;', cls: 'sn-itb-code' },
]

const MARK_TITLES: Readonly<Record<MarkName, string>> = {
  bold: '加粗',
  italic: '斜体',
  underline: '下划线',
  strike: '删除线',
  code: '行内代码',
}

/** 色板：Notion 那套默认色，空串 = 默认（等于清除）。块菜单位置那边也用这份。 */
export const COLORS: Readonly<Record<ColorKind, readonly string[]>> = {
  textColor: ['', '#e03e3e', '#d9730d', '#dfab01', '#0f7b6c', '#0b6e99', '#6940a5', '#ad1a72', '#64473a', '#9b9a97'],
  highlight: ['', '#ffe2dd', '#fadec9', '#fdecc8', '#dbeddb', '#d3e5ef', '#e8deee', '#f5e0e9', '#e3e2e0'],
}

/**
 * 上一次用过的那个色 —— **⌘⇧H** 刷的就是它（`kind` 一起记：上次可能是底纹，也可能是字色）。
 * 落在 localStorage：重开 app 后还在，不然每次重启都得回色板点一次才记得住。
 */
const LAST_COLOR_KEY = 'sn-inline-toolbar-last-color'

function readLastColor(): { kind: ColorKind; color: string } | undefined {
  try {
    const raw = localStorage.getItem(LAST_COLOR_KEY)
    if (!raw) return undefined
    const v = JSON.parse(raw) as Partial<{ kind: ColorKind; color: string }>
    if ((v.kind === 'highlight' || v.kind === 'textColor') && typeof v.color === 'string' && v.color) {
      return { kind: v.kind, color: v.color }
    }
  } catch {
    // 坏数据 / 拿不到就当没存过
  }
  return undefined
}

let lastColor = readLastColor()

/** 选区里的正文块能就地换成这些。表格 / 分割线会把字弄没，不放进来。块菜单也用这份。 */
export const TURN_INTO: readonly { id: string; label: string; type: string; attrs?: Record<string, unknown> }[] = [
  { id: 'paragraph', label: '文本', type: 'paragraph' },
  { id: 'h1', label: '标题 1', type: 'heading', attrs: { level: 1 } },
  { id: 'h2', label: '标题 2', type: 'heading', attrs: { level: 2 } },
  { id: 'h3', label: '标题 3', type: 'heading', attrs: { level: 3 } },
  { id: 'todoItem', label: '待办', type: 'todoItem', attrs: { checked: false } },
  { id: 'bulletedListItem', label: '无序列表', type: 'bulletedListItem' },
  { id: 'numberedListItem', label: '有序列表', type: 'numberedListItem' },
  { id: 'toggle', label: '折叠列表', type: 'toggle', attrs: { open: true } },
  { id: 'quote', label: '引用', type: 'quote' },
  { id: 'callout', label: '标注', type: 'callout', attrs: { icon: '💡' } },
  { id: 'codeBlock', label: '代码', type: 'codeBlock', attrs: { language: '' } },
]

const LINK_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6.6 9.4 9.4 6.6"/><path d="M7 4.4 8.2 3.2a2.5 2.5 0 0 1 3.6 3.6L10.6 8"/><path d="M9 11.6 7.8 12.8a2.5 2.5 0 0 1-3.6-3.6L5.4 8"/></svg>'

const HL_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10.9 2.4 13.6 5.1 7 11.7 4.3 9z"/><rect x="2" y="12.1" width="12" height="1.9" rx=".6"/></svg>'

const COMMENT_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.3a1.8 1.8 0 0 1-1.8 1.8H5l-2.7 2V4.1a1.8 1.8 0 0 1 1.8-1.8h7.6a1.8 1.8 0 0 1 1.8 1.8z"/></svg>'

const ANCHOR_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M4.5 2.5h7v11L8 10.7l-3.5 2.8z"/></svg>'

/**
 * 评论那颗按钮点下去交出去的编号 —— 跟 `comment.ts` 的 `CommentHooks.selection` 同形
 * （`TextAnchorInfo` 去掉 `rect`）。语法上没法共享那个类型（它没导出），只能照抄一份。
 */
type CommentAnchor = { blockId: string; index: number; length: number; quote: string }

export function inlineToolbarPlugin(
  onComment?: (at: CommentAnchor) => void,
  onRead?: (range: { from: number; to: number }) => void,
  onBlock?: (at: { blockId: string; quote: string }) => void,
): Plugin {
  let bar: ReturnType<typeof createBar> | null = null
  return new Plugin({
    props: {
      handleKeyDown: (view, e) => {
        const mod = e.metaKey || e.ctrlKey
        if (!mod) return false
        const key = e.key.toLowerCase()
        // ⌘K / ⌘⇧M：不自己建面板，借工具条那两格（面板本来就在选区上飘着）。
        if (key === 'k' && !e.shiftKey && !e.altKey) {
          if (!canFormat(view.state)) return false
          bar?.showLink()
          return true
        }
        if (key === 'm' && e.shiftKey && onComment) {
          const at = selectionAnchor(view.state)
          if (!at) return false
          bar?.close()
          onComment(at)
          return true
        }
        // ⌘⇧H：抄 Notion 的「上次用过的颜色」。没选中文字就不认，交回给别的处理者
        // （这个键位在浏览器里另有含义，别抢）。
        return key === 'h' && e.shiftKey && lastColorShortcut(view)
      },
    },
    view: (view) => {
      bar = createBar(view, onComment, onRead, onBlock)
      const created = bar
      document.body.appendChild(created.el)
      created.sync()
      return { update: () => created.schedule(), destroy: () => created.destroy() }
    },
  })
}

function createBar(
  view: EditorView,
  onComment?: (at: CommentAnchor) => void,
  onRead?: (range: { from: number; to: number }) => void,
  onBlock?: (at: { blockId: string; quote: string }) => void,
) {
  const root = document.createElement('div')
  root.className = 'sn-itb'
  // 按钮装进可横滚的 strip；色板/菜单/链接框留在 root，免得被 overflow 裁掉。
  const strip = document.createElement('div')
  strip.className = 'sn-itb-strip'
  root.appendChild(strip)

  const turnBtn = mkButton('转换<span class="sn-itb-chev">▾</span>', 'sn-itb-turn')
  turnBtn.title = '转换成'
  const turnSep = mkSeparator()
  strip.append(turnBtn, turnSep)

  const markBtns = new Map<MarkName, HTMLButtonElement>()
  for (const { name, text, cls } of TEXT_MARKS) {
    const btn = mkButton(text, cls)
    btn.title = MARK_TITLES[name]
    btn.addEventListener('click', () => {
      toggleMark(schema.marks[name])(view.state, view.dispatch, view)
      after()
    })
    strip.appendChild(btn)
    markBtns.set(name, btn)
  }

  strip.appendChild(mkSeparator())

  const linkBtn = mkButton(LINK_ICON, 'sn-itb-icon')
  const hlBtn = mkButton(HL_ICON, 'sn-itb-icon sn-itb-color')
  const hlBar = document.createElement('span')
  hlBar.className = 'sn-itb-bar'
  hlBtn.appendChild(hlBar)
  const colorBtn = mkButton('A', 'sn-itb-color')
  const colorBar = document.createElement('span')
  colorBar.className = 'sn-itb-bar'
  colorBtn.appendChild(colorBar)
  strip.append(linkBtn, hlBtn, colorBtn)

  if (onRead) {
    strip.appendChild(mkSeparator())
    const readBtn = mkButton('读', '')
    readBtn.title = '朗读选中'
    readBtn.addEventListener('click', () => {
      const { from, to } = view.state.selection
      if (from === to) return
      closePopovers()
      onRead({ from, to })
      // 读起来之后原生选区就没用了：留着是一大片蓝，盖住「正在念」那句的高亮，
      // 用户点一下还以为没清掉。落个光标就走。
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from)))
      view.focus()
    })
    strip.appendChild(readBtn)
  }

  // 锚点：选中一段打个书签，右侧「锚点」列表一键跳回来。
  strip.appendChild(mkSeparator())
  const anchorBtn = mkButton(ANCHOR_ICON, 'sn-itb-icon')
  anchorBtn.title = '锚点'
  anchorBtn.addEventListener('click', () => {
    const { from, to } = view.state.selection
    if (from === to) return
    closePopovers()
    toggleAnchor(view, from, to)
    after()
  })
  strip.appendChild(anchorBtn)

  // 评论：装了回调才在。文字选区评一段；整块选区（代码块 / 图片 / 表格）评整块。
  if (onComment || onBlock) {
    strip.appendChild(mkSeparator())
    const commentBtn = mkButton(COMMENT_ICON, 'sn-itb-icon')
    commentBtn.title = '评论'
    commentBtn.addEventListener('click', () => {
      // 现量当时的选区（跟 `comment.ts` 的 `textSelection()` 同一套换算）。
      const at = selectionAnchor(view.state)
      if (at) {
        if (!onComment) return
        closePopovers()
        onComment(at)
        return
      }
      // 块选区没有文字那一套位置，交给块级评论。
      const block = onBlock ? blockAnchor(view.state) : null
      if (!block) return
      closePopovers()
      onBlock?.(block)
    })
    strip.appendChild(commentBtn)
  }

  const palette = document.createElement('div')
  palette.className = 'sn-itb-palette'
  root.appendChild(palette)

  const turnMenu = document.createElement('div')
  turnMenu.className = 'sn-itb-menu'
  const turnItemBtns = new Map<string, HTMLButtonElement>()
  for (const item of TURN_INTO) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.tabIndex = -1
    btn.textContent = item.label
    btn.addEventListener('click', () => {
      turnInto(view, item)
      closePopovers()
      after()
    })
    turnMenu.appendChild(btn)
    turnItemBtns.set(item.id, btn)
  }
  root.appendChild(turnMenu)

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
  // 触屏只有 pointerdown 会先到，光拦 mousedown 不够；鼠标那条一字不动。
  root.addEventListener('mousedown', (e) => {
    if (e.target !== input) e.preventDefault()
  })
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return
    // strip 空白处留给横滚手势，只在按钮上压默认动作保选区。
    if (e.target === input || e.target === strip) return
    e.preventDefault()
  })

  let open: 'link' | 'turn' | ColorKind | null = null

  function closePopovers(): void {
    open = null
    palette.style.display = 'none'
    linkRow.style.display = 'none'
    turnMenu.dataset.open = 'false'
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

  function showTurn(): void {
    if (textBlocks(view.state).length === 0) return
    if (open === 'turn') {
      closePopovers()
      view.focus()
      return
    }
    closePopovers()
    open = 'turn'
    const kinds = new Set(textBlocks(view.state).map((b) => blockKind(b.node)))
    for (const [id, btn] of turnItemBtns) btn.dataset.on = String(kinds.size === 1 && kinds.has(id))
    turnMenu.dataset.open = 'true'
  }

  turnBtn.addEventListener('click', showTurn)
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
    const box = view.hasFocus() && canFormat(state) ? selectionBox(view) : null
    if (!box) return hide()

    root.classList.add('sn-itb-on')
    const vp = viewport()
    const right = vp.left + vp.width
    const bottom = vp.top + vp.height
    const height = root.offsetHeight
    const above = box.top > vp.top + ROOM
    // 块选中时工具条靠块的左缘，给中间那颗「评论此块」让开。
    if (box.align === 'start') {
      const width = root.offsetWidth
      const left = Math.min(right - width - 4, Math.max(vp.left + 4, box.mid))
      root.style.left = `${left}px`
      root.style.transform = above ? 'translateY(-100%)' : ''
    } else {
      const half = root.offsetWidth / 2
      const left = Math.min(right - half - 4, Math.max(vp.left + half + 4, box.mid))
      root.style.left = `${left}px`
      root.style.transform = above ? 'translate(-50%, -100%)' : 'translateX(-50%)'
    }
    // 软键盘弹起时可视高度会缩，把整条夹回可视区，别被盖住。
    const desired = above ? box.top - GAP : box.bottom + GAP
    const renderTop = above ? desired - height : desired
    const clamped = Math.max(vp.top + 4, Math.min(renderTop, bottom - 4 - height))
    root.style.top = `${above ? clamped + height : clamped}px`
    refresh(state)
  }

  function refresh(state: EditorState): void {
    const blocks = textBlocks(state)
    turnBtn.hidden = turnSep.hidden = blocks.length === 0
    for (const [name, btn] of markBtns) {
      btn.dataset.active = String(markActive(state, schema.marks[name]))
    }
    linkBtn.dataset.active = String(markActive(state, schema.marks.link))
    // 没上色时显示 ⌘⇧H 会刷的那个色，不然看不出快捷键的默认色变成了什么。
    const hl = activeColor(state, schema.marks.highlight)
    hlBtn.dataset.active = String(hl !== null)
    hlBar.style.background = hl || (lastColor?.kind === 'highlight' ? lastColor.color : 'currentColor')
    const tc = activeColor(state, schema.marks.textColor)
    colorBtn.dataset.active = String(tc !== null)
    colorBar.style.background = tc || (lastColor?.kind === 'textColor' ? lastColor.color : 'currentColor')
  }

  /** 工具条上点一块色：刷完把工具条收一下（快捷那条路不走这儿 —— 它不该动焦点，也不该挪浮层）。 */
  function applyColor(kind: ColorKind, color: string): void {
    setColor(view, kind, color)
    after()
  }

  function setLink(target: EditorView, href: string): void {
    const mark = schema.marks.link
    const tr = target.state.tr
    for (const { $from, $to } of target.state.selection.ranges) {
      tr.removeMark($from.pos, $to.pos, mark)
      if (href) tr.addMark($from.pos, $to.pos, mark.create({ href }))
    }
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
  // 软键盘弹起 / 收起会改 visualViewport 的高度，重新夹一次位置。
  window.visualViewport?.addEventListener('resize', schedule)
  window.visualViewport?.addEventListener('scroll', schedule)
  // 手柄选块是「先落选区、后 focus」—— 选区那次 update 时还没有焦点，工具条会先藏起来。
  // 编辑器自己拿到焦点再量一次（只挂 view.dom：链接输入框在工具条里，别被它带偏）。
  view.dom.addEventListener('focusin', schedule)

  return {
    el: root,
    sync,
    schedule,
    showLink,
    close: closePopovers,
    destroy(): void {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      view.dom.removeEventListener('focusin', schedule)
      root.remove()
    },
  }
}

/** 选中段落的锚点开关：整段都在锚点里就撤掉，否则盖一个新锚。 */
function toggleAnchor(view: EditorView, from: number, to: number): void {
  const type = schema.marks.anchor
  if (!type) return
  const tr = view.state.tr
  let all = true
  let any = false
  view.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true
    if (node.marks.some((m) => m.type === type)) any = true
    else all = false
    return true
  })
  if (all && any) tr.removeMark(from, to, type)
  else tr.addMark(from, to, type.create({ id: newBlockId() }))
  view.dispatch(tr)
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
  if (color) {
    lastColor = { kind, color }
    try {
      localStorage.setItem(LAST_COLOR_KEY, JSON.stringify(lastColor))
    } catch {
      // 私密模式 / 配额满就退回内存态
    }
  }
  const mark = schema.marks[kind]
  const tr = target.state.tr
  for (const { $from, $to } of target.state.selection.ranges) {
    tr.removeMark($from.pos, $to.pos, mark)
    if (color) tr.addMark($from.pos, $to.pos, mark.create({ color }))
  }
  target.dispatch(tr)
}

/**
 * Notion 的 **⌘⇧H**：把**上一次用过的那个色**刷到选区上（底纹和字色都算，看上次用的是哪一类）；
 * 选区已经就是这个色，再按一次 = 撤掉 —— 跟工具条上再点一次同一块色是同一个意思。
 * 一次都还没用过色 → 落到默认黄底（Notion 的默认高亮色）。没选中文字就什么都不做。
 */
function lastColorShortcut(view: EditorView): boolean {
  if (!canFormat(view.state)) return false
  const pick = lastColor ?? { kind: 'highlight' as ColorKind, color: COLORS.highlight[3] ?? '' }
  if (!pick.color) return false
  const now = activeColor(view.state, schema.marks[pick.kind])
  setColor(view, pick.kind, now === pick.color ? '' : pick.color)
  return true
}

interface TurnItem {
  id: string
  label: string
  type: string
  attrs?: Record<string, unknown>
}

/** 选区碰到的正文块（块容器里那层文字）。表格格子不是块，转不了。 */
function textBlocks(state: EditorState): { pos: number; node: PMNode }[] {
  const { from, to } = state.selection
  const out: { pos: number; node: PMNode }[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'blockContainer') return
    const child = node.firstChild
    if (!child?.isTextblock) return
    const textFrom = pos + 2
    const textTo = pos + 1 + child.nodeSize - 1
    if (textTo <= from || textFrom >= to) return
    out.push({ pos: pos + 1, node: child })
  })
  return out
}

function blockKind(node: PMNode): string {
  return node.type.name === 'heading' ? `h${node.attrs.level ?? 1}` : node.type.name
}

/** 就地换块类型。代码块只收纯文字，带提及的那块跳过，免得换型把文档弄坏。 */
function turnInto(view: EditorView, item: TurnItem): void {
  const targets = textBlocks(view.state)
  if (!targets.length) return
  const type = schema.nodes[item.type]
  if (!type) return
  const tr = view.state.tr
  for (const hit of targets) {
    const pos = tr.mapping.map(hit.pos)
    const node = tr.doc.nodeAt(pos)
    if (!node?.isTextblock) continue
    const attrs = turnAttrs(item, node)
    if (item.type === 'codeBlock') {
      let plain = true
      node.forEach((child) => {
        if (!child.isText) plain = false
      })
      if (!plain) continue
      const text = node.textContent
      tr.replaceWith(pos, pos + node.nodeSize, type.create(attrs, text ? schema.text(text) : undefined))
    } else {
      tr.setNodeMarkup(pos, type, attrs)
    }
  }
  if (tr.docChanged) view.dispatch(tr)
}

function turnAttrs(item: TurnItem, node: PMNode): Record<string, unknown> | null {
  if (item.type === 'todoItem') return { checked: node.type.name === 'todoItem' ? node.attrs.checked : false }
  if (item.type === 'toggle') return { open: node.type.name === 'toggle' ? node.attrs.open : true }
  if (item.type === 'callout') {
    const icon = node.type.name === 'callout' ? String(node.attrs.icon ?? '') : ''
    return { icon: icon || '💡' }
  }
  if (item.type === 'codeBlock') return { language: node.type.name === 'codeBlock' ? node.attrs.language : '' }
  return item.attrs ?? null
}

/** 文字选区、格子多选，或整块选中。空光标 / 选中整块图片不出。 */
function canFormat(state: EditorState): boolean {
  const sel = state.selection
  if (sel instanceof BlockSelection) return sel.nodes.length > 0
  if (sel instanceof CellSelection) return true
  return sel instanceof TextSelection && !sel.empty && state.doc.textBetween(sel.from, sel.to).length > 0
}

/** 工具条摆在选区上方用的盒子。格子多选要把每一格都算进去；整块选中靠块的 DOM，别用缝里的光标坐标。 */
function selectionBox(view: EditorView): { top: number; bottom: number; mid: number; align: 'center' | 'start' } | null {
  const sel = view.state.selection
  if (sel instanceof BlockSelection) {
    const ids = new Set(sel.nodes.map((node) => String(node.attrs.id ?? '')))
    let top = Infinity
    let bottom = -Infinity
    let left = Infinity
    for (const el of view.dom.querySelectorAll<HTMLElement>('.sn-block')) {
      if (!ids.has(el.dataset.id ?? '')) continue
      const r = el.getBoundingClientRect()
      if (r.height <= 0) continue
      top = Math.min(top, r.top)
      bottom = Math.max(bottom, r.bottom)
      left = Math.min(left, r.left)
    }
    if (!Number.isFinite(top)) return null
    return { top, bottom, mid: left, align: 'start' }
  }
  try {
    let top = Infinity
    let bottom = -Infinity
    let left = Infinity
    let right = -Infinity
    for (const range of sel.ranges) {
      const a = view.coordsAtPos(range.$from.pos)
      const b = view.coordsAtPos(range.$to.pos)
      top = Math.min(top, a.top, b.top)
      bottom = Math.max(bottom, a.bottom, b.bottom)
      left = Math.min(left, a.left, b.left)
      right = Math.max(right, a.right, b.right)
    }
    if (!Number.isFinite(top)) return null
    return { top, bottom, mid: (left + right) / 2, align: 'center' }
  } catch {
    return null
  }
}

/** 有文字的每一段都带着这个 mark 才算按下。格子多选不能只看第一格。 */
function markActive(state: EditorState, mark: MarkType): boolean {
  let saw = false
  for (const { $from, $to } of state.selection.ranges) {
    if (state.doc.textBetween($from.pos, $to.pos).length === 0) continue
    saw = true
    if (!state.doc.rangeHasMark($from.pos, $to.pos, mark)) return false
  }
  return saw
}

/** 整个选区共用同一种颜色才算「激活」，否则返回 null。 */
function activeColor(state: EditorState, mark: MarkType): string | null {
  const seen = new Set<string>()
  let sawText = false
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (!node.isText) return
      sawText = true
      const hit = node.marks.find((m) => m.type === mark)
      if (hit) seen.add(String(hit.attrs.color ?? ''))
      else seen.add('')
    })
  }
  if (!sawText || seen.size !== 1) return null
  const only = [...seen][0]
  return only ? only : null
}

/** 选区里那条链接的 href（同一条才算），没有则 null。 */
function linkHref(state: EditorState): string | null {
  const seen = new Set<string>()
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (!node.isText) return
      const hit = node.marks.find((m) => m.type === schema.marks.link)
      seen.add(hit ? String(hit.attrs.href ?? '') : '')
    })
  }
  if (seen.size !== 1) return null
  const only = [...seen][0]
  return only ? only : null
}

/** 评论锚点的换算在 `comment.ts` 里（`selectionAnchor`）—— 别在这儿再抄一份，会漂。 */
