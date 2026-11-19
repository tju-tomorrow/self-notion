/**
 * 手机端现场包（D-0126 的网页版）：把「现在屏幕长什么样 + 有什么报错 + 同步到哪了」
 * 打成一包，POST 到桌面 `/bug`，落到 `<app data>/bugs/`。
 *
 * 只落在自己电脑上，不发外网；桌面 agent 用 `pnpm bugs` 直接读。
 */
import { toast } from '../../ui/toast'
import { isWeb } from '../env'
import { allBlobs, allContents, allDocs, metaValue } from './db'

interface Line {
  at: number
  level: string
  text: string
}

const ring: Line[] = []

function textOf(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
    .slice(0, 4000)
}

function push(level: string, args: unknown[]): void {
  ring.push({ at: Date.now(), level, text: textOf(args) })
  if (ring.length > 120) ring.shift()
}

/** 尽早装：控制台错误 / 未捕获异常都留一份给现场包。 */
export function installDebugCapture(): void {
  if (!isWeb || typeof window === 'undefined') return
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      push(level, args)
      orig(...args)
    }
  }
  window.addEventListener('error', (e) => {
    push('error', [`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`])
  })
  window.addEventListener('unhandledrejection', (e) => {
    push('error', [`unhandledrejection: ${String(e.reason)}`])
  })
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

function rectOf(el: Element): number[] {
  const r = el.getBoundingClientRect()
  return [round(r.x), round(r.y), round(r.width), round(r.height)]
}

function classOf(el: Element): string {
  const c = (el as HTMLElement).className
  return typeof c === 'string' ? c.slice(0, 140) : ''
}

const STYLE_PROPS = [
  'display',
  'position',
  'flex',
  'flexDirection',
  'flexWrap',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'padding',
  'margin',
  'gap',
  'overflow',
  'overflowX',
  'transform',
  'zIndex',
  'background',
  'color',
  'fontSize',
  'lineHeight',
  'whiteSpace',
  'boxSizing',
] as const

function stylesOf(el: Element): Record<string, string> {
  const cs = getComputedStyle(el)
  const out: Record<string, string> = {}
  for (const p of STYLE_PROPS) out[p] = cs.getPropertyValue(p)
  return out
}

const KEY_SELECTORS = [
  'html',
  'body',
  '#root',
  '[data-sn-shell]',
  '[data-sn-shell] > header',
  '[data-sn-shell] aside',
  '[data-sn-shell] main',
  '[data-sn-shell] [data-mobile]',
]

async function collect(title: string): Promise<Record<string, unknown>> {
  const docs = await allDocs()
  const contents = await allContents()
  const blobs = await allBlobs()
  const cursor = await metaValue('sync.cursor')
  const dirty = docs.filter((d) => d.dirty).length

  const viewport = window.visualViewport
  const elements = [...document.querySelectorAll('body *')]
    .slice(0, 700)
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0)
    .slice(0, 450)
    .map(({ el, r }) => ({
      tag: el.tagName.toLowerCase(),
      class: classOf(el),
      rect: [round(r.x), round(r.y), round(r.width), round(r.height)],
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
    }))

  const key: Record<string, unknown> = {}
  for (const sel of KEY_SELECTORS) {
    const el = document.querySelector(sel)
    if (!el) continue
    key[sel] = { rect: rectOf(el), styles: stylesOf(el) }
  }

  return {
    kind: 'ios-web',
    title,
    web: {
      at: Date.now(),
      href: location.href,
      origin: location.origin,
      title: document.title,
      readyState: document.readyState,
      standalone:
        (navigator as Navigator & { standalone?: boolean }).standalone ??
        window.matchMedia('(display-mode: standalone)').matches,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      online: navigator.onLine,
      inner: [window.innerWidth, window.innerHeight],
      outer: [window.outerWidth, window.outerHeight],
      screen: [screen.width, screen.height],
      dpr: window.devicePixelRatio,
      visualViewport: viewport
        ? {
            width: round(viewport.width),
            height: round(viewport.height),
            scale: viewport.scale,
            offsetTop: round(viewport.offsetTop),
          }
        : null,
      mobileQuery: window.matchMedia('(max-width: 720px)').matches,
      orientation: screen.orientation?.type ?? null,
      safeArea: {
        top: getComputedStyle(document.documentElement).getPropertyValue('--sn-safe-top'),
      },
      key,
      elements,
      html: document.documentElement.outerHTML.slice(0, 300_000),
      errors: ring.slice(-100),
      sync: {
        docs: docs.length,
        dirty,
        contents: contents.length,
        blobs: blobs.length,
        cursor,
      },
    },
  }
}

/** 收集并上传。成功会提示编号，桌面 `pnpm bugs` 里就是这个名字。 */
export async function sendBugReport(title = '手机端报告'): Promise<string> {
  const payload = await collect(title)
  const res = await fetch('/bug', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`上传现场包失败：${res.status} ${body.slice(0, 200)}`)
  }
  const out = (await res.json()) as { name?: string }
  const name = out.name ?? '(未知)'
  toast({ text: `已发送现场包：${name}`, tone: 'info' })
  return name
}
