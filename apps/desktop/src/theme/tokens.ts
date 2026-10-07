/**
 * 深浅色。契约里的 `ThemeService` 只给「读 + onChange」，所以这里是它的实现
 * —— 见文件末尾关于 `set` 为什么在契约之外的说明。
 *
 * ★ 值**不再手抄**：直接拿 `@toeverything/theme` 的 `combined*CssVariables`，
 *   也就是 `main.tsx` 引的那张 `style.css` 用的**同一张表**。
 *   BlockSuite 的组件不定义颜色，只读 `--affine-*`（实测 135 个），引了样式表之后
 *   它们从 CSS 里拿；`tokens` 这个 getter 是留给**取不到 `var()` 的地方**的
 *   （search-panel / shell-settings / shell-titlebar 要内联实际颜色值，见各自注释）。
 *   两边同源，内联出去的值和页面上算出来的值不可能漂。
 *
 * 依据：D-0021（外壳自写，不依赖 `@affine/component`）· D-0029（跟随系统深浅色，不做主题编辑器）
 * · D-0051（外观对齐 AFFiNE —— 它读 `--affine-*`，我们就得给同一张表）
 */
import { combinedDarkCssVariables, combinedLightCssVariables } from '@toeverything/theme'
import type { ThemeService } from '../kernel/contract'

export type Scheme = 'light' | 'dark'

/** 用户的偏好：跟随系统，或者手选一个。 */
export type SchemePref = 'system' | Scheme

const SCHEMES: Readonly<Record<Scheme, Readonly<Record<string, string>>>> = {
  light: combinedLightCssVariables,
  dark: combinedDarkCssVariables,
}

/**
 * `style.css` 用 `[data-theme=light|dark]` 切表，所以属性得挂在 `<html>` 上
 * —— 挂在外壳 div 上的话，弹到 body 下的浮层（菜单、tooltip）拿不到。
 */
function applyScheme(scheme: Scheme) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = scheme
}

/** 契约的 `ThemeService` 是一条只读通道 —— 没有 `set`。见文件末尾。 */
export interface ThemeController extends ThemeService {
  set(scheme: Scheme): void
  /** 跟随系统 / 手选。手选会落盘（localStorage），并停掉系统监听。 */
  setPreference(pref: SchemePref): void
  readonly preference: SchemePref
}

function storedPref(): SchemePref {
  try {
    const raw = localStorage.getItem('sn.scheme')
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
  } catch {
    return 'system'
  }
}

function persistPref(pref: SchemePref): void {
  try {
    localStorage.setItem('sn.scheme', pref)
  } catch {
    // 隐私模式落不了盘不是功能问题
  }
}

export function createTheme(pref: SchemePref = storedPref()): ThemeController {
  let preference: SchemePref = pref
  let scheme: Scheme = preference === 'system' ? systemScheme() : preference
  const subs = new Set<() => void>()
  let stopSystem: (() => void) | null = null

  const paint = (next: Scheme, force = false) => {
    if (next === scheme && !force) return
    scheme = next
    applyScheme(next)
    subs.forEach((cb) => cb())
  }

  /** D-0029：跟随系统时，系统切了要跟着走；手选之后就把这条监听撤掉。 */
  const watchSystem = () => {
    stopSystem?.()
    stopSystem = null
    if (preference !== 'system') return
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => paint(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    stopSystem = () => mq.removeEventListener('change', onChange)
  }

  // 首次无论如何都要把 data-theme 写上去。
  paint(scheme, true)
  watchSystem()

  return {
    get scheme() {
      return scheme
    },
    get preference() {
      return preference
    },
    // 同一个 scheme 下返回**同一个对象**：宿主把它交给 useSyncExternalStore，
    // 每次新对象等于每次重渲染（React 会用 Object.is 比快照）。
    get tokens() {
      return SCHEMES[scheme]
    },
    onChange(cb) {
      subs.add(cb)
      return () => void subs.delete(cb) // 逆函数（D-0033）
    },
    set(next) {
      preference = next
      persistPref(next)
      watchSystem()
      paint(next)
    },
    setPreference(next) {
      preference = next
      persistPref(next)
      watchSystem()
      paint(next === 'system' ? systemScheme() : next)
    },
  }
}

/** D-0029：外观跟随系统。SSR / 测试里没有 window，退到浅色。 */
function systemScheme(): Scheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
