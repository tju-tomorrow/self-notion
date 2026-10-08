/**
 * 把编辑器放进窗口 —— 走槽位（`ctx.slot.register`），不直接摸别人的 DOM。分栏状态机照抄 `editor-blocksuite/view.ts`。
 *
 * ★ 槽里放**自定义元素**（标签名带 `-`）而不是 React 组件：插件目录不 import react，
 *   而 React 遇到带 `-` 的小写标签会当普通 DOM 元素创建。浏览器再把它升级成下面的类。
 * ★ 「当前是哪篇」「并排几栏」都是**插件内部状态**，不进契约。来源是跨插件事件：`OPEN_DOC` / `SPLIT_VIEW`。
 * ★ 这个文件**不许**静态 import `./editor` —— 要模块里的函数走 `await load()`（懒装载）。
 */
import type { Context } from 'cordis'

import {
  DOCS_CHANGED,
  OPEN_DOC,
  SPLIT_VIEW,
  type DocMeta,
  type OpenDocEvent,
  type SplitViewEvent,
} from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import type { EditorHandle } from './editor'
import './editor.css'

/** 取编辑器模块。**先等 `ctx.editor.ready()`** —— 它保证 `connectDocs` 那条线已经接上。 */
let editorReady: () => Promise<void> = () => Promise.resolve()
const load = async () => {
  await editorReady()
  return import('./editor')
}

/** 槽位里放的名字，也是自定义元素的标签名（必须带 `-`，否则 React 当组件查表）。 */
export const EDITOR_ELEMENT = 'sn-editor-host'

/* ────────────────────────── 分栏状态（插件内部） ────────────────────────── */

/** 最多三栏（D-0118）：再多每栏都窄到没法读。 */
const MAX_PANES = 3

/** 拖分隔条时一栏最少占多少（相邻两栏宽度之和的百分比）—— 再窄就一个字一行了。 */
const MIN_PANE_PCT = 15

/** 每栏一篇文档；`null` = 这一栏还空着。 */
let panes: (string | null)[] = [null]

/** 哪一栏是「当前」—— 新打开的文档落进它。 */
let focus = 0

/** 「库里这篇的字节换过了，重读一遍」—— 每篇只对紧接着的那次渲染生效。 */
const forced = new Set<string>()

const listeners = new Set<() => void>()

/** 栏头要显示的页名。`doc:list` 一次给全（跟标签条同一条路），`DOCS_CHANGED` 后重取。 */
let titles: ReadonlyMap<string, string> = new Map()

/** 发事件用。`registerEditorView` 时接上 —— 模块级的订阅者拿不到 ctx。 */
let bus: Context | undefined

let failedText = '打不开这篇文档'
let paneEmptyText = '点侧栏里的一篇，放到这一栏'
let closeText = '关掉这一栏'
let untitledText = '未命名'

function notify(): void {
  // 栏数可能刚变过 —— 顺手广播一条，顶栏那颗按钮看不见这里的 `panes`，靠它改文案。
  bus?.emit(SPLIT_VIEW, { panes: panes.length })
  for (const cb of listeners) cb()
}

function onPanesChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

/* ────────────────────────── 换篇 / 改栏数 ────────────────────────── */

/** 切到某篇。已经并排着的那一篇**只把焦点给它** —— 同一篇占两栏，两边改同一份会打架。 */
export function openDoc(id: string): void {
  const at = panes.indexOf(id)
  if (at >= 0) {
    if (at === focus) return
    focus = at
    notify()
    return
  }
  if (panes[focus] === id) return
  panes[focus] = id
  notify()
}

/** 点某一栏 → 焦点给它。顶栏和标签条只听 `OPEN_DOC`，所以回发一条让它们跟上。 */
function focusPane(at: number): void {
  if (at === focus || at < 0 || at >= panes.length) return
  focus = at
  notify()
  const id = panes[at]
  if (id != null) bus?.emit(OPEN_DOC, { id })
}

