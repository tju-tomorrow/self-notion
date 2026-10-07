/**
 * 笔记里那只：**默认跟着鼠标走**，也可以让它自己到处乱逛，或者干脆不出来（设置页三档）。
 *
 * 两条硬规矩（用户交代）：**不许压住鼠标、不许挡住字**。做法是同一件事 —— `pushOut`：
 * 目标点算完，先推出**正文那块**（标题那条到最后一个块的底，左右各让 `COLUMN_PAD`），
 * 再推出**光标周围那一圈**（`CURSOR_PAD`）。两次都是沿最近的一条边退，所以往哪边躲是定的
 * （不会左右横跳）；空档在哪它就往哪躲 —— 正文上方那截、正文下方的留白、两边的页边，
 * 谁近算谁。窗口窄到无处可躲时它会压在字上，那就**半透明**，字还读得出来。
 *
 * 活动范围是**编辑器视口**（`.affine-page-viewport`），不是整个正文区 —— 不然它会散步
 * 到右侧评论栏上去。
 *
 * 覆盖层铺在正文上、`pointer-events: none`，只有宠物自己那块能点 —— 不然它把编辑器的
 * 点击全吃了。它是鼠标专属的小反应（`aria-hidden`）：键盘 Tab 一圈里多出一只乱跑的
 * 宠物，是给人添乱。
 */
import { useEffect, useRef, useState } from 'react'
import type { Context } from 'cordis'
import { createPixelPet, type PixelPet } from './pet'
import { usePet, usePetMode } from './store'
import * as s from './mascot.css'

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** 光标周围这一圈不许压上去 */
const CURSOR_PAD = 34
/** 正文那块再让出这么宽 */
const COLUMN_PAD = 8
/** 新目标跟上一个差不到这么多像素就不重新下指令 —— 免得在边上原地抖 */
const TARGET_SLOP = 10
/** 每多少帧重量一次 DOM（位置 / 正文范围）。每帧量会把布局反复抖出来。 */
const MEASURE_EVERY = 30
/** 乱逛：到点就换个落脚点（下限 + 随机出来的这段时间） */
const ROAM_MIN_MS = 2200
const ROAM_SPAN_MS = 3000
const TALK_MS = 1500
const LINE_MS = 3200
/** 笔记里这只比侧栏那只大一号：那边是缩略图，这边才是本尊 */
const ROAM_SCALE = 4

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max))

const inflate = (r: Rect, pad: number): Rect => ({
  left: r.left - pad,
  right: r.right + pad,
  top: r.top - pad,
  bottom: r.bottom + pad,
})

const overlap = (x: number, y: number, w: number, h: number, r: Rect): boolean =>
  x + w > r.left && x < r.right && y + h > r.top && y < r.bottom

/** 把盒子推出一个矩形（沿最近的一条边退）。没碰上就原样返回。 */
function pushOut(x: number, y: number, w: number, h: number, r: Rect): [number, number] {
  if (!overlap(x, y, w, h, r)) return [x, y]
  const moves: [number, number][] = [
    [r.left - (x + w), 0],
    [r.right - x, 0],
    [0, r.top - (y + h)],
    [0, r.bottom - y],
  ]
  let best = moves[0]
  for (const m of moves) {
    if (Math.abs(m[0]) + Math.abs(m[1]) < Math.abs(best[0]) + Math.abs(best[1])) best = m
  }
  return [x + best[0], y + best[1]]
}

