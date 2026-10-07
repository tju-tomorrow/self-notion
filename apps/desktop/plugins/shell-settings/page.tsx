/**
 * 设置页的界面：**页面框架**（把槽里的所有 section 列成导航并切换）+ **插件管理**那一段。
 *
 * 框架自己也是「槽里的一个 section」（谁渲染这个槽，谁就得到整扇设置页），
 * 它**把自己从导航里滤掉**（按组件引用比 —— `self`），否则会一层套一层。
 * 外观照 AFFiNE 的设置弹窗：左栏 240 的分区导航 + 右侧 24 padding 的内容区。
 *
 * `SlotService.register` 没有 title / order，所以别的插件的 section 只能拿函数名当标签，
 * 匿名箭头函数就退化成「未命名 section N」（要好看的标签得动契约 —— 没动）。
 */
import {
  Component,
  createElement,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useMemo,
  useState,
  useSyncExternalStore,
  useEffect,
} from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, PageIcon, PluginIcon } from '@blocksuite/icons/rc'
import type { Context } from 'cordis'
import type { PluginEntry, PluginManager, Toggle } from './store'
import { reportError } from '../../src/kernel/errors'
// 契约靠 module augmentation 挂到 Context 上；显式 import 一次，保证它进了编译单元。
import type {} from '../../src/kernel/contract'
import * as s from './settings.css'

const ICON = 20

/**
 * 每个 section 包一层 ErrorBoundary：一个插件的 section 抛错，只降级它自己那一段，
 * 不带走整扇设置页（CONVENTIONS §6.6）。外壳那个 `SlotBoundary` 在 `src/shell/` 里 ——
 * 插件不 import 宿主内部文件，所以这里自己留一份最小的（十来行，没什么可共用的）。
 */
class SectionBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    reportError('shell-settings', error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** `unknown` → 组件：契约里槽装的是 `unknown`（内核不认识 React），到渲染这一步才收窄。 */
function asComponent(section: unknown): ComponentType {
  return section as ComponentType
}

/* ────────────────────────── 设置页框架 ────────────────────────── */

export function SettingsPage({
  ctx,
  self,
  own,
  onClose,
}: {
  ctx: Context
  /** 框架自己那个 slot item —— 用来把自己从导航里滤掉（见文件头）。 */
  self: unknown
  /** 本插件自己那一段 section 的 slot item —— 它的标签有词条，别人的只能拿组件名。 */
  own: unknown
  onClose?: () => void
}) {
  // 槽一变就重算导航：别的插件装载 / 卸载，标签跟着来去（热装载）。
  const all = useSyncExternalStore(
    (cb) => ctx.slot.subscribe('settings.section', cb),
    () => ctx.slot.list('settings.section'),
    () => ctx.slot.list('settings.section'),
  )
  const sections = all.filter((item) => item !== self)

  const [picked, setPicked] = useState<unknown>(null)
  // 选中的那个可能已经随着插件卸载消失了 —— 那就退回第一个，别渲染一片空白。
  const active = picked !== null && sections.includes(picked) ? picked : (sections[0] ?? null)
  const activeIndex = active === null ? -1 : sections.indexOf(active)

  return createElement(
    'div',
    { className: s.page },
    createElement(
      'div',
      { className: s.nav },
      createElement('div', { className: s.navTitle }, ctx.i18n.t('settings.title')),
      createElement(
        'div',
        { className: s.navList },
        ...sections.map((section, index) =>
          createElement(
            'button',
            {
              key: index,
              className: section === active ? `${s.navItem} ${s.navItemOn}` : s.navItem,
              // ★ 外面的那层箭头不能省：槽里登记的常常是**函数**（插件惯用 `const section = () => …`），
              //   而 useState 见到函数参数会把它当更新器调用 —— 存进去的就不是那一项了，
              //   选中判定随即失效、永远弹回第一节（这就是「字体 / GitHub 备份点不动」）。
              onClick: () => setPicked(() => section),
            },
            createElement(
              'span',
              { className: s.navIcon },
              createElement(section === own ? PluginIcon : PageIcon, { width: ICON, height: ICON }),
            ),
            createElement('span', { className: s.navLabel }, label(ctx, section, index, own)),
          ),
        ),
      ),
    ),
    createElement(
      'div',
      { className: s.content },
      createElement(
        'h2',
        { className: s.heading },
        activeIndex < 0 ? ctx.i18n.t('settings.title') : label(ctx, active, activeIndex, own),
      ),
      active === null
        ? createElement('p', { className: s.muted }, ctx.i18n.t('settings.section.none'))
        : createElement(SectionBoundary, { key: activeIndex }, createElement(asComponent(active))),
    ),
    onClose
      ? createElement(
          'button',
          {
            className: s.close,
            onClick: onClose,
            title: ctx.i18n.t('settings.close'),
            'aria-label': ctx.i18n.t('settings.close'),
          },
          createElement(CloseIcon, { width: ICON, height: ICON }),
        )
      : null,
  )
}

/** 导航标签：本插件那一段有词条；别人的先认组件上的 `.label`（插件自己给的中文名），
 *  再退回组件名，最后才是「未命名 section N」。 */
function label(ctx: Context, section: unknown, index: number, own: unknown): string {
  if (section === own) return ctx.i18n.t('settings.plugins.tab')
  const named = section as { name?: unknown; label?: unknown }
  if (typeof named.label === 'string' && named.label) return named.label
  if (typeof named.name === 'string' && named.name) return named.name
  return ctx.i18n.t('settings.section.untitled', { n: index + 1 })
}

/* ────────────────────────── 插件管理 ────────────────────────── */

export function PluginSection({ ctx, manager }: { ctx: Context; manager: PluginManager }) {
  // cordis 的状态变化（装载 / 卸载 / 依赖就绪）→ 版本号 → 重算这一列。
  const rev = useSyncExternalStore(
    (cb) => manager.subscribe(cb),
    () => manager.version(),
    () => manager.version(),
  )
  const entries = useMemo(() => manager.list(), [manager, rev])

  if (!entries.length) return createElement('p', { className: s.muted }, ctx.i18n.t('settings.plugins.empty'))

  return createElement(
    'div',
    null,
    createElement('p', { className: s.muted }, ctx.i18n.t('settings.plugins.summary', { n: entries.length })),
    createElement(
      'div',
      { className: s.list },
      ...entries.map((entry) => createElement(PluginRow, { key: entry.id, ctx, manager, entry })),
    ),
  )
}

function PluginRow({ ctx, manager, entry }: { ctx: Context; manager: PluginManager; entry: PluginEntry }) {
  const facts: string[] = []
  if (entry.services.length) facts.push(ctx.i18n.t('settings.plugins.provides', { list: entry.services.join(', ') }))
  if (entry.requires.length) facts.push(ctx.i18n.t('settings.plugins.requires', { list: entry.requires.join(', ') }))
  if (entry.protected) facts.push(ctx.i18n.t('settings.plugins.protected'))

  return createElement(
    'div',
    { className: s.row },
    createElement(
      'span',
      { className: s.rowIcon },
      createElement(PluginIcon, { width: ICON, height: ICON }),
    ),
    createElement(
      'div',
      { className: s.rowMain },
      createElement(
        'div',
        { className: s.identity },
        createElement('span', { className: s.rowName }, entry.id),
        createElement(
          'span',
          { className: entry.state === 'ACTIVE' ? s.state : `${s.state} ${s.stateOff}` },
          stateLabel(ctx, entry),
        ),
      ),
      facts.length ? createElement('div', { className: s.facts }, facts.join(' · ')) : null,
    ),
    createElement(
      'button',
      {
        className: s.toggle,
        role: 'switch',
        'aria-checked': entry.enabled,
        'aria-label': ctx.i18n.t(entry.enabled ? 'settings.plugins.disable' : 'settings.plugins.enable'),
        // 保护名单里的插件不给停（见 store.ts 里 `PROTECTED_SERVICES` 那段为什么）。
        disabled: entry.protected,
        title: entry.protected ? ctx.i18n.t('settings.plugins.protected') : undefined,
        onClick: () => manager.setEnabled(entry.id, !entry.enabled),
      },
    ),
  )
}

/**
 * 状态标签。`ACTIVE` / `PENDING` / `FAILED` 这些是 cordis 的 `FiberState` **标识符**，
 * 原样显示（跟 search-panel 原样显示命令 id 一个道理）；只有 `STOPPED` 是我们自己的词，走词条。
 */
function stateLabel(ctx: Context, entry: PluginEntry): string {
  return entry.state === 'STOPPED' ? ctx.i18n.t('settings.plugins.state.stopped') : entry.state
}

/* ────────────────────────── 覆盖层 ────────────────────────── */

/**
 * 设置页的宿主。
 *
 * ★ 为什么要自己开一层：契约里**没有**「打开设置」这回事，外壳目前只渲染
 *   `sidebar.item` / `main.view` / `titlebar.right` —— 没人渲染 `settings.section`，
 *   所以只注册那一段会是**看不见的死代码**。这个插件自己把宿主补上
 *   （`settings.open` 命令 → ⌘K 面板里能搜到，因为 search-panel 列的是 `ctx.command.list()`）。
 *   哪天外壳自己长出一扇设置窗（渲染 `settings.section` 即可），把这里删掉就行。
 *
 * ★ 覆盖层不走槽（契约明说槽只装内联元素），所以 portal 到 body（同 search-panel）。
 */
export function SettingsOverlay({
  ctx,
  self,
  own,
  toggle,
}: {
  ctx: Context
  self: unknown
  own: unknown
  toggle: Toggle
}) {
  const open = useSyncExternalStore(
    (cb) => toggle.subscribe(cb),
    () => toggle.get(),
    () => toggle.get(),
  )
  // Esc 关闭 —— 覆盖层没有自己的焦点域，所以挂在 document 上。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggle.set(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, toggle])
  if (!open) return null

  return createPortal(
    createElement(
      'div',
      {
        className: s.scrim,
        // 点空白关（点面板本体不关）
        onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => {
          if (e.target === e.currentTarget) toggle.set(false)
        },
      },
      createElement(
        'div',
        { className: s.panel },
        // 只渲染框架本体，**不**把整个槽渲一遍 —— 那会把每一段再画一次（框架里已经画过了）。
        createElement(SectionBoundary, null, createElement(SettingsPage, { ctx, self, own, onClose: () => toggle.set(false) })),
      ),
    ),
    document.body,
  )
}
