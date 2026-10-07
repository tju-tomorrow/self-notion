/**
 * 侧栏底部那格：只**展示**当前这只宠物（换形象在设置页，见 `./settings.tsx`）。
 *
 * 点它 → 开内置助手那一页（拿不到就冒一句台词）。
 *
 * ★ **这一格是内置助手的入口**（用户 2026-10-07：「我要他做 agentic 的」；2026-10-07 晚接上）。
 *   点一下 → `ctx.get('agent')?.toggle()` 开助手（`plugins/ai/`，D-0095 起是标签条里一个虚拟标签）。接的是
 *   `docs/ai.md` / D-0042 那个能读能写笔记的助手，**不是**网页版 AI 面板
 *   （那条路归 `plugins/ai-web`：顶栏那颗图标 + 划线的「问 AI」）。
 *   接的时候只动了 `onClick` 那一处，展示那套（帧、走路、气泡）一行没改。
 *
 * 帧推进走组件里的 rAF（不在控制器里起循环），换形象时 canvas 换 key 重挂 ——
 * 重挂顺带把「蹦出来」那个入场动画再放一遍。
 */
import { useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import { createPixelPet, type PixelPet } from './pet'
import { usePet } from './store'
import * as s from './mascot.css'

/** 没人搭理它的时候自己换的小动作。`sleep` 不放进来 —— 睡 1.8 秒就醒很奇怪。 */
const MOODS = ['think', 'confused', 'celebrate'] as const
type Mood = (typeof MOODS)[number]

const MOOD_MS = 1800
const MOOD_EVERY_MS = 7000
/** 点了之后张嘴说话的时长 / 气泡挂多久 */
const TALK_MS = 1500
const LINE_MS = 3200

export function Mascot({ ctx }: { ctx: Context }) {
  const pet = usePet(ctx)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<PixelPet | null>(null)
  const lineTimer = useRef<number | null>(null)
  /** 气泡：记着它是**哪只**说的 —— 在设置页换了形象，上一只的话不该还挂着。 */
  const [line, setLine] = useState<{ id: string; text: string } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const engine = createPixelPet(canvas, pet)
    engineRef.current = engine

    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      // 上限 50ms：切回来的时候 dt 可能有好几秒，一步跳过去帧就全浪费了
      engine.tick(Math.min(0.05, (now - last) / 1000))
      last = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // 一直只眨眼看着像卡住了 —— 隔一会儿自己比划两下
    const mood = window.setInterval(() => {
      const pick: Mood = MOODS[Math.floor(Math.random() * MOODS.length)]
      engine.setState(pick)
      window.setTimeout(() => engine.setState('idle'), MOOD_MS)
    }, MOOD_EVERY_MS)

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(mood)
      engine.dispose()
      engineRef.current = null
    }
  }, [pet])

  useEffect(
    () => () => {
      if (lineTimer.current !== null) window.clearTimeout(lineTimer.current)
    },
    [],
  )

  const speak = (text: string) => {
    engineRef.current?.setState('explain')
    window.setTimeout(() => engineRef.current?.setState('idle'), TALK_MS)
    setLine({ id: pet.id, text })
    if (lineTimer.current !== null) window.clearTimeout(lineTimer.current)
    lineTimer.current = window.setTimeout(() => setLine(null), LINE_MS)
  }

  /** 点一下：开关内置助手的面板（D-0072 说好的那一格）。
   *  **软依赖**：助手插件不在（或没装）就退回冒一句自己的台词 —— 那一格不能点了没反应。 */
  const onClick = () => {
    const agent = ctx.get('agent')
    if (!agent) return speak(ctx.i18n.t(pet.line))
    agent.toggle()
  }

  return (
    <div className={s.foot}>
      {line !== null && line.id === pet.id && (
        <p className={s.bubble} key={`${line.id}:${line.text}`}>
          {line.text}
        </p>
      )}
      {/* 只画小人。名字（珊瑚 / 靛蓝 / 苔绿…）**不进画面** —— 那是个色名，写在旁边既占地方
          又没必要；`title` / `aria-label` 留着，读屏和悬停还认得出是谁（用户：「不用说颜色…
          就展示那个宠物就可以」）。 */}
      <button
        type="button"
        className={s.stage}
        title={pet.name}
        aria-label={pet.name}
        onClick={onClick}
      >
        <canvas key={pet.id} ref={canvasRef} className={s.canvas} aria-hidden="true" />
      </button>
    </div>
  )
}
