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
import { startPet } from './loop'
import { createPixelPet } from './pet'
import { usePet } from './store'
import * as s from './mascot.css'

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

    const stop = startPet(canvas, engine, MOOD_EVERY_MS)

    return () => {
      stop()
      engine.dispose()
    }
  }, [pet, size])

  return <canvas key={pet.id} ref={ref} className={s.canvas} aria-hidden="true" />
}
