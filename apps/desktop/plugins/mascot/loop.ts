/**
 * 宠物那两个 rAF 循环的**开关**：看不见就别画，被遮罩盖住也别画（两个消费方共用）。
 *
 * 停它的两条理由：
 *   1. 看不见（侧栏折叠 / 滚出视野 / 窗口在后台）—— 原来是无条件循环，画给谁看都不知道。
 *   2. **遮罩底下的不画**（`src/ui/scrim.css.ts` 的 `.sn-scrim`）：那层是全屏 `backdrop-filter`，
 *      底下有个 60fps 的动画 = 每帧把整屏重新模糊一遍（Foundry 实测：全屏 blur 把 4K 的
 *      58–60fps 打到 18fps）。宠物停在遮罩后面，摸砂才付得起。
 *
 * 三条停下来的路：`IntersectionObserver`（折叠 / 滚出视野）、`visibilitychange`（切走）、
 * `focus` / `blur`（窗口在后台）。回来自己接着跑。
 */
import { SCRIM } from '../../src/ui/scrim.css'
import type { PixelPet } from './pet'

/** 没人搭理它的时候自己换的小动作。`sleep` 不放进来 —— 睡 1.8 秒就醒很奇怪。 */
const MOODS = ['think', 'confused', 'celebrate'] as const
const MOOD_MS = 1800

export function startPet(canvas: HTMLCanvasElement, engine: PixelPet, moodEveryMs: number): () => void {
  let raf = 0
  let mood = 0
  let sentry = 0
  let last = 0
  let frames = 0
  let onScreen = false
  let awake = false

  /** 这一帧该不该画：被遮罩盖住就不该。 */
  const covered = (): boolean => document.querySelector(`.${SCRIM}`) !== null

  const halt = (): void => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    if (mood) window.clearInterval(mood)
    mood = 0
    if (sentry) window.clearInterval(sentry)
    sentry = 0
    engine.setState('idle')
  }

  /** 遮罩期间的低频哨兵：等它走了再接着跑。 */
  const waitForScrim = (): void => {
    if (sentry) return
    sentry = window.setInterval(() => {
      if (covered()) return
      window.clearInterval(sentry)
      sentry = 0
      run()
    }, 400)
  }

  const step = (now: number): void => {
    // 每 ~20 帧瞄一眼有没有东西盖上来（一次 querySelector，便宜）
    if (++frames % 20 === 0 && covered()) {
      halt()
      waitForScrim()
      return
    }
    // 上限 50ms：切回来的时候 dt 可能有好几秒，一步跳过去帧就全浪费了
    engine.tick(Math.min(0.05, (now - last) / 1000))
    last = now
    raf = requestAnimationFrame(step)
  }

  const beat = (): void => {
    engine.setState(MOODS[Math.floor(Math.random() * MOODS.length)])
    window.setTimeout(() => engine.setState('idle'), MOOD_MS)
  }

  function run(): void {
    if (raf || sentry || !onScreen || !awake || covered()) return
    last = performance.now()
    raf = requestAnimationFrame(step)
    mood = window.setInterval(beat, moodEveryMs)
  }

  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting
    if (onScreen) run()
    else halt()
  })
  io.observe(canvas)

  const sync = (): void => {
    awake = document.visibilityState === 'visible' && document.hasFocus()
    if (awake) run()
    else halt()
  }
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  sync()

  return () => {
    halt()
    io.disconnect()
    document.removeEventListener('visibilitychange', sync)
    window.removeEventListener('focus', sync)
    window.removeEventListener('blur', sync)
  }
}
