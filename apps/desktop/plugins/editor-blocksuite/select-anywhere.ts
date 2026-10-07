/**
 * 拖选：**整个编辑器都能拖，而且拖出来的选区不会被塌掉**（D-0090）。
 *
 * 两件事合成这一个文件，因为它们是同一段路的头和尾：
 *
 * **① 行尾那片空白不是可编辑区**。contenteditable 只盖住文字本身，行剩下的那截属于块自己；
 *   在那边按下只等于「放一个光标」。而「从右往左选」的手就是往那儿按的 —— 所以那个方向选不中。
 *   解法：按在块身上、可编辑区外时，自己用 `caretRangeFromPoint` 找离指针最近的文字位置起锚。
 *
 * **② 上游会把你刚选上的东西塌掉**。BlockSuite 的 `syncInlineRange`
 *   （`std/src/inline/services/range.ts`）会把「模型里的插入点」**反向写回 DOM 选区**：
 *   `selection.removeAllRanges()` + `addRange(toDomRange(inlineRange))`。而它那个 `TextSelection`
 *   是 `from`=锚点 / `to`=焦点 + 一个 `reverse` 标记 —— **反向拖的时候长度是负数**，
 *   负长度的 range 写回去就是**塌的**。于是每来一次 `selectionchange`，选区就被按回成「塌的光标」，
 *   表现就是**只能移动光标**（errors.log 实测：拖到第 5 下选上了「擦」，第 6 下又塌了，
 *   19 下拖完还是塌的，而且锚点跟着焦点一路跑 —— 正说明有东西在按指针重写塌选区）。
 *   解法：拖的期间**守着自己那条**，`selectionchange` 上发现不是我们的就写回来；
 *   松手后再守 400ms（上游那次同步可能比我们松手晚），然后放手。
 *
 * 为什么会变成「自己管一切」：①要求接管空白区，②要求接管整段拖选（不然写回来的东西会被上游
 * 按掉），两件事只能合成一处，所以现在是**按下即接管**。放行的只有：拖拽手柄 / 工具条 /
 * 斜杠菜单 / 空白拖选层 / 双击（选词、选行交给原生，它做得比我们好）。
 */
import { INLINE_ROOT_ATTR } from '@blocksuite/affine/std/inline'

/** 这些一律不碰，交给上游。 */
const PASSTHROUGH = [
  'affine-drag-handle-widget',
  '.affine-drag-handle-widget',
  // 我们自己那颗 ⠿ 拖动手柄（D-0117）——它自己管拖动，别把光标挪走。
  '.sn-block-handle',
  'affine-toolbar-widget',
  'editor-toolbar',
  'affine-slash-menu',
  'affine-page-dragging-area',
  'affine-block-selection',
].join(',')

/** 松手之后还要守多久：上游那次选区同步可能比我们松手晚。 */
const GUARD_MS = 400

/** 指针底下的文字位置。WebKit 是 `caretRangeFromPoint`，标准名是 `caretPositionFromPoint`。 */
function pointRange(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  const direct = doc.caretRangeFromPoint?.(x, y)
  if (direct) return direct
  const pos = doc.caretPositionFromPoint?.(x, y)
  if (!pos) return null
  const range = document.createRange()
  range.setStart(pos.offsetNode, pos.offset)
  range.collapse(true)
  return range
}

export function selectAnywhere(root: HTMLElement): () => void {
  /** 我们这条选区的两端（按下那点 + 指针当前那点）。null = 没接管。 */
  let own: { a: Node; ao: number; f: Node; fo: number } | null = null
  let tail = 0

  /** 现在 DOM 里那条就是我们写的吗？——是的话不再写，不然 `selectionchange` 会自己套自己。 */
  function isMine(): boolean {
    if (own === null) return false
    const sel = window.getSelection()
    return (
      sel !== null &&
      sel.anchorNode === own.a &&
      sel.anchorOffset === own.ao &&
      sel.focusNode === own.f &&
      sel.focusOffset === own.fo
    )
  }

  function drop(): void {
    own = null
    if (tail !== 0) {
      clearTimeout(tail)
      tail = 0
    }
  }

  /** 把我们那条写回 DOM。上游塌掉一次，这里就写回来一次。 */
  function apply(): void {
    if (own === null || isMine()) return
    const sel = window.getSelection()
    if (sel === null) return
    try {
      // 两端**有方向**：反向拖时焦点落在锚点前面，负方向照样成立。
      sel.setBaseAndExtent(own.a, own.ao, own.f, own.fo)
    } catch {
      // 节点被上游重渲染掉了（换行 / 重建）—— 放弃这一次，别把它抛出去。
      drop()
    }
  }

  const onDown = (e: MouseEvent): void => {
    drop()
    const target = e.target as HTMLElement | null
    if (e.button !== 0 || e.detail > 1 || target === null || target.closest(PASSTHROUGH)) return
    const block = target.closest('[data-block-id]')
    if (block === null || !root.contains(block)) return

    const range = pointRange(e.clientX, e.clientY)
    // 量不到、或最近那段文字不在这个块里 —— 不猜，放行。
    if (range === null || !block.contains(range.startContainer)) return

    e.preventDefault()
    // preventDefault 把原生那次聚焦一起拦了 —— 不补的话，从没聚焦的地方按下去，后面打的字进不去。
    const editable = block.querySelector<HTMLElement>(`[${INLINE_ROOT_ATTR}]`)
    if (editable !== null && !editable.contains(document.activeElement)) editable.focus()

    const at = range.cloneRange()
    at.collapse(true)
    own = { a: at.startContainer, ao: at.startOffset, f: at.startContainer, fo: at.startOffset }
    apply()
  }

  const onMove = (e: MouseEvent): void => {
    if (e.buttons !== 1) {
      drop()
      return
    }
    if (own === null) return
    const range = pointRange(e.clientX, e.clientY)
    if (range === null) return
    e.preventDefault()
    own.f = range.startContainer
    own.fo = range.startOffset
    apply()
  }

  const onUp = (): void => {
    if (own === null) return
    // 再守一小会儿：上游的同步可能排在我们松手之后。
    tail = window.setTimeout(drop, GUARD_MS)
  }

  /** 上游每写一次 DOM 选区我们就被叫醒一次 —— 塌掉的就在这儿写回来。 */
  const onSelChange = (): void => {
    if (own !== null) apply()
  }

  document.addEventListener('mousedown', onDown, true)
  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('mouseup', onUp, true)
  document.addEventListener('selectionchange', onSelChange, true)
  // 拖到窗口外面松手，mouseup 收不到 —— 兜底，不然下一次按下会带着旧锚点。
  window.addEventListener('blur', drop)
  return () => {
    drop()
    document.removeEventListener('mousedown', onDown, true)
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('mouseup', onUp, true)
    document.removeEventListener('selectionchange', onSelChange, true)
    window.removeEventListener('blur', drop)
  }
}
