/**
 * `@` 提及（P2）—— 和 `slash.ts` 同一套 suggestion，只是触发符从 `/` 换成 `@`。
 *
 * ★ 触发**不看 keydown 的时序**：每笔事务后直接从文档里读光标前那段文字（D-0126 的根因是
 *   「字先落、keydown 后到」，读文档天然避开）；`view.composing` 只用来「组字期间别动手」。
 *   —— 这条规矩照抄 `slash.ts`，别改成监听 keydown。
 * ★ 候选来自 `doc-meta.ts` 的 `allDocs()`（全库元数据的只读快照），不放这里一份。
 * ★ 这一层不认识 ctx / i18n（editor.ts 立的规矩），文案写死、块名保持英文（D-0089）。
 * ★ 出口只有 `mentionPlugin()`。样式在自己的 `mention.css.ts`（CONVENTIONS §6.2）。
 * ★ 菜单挂 `document.body`（fixed 定位）—— 挂栏里会被 `.sn-pane-body` 的 overflow 裁掉。
 * ★ **接线时排进 `buildPlugins()` 要跟 `slashPlugin()` 一样排在 `keymap(baseKeymap)` 前面**
 *   （PM 的 handleKeyDown 取「第一个说处理了的」插件）。
 */
import type { NodeType } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'

import { allDocs } from '../doc-meta'
import './mention.css'

/** 候选 = 库里的文档元数据。类型从 `allDocs` 反推 —— 这层不 import contract。 */
type Doc = ReturnType<typeof allDocs>[number]

/** 一次最多列几条（多了滚起来烦，够 Notion 那种「打两个字就中」）。
 *  ponytail: 全量线性过滤；几千篇以上再换索引。 */
const LIMIT = 8

const NO_MATCH = '没有匹配的页面'

/* ─────────────────────────────── 匹配 ─────────────────────────────── */

/** 触发符到光标那段的 inline decoration。 */
const HIT_CLASS = 'sn-mention-hit'

interface MentionMatch {
  /** 触发符 `@` 在文档里的位置。 */
  readonly from: number
  /** 光标位置（query 的右端，不含）。 */
  readonly to: number
  readonly query: string
}

interface MentionState {
  readonly match: MentionMatch | null
}

/**
 * 从光标往前找 `@`。**只在词首算** —— 邮箱 / `a@b` 那种前面是字母数字的不弹（`@` 比 `/`
 * 更容易出现在正文里，收这一条）。全角 `＠` 同权：中文输入法下不切半角也呼得出。
 */
function triggerIndex(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch !== '@' && ch !== '＠') continue
    const prev = text[i - 1]
    if (prev !== undefined && /[A-Za-z0-9]/.test(prev)) return -1
    return i
  }
  return -1
}

function findMatch(state: EditorState): MentionMatch | null {
  const sel = state.selection
  if (!sel.empty) return null
  const $head = sel.$head
  const parent = $head.parent
  // 代码块里的 `@` 是字面量，不弹。
  if (!$head.depth || !parent.isTextblock || parent.type.spec.code) return null
  if ($head.node($head.depth - 1).type.name !== 'blockContainer') return null
  const text = parent.textBetween(0, $head.parentOffset)
  const at = triggerIndex(text)
  if (at < 0) return null
  const query = text.slice(at + 1)
  // 打了空格就不是在搜页了（跟 slash 一个决定：标题里的空格靠 `includes` 命中）。
  if (/\s/.test(query)) return null
  return { from: $head.start($head.depth) + at, to: sel.from, query }
}

/** 按标题过滤，按库里的顺序取前 LIMIT 条。query 空 = 全给（顶上一批最近的）。 */
function candidates(query: string): Doc[] {
  const q = query.trim().toLowerCase()
  const out: Doc[] = []
  for (const meta of allDocs()) {
    if (q && !(meta.title || '').toLowerCase().includes(q)) continue
    out.push(meta)
    if (out.length >= LIMIT) break
  }
  return out
}