export function RoamPet({ ctx }: { ctx: Context }) {
  const pet = usePet(ctx)
  const mode = usePetMode(ctx)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<PixelPet | null>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const talking = useRef(false)
  const lineTimer = useRef<number | null>(null)
  const [line, setLine] = useState(false)

  useEffect(() => {
    if (mode === 'off') return
    const wrap = wrapRef.current
    const node = nodeRef.current
    const canvas = canvasRef.current
    if (!wrap || !node || !canvas) return

    const engine = createPixelPet(canvas, { ...pet, scale: ROAM_SCALE })
    engineRef.current = engine
    const [sw, sh] = engine.size

    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointermove', onMove)

    let wrapBox = wrap.getBoundingClientRect()
    /** 能散步的地方：编辑器的视口（右侧评论栏不算） */
    let area: Rect = { left: 0, top: 0, right: wrap.clientWidth, bottom: wrap.clientHeight }
    /** 正文那块：标题那条的顶 → 最后一个块的底。上面那截留白不算正文。 */
    let text: Rect | null = null

    const measure = () => {
      wrapBox = wrap.getBoundingClientRect()
      const at = (r: DOMRect): Rect => ({
        left: r.left - wrapBox.left,
        top: r.top - wrapBox.top,
        right: r.right - wrapBox.left,
        bottom: r.bottom - wrapBox.top,
      })

      const viewport = wrap.querySelector('.affine-page-viewport')
      area = viewport
        ? at(viewport.getBoundingClientRect())
        : { left: 0, top: 0, right: wrap.clientWidth, bottom: wrap.clientHeight }

      text = null
      const title = wrap.querySelector('doc-title')
      if (!title) return
      const head = at(title.getBoundingClientRect())
      if (head.right - head.left <= 0) return
      // 最后一块的底 = 正文写到哪儿。`editor-host` 自己会被 flex 撑满整屏，量它没用。
      const blocks = wrap.querySelectorAll('[data-block-id]')
      const tail = blocks[blocks.length - 1]
      text = {
        ...head,
        bottom: Math.max(tail ? at(tail.getBoundingClientRect()).bottom : head.bottom, head.bottom),
      }
    }
    measure()

    /** 目标点 → 真的能站的位置：先躲字、再躲鼠标，最后夹在能散步的范围里。 */
    const settle = (x: number, y: number, cx: number | null, cy: number | null): [number, number] => {
      let px = x
      let py = y
      if (text) [px, py] = pushOut(px, py, sw, sh, inflate(text, COLUMN_PAD))
      if (cx !== null && cy !== null) {
        // 光标那一圈用正方形近似：够用，而且退的方向是确定的（不会左右横跳）
        ;[px, py] = pushOut(px, py, sw, sh, {
          left: cx - CURSOR_PAD,
          right: cx + CURSOR_PAD,
          top: cy - CURSOR_PAD,
          bottom: cy + CURSOR_PAD,
        })
      }
      return [clamp(px, area.left, area.right - sw), clamp(py, area.top, area.bottom - sh)]
    }

    let raf = 0
    let frame = 0
    let last = performance.now()
    let nextRoam = last + 900
    let asked: [number, number] | null = null
    let dim = false

    const loop = (now: number) => {
      // 上限 50ms：切回来时 dt 可能有好几秒，一步跳过去帧就全浪费了
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      engine.setBounds(wrap.clientWidth, wrap.clientHeight)
      if (++frame % MEASURE_EVERY === 0) measure()

      const p = pointer.current
      const cx = p ? p.x - wrapBox.left : null
      const cy = p ? p.y - wrapBox.top : null

      let want: [number, number] | null = null
      if (!talking.current) {
        if (mode === 'follow') {
          // 目标是光标左上一点：宠物该跟在手边上，不是盖在手底下
          if (cx !== null && cy !== null) want = [cx - sw * 0.7, cy - sh * 0.6]
        } else if (now >= nextRoam) {
          nextRoam = now + ROAM_MIN_MS + Math.random() * ROAM_SPAN_MS
          want = [
            area.left + Math.random() * Math.max(0, area.right - area.left - sw),
            area.top + Math.random() * Math.max(0, area.bottom - area.top - sh),
          ]
        }
      }

      if (want) {
        const [tx, ty] = settle(want[0], want[1], cx, cy)
        // 差一点点就别再下指令：原地反复起步看起来像抽筋
        if (!asked || Math.hypot(tx - asked[0], ty - asked[1]) > TARGET_SLOP) {
          asked = [tx, ty]
          engine.moveTo(tx, ty)
        }
      }

      engine.tick(dt)
      const [ax, ay] = engine.position
      node.style.transform = `translate3d(${ax}px, ${ay}px, 0)`
      // 朝向只翻 canvas：气泡要是跟着翻，字就成镜像了
      canvas.style.transform = `scaleX(${engine.facing})`
      // 躲不开（窄窗口、长文档）就压在字上了 —— 半透明，还读得出来。只在变了才写 style。
      const onText = text !== null && overlap(ax, ay, sw, sh, text)
      if (onText !== dim) {
        dim = onText
        node.style.opacity = onText ? '0.5' : '1'
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      engine.dispose()
      engineRef.current = null
    }
  }, [pet, mode])

  useEffect(
    () => () => {
      if (lineTimer.current !== null) window.clearTimeout(lineTimer.current)
    },
    [],
  )

  // 说话期间不许乱跑（`talking` 是给 rAF 循环看的，别用 state —— 每帧一次重渲染不值）
  const talk = () => {
    engineRef.current?.setState('explain')
    talking.current = true
    window.setTimeout(() => {
      talking.current = false
      engineRef.current?.setState('idle')
    }, TALK_MS)
    setLine(true)
    if (lineTimer.current !== null) window.clearTimeout(lineTimer.current)
    lineTimer.current = window.setTimeout(() => setLine(false), LINE_MS)
  }

  if (mode === 'off') return null

  return (
    <div ref={wrapRef} className={s.roam} aria-hidden="true">
      <div ref={nodeRef} className={s.roamPet} onPointerDown={talk}>
        {line && <p className={s.roamBubble}>{ctx.i18n.t(pet.line)}</p>}
        <canvas key={pet.id} ref={canvasRef} className={s.roamCanvas} />
      </div>
    </div>
  )
}
