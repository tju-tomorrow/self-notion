/**
 * 每个块的 ⠿ 拖动手柄（用户：「让每一个块可以用这个拖动」，D-0117）。
 *
 * 上游那个 `affine-drag-handle-widget` 在我们这套结构里没露过面，所以自己画一个：
 * 悬停块 → 左边浮出 ⠿ → 按住拖 → 落点线 → 松手。
 *
 * ★ 搬块调的是**上游的** `store.moveBlocks`（块模型 / 顺序 / 落库全是 AFFiNE 那套），
 *   这里只负责「手感」：浮出的手柄、跟着光标的拖影、那条落点线。
 * ★ 拖影和落点线一律 `pointer-events: none` —— 不然 `elementFromPoint` 量到的是它们自己。
 */
import type { BlockModel, Store } from '@blocksuite/affine/store'

/** 手柄浮在块的左边多少像素 —— 就是手柄自己的宽度，右缘贴着块的左缘（不留缝）。 */
const HANDLE_GAP = 20
/** 拖影里最多显示几个字。 */
const GHOST_LIMIT = 40

/** 这些块不给手柄：页面/note 是容器，搬它们没有意义。 */
const NO_HANDLE = new Set(['affine:page', 'affine:note'])

interface Hit {
  id: string
  rect: DOMRect
}

/** 只写**变化了**的属性 —— 每帧重写同一个值，浏览器也要重算一遍样式。 */
function put(el: HTMLElement, props: Readonly<Record<string, string>>): void {
  for (const key of Object.keys(props)) {
    const value = props[key]
    if (el.style.getPropertyValue(key) !== value) el.style.setProperty(key, value)
  }
}