/** 重读某一篇（恢复历史版本后调）。返回「有没有人接」—— 一篇都没并排着就没人接。 */
export function reloadDoc(id: string): boolean {
  if (!panes.includes(id)) return false
  forced.add(id)
  notify()
  return true
}

export function openDocIds(): string[] {
  return panes.filter((id): id is string => id !== null)
}

/** 把栏数设成 n（下界 1、上界 3）。变少了要**保住焦点那一篇**。 */
export function setPaneCount(n: number): number {
  const want = Math.min(MAX_PANES, Math.max(1, Math.trunc(n)))
  if (want === panes.length) return panes.length
  if (want > panes.length) {
    while (panes.length < want) panes.push(null)
    // 焦点给**刚开出来那一栏**：不然接着点侧栏里的一篇会盖掉你正在看的那篇。
    focus = panes.length - 1
  } else {
    const keep = panes[focus] ?? null
    const rest = panes.filter((_, i) => i !== focus)
    panes = [keep, ...rest].slice(0, want)
    focus = 0
  }
  notify()
  return panes.length
}

/** 关掉第 at 栏。只剩一栏时不是「关栏」而是**清空**它。 */
function closePane(at: number): void {
  if (panes.length <= 1) {
    if (panes[0] === null) return
    panes = [null]
    focus = 0
    notify()
    return
  }
  panes = panes.filter((_, i) => i !== at)
  if (focus > at) focus--
  else if (focus >= panes.length) focus = panes.length - 1
  notify()
}

/** 拔插件时清干净 —— 留着的话重装一次会带着上一次的文档和一堆死订阅。 */
function resetView(): void {
  panes = [null]
  focus = 0
  forced.clear()
  listeners.clear()
  titles = new Map()
  bus = undefined
}

/* ────────────────────────── 一栏 ────────────────────────── */

/**
 * 一栏：栏头（页名 + 关掉这一栏）+ 编辑器挂载点。
 *
 * 用**普通 div** 不用自定义元素：改栏数时要把这些节点在宿主里搬来搬去，搬动一个已连接的自定义元素
 * 会触发它的 disconnected/connected，编辑器被反复卸载重挂。
 */
class PaneView {
  readonly el: HTMLDivElement
  private readonly head: HTMLDivElement
  private readonly label: HTMLSpanElement
  private readonly body: HTMLDivElement
  private handle: EditorHandle | undefined
  /** 现在真的挂着哪一篇。空栏 / 还没挂完都是 null。 */
  private shown: string | null = null
  private index = 0
  /** 拖过分隔条就是固定百分比；没拖过就平分（flex-grow）。 */
  private pct: number | null = null
  /** 防串台：连点两篇时，先发的那次必须在挂载前发现自己已经过期。 */
  private seq = 0

  constructor(private readonly host: EditorHostElement) {
    this.el = document.createElement('div')
    this.el.className = 'sn-pane'
    this.head = document.createElement('div')
    this.head.className = 'sn-pane-head'
    this.label = document.createElement('span')
    this.label.className = 'sn-pane-title'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'sn-pane-close'
    close.textContent = '×'
    close.title = closeText
    close.setAttribute('aria-label', closeText)
    close.addEventListener('click', (e) => {
      e.stopPropagation() // 别让点 × 顺带走一遍「焦点给这一栏」
      closePane(this.index)
    })
    this.head.append(this.label, close)
    this.body = document.createElement('div')
    this.body.className = 'sn-pane-body'
    this.el.append(this.head, this.body)
    // 点哪一栏哪一栏就是「当前」。
    this.el.addEventListener('pointerdown', () => this.host.onPanePointerDown(this.index))
  }

  set(want: string | null, focused: boolean, index: number): void {
    this.index = index
    this.el.classList.toggle('sn-pane-on', focused)
    // 单栏时整条栏头收掉：那种形态下「哪一栏」没有歧义。
    this.head.style.display = panes.length > 1 ? '' : 'none'
    this.label.textContent = want === null ? '' : titles.get(want) || untitledText
    this.label.title = this.label.textContent
    this.applyWidth()
    const reload = want !== null && forced.delete(want)
    if (want === this.shown && !reload) return
    void this.open(want, reload)
  }

