/**
 * 编辑器这侧的判据（D-0126）—— 换基座后按 **ProseMirror + JSON 落库** 这个新模型重写。
 *
 * 谁看得见 DOM 和模型，谁就判这一组不变量 —— 现场包里那几段「DOM 是什么 / 模型是什么 / 光标在哪」
 * 就是这儿供出去的。判出来只调 `ctx.bugs.broken()`：记事件 + 自动抓现场（同一判据 5 秒内只抓一次，
 * 那侧管）。这里**不写盘、不弹窗**，也不 import bug 插件 —— `ctx.get('bugs')` 是软依赖，
 * bug 插件被卸了这儿就什么都不做（判据跟着哑，比崩掉好）。
 *
 * ★ 新模型跟旧 BlockSuite 的两处差，全篇都绕不开，先说清：
 *   · 一个块 = `blockContainer`（DOM 是 `div.sn-block[data-id]`），块的文字在它的**第一个孩子**（内容节点）里，
 *     嵌套子块挂在后面的 `blockGroup`（DOM 是 `div.sn-group`）里 —— 别拿整个 `.sn-block` 的 textContent 当块文字。
 *   · **NodeView 往 DOM 里塞界面**（代码块的语言选择器 / 复选框 / 公式的 KaTeX 排版 / 子页面卡片上的标题）——
 *     旧基座靠在 `INLINE_ROOT_ATTR` 上划这个边界，这里靠 PM 的位置：`domAtPos` 划一段 Range 只取内容区。
 *   判据都**便宜**：每次最多扫一遍当前开着的几篇（每块先看便宜的 textContent，可疑了才算精确那一下）。
 *   跑在 selectionchange（节流 150ms）和粘贴之后 —— 不是全量体检，是为了「出错的那一刻正好有人在场」。
 */
import type { Context } from 'cordis'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import type { BugsService } from '../../src/kernel/contract'
import { liveDocs, type LiveDoc } from './editor'

/** 两次检查之间至少隔这么久。selectionchange 是几乎每帧级的，不节流会把主线程吃掉。 */
const THROTTLE_MS = 150
/** 粘贴之后等这么久再看结果 —— 插入是异步的（上游还有中间件要跑）。 */
const PASTE_AFTER_MS = 300
/** 改过之后多久还没落库就算「卡住」——正常节流是 300ms，给足余量。 */
const STALE_MS = 60_000
/** 这条要定期看（不是靠事件）：它盯的正是「什么都没发生」。 */
const STALE_TICK_MS = 30_000
/** 现场包是给人看的，不是归档 —— 最多这么些行。 */
const MAX_ROWS = 12

/** 焦点可能落在 shadow root 里（弹层有时就在那儿）。 */
function deepActive(): Element | null {
  let active: Element | null = document.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active
}

const codesOf = (s: string): string =>
  [...s].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join(' ')

/**
 * 「奇字符」——**看不见但会出事的那些**：C0/C1 控制符、零宽 / BOM / 对象替换符、私用区（PUA）、
 * 非字符、标签字符。按「码点 × 个数」报出来，方框到底是哪个字符看一眼就够。
 *
 * ★ 用**黑名单**，不用白名单：白名单会把 `→ ★ · —` 这些正常排版字符全报进来（本仓库的文档里
 *   满地都是），现场包会被噪音淹掉，反而看不见真东西。这里的判据是「字体里通常没有字形」的那种。
 */
function isOdd(c: number): boolean {
  if (c < 0x20 && c !== 0x0a && c !== 0x09) return true // C0（换行 / 制表除外）
  if (c >= 0x7f && c <= 0x9f) return true // DEL + C1
  if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0x2060) return true // 零宽 / 词连接
  if (c === 0xfeff || c === 0xfffc || c === 0xfffd) return true // BOM / 对象替换符 / 替换符
  if (c >= 0xe000 && c <= 0xf8ff) return true // PUA（BMP）
  if (c >= 0xf0000 && c <= 0xffffd) return true // PUA-A
  if (c >= 0x100000 && c <= 0x10fffd) return true // PUA-B
  if (c >= 0xfdd0 && c <= 0xfdef) return true // 非字符
  if ((c & 0xfffe) === 0xfffe) return true // 每个平面最后两个码点（也是非字符）
  if (c >= 0xe0000 && c <= 0xe007f) return true // 标签字符（不可见）
  return false
}

function oddChars(s: string): string {
  const m = new Map<number, number>()
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (isOdd(c)) m.set(c, (m.get(c) ?? 0) + 1)
  }
  return [...m].map(([c, n]) => `${c.toString(16)}×${n}`).join(' ')
}

