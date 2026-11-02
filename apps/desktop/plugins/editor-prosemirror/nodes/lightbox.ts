/**
 * 图片灯箱：点正文里的图 → 全屏放大，滚轮 / 双指缩放，放大后拖动平移。
 *
 * 纯 DOM —— 这一坨在懒加载的编辑器块里（`view.ts` 那条「不许静态 import react」），
 * 而且要挂到 `document.body` 上，走 React 就得再开一个 root。
 */
import { reportError } from '../../../src/kernel/errors'
import './lightbox.css'

/** 缩放上下限。上限取 8 是因为再大就是看像素点了；下限跟着「适应窗口」走（见 `open`）。 */
const MAX = 8
/** 打开时四周留的边 —— 让「这是浮层、不是正文」看得出来。 */
const MARGIN = 0.92
/** 拖动超过这个距离就不算「点击」（PM 里拖图片会走到 click，不拦就会一边拖一边弹灯箱）。 */
export const DRAG_SLOP = 4

let live: (() => void) | null = null

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

  const paint = (smooth = false) => {
    // 滚轮 / 拖动时不能有过渡，否则跟手感觉全没了。
    img.style.transition = smooth ? 'transform .18s ease' : 'none'
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }

  const reset = (next: number, smooth: boolean) => {
    scale = next
    x = 0
    y = 0
    paint(smooth)
  }

  /** 以光标为锚点缩放：光标底下那个点缩放前后不动（否则一放大就跑出视口）。 */
  const zoomAt = (factor: number, clientX: number, clientY: number) => {
    const rect = img.getBoundingClientRect()
    const next = Math.min(MAX, Math.max(fit * 0.5, scale * factor))
    const k = next / scale - 1
    x -= (clientX - (rect.left + rect.width / 2)) * k
    y -= (clientY - (rect.top + rect.height / 2)) * k
    scale = next
    paint()
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    // 触控板捏合在 WebKit 里是 ctrl+wheel、位移很小，所以给一档更陡的系数。
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY)
  }

  let drag: { fromX: number; fromY: number; atX: number; atY: number } | null = null

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    drag = { fromX: e.clientX, fromY: e.clientY, atX: x, atY: y }
    img.dataset.dragging = 'true'
  }
  const onMove = (e: MouseEvent) => {
    if (!drag) return
    x = drag.atX + (e.clientX - drag.fromX)
    y = drag.atY + (e.clientY - drag.fromY)
    paint()
  }
  const onUp = () => {
    if (!drag) return
    drag = null
    delete img.dataset.dragging
  }

  const onDouble = () => reset(Math.abs(scale - fit) < 0.001 ? (fit < 1 ? 1 : 2) : fit, true)

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    // 抢在编辑器前面：Esc 在这里是「关灯箱」，不该顺手把别的东西也关掉。
    e.stopPropagation()
    close()
  }

  const close = () => {
    if (live !== close) return
    live = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    window.removeEventListener('keydown', onKey, true)
    host.remove()
  }

  live = close
  img.addEventListener('mousedown', onDown)
  img.addEventListener('dblclick', onDouble)
  host.addEventListener('wheel', onWheel, { passive: false })
  // 点空白处关掉。认 `target === host` —— 落在图上松手是「拖完」，不该关。
  host.addEventListener('mousedown', (e) => {
    if (e.target === host) close()
  })
  closeBtn.addEventListener('click', () => close())
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  window.addEventListener('keydown', onKey, true)

  img.addEventListener('load', () => {
    // 大图缩到窗口里，小图不放大（原尺寸就是最好的呈现）。
    fit = Math.min(1, (window.innerWidth * MARGIN) / img.naturalWidth, (window.innerHeight * MARGIN) / img.naturalHeight)
    reset(fit, true)
  })
  img.addEventListener('error', () => {
    reportError('editor.image', new Error(`灯箱打不开这张图：${src}`))
    close()
  })
  img.src = src

  document.body.appendChild(host)
}