  private applyWidth(): void {
    this.el.style.flex = this.pct === null ? '1 1 0%' : `0 0 ${this.pct}%`
  }

  setWidth(pct: number): void {
    this.pct = pct
    this.applyWidth()
  }

  width(): number {
    return this.el.getBoundingClientRect().width
  }

  private async open(want: string | null, reload: boolean): Promise<void> {
    const mine = ++this.seq
    if (want === null) {
      this.teardown()
      this.showEmpty(paneEmptyText)
      return
    }

    const previous = this.shown
    // ★ 这一句是**冷启动的分水岭**：打开第一篇文档时，是它把人等进去、把模块拉下来的。
    const editor = await load()
    // ★ 恢复历史版本这一趟必须跳过：手里那个活文档是**恢复前**的状态，落一次就把刚改好的库写回去了。
    if (previous && !reload) await editor.flushDoc(previous)
    if (mine !== this.seq) return // 期间又切走了，这次作废

    this.teardown()
    // 丢掉活文档 —— 下面 `mountEditor` 照库里的新字节重建一个。
    if (reload) editor.dropDoc(want)

    try {
      const handle = await editor.mountEditor(this.body, want)
      if (mine !== this.seq) {
        handle.unmount()
        return
      }
      this.handle = handle
      this.shown = want
    } catch (err) {
      // 静默失败是 D-0045 明令禁止的：打不开就留痕 + 让用户看见，别给个空白编辑器。
      reportError('editor-prosemirror', err)
      if (mine === this.seq) this.showEmpty(`${failedText}：${String(err)}`)
    } finally {
      // 重读完了（哪怕失败了）就把闸门放开 —— 不放的话这一篇从此不再落库。
      if (reload) editor.unmuteDoc(want)
    }
  }

  /** 拆掉栏里的编辑器。**不落库** —— 该落的由调用方先落（见 `open`）或者由 `destroy` 补。 */
  private teardown(): void {
    this.handle?.unmount()
    this.handle = undefined
    this.shown = null
    this.body.replaceChildren()
  }

  /** 这一栏走人（关栏 / 拔插件）—— 走的路上把最后一点改动落库。 */
  destroy(): void {
    const leaving = this.shown
    this.seq++
    this.teardown()
    if (leaving !== null) void load().then((editor) => editor.flushDoc(leaving))
    this.el.remove()
  }

  private showEmpty(text: string): void {
    const p = document.createElement('p')
    p.className = 'sn-pane-empty'
    p.textContent = text
    this.body.replaceChildren(p)
  }
}

/* ────────────────────────── 宿主元素 ────────────────────────── */

class EditorHostElement extends HTMLElement {
  private slots: PaneView[] = []
  private splitters: HTMLElement[] = []
  private off: (() => void) | undefined

  connectedCallback() {
    // 顶栏是 `main` 的第一个孩子，编辑器要跟着它缩 —— `height:100%` 会顶出去。
    this.style.cssText = 'display:flex;flex:1 1 auto;min-height:0;position:relative'
    this.off = onPanesChange(() => this.sync())
    // 元素可能比事件晚到（槽位后挂、热重载）—— 连上时先补一次。
    this.sync()
  }

  disconnectedCallback() {
    this.off?.()
    this.off = undefined
    for (const slot of this.slots) slot.destroy()
    this.slots = []
  }

  onPanePointerDown(index: number): void {
    focusPane(index)
  }

