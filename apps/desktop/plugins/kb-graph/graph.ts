/**
 * 知识图谱的画布控制器：**自写的力导向布局** + canvas 2D 渲染 + 缩放/平移/点选。
 *
 * 不引图布局库（CONVENTIONS §6.7）：节点两两斥力（O(n²)，`limit` 默认 60 够用）+ 边上弹簧
 * + 一点阻尼，每帧按力更新位置。能量掉到阈值以下就停 rAF —— 静下来别白烧帧。
 *
 * 停下来的三条路（都塞进 `destroy`）：`cancelAnimationFrame`、`ResizeObserver.disconnect`、
 * 解绑 pointer/wheel。组件卸载 / 页面切走时由 `page.tsx` 的 effect 清理调用。
 */
import type { KbEdge, KbNode, ThemeService } from '../../src/kernel/contract'

export interface GraphData {
  nodes: KbNode[]
  edges: KbEdge[]
}

export interface GraphHandle {
  setData(data: GraphData): void
  destroy(): void
}

interface Body {
  kind: string
  id: string
  label: string
  degree: number
  x: number
  y: number
  vx: number
  vy: number
}

interface Link {
  a: number
  b: number
  weight: number
}

const REP = 6000 // 斥力强度，力 = REP / 距离²
const SPRING = 0.03 // 弹簧系数
const REST = 90 // 弹簧自然长度
const GRAVITY = 0.002 // 往世界原点拉，别让孤点飘出去
const DAMPING = 0.85 // 每帧速度衰减
const MAX_V = 8
const MAX_FRAMES = 900 // 兜底：再久也停，别无限跑
const ENERGY_EPS = 0.6
const LABEL_MAX = 14

/** canvas 取不到 `var()`，颜色值只能从 `ctx.theme.tokens` 读（@toeverything 那套）。 */
const FALLBACK = {
  bg: '#ffffff',
  text: '#1a1a1a',
  muted: '#8a8a8a',
  edge: '#cfcfcf',
  doc: '#1e96eb',
  entity: '#e9a23b',
  topic: '#3fb37f',
  tag: '#9aa0a6',
} as const

type Palette = { [K in keyof typeof FALLBACK]: string }

function palette(theme: ThemeService | undefined): Palette {
  const tk = theme?.tokens
  const get = (key: string, fb: string) => {
    const v = tk?.[key]
    return typeof v === 'string' && v !== '' ? v : fb
  }
  return {
    bg: get('--affine-background-primary-color', FALLBACK.bg),
    text: get('--affine-text-primary-color', FALLBACK.text),
    muted: get('--affine-text-secondary-color', FALLBACK.muted),
    edge: get('--affine-border-color', FALLBACK.edge),
    doc: get('--affine-primary-color', FALLBACK.doc),
    entity: get('--affine-palette-line-orange', FALLBACK.entity),
    topic: get('--affine-palette-line-green', FALLBACK.topic),
    tag: get('--affine-palette-line-purple', FALLBACK.tag),
  }
}

const kindColor = (p: Palette, kind: string): string =>
  kind === 'doc' ? p.doc : kind === 'entity' ? p.entity : kind === 'topic' ? p.topic : p.tag

const nodeRadius = (degree: number): number => 4 + Math.min(8, degree) * 0.8

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

