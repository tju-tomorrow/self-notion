/**
 * 像素宠物的控制器：把 `./pixel.ts` 生成的帧按时间画到 canvas 上，外加**位置**。
 * 帧推进和位移都由调用方（组件里的 rAF）驱动，这里不起自己的循环。
 *
 * 位置是「左上角落在哪儿」，画在 canvas 里的永远只有那只生物本身 ——
 * 挪动是消费方把 canvas 用 CSS transform 搬走（每帧改画布坐标要重画整张，划不来）。
 */
import {
  DEFAULT_SCALE,
  GRID_H,
  GRID_W,
  drawPixelFrame,
  frameFor,
  frameIndexAt,
  generatePixelClips,
  stepTowards,
  type PetState,
  type PixelAvatar,
} from './pixel'

/** 走动速度（像素/秒）。跟 LingRui 那边一个数，追鼠标的时候不显得飘。 */
const SPEED = 320

export interface PixelPet {
  setState(next: PetState): void
  /** 往哪儿走。到了会自己回 `idle`，不用调用方管。 */
  moveTo(x: number, y: number): void
  /** 活动范围（外框尺寸）：越界的会被拉回来 —— 窗口缩小后宠物不该留在墙外 */
  setBounds(width: number, height: number): void
  readonly position: readonly [number, number]
  /** 精灵的尺寸（CSS 像素，不含 dpr）。消费方拿它算边界。 */
  readonly size: readonly [number, number]
  /** 1 = 朝右，-1 = 朝左。消费方拿它翻 canvas。 */
  readonly facing: 1 | -1
  /** 每帧推进 dt 秒并重绘 */
  tick(dt: number): void
  dispose(): void
}

export function createPixelPet(canvas: HTMLCanvasElement, avatar: PixelAvatar): PixelPet {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('createPixelPet: 拿不到 2D context')
  const ctx: CanvasRenderingContext2D = context

  const clips = generatePixelClips(avatar)
  const palette = avatar.palette
  const scale = avatar.scale ?? DEFAULT_SCALE
  const dpr = window.devicePixelRatio || 1

  const width = GRID_W * scale
  const height = GRID_H * scale
  // 后端像素按 dpr 放大、CSS 尺寸不变，否则 Retina 上是一团糊
  canvas.width = width * dpr
  canvas.height = height * dpr
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  ctx.scale(dpr, dpr)

  let state: PetState = 'idle'
  /** 当前状态内累计的秒数：换状态就归零，动画每次从头放 */
  let t = 0
  let x = 0
  let y = 0
  let facing: 1 | -1 = 1
  let target: readonly [number, number] | null = null

  /** 上次画的是什么。状态 / 帧 / 位置 / 朝向都没变就不重画。 */
  let painted = ''

  const draw = (): void => {
    const key = `${state}:${frameIndexAt(clips[state], t)}:${Math.round(x)}:${Math.round(y)}:${facing}`
    if (key === painted) return
    painted = key
    ctx.clearRect(0, 0, width, height)
    drawPixelFrame(ctx, frameFor(clips, state, t), palette, scale)
  }

  const pet: PixelPet = {
    setState(next: PetState): void {
      if (next === state) return
      state = next
      t = 0
      if (next !== 'run') target = null
      draw()
    },

    moveTo(tx: number, ty: number): void {
      // 同一个目标别反复重设：鼠标停着不动，它就不该一直在原地跑步
      if (target && target[0] === tx && target[1] === ty) return
      target = [tx, ty]
      if (state !== 'run') {
        state = 'run'
        t = 0
      }
    },

    setBounds(w: number, h: number): void {
      const nx = Math.min(Math.max(0, x), Math.max(0, w - width))
      const ny = Math.min(Math.max(0, y), Math.max(0, h - height))
      if (nx !== x || ny !== y) {
        x = nx
        y = ny
        target = null
      }
    },

    get position() {
      return [x, y] as const
    },

    get size() {
      return [width, height] as const
    },

    get facing() {
      return facing
    },

    tick(dt: number): void {
      t += dt
      if (target) {
        const nx = stepTowards([x, y], target, SPEED, dt)
        // 左右朝向照着这一帧实际挪的方向翻，别用目标点算 —— 往回走的时候才对
        if (Math.abs(nx[0] - x) > 0.05) facing = nx[0] > x ? 1 : -1
        x = nx[0]
        y = nx[1]
        if (nx[0] === target[0] && nx[1] === target[1]) {
          target = null
          state = 'idle'
          t = 0
        }
      }
      draw()
    },

    dispose(): void {
      target = null
      ctx.clearRect(0, 0, width, height)
    },
  }

  draw()
  return pet
}
