/**
 * bug 系统（D-0126）：现场包 + 事件带 + 主区那一页。
 *
 * **为什么要有**：会出错的东西不一定抛。DOM 和模型脱钩、一次粘贴多插一份、输入法留字 ——
 * 这些一个都不抛，而 `errors.log` 只收「抛出来的错」。以前每查一次这种 bug 就得现造一个探针、
 * 再让你复现一遍。现在改成：判据有人判，**判到就自动抓一份现场**，你按 ⌘⇧B 也能随时抓。
 *
 * **分工**：这个插件不判任何判据，也不 import 任何人的内部文件 ——
 *   · 谁有现场谁 `provider()` 一段事实进来（编辑器那边供 DOM / 模型 / 选区）；
 *   · 谁判出问题谁调 `broken()`（粘贴那边看块数、编辑器那边看 DOM≠模型）。
 * 落盘在 Rust（`src-tauri/src/bugs.rs`，`<app data>/bugs/`）。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { DOC_SAVED, OPEN_DOC, SHOW_LIST, type BugsService } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { BugsPage, setBugsPage } from './page'
import { bumpRevision, currentEvents, pushEvent } from './state'

export const name = 'plugin-bugs'

export const inject = ['rpc', 'slot', 'command', 'i18n']

/** 同一个判据多久之内只自动抓一次。不变量是每帧都可能被撞的，一撞就写盘会把目录撑爆。 */
const COOLDOWN_MS = 5000

type Facts = Record<string, unknown>
type FactProvider = () => Facts | Promise<Facts>

export function apply(ctx: Context) {
  const providers = new Set<FactProvider>()
  const lastBroken = new Map<string, number>()

  /** 抓现场时按注册顺序问一遍「谁有现场」。**一家炸了不许影响整份**。 */
  const gather = async (): Promise<Facts> => {
    const facts: Facts = {}
    for (const fn of providers) {
      try {
        Object.assign(facts, await fn())
      } catch (err) {
        reportError('bugs', err)
      }
    }
    return facts
  }

  const write = async (kind: string, title: string, detail: string, extra?: Facts): Promise<void> => {
    const facts = { ...(await gather()), ...extra }
    await ctx.rpc.call('bug:write', {
      kind,
      title,
      detail,
      // 列表页要一行就能认出来是哪篇 —— 供现场那侧给的 `doc` 直接提上来。
      doc: facts.doc ?? null,
      facts,
      events: currentEvents(),
    })
    bumpRevision()
  }

  const bugs: BugsService = {
    event: (what, detail) => pushEvent(what, detail),

    broken: (kind, title, detail, facts) => {
      pushEvent(`broken:${kind}`, detail)
      const now = Date.now()
      if ((lastBroken.get(kind) ?? 0) + COOLDOWN_MS > now) return
      lastBroken.set(kind, now)
      // 抓不下来不能让判据那边崩 —— 它只是路过报个信（AGENTS §3：错走唯一出口）。
      void write(kind, title, detail, facts).catch((err: unknown) => reportError('bugs', err))
    },

    capture: (note) => {
      pushEvent('capture', note)
      void write('manual', ctx.i18n.t('bugs.manual'), note ?? '', undefined).catch((err: unknown) =>
        reportError('bugs', err),
      )
    },

    provider: (fn) => {
      providers.add(fn)
      return () => void providers.delete(fn)
    },
  }

  ctx.effect(() => [
    ctx.provide('bugs', bugs),
    // 这一页和虚拟目录同一条路：主区切过去，别处不占位（`main.home` 那格自己让开）。
    ctx.on(SHOW_LIST, ({ group }) => setBugsPage(group === 'bugs')),
    ctx.slot.register('main.home', () => createElement(BugsPage, { ctx })),

    ctx.command.register({
      id: 'bugs.open',
      title: ctx.i18n.t('bugs.open'),
      run: () => ctx.emit(SHOW_LIST, { group: 'bugs' }),
    }),
    ctx.command.register({
      id: 'bugs.capture',
      title: ctx.i18n.t('bugs.capture'),
      run: () => bugs.capture(),
    }),

    // 事件带的前因：快捷键 + 剪贴板里有什么 + 开关了哪一篇 + 落库。
    ctx.effect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() === 'b' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
          e.preventDefault()
          bugs.capture()
          return
        }
        // 只记**有信息量**的键：单个字母的连打会把整条带冲掉，而它们本来就在正文里。
        if (e.key.length > 1 || e.metaKey || e.ctrlKey) {
          const mod = `${e.metaKey ? '⌘' : ''}${e.ctrlKey ? '^' : ''}${e.altKey ? '⌥' : ''}${e.shiftKey ? '⇧' : ''}`
          pushEvent('key', `${mod}${e.key}`)
        }
      }
      const onPaste = (e: ClipboardEvent) => {
        const data = e.clipboardData
        if (!data) return
        pushEvent('paste', `类型=[${[...data.types].join(',')}] 文件=${data.files.length}`)
      }
      document.addEventListener('keydown', onKey, true)
      document.addEventListener('paste', onPaste, true)
      return () => {
        document.removeEventListener('keydown', onKey, true)
        document.removeEventListener('paste', onPaste, true)
      }
    }),

    ctx.on(OPEN_DOC, ({ id }) => pushEvent('open', id)),
    ctx.on(DOC_SAVED, ({ id }) => pushEvent('saved', id)),
  ])
}