export function createGraph(
  canvas: HTMLCanvasElement,
  opts: { theme?: ThemeService; onPickDoc: (id: string) => void },
): GraphHandle {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('kb-graph: 拿不到 2D context')
  const g: CanvasRenderingContext2D = context

  let bodies: Body[] = []
  let links: Link[] = []
  let fx = new Float64Array(0)
  let fy = new Float64Array(0)

  // 视图：screen = world * scale + (tx, ty)。世界原点默认落在画布中心。
  let scale = 1
  let tx = 0
  let ty = 0
  let w = 0
  let h = 0
  let dpr = 1
  let hasView = false

  let raf = 0
  let frames = 0
  let energy = Infinity
  let alive = true

  let hover = -1
  let picked = -1
  let highlight: Set<number> | null = null
  let down = false
  let dragged = false
  let downX = 0
  let downY = 0
  let lastX = 0
  let lastY = 0

  /* ── 布局 ── */

  const centerView = (): void => {
    if (w > 0 && h > 0) {
      tx = w / 2
      ty = h / 2
      scale = 1
      hasView = true
    }
  }

  function setData(data: GraphData): void {
    const index = new Map<string, number>()
    const key = (kind: string, id: string) => `${kind}:${id}`
    bodies = data.nodes.map((n, i) => {
      index.set(key(n.kind, n.id), i)
      // 起始位置用向日葵撒点（确定性）——随机也行，但没必要靠 Math.random
      const a = i * 2.399963229728653
      const r = 26 * Math.sqrt(i + 0.5)
      return {
        kind: n.kind,
        id: n.id,
        label: n.label,
        degree: 0,
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        vx: 0,
        vy: 0,
      }
    })
    links = []
    for (const e of data.edges) {
      const a = index.get(key(e.srcKind, e.srcId))
      const b = index.get(key(e.dstKind, e.dstId))
      if (a === undefined || b === undefined || a === b) continue
      links.push({ a, b, weight: Number.isFinite(e.weight) ? e.weight : 1 })
      bodies[a].degree++
      bodies[b].degree++
    }
    fx = new Float64Array(bodies.length)
    fy = new Float64Array(bodies.length)
    highlight = null
    picked = -1
    hover = -1
    centerView()
    start()
  }

  function step(): void {
    const n = bodies.length
    fx.fill(0)
    fy.fill(0)

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = bodies[j].x - bodies[i].x
        let dy = bodies[j].y - bodies[i].y
        let d2 = dx * dx + dy * dy
        // 重合时给个固定方向，别除零
        if (d2 < 1) {
          d2 = 1
          dx = 0.7
          dy = 0.7
        }
        const inv = 1 / Math.sqrt(d2)
        const f = REP / d2
        const ux = dx * inv
        const uy = dy * inv
        fx[i] -= f * ux
        fy[i] -= f * uy
        fx[j] += f * ux
        fy[j] += f * uy
      }
    }

    for (const l of links) {
      const a = bodies[l.a]
      const b = bodies[l.b]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(1, Math.hypot(dx, dy))
      const f = SPRING * (d - REST) * Math.min(3, Math.max(0.4, l.weight))
      const ux = dx / d
      const uy = dy / d
      fx[l.a] += f * ux
      fy[l.a] += f * uy
      fx[l.b] -= f * ux
      fy[l.b] -= f * uy
    }

    energy = 0
    for (let i = 0; i < n; i++) {
      const b = bodies[i]
      fx[i] -= b.x * GRAVITY
      fy[i] -= b.y * GRAVITY
      b.vx = (b.vx + fx[i]) * DAMPING
      b.vy = (b.vy + fy[i]) * DAMPING
      const sp = Math.hypot(b.vx, b.vy)
      if (sp > MAX_V) {
        b.vx = (b.vx / sp) * MAX_V
        b.vy = (b.vy / sp) * MAX_V
      }
      b.x += b.vx
      b.y += b.vy
      energy += b.vx * b.vx + b.vy * b.vy
    }
  }

  /* ── 画 ── */

  function topLabels(): number[] {
    const idx = bodies.map((_, i) => i)
    idx.sort((a, b) => bodies[b].degree - bodies[a].degree)
    return idx.slice(0, LABEL_MAX)
  }

  function render(): void {
    const p = palette(opts.theme)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    g.fillStyle = p.bg
    g.fillRect(0, 0, w, h)
    if (bodies.length === 0) return

    for (const l of links) {
      const a = bodies[l.a]
      const b = bodies[l.b]
      const dim = highlight !== null && !(highlight.has(l.a) && highlight.has(l.b))
      g.globalAlpha = dim ? 0.1 : 0.35
      g.strokeStyle = p.edge
      g.lineWidth = Math.min(4, 0.8 + Math.min(3, l.weight) * 0.8)
      g.beginPath()
      g.moveTo(a.x * scale + tx, a.y * scale + ty)
      g.lineTo(b.x * scale + tx, b.y * scale + ty)
      g.stroke()
    }
    g.globalAlpha = 1

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]
      const x = b.x * scale + tx
      const y = b.y * scale + ty
      const on = highlight === null || highlight.has(i)
      g.globalAlpha = on ? 1 : 0.25
      g.beginPath()
      g.arc(x, y, nodeRadius(b.degree), 0, Math.PI * 2)
      g.fillStyle = kindColor(p, b.kind)
      g.fill()
      if (i === picked || i === hover) {
        g.lineWidth = 2
        g.strokeStyle = p.text
        g.stroke()
      }
    }
    g.globalAlpha = 1

    g.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    g.textBaseline = 'middle'
    g.textAlign = 'left'
    const labelSet = topLabels()
    if (picked >= 0 && !labelSet.includes(picked)) labelSet.push(picked)
    if (hover >= 0 && !labelSet.includes(hover)) labelSet.push(hover)
    for (const i of labelSet) {
      if (highlight !== null && !highlight.has(i)) continue
      const b = bodies[i]
      g.fillStyle = i === picked || i === hover ? p.text : p.muted
      g.fillText(clip(b.label, 22), b.x * scale + tx + nodeRadius(b.degree) + 4, b.y * scale + ty)
    }
  }

  function loop(): void {
    raf = 0
    if (!alive) return
    step()
    render()
    frames++
    if (frames < MAX_FRAMES && energy > ENERGY_EPS) raf = requestAnimationFrame(loop)
  }

  function start(): void {
    frames = 0
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(loop)
  }

  /* ── 交互 ── */

  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function hitTest(x: number, y: number): number {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]
      const d = Math.hypot(b.x * scale + tx - x, b.y * scale + ty - y)
      if (d <= nodeRadius(b.degree) + 3 && d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  function neighbors(i: number): Set<number> {
    const set = new Set<number>([i])
    for (const l of links) {
      if (l.a === i) set.add(l.b)
      if (l.b === i) set.add(l.a)
    }
    return set
  }

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const r = canvas.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const next = Math.min(4, Math.max(0.25, scale * Math.exp(-e.deltaY * 0.0015)))
    tx = mx - (mx - tx) * (next / scale)
    ty = my - (my - ty) * (next / scale)
    scale = next
    render()
  }

  const onDown = (e: PointerEvent): void => {
    const { x, y } = local(e)
    down = true
    dragged = false
    downX = lastX = x
    downY = lastY = y
    canvas.setPointerCapture(e.pointerId)
  }

  const onMove = (e: PointerEvent): void => {
    const { x, y } = local(e)
    if (down) {
      if (!dragged && Math.hypot(x - downX, y - downY) > 4) dragged = true
      if (dragged) {
        tx += x - lastX
        ty += y - lastY
        render()
      }
      lastX = x
      lastY = y
      return
    }
    const hit = hitTest(x, y)
    if (hit !== hover) {
      hover = hit
      canvas.style.cursor = hit >= 0 ? 'pointer' : 'grab'
      render()
    }
  }

  const onUp = (e: PointerEvent): void => {
    const { x, y } = local(e)
    down = false
    if (dragged) {
      dragged = false
      return
    }
    const hit = hitTest(x, y)
    if (hit < 0) {
      if (highlight !== null) {
        highlight = null
        picked = -1
        render()
      }
      return
    }
    picked = hit
    const b = bodies[hit]
    // doc 点了就跳过去；entity / topic 不跳转，改成高亮它的邻居
    if (b.kind === 'doc') {
      opts.onPickDoc(b.id)
      return
    }
    highlight = neighbors(hit)
    render()
  }

  /* ── 尺寸与生命周期 ── */

  function resize(): void {
    const rect = canvas.getBoundingClientRect()
    w = rect.width
    h = rect.height
    dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    if (!hasView) centerView()
    render()
  }

  canvas.style.cursor = 'grab'
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  const ro = new ResizeObserver(() => resize())
  ro.observe(canvas)
  const stopTheme = opts.theme?.onChange(() => render()) ?? (() => {})
  resize()

  return {
    setData,
    destroy(): void {
      alive = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      ro.disconnect()
      stopTheme()
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.style.cursor = ''
      bodies = []
      links = []
      highlight = null
    },
  }
}
