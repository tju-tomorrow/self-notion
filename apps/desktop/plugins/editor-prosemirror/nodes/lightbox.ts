/**
 * 图片灯箱：点正文里的图 → 全屏放大，滚轮 / 双指缩放，放大后拖动平移。
 *
 * 纯 DOM —— 这一坨在懒加载的编辑器块里（`view.ts` 那条「不许静态 import react」），
 * 而且要挂到 `document.body` 上，走 React 就得再开一个 root。
 */
import { reportError, reportNote } from '../../../src/kernel/errors'
import './lightbox.css'

/** 缩放上下限。上限取 8 是因为再大就是看像素点了；下限跟着「适应窗口」走（见 `open`）。 */
const MAX = 8
/** 打开时四周留的边 —— 让「这是浮层、不是正文」看得出来。 */
const MARGIN = 0.92
/** 拖动超过这个距离就不算「点击」（PM 里拖图片会走到 click，不拦就会一边拖一边弹灯箱）。 */
export const DRAG_SLOP = 4
/** 触屏双 tap 的时间与位移窗口。 */
const TAP_MS = 320
const TAP_SLOP = 24

let live: (() => void) | null = null

/** 放大期间这些事件一律不往下传：编辑器还留着这张图的 NodeSelection 和焦点，
 *  PM 的合成收尾 / beforeinput 一次 deleteSelection 就能把选中的原子块整个删掉。 */
const SWALLOWED = [
  'keydown', 'keyup', 'keypress', 'beforeinput', 'input',
  'compositionstart', 'compositionupdate', 'compositionend',
] as const

/**
 * 灯箱开 / 关的广播。原生子 webview（网页版 AI 面板）不吃 CSS —— 它浮在灯箱黑罩上面，
 * 只能靠这个事件让它先收起来。
 */
function notifyLightbox(open: boolean): void {
  window.dispatchEvent(new CustomEvent('sn:lightbox', { detail: { open } }))
}

/** 浮层尺寸优先取可视视口。 */
function viewSize(): { width: number; height: number } {
  const v = window.visualViewport
  return v ? { width: v.width, height: v.height } : { width: window.innerWidth, height: window.innerHeight }
}