  private sync(): void {
    while (this.slots.length > panes.length) this.slots.pop()?.destroy()
    while (this.slots.length < panes.length) this.slots.push(new PaneView(this))

    // ★ 缝只用不重建、节点**只在真的换了位才动**：`append` 一个已在树里的节点是先摘再插
    //   （搬家，不是摆好），而搬家会触发自定义元素的 disconnected/connected → 编辑器反复重挂、焦点滚动全丢。
    while (this.splitters.length < Math.max(0, this.slots.length - 1)) {
      this.splitters.push(this.makeSplitter())
    }
    while (this.splitters.length > Math.max(0, this.slots.length - 1)) {
      this.splitters.pop()?.remove()
    }
    const want: Node[] = []
    this.slots.forEach((slot, i) => {
      want.push(slot.el)
      const bar = this.splitters[i]
      if (bar) want.push(bar)
    })
    want.forEach((node, i) => {
      if (this.childNodes[i] !== node) this.insertBefore(node, this.childNodes[i] ?? null)
    })
    // ponytail: 按**下标**对齐（关中间那栏会让右边那栏挪一位、重挂一次）—— 不为这个做 key 化 diff。
    this.slots.forEach((slot, i) => slot.set(panes[i] ?? null, i === focus, i))
  }

  private makeSplitter(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'sn-split'
    bar.setAttribute('role', 'separator')
    bar.setAttribute('aria-orientation', 'vertical')
    // 下标要**当下**才算：缝是复用的，建的那会儿那个位置关一栏之后就不作数了。
    bar.addEventListener('pointerdown', (e) => this.startResize(e, this.splitters.indexOf(bar)))
    return bar
  }

  /** 拖分隔条：只动**相邻两栏**的宽度，两者之和不变。存百分比 —— 窗口变了也跟着缩。 */
  private startResize(e: PointerEvent, i: number): void {
    e.preventDefault()
    const left = this.slots[i]
    const right = this.slots[i + 1]
    if (!left || !right) return
    const lw = left.width()
    const rw = right.width()
    const total = lw + rw
    if (total <= 0) return
    const startX = e.clientX
    const min = (MIN_PANE_PCT / 100) * total
    document.body.style.userSelect = 'none'
    const move = (ev: globalThis.PointerEvent) => {
      const want = Math.min(total - min, Math.max(min, lw + ev.clientX - startX))
      left.setWidth((want / total) * 100)
      right.setWidth(((total - want) / total) * 100)
    }
    const up = () => {
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
}

/** 定义元素。幂等 —— 热更新会重新执行模块，重复 define 会抛。 */
export function defineEditorElement(): void {
  if (customElements.get(EDITOR_ELEMENT)) return
  customElements.define(EDITOR_ELEMENT, EditorHostElement)
}

/**
 * 注册 `main.view` + 订阅 `OPEN_DOC` / `SPLIT_VIEW`。返回的正是卸载函数（D-0033 的逆函数纪律）。
 */
export function registerEditorView(ctx: Context): () => void {
  defineEditorElement()
  bus = ctx
  failedText = ctx.i18n.t('editor.openFailed')
  paneEmptyText = ctx.i18n.t('editor.paneEmpty')
  closeText = ctx.i18n.t('editor.paneClose')
  untitledText = ctx.i18n.t('doc.untitled')
  // 只记下「怎么问」，不问 —— 这一问就是装载。
  editorReady = () => ctx.editor.ready()

  // `ctx.on` 是 **fiber 作用域**的：拔插件时 cordis 自己会摘掉，不用手工 off。
  ctx.on(OPEN_DOC, ({ id }: OpenDocEvent) => openDoc(id))
  ctx.on(SPLIT_VIEW, ({ panes: want }: SplitViewEvent) => void setPaneCount(want))

  // 栏头的页名（改名、新建子页面之后要跟着变 —— 和标签条同一条路）。
  const pullTitles = () =>
    void ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: true }).then((all) => {
      titles = new Map(all.map((doc) => [doc.id, doc.title]))
      notify()
    })
  ctx.on(DOCS_CHANGED, pullTitles)
  pullTitles()

  const unregister = ctx.slot.register('main.view', EDITOR_ELEMENT)

  return () => {
    unregister()
    resetView()
  }
}
