/**
 * 内存监控（D-0088）：macOS 菜单栏一个数字 + 设置页一段明细。
 *
 * **口径**（用户要的是「运行时内存」）：
 *   - 进程那部分由 Rust 问 libproc（`mem:snapshot` 一条命令，见 `src-tauri/src/mem.rs`）。
 *     ★ 必须把 **WKWebView 的 WebContent 进程**一起算进去 —— 编辑器和 Y.Doc 在它里面，
 *       只报我们自己那点（SQLite + 网络）数字是假的。
 *   - 文档那部分由编辑器给（软依赖 `ctx.get('mem')`）：每篇**当前加载在内存里**的
 *     Y.Doc 字节数。**这是代理指标**，WebKit 没有 per-page 的 heap API —— 界面上说清楚。
 *
 * **一个时钟**：轮询只在这儿。托盘和设置页读的是同一份状态（`state.ts`），
 * 各开一个定时器就会在屏幕上出现两个对不上的数字。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { reportError } from '../../src/kernel/errors'
import { MemSection } from './section'
import { setMemState, shortBytes, fmtBytes, type MemSnap } from './state'

export const name = 'mem-monitor'

// rpc：mem:snapshot / mem:render / mem:tray；settings：那个开关。
export const inject = ['rpc', 'settings']

/** 菜单栏那个数字开不开。默认关 —— 它是一直在跑的定时器，不该默认替人打开。 */
export const TRAY_KEY = 'sn.mem.tray'

/** 轮询间隔。2 秒：比活动监视器慢一档，看趋势够用，也不至于一直叫醒 CPU。 */
const TICK_MS = 2000

export function apply(ctx: Context) {
  let timer: ReturnType<typeof setInterval> | null = null
  let busy = false
  let trayOn = false
  let sectionOpen = false

  const tick = async (): Promise<void> => {
    // 上一拍还没回来就别叠 —— 量内存本身也可能慢。
    if (busy) return
    busy = true
    try {
      const snap = await ctx.rpc.call<MemSnap>('mem:snapshot')
      const docs = ctx.get('mem')?.stats() ?? []
      setMemState({ ...snap, docs, at: Date.now(), error: '' })
      const docBytes = docs.reduce((n, d) => n + d.bytes, 0)
      await ctx.rpc.call('mem:render', {
        title: shortBytes(snap.total),
        rows: [
          `${ctx.i18n.t('mem.total')} ${fmtBytes(snap.total)}`,
          `${ctx.i18n.t('mem.own')} ${fmtBytes(snap.own)}`,
          `WebKit ${fmtBytes(snap.webkit)}`,
          `${ctx.i18n.t('mem.docs')} ${docs.length} · ${fmtBytes(docBytes)}`,
        ],
      })
    } catch (err) {
      setMemState({ error: String(err) })
      reportError('mem', err)
    } finally {
      busy = false
    }
  }

  /** 托盘开着、或者设置页那一段正显示 —— 这两种情况之一就要时钟。 */
  const sync = (): void => {
    if (trayOn || sectionOpen) {
      if (!timer) {
        void tick()
        timer = setInterval(() => void tick(), TICK_MS)
      }
      return
    }
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  /** 开关真正落地：托盘建/摘 + 时钟起/停。设置一变就调。 */
  const apply_ = (): void => {
    trayOn = ctx.settings.get<boolean>(TRAY_KEY) === true
    void ctx.rpc.call('mem:tray', { on: trayOn }).catch((e) => reportError('mem', e))
    sync()
  }

  ctx.effect(() => {
    apply_()
    return ctx.settings.onChange(TRAY_KEY, apply_)
  })

  // ★ 这个回调要**稳定**（定义在 apply 里一次），不能每次 render 新造一个 ——
  //   设置页那段的 `useEffect(..., [onOpen])` 会因此每渲染一次就重跑一遍装卸。
  const setOpen = (open: boolean): void => {
    sectionOpen = open
    sync()
  }

  ctx.effect(() => {
    const section = () => createElement(MemSection, { ctx, onOpen: setOpen })
    ;(section as { label?: string }).label = ctx.i18n.t('mem.title')
    return ctx.slot.register('settings.section', section)
  })

  // 拔插件：时钟停掉、托盘摘掉 —— 不留一个还在轮询的后台。
  ctx.effect(() => () => {
    if (timer) clearInterval(timer)
    timer = null
    trayOn = false
    void ctx.rpc.call('mem:tray', { on: false }).catch(() => {})
  })
}