/** 模型里的一个块 —— DOM 侧定位内容区要用它的 `pos`。 */
interface Block {
  id: string
  /** 内容节点的类型名（paragraph / heading / codeBlock / …）—— 现场里一眼看出是哪种块。 */
  type: string
  /** 它在 doc 里的位置（`blockContainer` 的起点）。 */
  pos: number
  node: PMNode
  /** 块的文字（模型侧，就是要落库的那份）。 */
  text: string
  /** atom 块（图片 / 公式 / 子页面卡片…）或内容里夹了行内原子（@提及 / 行内公式）—— 它们渲染出来
   *  自带文字，DOM 天然比模型多，所以 DOM 对比跳过（奇字符照扫）。 */
  atomic: boolean
}

function hasInlineAtom(content: PMNode): boolean {
  let found = false
  content.descendants((n) => {
    if (n.isInline && n.isAtom) {
      found = true
      return false
    }
    return true
  })
  return found
}

/** 一遍走完 doc：id → 块。同一个 id 出现两次时留第一个（重复由 `dup-id` 那条判据报）。 */
function modelBlocks(doc: PMNode): Map<string, Block> {
  const out = new Map<string, Block>()
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockContainer' || node.childCount === 0) return true
    const id = String(node.attrs.id ?? '')
    if (id === '' || out.has(id)) return true
    const content = node.child(0)
    out.set(id, {
      id,
      type: content.type.name,
      pos,
      node,
      text: content.textContent,
      // atom 块（图片 / 公式 / 子页面卡片…）和夹了行内原子的块：DOM 天然比模型多文字，DOM 对比跳过。
      atomic: content.isAtom || hasInlineAtom(content),
    })
    return true
  })
  return out
}

/** 一个 `.sn-block` 直接子元素里（排除 `sn-group`）的文字 —— 便宜，但会把 NodeView 的界面文字算进来。 */
function domBlockText(el: Element): string {
  let s = ''
  for (const child of el.children) {
    if (child.classList.contains('sn-group')) continue
    s += child.textContent ?? ''
  }
  return s
}

function firstContentEl(host: Element): Element | null {
  for (const child of host.children) if (!child.classList.contains('sn-group')) return child
  return null
}

/**
 * 块内容在 DOM 里渲染出的文字 —— **只取内容区**，NodeView 塞的界面（语言选择器 / 复选框 / KaTeX）不算。
 * 靠 PM 的位置划 Range：内容节点占 `[pos+1, pos+1+nodeSize]`，它的行内内容占 `[pos+2, pos+2+content.size]`。
 * 内容本来就是空的（atom 块 / 空段落）→ `''`；位置落边界上取不出来 → `null`（调用方据此跳过 DOM 对比，别报假的）。
 */
function contentDomText(view: EditorView, pos: number, node: PMNode): string | null {
  const content = node.childCount > 0 ? node.child(0) : undefined
  if (content === undefined || content.content.size === 0) return ''
  try {
    const from = pos + 2
    const a = view.domAtPos(from)
    const b = view.domAtPos(from + content.content.size)
    const range = document.createRange()
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset)
    return range.toString()
  } catch {
    return null
  }
}

/** 一行现场。**正常的块不进现场**。 */
interface Row {
  id: string
  type: string
  dom: string
  model: string
  domOdd: string
  modelOdd: string
  /** DOM 内容区 ≠ 模型文字（方框那种 bug 的另一面）。 */
  mismatch: boolean
  html?: string
}

interface Scan {
  rows: Row[]
  /** DOM 里挂着块、模型里没有。 */
  orphans: number
  /** 同一个 id 在 DOM 里出现不止一次。 */
  dups: number
}

/** 扫一遍某一篇的每一个块：对不上的、有奇字符的收进现场；顺手数孤儿与重复。 */
function scan(doc: LiveDoc, blocks: Map<string, Block>): Scan {
  const rows: Row[] = []
  const seen = new Set<string>()
  let dups = 0
  let orphans = 0
  for (const el of doc.view.dom.querySelectorAll<HTMLElement>('.sn-block[data-id]')) {
    const id = el.dataset.id ?? ''
    if (id === '') continue
    if (seen.has(id)) dups += 1
    seen.add(id)
    const blk = blocks.get(id)
    if (blk === undefined) {
      orphans += 1
      continue
    }
    // 先看便宜的：既没奇字符、又不像是 DOM≠模型，就直接过 —— 精确那一下（domAtPos）只留给可疑的块。
    const cheap = domBlockText(el)
    const modelOdd = oddChars(blk.text)
    if (oddChars(cheap) === '' && modelOdd === '' && (blk.atomic || cheap === blk.text)) continue
    // 可疑了才取精确的（只含内容区）。取不出来（`null`）就这一块不比 DOM —— 报个假的更坏事。
    const precise = contentDomText(doc.view, blk.pos, blk.node)
    const domOdd = oddChars(precise ?? cheap)
    const mismatch = precise !== null && !blk.atomic && precise !== blk.text
    if (!mismatch && domOdd === '' && modelOdd === '') continue
    const dom = precise ?? cheap
    if (rows.length >= MAX_ROWS) break
    const row: Row = {
      id,
      type: blk.type,
      dom: dom.slice(0, 80),
      model: blk.text.slice(0, 80),
      domOdd,
      modelOdd,
      mismatch,
    }
    // 头几块留 html —— 方框是「字符」还是「元素」，一看 html 就知道。
    if (rows.length < 3) row.html = (firstContentEl(el)?.innerHTML ?? '').slice(0, 600)
    rows.push(row)
  }
  return { rows, orphans, dups }
}

