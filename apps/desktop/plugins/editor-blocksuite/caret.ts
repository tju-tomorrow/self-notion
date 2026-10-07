/**
 * 自绘光标（D-0076）—— 正文里的插入点，形状可在设置里选：细线 / 方块（终端那种）。
 *
 * **为什么要自己画**：CSS 本来有 `caret-shape: bar | block | underscore`，但 WebKit
 * **没实现**（WebKit bug 319405 还开着，只有 Chrome 144 有）。这个应用是 WKWebView，
 * 所以形状改不了 —— 只能把原生光标弄透明（`editor.css.ts` 里那条 `caret-color`），
 * 自己叠一个小方块跟着插入点跑。
 *
 * ★ 挂在 `body` 上、用 `position: fixed`：`getBoundingClientRect()` 给的就是视口坐标，
 *   fixed 直接对得上，**不用给 BlockSuite 任何一层加 `position: relative`** ——
 *   那会动它的 containing block，拖拽手柄和浮层都可能跟着挪位。
 * ★ 滚动得自己跟：正文那个滚动容器一滚，插入点就换了视口坐标。`scroll` **不冒泡**，
 *   要靠捕获才收得到（`addEventListener(..., true)`）。
 */

export const CARET_KEY = 'sn.editor.caret'

export type CaretShape = 'default' | 'bar' | 'block'

export const CARET_SHAPES: readonly CaretShape[] = ['default', 'bar', 'block']
export const CARET_DEFAULT: CaretShape = 'default'

/** 存过垃圾（换版本、手改库）就回默认，别把界面上弄成一个没有的光标。 */
export function caretShapeOf(raw: unknown): CaretShape {
  return CARET_SHAPES.includes(raw as CaretShape) ? (raw as CaretShape) : CARET_DEFAULT
}

/** 形状写到 `<html data-caret>` 上 —— CSS 认这个属性（`editor.css.ts` 那几条）。 */
export function applyCaretShape(shape: CaretShape): void {
  document.documentElement.dataset.caret = shape
}

export function clearCaretShape(): void {
  delete document.documentElement.dataset.caret
}

/** 插入点在视口里的位置 + 该多高。`height` 跟着那一行自己的行高走（标题行比正文高）。 */
interface Box {
  x: number
  y: number
  height: number
}

/**
 * 量插入点。
 *
 * 折叠的 range 在 WebKit 上 `getClientRects()` 经常是空的，用 `getBoundingClientRect()` 兜；
 * **空块**（一个字都没有）两个都量不出高度，退回落点那个元素的框 —— 它的左边就是插入点。
 */
function caretBox(range: Range): Box | null {
  const at = range.cloneRange()
  at.collapse(true)
  const rects = at.getClientRects()
  const r = rects[rects.length - 1] ?? at.getBoundingClientRect()
  if (r.height > 0) return { x: r.x, y: r.y, height: r.height }

  const node = at.startContainer
  const host = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null
  const box = host?.getBoundingClientRect()
  if (!box || box.height === 0) return null
  return { x: box.left, y: box.top, height: box.height }
}

/**
 * 挂一个自绘光标，跟着 `root` 里的插入点跑。返回卸载函数。
 *
 * 不认设置也照跑 —— 形状和「藏不藏」全在 CSS 那几条里（`html[data-caret]`），
 * 选了默认时这个元素就是 `display: none`，这边白算一帧而已。
 */
export function mountCaret(root: HTMLElement): () => void {
  const el = document.createElement('div')
  el.className = 'sn-caret'
  document.body.appendChild(el)

  let raf = 0
  let typing = 0

  const hide = () => el.removeAttribute('data-on')

  const place = (): void => {
    raf = 0
    const sel = window.getSelection()
    // 没有折叠的选区 —— 那会儿用户看的是高亮，不是插入点。
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return hide()
    const node = sel.anchorNode
    if (!node || !root.contains(node)) return hide()
    // 焦点不在编辑区（点了侧栏、设置、⌘K）就藏起来：光标留在正文上闪是假的。
    const active = document.activeElement
    if (!active || !root.contains(active)) return hide()
    const box = caretBox(sel.getRangeAt(0))
    if (!box) return hide()
    el.style.transform = `translate(${box.x}px, ${box.y}px)`
    el.style.height = `${box.height}px`
    el.setAttribute('data-on', '1')
  }

  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(place)
  }

  /** 打字间歇不闪（原生光标也是这个行为），停手 500ms 后自己闪回来。 */
  const typingNow = (): void => {
    el.setAttribute('data-typing', '1')
    clearTimeout(typing)
    typing = window.setTimeout(() => el.removeAttribute('data-typing'), 500)
  }
  const onInput = (): void => {
    typingNow()
    schedule()
  }
  const onFocus = (): void => schedule()

  document.addEventListener('selectionchange', schedule)
  document.addEventListener('input', onInput, true)
  document.addEventListener('keydown', typingNow, true)
  // `scroll` 不冒泡 —— 捕获才收得到正文滚动容器那一下。
  document.addEventListener('scroll', schedule, true)
  document.addEventListener('focusin', onFocus)
  document.addEventListener('focusout', onFocus)
  window.addEventListener('resize', schedule)

  schedule()

  return () => {
    if (raf) cancelAnimationFrame(raf)
    clearTimeout(typing)
    document.removeEventListener('selectionchange', schedule)
    document.removeEventListener('input', onInput, true)
    document.removeEventListener('keydown', typingNow, true)
    document.removeEventListener('scroll', schedule, true)
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('focusout', onFocus)
    window.removeEventListener('resize', schedule)
    el.remove()
  }
}
