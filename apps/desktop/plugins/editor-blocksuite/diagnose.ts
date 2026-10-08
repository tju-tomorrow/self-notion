/**
 * 编辑器这侧的判据（D-0126）。**谁看得见 DOM 和模型，谁就判这一组不变量** ——
 * 现场包里那几段「DOM 是什么 / 模型是什么 / 选区在哪」就是这儿供出去的。
 *
 * 判出来了只调 `ctx.bugs.broken()`：记进事件带 + 自动抓一份现场（同一个判据 5 秒内只抓一次，
 * 那侧管）。这里**不写盘、不弹窗**，也不 import bug 插件 —— `ctx.get('bugs')` 是软依赖，
 * bug 插件被卸了这儿就什么都不做（判据跟着一起哑，比崩掉好）。
 *
 * 判据都是**便宜**的（每次最多扫一遍当前那一篇的块），跑在 selectionchange（节流 150ms）
 * 和粘贴之后 —— 不是为了全量体检，是为了「出错的那一刻正好有人在场」。
 */
import type { Context } from 'cordis'
import type { BlockStdScope } from '@blocksuite/affine/std'
import { INLINE_ROOT_ATTR } from '@blocksuite/affine/std/inline'
import { DOC_SAVED, OPEN_DOC } from '../../src/kernel/contract'
import { liveStd, liveDocId } from './editor'

/** 两次检查之间至少隔这么久。selectionchange 是每帧级的，不节流会把主线程吃掉。 */
const THROTTLE_MS = 150
/** 粘贴之后等这么久再看结果 —— 插入是异步的（上游还有中间件要跑）。 */
const PASTE_AFTER_MS = 300
/** 改过之后多久还没落库就算「卡住」——正常节流是 300ms，给足余量。 */
const STALE_MS = 60_000
/** 这条要定期看（不是靠事件）：它盯的正是「什么都没发生」。 */
const STALE_TICK_MS = 30_000

/** 焦点可能落在 shadow root 里（BlockSuite 的弹层就在那儿）。 */
function deepActive(): Element | null {
  let active: Element | null = document.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active
}

const textOf = (std: BlockStdScope | undefined, id: string): string =>
  std?.store.getBlock(id)?.model.text?.toString() ?? ''

/** 当前光标在哪一块、那一块 DOM 里是什么字。 */
function caretFacts(): { blockId: string; dom: string; model: string } | null {
  const active = deepActive()
  const host = active?.closest<HTMLElement>('[data-block-id]')
  const root = host?.querySelector<HTMLElement>(`[${INLINE_ROOT_ATTR}]`)
  const blockId = host?.dataset.blockId
  if (!blockId || !root) return null
  return { blockId, dom: root.textContent ?? '', model: '' }
}

/** 一篇文档里所有块的 id（含嵌套）。 */
function blockIds(std: BlockStdScope | undefined): string[] {
  const root = std?.store.root
  if (!root) return []
  const out: string[] = []
  const walk = (model: typeof root): void => {
    out.push(model.id)
    for (const child of model.children) walk(child)
  }
  walk(root)
  return out
}

/**
 * 「奇字符」：**看不见但会出事的那些** —— 零宽（200b/200c/200d/2060）、BOM、对象替换符、
 * 私有区、控制符。按「码点 × 个数」报出来，方框到底是哪个字符看一眼就够。
 *
 * ★ 用**黑名单**，不用白名单：白名单会把 `→ ★ · —` 这些正常排版字符全报进来
 *   （本仓库的文档里满地都是），现场包会被噪音淹掉，反而看不见真东西。
 */
function oddChars(s: string): string {
  const m = new Map<number, number>()
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    const bad =
      (c < 0x20 && c !== 0x0a && c !== 0x09) ||
      (c >= 0x7f && c <= 0x9f) ||
      c === 0x200b ||
      c === 0x200c ||
      c === 0x200d ||
      c === 0x2060 ||
      c === 0xfeff ||
      c === 0xfffc ||
      c === 0xfffd ||
      (c >= 0xe000 && c <= 0xf8ff) ||
      (c >= 0xfff0 && c <= 0xffff)
    if (bad) m.set(c, (m.get(c) ?? 0) + 1)
  }
  return [...m].map(([c, n]) => `${c.toString(16)}×${n}`).join(' ')
}

/** 一行现场：谁那行 DOM 和模型对不上 / 谁那行有奇字符。**正常的行不进现场**。 */
interface LineFacts {
  id: string
  flavour: string | null
  dom: string
  model: string
  domOdd: string
  modelOdd: string
  vtext: number
  html?: string
}

