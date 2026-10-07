/**
 * 一只**别人的页面**里的宠物（`MascotService`，D-0095）—— 内置助手拿它当标志和头像。
 *
 * 跟侧栏那只共用同一套帧、配色、引擎，区别只有两点：
 *   1. 不走路（不喂 `moveTo` / `setBounds`），只是站着眨眼、隔一会儿比划一下；
 *   2. 尺寸由调用方给 —— 引擎画出来的原生尺寸是 `16×12 × scale`，这里事后改 canvas 的
 *      CSS 尺寸把它缩到要的大小（`image-rendering: pixelated`，缩多少都不糊）。
 */
import { useEffect, useRef } from 'react'
import type { Context } from 'cordis'
import { createPixelPet } from './pet'
import { usePet } from './store'
import * as s from './mascot.css'

/** 没人搭理的时候自己换的小动作，和侧栏那只同一批。 */
const MOODS = ['think', 'confused', 'celebrate'] as const
const MOOD_MS = 1800
const MOOD_EVERY_MS = 9000

export function PetFace({ ctx, size }: { ctx: Context; size: number }) {
  const pet = usePet(ctx)
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const engine = createPixelPet(canvas, pet)
    // 引擎按精灵自己的尺寸写 canvas 的样式，这里覆盖成调用方要的那个大小
    canvas.style.width = `${size}px`
    canvas.style.height = `${(size * 3) / 4}px`

    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      // 上限 50ms：切回来的时候 dt 可能有好几秒，一步跳过去帧就全浪费了
      engine.tick(Math.min(0.05, (now - last) / 1000))
      last = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const mood = window.setInterval(() => {
      engine.setState(MOODS[Math.floor(Math.random() * MOODS.length)])
      window.setTimeout(() => engine.setState('idle'), MOOD_MS)
    }, MOOD_EVERY_MS)

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(mood)
      engine.dispose()
    }
  }, [pet, size])

  return <canvas key={pet.id} ref={ref} className={s.canvas} aria-hidden="true" />
}