/* ─────────────────────────────── 落节点 ─────────────────────────────── */

/** 选中一条：删掉 `@query`，原位插一个 `mention` 节点（`docId` = 选中的那篇），光标落到它后面。 */
function runMention(view: EditorView, match: MentionMatch, docId: string): void {
  const state = view.state
  const type = state.schema.nodes.mention as NodeType | undefined
  if (!type) return
  const node = type.create({ docId })
  const tr = state.tr
  tr.delete(match.from, match.to)
  const at = tr.mapping.map(match.from)
  tr.insert(at, node)
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + node.nodeSize), 1))
  tr.scrollIntoView()
  view.dispatch(tr)
  view.focus()
}

/* ─────────────────────────────── 菜单 ─────────────────────────────── */

const key = new PluginKey<MentionState>('sn-mention')

/** 一个 EditorView 一份菜单（并排三栏时各弹各的）。 */
const menus = new WeakMap<EditorView, MentionMenu>()

class MentionMenu {
  private readonly el: HTMLDivElement
  private items: Doc[] = []
  private rows: HTMLDivElement[] = []
  private index = 0
  /** 上次渲染的指纹：换了 match 才重建，否则只挪位置（不然每敲一个字滚动位置就跳回顶上）。 */
  private sig = ''
  private match: MentionMatch | null = null
  private composing = false
  private shown = false
  /** Esc 关掉的那条触发符位置 —— 换了触发符才肯再开（跟 slash 一个记忆法）。 */
  private dismissed = -1
  private readonly off: (() => void)[] = []

  constructor(private readonly view: EditorView) {
    this.el = document.createElement('div')
    this.el.className = 'sn-mention-menu'
    this.el.setAttribute('role', 'listbox')
    this.el.style.display = 'none'
    // 点菜单别把编辑器的焦点抢走（抢走 = blur = 菜单当场收起来）。
    this.el.addEventListener('mousedown', (e) => e.preventDefault())
    document.body.appendChild(this.el)

    this.listen(this.view.dom, 'compositionstart', () => {
      this.composing = true
    })
    this.listen(this.view.dom, 'compositionend', () => {
      this.composing = false
      // 提交之后 PM 一般会补一笔事务；万一没有（有些输入法直接改 DOM），这儿兜一次。
      this.sig = ''
      queueMicrotask(() => this.sync())
    })
    // 菜单是 fixed 的：栏里一滚它就跟不上光标了 —— 滚的时候重新算（捕获，滚动不冒泡）。
    this.listen(document, 'scroll', () => this.reposition(), true)
    this.listen(window, 'resize', () => this.reposition())
  }

  private listen(target: EventTarget, type: string, fn: EventListener, capture = false): void {
    target.addEventListener(type, fn, capture)
    this.off.push(() => target.removeEventListener(type, fn, capture))
  }

  /** 每笔事务后过一遍：重建 / 挪位置 / 收起来。 */
  sync(): void {
    const match = key.getState(this.view.state)?.match ?? null
    // 组字期间不动：preedit 还没进 PM 的 state，重建只会把上一次的结果闪一下。
    if (this.composing || this.view.composing) return
    if (!match) {
      this.dismissed = -1
      return this.hide()
    }
    if (match.from === this.dismissed) return this.hide()
    const sig = `${match.from}:${match.to}:${match.query}`
    if (sig === this.sig) return this.reposition()
    this.sig = sig
    this.match = match
    this.index = 0
    this.paint(match)
  }

  private paint(match: MentionMatch): void {
    this.items = candidates(match.query)
    this.rows = []
    const frag = document.createDocumentFragment()
    if (this.items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'sn-mention-none'
      empty.textContent = NO_MATCH
      frag.appendChild(empty)
    } else {
      this.items.forEach((meta) => frag.appendChild(this.row(meta, this.rows.length)))
    }
    this.el.replaceChildren(frag)
    this.shown = true
    this.el.style.display = 'block'
    this.paintIndex()
    this.reposition()
  }