export function mountBlockDrag(root: HTMLElement, store: Store): () => void {
  const handle = document.createElement('button')
  handle.type = 'button'
  handle.className = 'sn-block-handle'
  handle.setAttribute('aria-label', '拖动以移动')
  for (let i = 0; i < 6; i++) handle.append(document.createElement('span'))

  const ghost = document.createElement('div')
  ghost.className = 'sn-block-drag-ghost'

  const line = document.createElement('div')
  line.className = 'sn-block-drop-line'

  // ★ 挂在**编辑器里面**：鼠标移到手柄上时它还在 `root` 的子树里，
  //   这样 `pointermove` 不会因为「离开编辑器」而把手柄收掉。
  root.append(handle, ghost, line)

  let hovered: string | null = null
  /** 现在这个块在屏幕上的矩形 —— 手柄和它之间那段页边也要算「还在它身上」。 */
  let hoveredRect: DOMRect | null = null
  let drag: { id: string; pointerId: number } | null = null
  let drop: { parent: BlockModel; target: BlockModel; before: boolean } | null = null

  /** 某一点上是哪个块（手柄 / 拖影 / 落点线都不接鼠标，所以量到的一定是正文）。 */
  const hitAt = (x: number, y: number): Hit | null => {
    const el = document.elementFromPoint(x, y)
    const block = el instanceof Element ? el.closest<HTMLElement>('[data-block-id]') : null
    const id = block?.getAttribute('data-block-id') ?? null
    if (!id || !block || !root.contains(block)) return null
    const model = store.getModelById(id)
    if (!model || NO_HANDLE.has(model.flavour)) return null
    return { id, rect: block.getBoundingClientRect() }
  }

  const place = (rect: DOMRect): void => {
    // `transform` 走合成层，不动布局 —— 每一下 pointermove 都改 `left/top` 会一路重排。
    put(handle, { transform: `translate(${rect.left - HANDLE_GAP}px, ${rect.top + 2}px)` })
  }

  const show = (hit: Hit): void => {
    hovered = hit.id
    hoveredRect = hit.rect
    place(hit.rect)
    handle.dataset.on = '1'
  }

  const hide = (): void => {
    hovered = null
    hoveredRect = null
    delete handle.dataset.on
  }

  /**
   * 这一点还在「块 + 手柄」这一片里吗。
   *
   * ★ 鼠标从块往左去抓手柄，中间要经过一段页边 —— 那里不属于任何块（`hitAt` 量不到），
   *   早期版本到那儿就当成「走开了」把手柄收掉，于是「想去拖的时候就消失了」。
   * ★ 不量 DOM：手柄就在块的左边 `HANDLE_GAP` 处，直接用那个矩形推。
   */
  const stillNearby = (x: number, y: number): boolean => {
    if (!hoveredRect) return false
    const pad = 12
    return (
      x >= hoveredRect.left - HANDLE_GAP - pad &&
      x <= hoveredRect.right + pad &&
      y >= hoveredRect.top - pad &&
      y <= hoveredRect.bottom + pad
    )
  }

  /** `child` 是不是在 `ancestor` 底下 —— 不能把块拖进自己的子树。 */
  const under = (child: string, ancestor: string): boolean => {
    for (let p = store.getParent(child); p; p = store.getParent(p.id)) {
      if (p.id === ancestor) return true
    }
    return false
  }

  /** 悬停：鼠标底下那个块。 */
  const stepHover = (x: number, y: number): void => {
    const hit = hitAt(x, y)
    if (hit) {
      if (hit.id !== hovered) show(hit)
      else {
        hoveredRect = hit.rect
        place(hit.rect)
      }
      return
    }
    // 量不到块：可能正走在「块 → 手柄」那段页边上 —— 别急着收。
    if (hovered !== null && stillNearby(x, y)) return
    hide()
  }

  /** 拖动：拖影跟着光标 + 算落点（落点线画在目标块的上缘 / 下缘）。 */
  const stepDrag = (x: number, y: number): void => {
    if (!drag) return
    put(ghost, { transform: `translate(${x + 14}px, ${y + 12}px)` })
    const hit = hitAt(x, y)
    drop = null
    if (hit && hit.id !== drag.id && !under(hit.id, drag.id)) {
      const target = store.getModelById(hit.id)
      const parent = target ? store.getParent(hit.id) : null
      if (target && parent) {
        const before = y < hit.rect.top + hit.rect.height / 2
        drop = { parent, target, before }
        put(line, {
          display: 'block',
          width: `${hit.rect.width}px`,
          transform: `translate(${hit.rect.left}px, ${before ? hit.rect.top - 1 : hit.rect.bottom - 1}px)`,
        })
      }
    }
    if (!drop) put(line, { display: 'none' })
  }

  /**
   * ★ 一帧只算一次（用户：「移动的时候特别卡」）。
   *
   * 指针事件比帧快得多，每来一个就 `elementFromPoint` + 量矩形 + 写样式的话，
   * 读一下写一下交替，浏览器每一下都要重算布局 —— 拖起来就是一顿一顿的。
   * 这里只记住最新的那一点，落到下一帧再算。
   */
  let queued: { x: number; y: number } | null = null
  let frame = 0
  const queue = (x: number, y: number): void => {
    queued = { x, y }
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const p = queued
      queued = null
      if (!p) return
      if (drag) stepDrag(p.x, p.y)
      else stepHover(p.x, p.y)
    })
  }

  const onMove = (e: PointerEvent): void => {
    const target = e.target
    // 停在自己身上：保持现在这个块（不然鼠标一碰手柄它就没了）。
    if (target instanceof Element && (target === handle || handle.contains(target))) return
    queue(e.clientX, e.clientY)
  }

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !hovered) return
    const model = store.getModelById(hovered)
    if (!model) return
    // 手柄这一下不归 `select-anywhere`（它会把光标挪走）。
    e.preventDefault()
    e.stopPropagation()
    handle.setPointerCapture(e.pointerId)
    drag = { id: hovered, pointerId: e.pointerId }
    const text = (model.text?.toString() ?? '').trim().slice(0, GHOST_LIMIT)
    ghost.textContent = text || model.flavour
    put(ghost, { display: 'block' })
    handle.dataset.dragging = '1'
  }

  const onUp = (e: PointerEvent): void => {
    if (!drag) return
    const moved = drop
    const id = drag.id
    drag = null
    drop = null
    put(ghost, { display: 'none' })
    put(line, { display: 'none' })
    delete handle.dataset.dragging
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
    const model = store.getModelById(id)
    if (!moved || !model) return
    store.moveBlocks([model], moved.parent, moved.target, moved.before)
    // 块挪完了：手柄跟着它走（DOM 会在这一帧之后重排，下一帧再量）。
    requestAnimationFrame(() => {
      const el = root.querySelector<HTMLElement>(`[data-block-id="${id}"]`)
      if (el) place(el.getBoundingClientRect())
    })
  }

  // 手柄自己的那一串（拖的时候指针被它捕获，事件都落在这儿）。
  handle.addEventListener('pointerdown', onDown)
  handle.addEventListener('pointermove', (e) => queue(e.clientX, e.clientY))
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
  root.addEventListener('pointermove', onMove)
  // 滚了 / 鼠标出编辑器 / 打字改布局 —— 位置就过期了，收掉。
  root.addEventListener('scroll', hide, true)
  root.addEventListener('pointerleave', () => {
    if (!drag) hide()
  })

  return () => {
    if (frame !== 0) cancelAnimationFrame(frame)
    handle.remove()
    ghost.remove()
    line.remove()
  }
}