/** 扫一遍当前这一篇的每一行。最多 12 行 —— 现场包是给人看的，不是归档。 */
function oddLines(std: BlockStdScope | undefined): LineFacts[] {
  if (!std) return []
  const out: LineFacts[] = []
  for (const el of document.querySelectorAll<HTMLElement>('[data-block-id]')) {
    const id = el.dataset.blockId ?? ''
    if (id === '') continue
    const root = el.querySelector<HTMLElement>(`[${INLINE_ROOT_ATTR}]`)
    if (!root) continue
    const block = std.store.getBlock(id)?.model
    // ★ 只有「本来就有 text」的块才比 —— `affine:page` / `affine:note` 没有 text，
    //   它们的 inline root 里那点空白本来就不该进模型（第一版判据就是这么误报的）。
    if (block === undefined || block.text === undefined) continue
    const dom = root.textContent ?? ''
    const model = block.text.toString()
    const domOdd = oddChars(dom)
    const modelOdd = oddChars(model)
    if (dom === model && domOdd === '' && modelOdd === '') continue
    const row: LineFacts = {
      id,
      flavour: block.flavour,
      dom: dom.slice(0, 80),
      model: model.slice(0, 80),
      domOdd,
      modelOdd,
      vtext: root.querySelectorAll('[data-v-text],v-text').length,
    }
    // 头几行的 html 留下来 —— 方框是「字符」还是「元素」，一看 html 就知道。
    if (out.length < 4) row.html = root.innerHTML.slice(0, 600)
    out.push(row)
    if (out.length >= 12) break
  }
  return out
}