  private row(meta: Doc, at: number): HTMLDivElement {
    const row = document.createElement('div')
    row.className = 'sn-mention-row'
    row.setAttribute('role', 'option')
    const icon = document.createElement('span')
    icon.className = 'sn-mention-ico'
    icon.textContent = meta.icon || '📄'
    const title = document.createElement('span')
    title.className = 'sn-mention-title'
    title.textContent = meta.title || '无标题'
    row.append(icon, title)
    row.addEventListener('mouseenter', () => {
      this.index = at
      this.paintIndex()
    })
    // 用 click 不用 mousedown：mousedown 被上面 preventDefault 了（保焦点）。
    row.addEventListener('click', () => this.pick(at))
    this.rows.push(row)
    return row
  }

  private paintIndex(): void {
    this.rows.forEach((row, at) => row.setAttribute('aria-selected', String(at === this.index)))
    this.rows[this.index]?.scrollIntoView({ block: 'nearest' })
  }

  private reposition(): void {
    if (!this.shown || !this.match) return
    const at = this.view.coordsAtPos(this.match.from)
    const box = this.el.getBoundingClientRect()
    const left = Math.max(8, Math.min(at.left, window.innerWidth - box.width - 8))
    const below = at.bottom + 4
    const top = below + box.height > window.innerHeight - 8 ? at.top - box.height - 4 : below
    this.el.style.left = `${left}px`
    this.el.style.top = `${Math.max(8, top)}px`
  }

  hide(): void {
    if (!this.shown) return
    this.shown = false
    this.sig = ''
    this.match = null
    this.items = []
    this.rows = []
    this.el.style.display = 'none'
  }

  /**
   * 上 / 下 / 回车 / Esc。**没弹菜单、或者正组字，一律不碰** —— 让键照常走。
   * 组字那一下尤其不能吞：回车是「确认这个字」，吞了就把拼音当选中项了（D-0126）。
   */
  key(event: KeyboardEvent): boolean {
    if (this.composing || this.view.composing || event.isComposing) return false
    if (!this.shown || this.items.length === 0) return false
    switch (event.key) {
      case 'ArrowDown':
        this.move(1)
        return true
      case 'ArrowUp':
        this.move(-1)
        return true
      case 'Enter':
        this.pick(this.index)
        return true
      case 'Escape':
        if (this.match) this.dismissed = this.match.from
        this.hide()
        return true
      default:
        return false
    }
  }

  private move(step: number): void {
    const n = this.items.length
    this.index = (this.index + step + n) % n
    this.paintIndex()
  }

  private pick(at: number): void {
    const meta = this.items[at]
    if (!meta || !this.match) return
    const match = this.match
    this.hide()
    runMention(this.view, match, meta.id)
  }

  destroy(): void {
    for (const off of this.off) off()
    this.off.length = 0
    this.el.remove()
  }
}

/* ─────────────────────────────── 插件 ─────────────────────────────── */

export function mentionPlugin(): Plugin {
  return new Plugin<MentionState>({
    key,
    state: {
      init: (_config, state) => ({ match: findMatch(state) }),
      // 每笔事务重算：从文档里现读，不用 map 追位置。
      apply: (_tr, _prev, _old, next) => ({ match: findMatch(next) }),
    },
    props: {
      decorations(state) {
        const match = key.getState(state)?.match
        if (!match) return null
        return DecorationSet.create(state.doc, [
          Decoration.inline(match.from, match.to, { class: HIT_CLASS }),
        ])
      },
      handleKeyDown(view, event) {
        return menus.get(view)?.key(event) ?? false
      },
      handleDOMEvents: {
        // 焦点走了（点别处）就收起来；回到编辑器里下一次事务会再弹。
        blur(view) {
          menus.get(view)?.hide()
          return false
        },
      },
    },
    view(editorView) {
      const menu = new MentionMenu(editorView)
      menus.set(editorView, menu)
      return {
        update: () => menu.sync(),
        destroy: () => {
          menu.destroy()
          menus.delete(editorView)
        },
      }
    },
  })
}
