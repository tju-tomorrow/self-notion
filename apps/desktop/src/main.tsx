// WKWebView 没有 Symbol.dispose（handoff.md 坑 #1；侦察一确认 blocksuite 内不打也不崩，
// 但从 packages/ 抄来的代码会崩）。成本近乎零，放最顶上。
// 用 defineProperty 不用 ??= ：TS 把这两个符号声明成 readonly，赋值过不了编译。
for (const k of ['dispose', 'asyncDispose'] as const) {
  if (!(k in Symbol)) {
    Object.defineProperty(Symbol, k, { value: Symbol.for(`Symbol.${k}`), configurable: true })
  }
}

// ★ BlockSuite 的组件不定义颜色，只读 `--affine-*` 变量（135 个），而 AFFiNE 的真值
//   全在这个包里 —— 不引它，`var()` 全部落空，属性整条作废（菜单面板透明、文字叠在一起）。
//   字体同理：不引就没有 Inter，字的宽度和行高都不是 AFFiNE 那个样子。
import '@toeverything/theme/style.css'
import '@toeverything/theme/fonts.css'

import React from 'react'
import { createRoot } from 'react-dom/client'
import { Context } from 'cordis'
import { boot } from './kernel/scanner'
import { createSlot } from './kernel/slot'
// 新窗口带着 `#doc=<id>` 起来（Rust `windows.rs` 的 `doc_hash`）
import { OPEN_DOC } from './kernel/contract'
import { describeThrown, installErrorSink, reportError } from './kernel/errors'
import { mountConfirmHost } from './ui/confirm'
import { mountToastHost } from './ui/toast'
import { createI18n } from './i18n/i18n'
import { AppShell } from './shell/app-shell'
import { createTheme } from './theme/tokens'

// 最早装：后面任何一步炸了都有一条记录。
installErrorSink()

// macOS 那套「自动检查」在输入框里只会捣乱：`"` 变弯引号、句首自动大写、拼写红线。
// 正文自己设了（`editor.ts` 的 `attributes`），这里管住其余输入框 —— 标题、搜索、AI 输入框、
// 设置页那些（用户 2026-10-09）。
// ★ 走 `focusin` 不逐个挂：输入框是随页面长出来的，挨个找永远漏。
// ★ 只管应用自己的 DOM。网页版 AI 面板里那些框在**另一个 webview** 里，碰不到也不该碰。
document.addEventListener(
  'focusin',
  (e) => {
    const t = e.target
    if (!(t instanceof HTMLElement)) return
    if (!t.isContentEditable && !(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement)) return
    t.spellcheck = false
    t.setAttribute('autocorrect', 'off')
    t.setAttribute('autocapitalize', 'off')
  },
  true,
)

const el = document.getElementById('root')
if (!el) throw new Error('#root 不见了')

/** 组合根：外壳只认契约，服务在这里装配（S6 起主题 / i18n 也在这儿上）。
 *  ponytail: theme / i18n 现在是 app 内的服务，没做成插件 —— 它们将来该是 `plugins/theme`
 *  `plugins/i18n`（D-0039「一切皆插件」）。等 plugins/ 目录归位再搬，签名不用动。 */
const ctx = new Context()
ctx.provide('slot', createSlot())
ctx.provide('theme', createTheme())
ctx.provide('i18n', createI18n())
// 应用内确认框与轻提示（`window.confirm` 在本仓库禁用，理由见 `ui/confirm.tsx`）。
ctx.effect(() => mountConfirmHost((key) => ctx.i18n.t(key)))
ctx.effect(() => mountToastHost())

async function main() {
  // ponytail: 装载失败就整屏摊开。toast / 通知服务出现后改成「降级 + 一条通知」，
  // 但绝不能静默白屏 —— 那正是 D-0045 要防的东西。
  const { invoke } = await import('@tauri-apps/api/core')

  /** 把窗口露出来。★ 窗口在第一帧画出来之前是**藏着**的（`tauri.conf.json` 的
   *  `visible: false`）—— 不然启动那一下先闪一个空的毛玻璃窗，然后内容「啪」地顶上来。
   *
   *  ★ 等帧要带超时：窗口还藏着的时候，WebKit 会把 rAF 和定时器一起节流
   *  （页面是「不可见」的），干等 rAF 可能等到 Rust 那个兜底定时器。
   *  所以「抢一下、最多等 150ms」—— 抢到了就是画完再露，没抢到也几乎看不出来。 */
  const reveal = async () => {
    await Promise.race([
      new Promise<void>((r) => requestAnimationFrame(() => r())),
      new Promise<void>((r) => setTimeout(r, 150)),
    ])
    // 失败**不抛**：这条只是「把窗口露出来」，Rust 那边 4 秒兜底也会露 —— 拿它当致命错误
    // 会把一次露窗失败说成白屏。但原因要写清楚（`describeThrown`：对象不再打成 `[object Object]`）。
    await invoke('api', { req: { method: 'boot:ready' } }).catch((e) =>
      reportError('boot', new Error(`boot:ready 失败：${describeThrown(e)}`)),
    )
  }

  try {
    await boot(ctx)
  } catch (err) {
    reportError('boot', err)
    createRoot(el!).render(<pre style={{ padding: 24, color: '#b00' }}>{String(err)}</pre>)
    // 装载炸了也要露 —— 藏着的话用户只能看到一个一直不出现的窗口（Rust 那边 4 秒兜底）。
    await reveal()
    return
  }

  createRoot(el!).render(
    <React.StrictMode>
      <AppShell ctx={ctx} />
    </React.StrictMode>,
  )
  await reveal()

  // 新窗口带着 `#doc=<id>` 起来 → 直接开这一篇。菜单只会告诉前端「开个新窗口」——
  // 当前是哪一篇只有这边知道，所以由 Rust 建窗、由这边决定停在哪一页。
  // 放在渲染之后：编辑器的槽得先在 DOM 里。主窗口没有这段 hash，什么也不会发生。
  const opened = new URLSearchParams(location.hash.slice(1)).get('doc')
  if (opened) ctx.emit(OPEN_DOC, { id: decodeURIComponent(opened) })

  // 通道探活。界面**不显示**结果 —— 之前那行 pong 是开发期的脚手架，摆在侧栏底部很难看。
  await invoke('api', { req: { method: 'meta:ping' } }).catch((e) =>
    reportError('boot', new Error(`meta:ping 失败：${String(e)}`)),
  )
}

void main()