export function installDiagnostics(ctx: Context): () => void {
  let last = 0
  let pastedIds: Set<string> | null = null

  /** 眼前这一篇 + 光标那一行 —— 抓现场时最要紧的几段。 */
  const facts = (): Record<string, unknown> => {
    const std = liveStd()
    const docId = liveDocId()
    const caret = caretFacts()
    const out: Record<string, unknown> = {
      doc: docId === null ? null : docId,
      blocks: blockIds(std).length,
      // 逐行扫的结果：手动抓（⌘⇧B）也带上 —— 那次也想知道「哪一行不对劲」。
      lines: oddLines(std),
    }
    if (std && caret) {
      const block = std.store.getBlock(caret.blockId)?.model
      out.block = { id: caret.blockId, flavour: block?.flavour ?? null, text: block?.text?.toString() ?? null }
      const el = document.querySelector(`[data-block-id="${caret.blockId}"]`)
      const dom: Record<string, unknown> = {
        text: caret.dom,
        codes: [...caret.dom].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join(' '),
        html: el?.querySelector(`[${INLINE_ROOT_ATTR}]`)?.innerHTML ?? null,
        nodes: el?.querySelector(`[${INLINE_ROOT_ATTR}]`)?.childNodes.length ?? null,
      }
      out.dom = dom
      // 选区对象是 BlockSuite 的类实例，过桥前先降级成纯 JSON。
      out.selection = (std.selection.value as readonly unknown[]).map(
        (sel) => JSON.parse(JSON.stringify(sel)) as unknown,
      )
    }
    return out
  }

  const check = (): void => {
    const bugs = ctx.get('bugs')
    const std = liveStd()
    if (!bugs || !std) return
    const now = Date.now()
    if (now - last < THROTTLE_MS) return
    last = now

    const store = std.store
    const known = new Set(blockIds(std))

    // ① 逐行扫：「方框那种 bug」——DOM 和模型对不上、或者有看不见的怪字符。
    //    ★ 扫**整篇**，不是只看光标那一行：真凶常常不在光标底下（第一次抓就抓错了地方）。
    const rows = oddLines(std)
    const mismatch = rows.filter((r) => r.dom !== r.model)
    if (mismatch.length > 0) {
      const first = mismatch[0]!
      bugs.broken(
        'dom-model',
        ctx.i18n.t('bugs.domModel'),
        `${mismatch.length} 行对不上（第一行 ${first.id}：DOM=${JSON.stringify(first.dom)} 模型=${JSON.stringify(first.model)}）`,
        { lines: rows },
      )
    }
    const odd = rows.filter((r) => r.domOdd !== '' || r.modelOdd !== '')
    if (odd.length > 0) {
      const first = odd[0]!
      bugs.broken(
        'odd-chars',
        ctx.i18n.t('bugs.odd'),
        `${odd.length} 行有看不见的字符（第一行 ${first.id}：DOM=${first.domOdd} 模型=${first.modelOdd}）`,
        { lines: rows },
      )
    }

    // ② 选区指向的块在 store 里没有 → 光标站在一块已经不存在的块上。
    const caret = caretFacts()
    if (caret && !known.has(caret.blockId)) {
      bugs.broken('dangling-selection', ctx.i18n.t('bugs.dangling'), `块 ${caret.blockId}`)
    }

    // ③ DOM 里挂着块、store 里没有（孤儿）· ④ 同一个 id 出现两次。
    const seen = new Set<string>()
    let orphans = 0
    let dups = 0
    for (const el of document.querySelectorAll<HTMLElement>('[data-block-id]')) {
      const id = el.dataset.blockId ?? ''
      if (id === '') continue
      if (seen.has(id)) dups += 1
      seen.add(id)
      if (!known.has(id)) orphans += 1
    }
    if (orphans > 0) {
      bugs.broken('orphan-block', ctx.i18n.t('bugs.orphan'), `DOM 里有 ${orphans} 个块不在 store`)
    }
    if (dups > 0) {
      bugs.broken('dup-id', ctx.i18n.t('bugs.dupId'), `同一个 block id 在 DOM 里出现 ${dups + 1} 次`)
    }

    // ⑤ 图片块没有 sourceId —— 半残的图（渲染出来是空框）。
    const bad = store
      .getModelsByFlavour('affine:image')
      .filter((m: { props: { sourceId?: unknown } }) => !m.props.sourceId)
    if (bad.length > 0) {
      bugs.broken('image-source', ctx.i18n.t('bugs.image'), `${bad.length} 个图片块的 sourceId 是空的`)
    }
  }

  /** 粘贴之后：新加的块里出现**两份一模一样的文字** → 一次粘贴插了两遍（D-0124 那个形状）。 */
  const checkPaste = (): void => {
    const bugs = ctx.get('bugs')
    const std = liveStd()
    if (!bugs || !std || pastedIds === null) return
    const before = pastedIds
    pastedIds = null
    const added = blockIds(std).filter((id) => !before.has(id))
    const seen = new Map<string, string>()
    for (const id of added) {
      const text = textOf(std, id)
      if (text.trim() === '') continue
      const was = seen.get(text)
      if (was !== undefined) {
        bugs.broken('paste-twin', ctx.i18n.t('bugs.pasteTwin'), `「${text.slice(0, 40)}」出现两份（${was} / ${id}）`)
        continue
      }
      seen.set(text, id)
    }
  }

  const onSelectionChange = (): void => check()
  const onKey = (e: KeyboardEvent): void => {
    // 方向键是「光标动、内容不动」的那类 —— 方框那种 bug 就是在这一下冒出来的。
    if (e.key.startsWith('Arrow')) setTimeout(check, 60)
  }
  const onPaste = (): void => {
    pastedIds = new Set(blockIds(liveStd()))
    setTimeout(checkPaste, PASTE_AFTER_MS)
    setTimeout(check, PASTE_AFTER_MS + 60)
  }

  // ⑥ 「改过但一直没落库」—— 最危险的一类，因为它**什么都不抛**，
  //   表现只是「关掉再开，刚写的没了」。实测就有一篇从 01:34 起再没写过库。
  //   ★ 这条必须**定期**看：它盯的就是「什么都没发生」。
  const editedAt = new Map<string, number>()
  const savedAt = new Map<string, number>()
  const watchStore = (): void => {
    const std = liveStd()
    const id = liveDocId()
    if (!std || id === null) return
    if (editedAt.get(id) === undefined) {
      // 每篇只挂一次：块一变就记「它脏了」（比等 selectionchange 准）。
      std.store.slots.blockUpdated.subscribe(() => editedAt.set(id, Date.now()))
    }
    editedAt.set(id, editedAt.get(id) ?? Date.now())
  }
  const staleTick = setInterval(() => {
    const bugs = ctx.get('bugs')
    const id = liveDocId()
    if (!bugs || id === null) return
    const edited = editedAt.get(id) ?? 0
    const saved = savedAt.get(id) ?? 0
    if (edited > saved && Date.now() - edited > STALE_MS) {
      bugs.broken(
        'stale-doc',
        ctx.i18n.t('bugs.stale'),
        `「${id}」改过但 ${Math.round((Date.now() - edited) / 1000)}s 没落库`,
      )
    }
  }, STALE_TICK_MS)

  document.addEventListener('selectionchange', onSelectionChange, true)
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('paste', onPaste, true)
  watchStore()
  const offSave = ctx.on(DOC_SAVED, ({ id }) => savedAt.set(id, Date.now()))
  const offOpen = ctx.on(OPEN_DOC, () => watchStore())
  const off = ctx.get('bugs')?.provider(facts)

  return () => {
    document.removeEventListener('selectionchange', onSelectionChange, true)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('paste', onPaste, true)
    clearInterval(staleTick)
    offSave()
    offOpen()
    off?.()
  }
}