interface Point { x: number; y: number }
const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y)
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function openLightbox(src: string): void {
  // 同一时刻只留一个：开着的时候点另一张 = 换图。
  live?.()

  const host = document.createElement('div')
  host.className = 'sn-lightbox'

  const img = document.createElement('img')
  img.className = 'sn-lightbox-img'
  img.draggable = false
  host.appendChild(img)

  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'sn-lightbox-close'
  closeBtn.textContent = '✕'
  host.appendChild(closeBtn)

  let scale = 1
  let fit = 1
  let x = 0
  let y = 0

  const paint = (smooth = false): void => {
    // 滚轮 / 拖动时不能有过渡，否则跟手感觉全没了。
    img.style.transition = smooth ? 'transform .18s ease' : 'none'
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }

  const reset = (next: number, smooth: boolean): void => {
    scale = next
    x = 0
    y = 0
    paint(smooth)
  }

  /** 以某个屏幕点为锚缩放：锚点缩放前后不动。中心用罩子中心 + 平移量算，不吃过渡动画的插值。 */
  const applyZoom = (target: number, ax: number, ay: number): void => {
    const next = Math.min(MAX, Math.max(fit * 0.5, target))
    if (next === scale) return
    const box = host.getBoundingClientRect()
    const cx = box.left + box.width / 2 + x
    const cy = box.top + box.height / 2 + y
    const k = next / scale - 1
    x -= (ax - cx) * k
    y -= (ay - cy) * k
    scale = next
  }

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    // 触控板捏合在 WebKit 里是 ctrl+wheel、位移很小，所以给一档更陡的系数。
    applyZoom(scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY)
    paint()
  }

  // fit ↔ 2x：在适应窗口时放大到 2 倍，其余一律收回到 fit。
  const toggleZoom = (): void => {
    if (Math.abs(scale - fit) < 0.01) reset(Math.min(MAX, Math.max(1, fit * 2)), true)
    else reset(fit, true)
  }

  /* ── Pointer Events：单指平移 / 双指 pinch / 双 tap / 点背景关 ──────────── */
  const active = new Map<number, Point>()
  let pan: { id: number; startX: number; startY: number; atX: number; atY: number } | null = null
  let pinch: { dist: number; mid: Point } | null = null
  let start: { id: number; x: number; y: number; time: number; onImg: boolean; moved: boolean } | null = null
  let lastTap = 0
  let lastTapAt: Point = { x: 0, y: 0 }
  let lastTouchTap = 0

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // 关闭键走原生 click，别被手势当成「点背景」抢先关掉。
    if (closeBtn.contains(e.target as Node)) return
    if (e.pointerType !== 'mouse') {
      // 触屏认领手势：压住兼容鼠标事件和整页缩放/滚动。
      e.preventDefault()
      host.setPointerCapture(e.pointerId)
    }
    active.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (active.size === 1) {
      const onImg = e.target === img
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, time: Date.now(), onImg, moved: false }
      // 鼠标保持原来的随手平移；触屏只在放大后才平移。
      const canPan = e.pointerType === 'mouse' || scale > fit * 1.01
      pan = canPan && onImg ? { id: e.pointerId, startX: e.clientX, startY: e.clientY, atX: x, atY: y } : null
    } else if (active.size === 2) {
      pan = null
      if (start) start.moved = true
      const [a, b] = [...active.values()]
      pinch = { dist: distance(a, b), mid: midpoint(a, b) }
    } else {
      pan = null
      pinch = null
      if (start) start.moved = true
    }
  }

  const onMove = (e: PointerEvent): void => {
    const p = active.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY
    if (start && start.id === e.pointerId && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_SLOP) {
      start.moved = true
    }
    if (active.size >= 2 && pinch) {
      const [a, b] = [...active.values()]
      const d = distance(a, b)
      const m = midpoint(a, b)
      if (pinch.dist > 0) applyZoom(scale * (d / pinch.dist), m.x, m.y)
      // 两指中点挪动 = 平移，跟着一起走。
      x += m.x - pinch.mid.x
      y += m.y - pinch.mid.y
      pinch = { dist: d, mid: m }
      paint()
    } else if (active.size === 1 && pan && pan.id === e.pointerId) {
      x = pan.atX + (e.clientX - pan.startX)
      y = pan.atY + (e.clientY - pan.startY)
      paint()
      img.dataset.dragging = 'true'
    }
  }

  const endPointer = (e: PointerEvent, cancelled: boolean): void => {
    if (!active.has(e.pointerId)) return
    active.delete(e.pointerId)
    delete img.dataset.dragging
    const touch = e.pointerType !== 'mouse'
    if (!cancelled && start && start.id === e.pointerId && !start.moved && Date.now() - start.time < TAP_MS) {
      if (start.onImg) {
        // 双 tap 只给触屏；鼠标双击走原生 dblclick，别在这儿抢。
        if (touch) {
          const now = Date.now()
          if (now - lastTap < TAP_MS && distance({ x: e.clientX, y: e.clientY }, lastTapAt) < TAP_SLOP) {
            lastTouchTap = now
            toggleZoom()
            lastTap = 0
          } else {
            lastTap = now
            lastTapAt = { x: e.clientX, y: e.clientY }
          }
        }
      } else {
        close()
      }
    }
    if (active.size < 2) pinch = null
    if (active.size === 0) {
      pan = null
      start = null
    }
  }
  const onUp = (e: PointerEvent): void => endPointer(e, false)
  const onCancel = (e: PointerEvent): void => endPointer(e, true)
  const onDouble = (): void => {
    // 触屏双 tap 已被 pointer 那条处理，浏览器补发的 dblclick 别再翻一次。
    if (Date.now() - lastTouchTap < 700) return
    toggleZoom()
  }

  const onCapture = (e: Event): void => {
    // 全在 window 捕获阶段拦掉：只 stopPropagation 挡不住同层的其他监听，也不挡
    // defaultPrevented 那条判断；编辑器不该在放大期间收到任何一个键 / 输入 / 合成事件。
    e.stopImmediatePropagation()
    e.stopPropagation()
    if (!(e instanceof KeyboardEvent)) {
      reportNote('lightbox', `拦下 ${e.type}`)
      return
    }
    if (e.key !== 'Escape') return
    e.preventDefault()
    reportNote('lightbox', 'Esc → 只关灯箱')
    close()
  }

  const onResize = (): void => {
    const oldFit = fit
    const { width, height } = viewSize()
    fit = Math.min(1, (width * MARGIN) / img.naturalWidth, (height * MARGIN) / img.naturalHeight)
    if (Math.abs(scale - oldFit) < 0.01) reset(fit, false)
  }

  const close = (): void => {
    if (live !== close) return
    live = null
    for (const type of SWALLOWED) window.removeEventListener(type, onCapture, true)
    host.removeEventListener('pointerdown', onDown)
    host.removeEventListener('wheel', onWheel)
    img.removeEventListener('dblclick', onDouble)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('resize', onResize)
    window.visualViewport?.removeEventListener('resize', onResize)
    host.remove()
    notifyLightbox(false)
  }

  live = close
  notifyLightbox(true)
  host.addEventListener('pointerdown', onDown)
  host.addEventListener('wheel', onWheel, { passive: false })
  img.addEventListener('dblclick', onDouble)
  closeBtn.addEventListener('click', () => close())
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('resize', onResize)
  window.visualViewport?.addEventListener('resize', onResize)
  for (const type of SWALLOWED) window.addEventListener(type, onCapture, true)

  img.addEventListener('load', () => {
    // 大图缩到窗口里，小图不放大（原尺寸就是最好的呈现）。
    const { width, height } = viewSize()
    fit = Math.min(1, (width * MARGIN) / img.naturalWidth, (height * MARGIN) / img.naturalHeight)
    reset(fit, true)
  })
  img.addEventListener('error', () => {
    reportError('editor.image', new Error(`灯箱打不开这张图：${src}`))
    close()
  })
  document.body.appendChild(host)
  img.src = src
}
