/**
 * 像素宠物引擎 —— 从 LingRui-Scribe 的 `@lingrui/mascot` 搬来（D-0072）。
 *
 * 帧是 16×12 的字符网格，`.` 透明，`0`~`4` 是调色板下标（轮廓 / 身体 / 肚皮 / 点缀 / 白）。
 * **纯逻辑，不认识 DOM** —— 画到 canvas 是 `./pet.ts` 的事。
 *
 * 两个消费方：侧栏底部那只钉在原地（只眨眼 / 自己比划），笔记里那只跟着鼠标走、
 * 或者自己乱逛 —— 位移就是下面这个 `stepTowards`。
 */

export type PetState =
  | 'idle'
  | 'think'
  | 'explain'
  | 'point'
  | 'run'
  | 'celebrate'
  | 'confused'
  | 'sleep'

export interface PixelAvatar {
  /** [轮廓, 身体, 肚皮, 点缀, 白] */
  palette: readonly string[]
  /** 程序化变体种子：腿的条数 / 位置由它定，所以换个种子就是换了只生物 */
  seed: number
  /** 每个像素放大几倍 */
  scale?: number
}

export type PixelFrame = string[]

export interface PixelClip {
  frames: PixelFrame[]
  fps: number
  loop: boolean
}

export type PixelClips = Record<PetState, PixelClip>

export const GRID_W = 16
export const GRID_H = 12
export const DEFAULT_SCALE = 4

const TRANSPARENT = '.'

type Grid = string[][]

function blank(): Grid {
  return Array.from({ length: GRID_H }, () => Array.from({ length: GRID_W }, () => TRANSPARENT))
}

function put(g: Grid, x: number, y: number, ch: string): void {
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return
  const row = g[y]
  if (row) row[x] = ch
}

function fill(g: Grid, x: number, y: number, w: number, h: number, ch: string): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, ch)
}

function outline(g: Grid, x: number, y: number, w: number, h: number, ch: string): void {
  for (let i = 0; i < w; i++) {
    put(g, x + i, y, ch)
    put(g, x + i, y + h - 1, ch)
  }
  for (let j = 0; j < h; j++) {
    put(g, x, y + j, ch)
    put(g, x + w - 1, y + j, ch)
  }
}

function toFrame(g: Grid): PixelFrame {
  return g.map((row) => row.join(''))
}

/* ── 生物体：触角 + 圆身 + 黑方眼 + 一排小腿 ── */

function creature(legPhase: 0 | 1, seed: number): Grid {
  const g = blank()

  put(g, 4, 2, '0')
  put(g, 4, 3, '0')
  put(g, 11, 2, '0')
  put(g, 11, 3, '0')

  fill(g, 2, 4, 12, 5, '1')
  outline(g, 2, 4, 12, 5, '0')
  fill(g, 5, 6, 6, 2, '2')

  put(g, 5, 5, '0')
  put(g, 5, 6, '0')
  put(g, 10, 5, '0')
  put(g, 10, 6, '0')

  // 种子决定 4 条还是 6 条腿；phase 让相邻的腿交错，跑起来才有动感
  const base = seed % 2 === 0 ? [4, 6, 9, 11] : [3, 5, 7, 9, 11, 12]
  const xs = legPhase === 0 ? base : base.map((x) => x + (x % 2 === 0 ? -1 : 1))
  for (const x of xs) {
    put(g, x, 9, '1')
    put(g, x, 10, '0')
  }
  return g
}

function withBlink(seed: number): Grid {
  const g = creature(0, seed)
  put(g, 5, 5, '2')
  put(g, 10, 5, '2')
  return g
}

function withMouth(seed: number, open: boolean): Grid {
  const g = creature(0, seed)
  if (open) {
    put(g, 7, 7, '0')
    put(g, 8, 7, '0')
  }
  return g
}

function withPoint(seed: number): Grid {
  const g = creature(0, seed)
  put(g, 14, 5, '1')
  put(g, 15, 5, '0')
  return g
}

