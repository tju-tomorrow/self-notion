/**
 * 设置页里的「宠物」一段：换形象（用户要求 —— 这里换，侧栏那只只管展示）。
 *
 * 五个候选各画一个**静态缩略图**（就是 idle 的第一帧，`createPixelPet` 画一次不再 tick），
 * 比一个色块说得多：选的是「哪只」不是「哪个颜色」。
 */
import { useEffect, useRef } from 'react'
import type { Context } from 'cordis'
import { Group, Row } from '../../src/ui/settings'
import { createPixelPet } from './pet'
import { PETS, type Pet } from './roster'
import { choosePet, usePet } from './store'
import * as s from './mascot.css'

export function MascotSettings({ ctx }: { ctx: Context }) {
  const current = usePet(ctx)

  return (
    <div className={s.section}>
      <Group desc={ctx.i18n.t('mascot.form.desc')}>
        <Row label={ctx.i18n.t('mascot.form')}>
          <div className={s.choices} role="radiogroup" aria-label={ctx.i18n.t('mascot.form')}>
            {PETS.map((pet) => (
              <Choice
                key={pet.id}
                pet={pet}
                on={pet.id === current.id}
                onPick={() => choosePet(ctx, pet.id)}
              />
            ))}
          </div>
        </Row>
      </Group>
    </div>
  )
}

function Choice({ pet, on, onPick }: { pet: Pet; on: boolean; onPick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // 只借它画一帧：不 tick，缩略图就是静止的
    const engine = createPixelPet(canvas, { ...pet, scale: 2 })
    return () => engine.dispose()
  }, [pet])

  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      className={on ? `${s.choice} ${s.choiceOn}` : s.choice}
      title={pet.name}
      onClick={onPick}
    >
      <canvas ref={canvasRef} className={s.choiceCanvas} aria-hidden="true" />
      <span className={s.choiceName}>{pet.name}</span>
    </button>
  )
}