/** 光标那一块：id / 类型 / DOM 文字 / 模型文字。不在任何块里（比如焦点在标题框）就不算。 */
function caretOf(doc: LiveDoc, blocks: Map<string, Block>): { id: string; blk: Block | undefined; dom: string; html: string; nodes: number } | null {
  const host = deepActive()?.closest<HTMLElement>('.sn-block[data-id]')
  const id = host?.dataset.id ?? ''
  if (host == null || id === '') return null
  const blk = blocks.get(id)
  const precise = blk !== undefined ? contentDomText(doc.view, blk.pos, blk.node) : null
  const dom = precise ?? domBlockText(host)
  return { id, blk, dom, html: (firstContentEl(host)?.innerHTML ?? '').slice(0, 600), nodes: host.childElementCount }
}

/** 光标所在的是哪一篇（取焦点那栏；判断不了就第一栏）。 */
function focusDoc(): LiveDoc | null {
  const all = liveDocs()
  if (all.length === 0) return null
  const active = deepActive()
  if (active != null) {
    for (const d of all) if (d.view.dom.contains(active)) return d
  }
  return all[0] ?? null
}

function selectionFacts(view: EditorView): Record<string, unknown> {
  const sel = view.state.selection
  return {
    from: sel.from,
    to: sel.to,
    empty: sel.empty,
    anchor: sel.anchor,
    head: sel.head,
    text: view.state.doc.textBetween(sel.from, sel.to, '\n').slice(0, 80),
  }
}