function withArmsUp(seed: number): Grid {
  const g = creature(0, seed)
  put(g, 1, 3, '1')
  put(g, 1, 4, '0')
  put(g, 14, 3, '1')
  put(g, 14, 4, '0')
  return g
}

function withBubble(seed: number, dots: number): Grid {
  const g = creature(0, seed)
  for (let i = 0; i < dots; i++) put(g, 12 + i * 2 > 15 ? 15 : 12 + i * 2, 1, '0')
  return g
}

function withQuestion(seed: number, phase: 0 | 1): Grid {
  const g = creature(0, seed)
  const y = phase === 0 ? 0 : 1
  put(g, 13, y, '0')
  put(g, 14, y, '0')
  put(g, 14, y + 1, '0')
  put(g, 13, y + 2, '0')
  put(g, 13, y + 3, '0')
  return g
}

function withSleep(seed: number): Grid {
  const g = withBlink(seed)
  put(g, 13, 1, '0')
  put(g, 14, 1, '0')
  put(g, 13, 2, '0')
  put(g, 13, 3, '0')
  return g
}

/** 由调色板 + 种子生成全部状态的帧组 —— 没有一张图片资产 */
export function generatePixelClips(avatar: PixelAvatar): PixelClips {
  const seed = avatar.seed || 0
  const open = toFrame(creature(0, seed))
  return {
    // 睁眼那帧放 4 格再眨一下：眨眼 0.33 秒、每 1.67 秒一次，不是每 0.33 秒眨一次
    idle: { fps: 3, loop: true, frames: [open, open, open, open, toFrame(withBlink(seed))] },
    think: { fps: 2, loop: true, frames: [toFrame(withBubble(seed, 1)), toFrame(withBubble(seed, 3))] },
    explain: { fps: 6, loop: true, frames: [toFrame(withMouth(seed, false)), toFrame(withMouth(seed, true))] },
    point: { fps: 2, loop: true, frames: [open, toFrame(withPoint(seed))] },
    run: { fps: 8, loop: true, frames: [open, toFrame(creature(1, seed))] },
    celebrate: { fps: 5, loop: true, frames: [open, toFrame(withArmsUp(seed))] },
    confused: { fps: 2, loop: true, frames: [toFrame(withQuestion(seed, 0)), toFrame(withQuestion(seed, 1))] },
    sleep: { fps: 1, loop: true, frames: [toFrame(withSleep(seed))] },
  }
}

/** 当前时间对应第几帧（纯函数） */
export function frameIndexAt(clip: PixelClip, t: number): number {
  const n = clip.frames.length
  if (n === 0) return 0
  const raw = Math.floor(Math.max(0, t) * clip.fps)
  return clip.loop ? raw % n : Math.min(raw, n - 1)
}

export function frameFor(clips: PixelClips, state: PetState, t: number): PixelFrame {
  const clip = clips[state]
  return clip.frames[frameIndexAt(clip, t)] ?? []
}

/** 朝目标走一步（纯函数）。到了就返回目标点，调用方据此知道「该站住了」。 */
export function stepTowards(
  from: readonly [number, number],
  target: readonly [number, number],
  speed: number,
  dt: number,
): [number, number] {
  const dx = target[0] - from[0]
  const dy = target[1] - from[1]
  const dist = Math.hypot(dx, dy)
  const step = Math.max(0, speed) * Math.max(0, dt)
  if (dist <= step || dist === 0) return [target[0], target[1]]
  return [from[0] + (dx / dist) * step, from[1] + (dy / dist) * step]
}

/** 把一帧画到 2D canvas 上 */
export function drawPixelFrame(
  ctx: CanvasRenderingContext2D,
  frame: PixelFrame,
  palette: readonly string[],
  scale: number,
): void {
  for (let y = 0; y < frame.length; y++) {
    const row = frame[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      if (!ch || ch === TRANSPARENT) continue
      const color = palette[Number(ch)]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x * scale, y * scale, scale, scale)
    }
  }
}