export function installDiagnostics(ctx: Context): () => void {
  let last = 0
  /** 粘贴前那一刻的块 id 集合，用来认「这次粘贴新加了哪些块」。 */
  let pasted: { docId: string; ids: Set<string> } | null = null

  /** 「改过但一直没落库」：记下第一次看见它脏的时刻，60s 后还脏就是卡住了。 */
  const dirtySince = new Map<string, number>()

  const checkDoc = (bugs: BugsService, doc: LiveDoc): void => {
    const blocks = modelBlocks(doc.view.state.doc)
    const { rows, orphans, dups } = scan(doc, blocks)

    // ① 逐块扫：DOM 内容区 ≠ 模型文字（第一版判据就是这么抓方块那种 bug 的）。
    //    ★ 扫**整篇**，不是只看光标那一行：真凶常常不在光标底下。
    const mismatch = rows.filter((r) => r.mismatch)
    if (mismatch.length > 0) {
      const first = mismatch[0]!
      bugs.broken(
        'dom-model',
        ctx.i18n.t('bugs.domModel'),
        `${mismatch.length} 块对不上（第一块 ${first.id}［${first.type}］：DOM=${JSON.stringify(first.dom)} 模型=${JSON.stringify(first.model)}）`,
        { lines: rows },
      )
    }

    // ② 看不见 / 罕见的字符 —— 这一版最要紧的一条（方框就是这个）。
    const odd = rows.filter((r) => r.domOdd !== '' || r.modelOdd !== '')
    if (odd.length > 0) {
      const first = odd[0]!
      bugs.broken(
        'odd-chars',
        ctx.i18n.t('bugs.odd'),
        `${odd.length} 块有看不见的字符（第一块 ${first.id}［${first.type}］：DOM=${first.domOdd} 模型=${first.modelOdd}）`,
        { lines: rows },
      )
    }

    // ③ 光标站在一块已经不存在的块上。
    const caret = caretOf(doc, blocks)
    if (caret !== null && caret.blk === undefined) {
      bugs.broken('dangling-selection', ctx.i18n.t('bugs.dangling'), `块 ${caret.id}`)
    }

    // ④ DOM 里挂着块、模型里没有（孤儿）· ⑤ 同一个 id 出现两次。
    if (orphans > 0) {
      bugs.broken('orphan-block', ctx.i18n.t('bugs.orphan'), `DOM 里有 ${orphans} 个块不在模型里`)
    }
    if (dups > 0) {
      bugs.broken('dup-id', ctx.i18n.t('bugs.dupId'), `同一个 block id 在 DOM 里出现 ${dups + 1} 次`)
    }
  }

  const runCheck = (): void => {
    const bugs = ctx.get('bugs')
    if (!bugs) return
    const now = Date.now()
    if (now - last < THROTTLE_MS) return
    last = now
    for (const doc of liveDocs()) checkDoc(bugs, doc)
  }

  /** 粘贴之后：新加的块里出现**两份一模一样的文字** → 一次粘贴插了两遍。 */
  const checkPaste = (): void => {
    const bugs = ctx.get('bugs')
    const snap = pasted
    pasted = null
    if (!bugs || snap === null) return
    const doc = liveDocs().find((d) => d.id === snap.docId)
    if (doc === undefined) return
    const seen = new Map<string, string>()
    for (const [id, blk] of modelBlocks(doc.view.state.doc)) {
      if (snap.ids.has(id)) continue
      const text = blk.text.trim()
      if (text === '') continue
      const was = seen.get(text)
      if (was !== undefined) {
        bugs.broken('paste-twin', ctx.i18n.t('bugs.pasteTwin'), `「${text.slice(0, 40)}」出现两份（${was} / ${id}）`)
        continue
      }
      seen.set(text, id)
    }
  }

  // ⑥「改过但一直没落库」—— 最危险的一类，因为它**什么都不抛**，表现只是「关掉再开，刚写的没了」。
  //   ★ 这条必须**定期**看：它盯的就是「什么都没发生」；判据 = 块脏了 60s 还没变干净（落库成功会立刻清脏）。
  const staleTick = (): void => {
    const bugs = ctx.get('bugs')
    if (!bugs) return
    const now = Date.now()
    const alive = new Set<string>()
    for (const doc of liveDocs()) {
      alive.add(doc.id)
      if (!doc.dirty || doc.muted) {
        dirtySince.delete(doc.id)
        continue
      }
      const since = dirtySince.get(doc.id)
      if (since === undefined) {
        dirtySince.set(doc.id, now)
        continue
      }
      if (now - since > STALE_MS) {
        bugs.broken('stale-doc', ctx.i18n.t('bugs.stale'), `「${doc.id}」改过但 ${Math.round((now - since) / 1000)}s 没落库`)
      }
    }
    for (const id of dirtySince.keys()) if (!alive.has(id)) dirtySince.delete(id)
  }

  /** 眼前这一篇 + 光标那一行 —— 抓现场时最要紧的几段。 */
  const facts = (): Record<string, unknown> => {
    const doc = focusDoc()
    if (doc === null) return { doc: null, blocks: 0, lines: [] }
    const blocks = modelBlocks(doc.view.state.doc)
    const out: Record<string, unknown> = {
      doc: doc.id,
      blocks: blocks.size,
      // 「还没落库」这个事实本身也进现场 —— 手抓（⌘⇧B）时它常常就是答案。
      dirty: doc.dirty,
      // 逐块扫的结果：手抓也带上 —— 那次也想知道「哪一块不对劲」。
      lines: scan(doc, blocks).rows,
    }
    const caret = caretOf(doc, blocks)
    if (caret !== null) {
      out.block = { id: caret.id, type: caret.blk?.type ?? null, text: caret.blk?.text ?? null }
      out.dom = { text: caret.dom, codes: codesOf(caret.dom), html: caret.html, nodes: caret.nodes }
      out.selection = selectionFacts(doc.view)
    }
    return out
  }

  const onSelectionChange = (): void => runCheck()
  const onKey = (e: KeyboardEvent): void => {
    // 方向键是「光标动、内容不动」的那类 —— 方框那种 bug 就是在这一下冒出来的。
    if (e.key.startsWith('Arrow')) setTimeout(runCheck, 60)
  }
  const onPaste = (): void => {
    const doc = focusDoc()
    pasted = doc === null ? null : { docId: doc.id, ids: new Set(modelBlocks(doc.view.state.doc).keys()) }
    setTimeout(checkPaste, PASTE_AFTER_MS)
    setTimeout(runCheck, PASTE_AFTER_MS + 60)
  }

  document.addEventListener('selectionchange', onSelectionChange, true)
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('paste', onPaste, true)
  const tick = window.setInterval(staleTick, STALE_TICK_MS)
  const offProvider = ctx.get('bugs')?.provider(facts)

  return () => {
    document.removeEventListener('selectionchange', onSelectionChange, true)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('paste', onPaste, true)
    window.clearInterval(tick)
    offProvider?.()
  }
}
