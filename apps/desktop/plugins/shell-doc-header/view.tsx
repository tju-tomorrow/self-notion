/**
 * 文档页顶栏 + 页面 ⋯ 菜单 + 设置页的「字体」段。
 *
 * 数据全走 rpc（doc:list / doc:summary / doc:open / doc:apply / doc:move / doc:trash / doc:favorite），
 * 改完广播 `DOCS_CHANGED`；当前是哪一篇只听 `OPEN_DOC`（契约里没有也不该有 currentDoc）。
 */
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode, type RefObject } from 'react'
import type { Context } from 'cordis'
import {
  AllDocsIcon,
  ArrowLeftSmallIcon,
  CopyIcon,
  DeleteTemporarilyIcon,
  DoneIcon,
  DuplicateIcon,
  ExpandWideIcon,
  FontIcon,
  HistoryIcon,
  LinkIcon,
  MoreHorizontalIcon,
  MoveToIcon,
  PageIcon,
  SplitViewIcon,
  StarIcon,
  TagIcon,
  TextIcon,
} from '@blocksuite/icons/rc'
import {
  CLOSE_ALL,
  DOCS_CHANGED,
  DOC_SAVED,
  OPEN_DOC,
  SPLIT_VIEW,
  type DocMeta,
  type DocSummary,
} from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { SlotHost } from '../../src/shell/slot-host'
import { copyText } from '../../src/ui/clipboard'
import { Hint } from '../../src/ui/hint'
import { Switch } from '../../src/ui/settings'
import { TagPanel } from '../../src/ui/tags'
import {
  CODE_FONT_KEY,
  DEFAULT_CODE_FONT,
  DEFAULT_FONT,
  DOC_FONT_KEY,
  FONT_SCALE_DEFAULT,
  FONT_SCALE_KEY,
  FONT_SCALES,
  GROUPS,
  PREVIEW,
  UI_FONT_KEY,
  docFontKey,
  docSmallKey,
  docWideKey,
  entryOf,
  groupOf,
  type FontEntry,
  type FontGroup,
} from './config'
import * as s from './doc-header.css'

const ICON = 18

type IconType = ComponentType<{ width?: number; height?: number }>

/** 读一个设置 key；改了就重渲染（勾选态靠它）。 */
function useSetting(ctx: Context, key: string): unknown {
  return useSyncExternalStore(
    (cb) => ctx.settings.onChange(key, cb),
    () => ctx.settings.get(key),
    () => ctx.settings.get(key),
  )
}

/* ────────────────────────── 订阅 ────────────────────────── */

/* 当前打开的文档 id。**状态放模块级、订阅放 `apply()`** —— 外壳是「收到 OPEN_DOC 才挂
   `doc.header`」，而第一篇文档那条事件比组件挂载早；组件自己监听就永远错过它，
   顶栏渲染成空、⋯ 按钮根本不在，点哪儿都没反应。 */
let currentId: string | null = null
const docSubs = new Set<() => void>()

export function setCurrentDoc(id: string | null): void {
  if (id === currentId) return
  currentId = id
  for (const cb of docSubs) cb()
}

function useCurrentDoc(): string | null {
  return useSyncExternalStore(
    (cb) => {
      docSubs.add(cb)
      return () => void docSubs.delete(cb)
    },
    () => currentId,
    () => currentId,
  )
}

/* 主区现在并排了几栏（1…3）。**值的家在编辑器插件那边**（它持有分栏状态），
   这里只是接它广播过来的镜像 —— 顶栏那颗按钮要按栏数改文案。 */
let paneCount = 1
const paneSubs = new Set<() => void>()

export function setPaneCount(n: number): void {
  if (n === paneCount) return
  paneCount = n
  for (const cb of paneSubs) cb()
}

function usePaneCount(): number {
  return useSyncExternalStore(
    (cb) => {
      paneSubs.add(cb)
      return () => void paneSubs.delete(cb)
    },
    () => paneCount,
    () => paneCount,
  )
}

/** 全量文档表（不带回收站）。写操作后别人会广播 `DOCS_CHANGED`，这边跟着重取。 */
function useDocs(ctx: Context): readonly DocMeta[] {
  const [docs, setDocs] = useState<readonly DocMeta[]>([])
  useEffect(() => {
    let live = true
    const fetch = () =>
      // 失败不吞：让 rejection 冒到全局处理器，落进 errors.log（D-0045）。
      void ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false }).then((all) => {
        if (live) setDocs(all)
      })
    fetch()
    const off = ctx.on(DOCS_CHANGED, fetch)
    return () => {
      live = false
      void off()
    }
  }, [ctx])
  return docs
}

/** 点外面关浮层。ref 挂在「⋯ 按钮 + 面板」那层壳上，点按钮自己不算「外面」。 */
function useOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ref, onOutside])
}

/* ────────────────────────── 顶栏 ────────────────────────── */

export function DocHeader({ ctx }: { ctx: Context }) {
  const id = useCurrentDoc()
  const docs = useDocs(ctx)
  const panes = usePaneCount()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  useOutside(anchor, () => setOpen(false))

  /** 保存指示：写库成功才亮一句，1.6 秒后自己灭（连着写就续上）。 */
  const [savedAt, setSavedAt] = useState<number | null>(null)
  useEffect(() => {
    const off = ctx.on(DOC_SAVED, ({ id: saved }) => {
      if (saved === id) setSavedAt(Date.now())
    })
    return () => void off()
  }, [ctx, id])
  useEffect(() => {
    if (savedAt === null) return
    const timer = setTimeout(() => setSavedAt(null), 1600)
    return () => clearTimeout(timer)
  }, [savedAt])

  // 字体不在这儿注入：`fonts.ts` 一个人在 <html> 上写变量，跟着设置和当前文档走。
  // 顶栏曾经自己写一份（挂在 OPEN_DOC 上），那等于同一件事两个出口。
  if (id === null) return null

  const here = docs.find((d) => d.id === id)
  const title = here?.title || ctx.i18n.t('doc.untitled')
  const trail = trailOf(docs, id)

  const favorite = () => {
    void ctx.rpc
      .call('doc:favorite', { id, value: !(here?.isFavorite ?? false) })
      .then(() => ctx.emit(DOCS_CHANGED))
      .catch((err) => reportError('doc.header', err))
  }

  return (
    <header className={s.bar}>
      <nav className={s.crumbs}>
        {trail.map((doc, i) => (
          <Fragment key={doc.id}>
            {i > 0 && <span className={s.sep}>/</span>}
            <button
              type="button"
              className={i === trail.length - 1 ? `${s.crumb} ${s.crumbOn}` : s.crumb}
              onClick={() => ctx.emit(OPEN_DOC, { id: doc.id })}
            >
              <span className={s.crumbIcon}>{doc.icon ?? <PageIcon width={14} height={14} />}</span>
              <span className={s.crumbLabel}>{doc.title || ctx.i18n.t('doc.untitled')}</span>
            </button>
          </Fragment>
        ))}
      </nav>

      <div className={s.actions}>
        {/* 动作区**最左端**那一格：网页版 AI 那颗挂这儿（D-0096）。 */}
        <SlotHost ctx={ctx} name="doc.header.leading" />
        {/* 紧贴它右边：内置助手那颗宠物（D-0106 续 —— 用户圈了 ∇ 右边这一格）。
            不摆在整行最右：用户要的是「在打开网页版 AI **右边一位**」，一位就是一位的距离。 */}
        <SlotHost ctx={ctx} name="doc.header.agent" />
        {/* 动作区里最靠左的一格：别的东西（总结那颗按钮，D-0075）挂进来就落在这儿。
            空着时里面一个节点都没有，不占地方。 */}
        <SlotHost ctx={ctx} name="doc.header.actions" />
        {savedAt !== null ? <span className={s.saved}>{ctx.i18n.t('doc.saved')}</span> : null}
        <Hint text={ctx.i18n.t(here?.isFavorite ? 'doc.unfavorite' : 'doc.favorite')}>
          <button
            type="button"
            className={s.iconButton}
            style={here?.isFavorite ? { color: 'var(--affine-primary-color)' } : undefined}
            aria-label={ctx.i18n.t(here?.isFavorite ? 'doc.unfavorite' : 'doc.favorite')}
            onClick={favorite}
          >
            <StarIcon width={ICON} height={ICON} />
          </button>
        </Hint>

        {/* 并排看（D-0118）：1 → 2 → 3 栏，到顶之后再点就是取消并排（回 1 栏）。
            只加不减的话用户没有路退回来。文案按当前栏数变 —— 不然这一颗按钮
            在三种状态下长得一模一样，看不出点下去会发生什么。 */}
        <Hint text={ctx.i18n.t(panes >= 3 ? 'doc.splitOff' : panes === 1 ? 'doc.splitOn' : 'doc.splitMore')}>
          <button
            type="button"
            className={s.iconButton}
            aria-label={ctx.i18n.t(panes >= 3 ? 'doc.splitOff' : panes === 1 ? 'doc.splitOn' : 'doc.splitMore')}
            aria-pressed={panes > 1}
            style={panes > 1 ? { color: 'var(--affine-primary-color)' } : undefined}
            onClick={() => ctx.emit(SPLIT_VIEW, { panes: panes >= 3 ? 1 : panes + 1 })}
          >
            <SplitViewIcon width={ICON} height={ICON} />
          </button>
        </Hint>

        <div className={s.anchor} ref={anchor}>
          <Hint text={ctx.i18n.t('doc.menu')}>
            <button
              type="button"
              className={s.iconButton}
              aria-label={ctx.i18n.t('doc.menu')}
              onClick={() => setOpen((v) => !v)}
            >
              <MoreHorizontalIcon width={ICON} height={ICON} />
            </button>
          </Hint>
          {open && (
            <PageMenu ctx={ctx} id={id} title={title} docs={docs} onClose={() => setOpen(false)} />
          )}
        </div>
      </div>
    </header>
  )
}

/** 面包屑：从当前篇往上走到根，再倒过来。防环 —— 父级数据坏了也不会转死。 */
function trailOf(docs: readonly DocMeta[], id: string): DocMeta[] {
  const byId = new Map(docs.map((d) => [d.id, d]))
  const chain: DocMeta[] = []
  for (let cur = byId.get(id); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    chain.unshift(cur)
    if (chain.length > 32) break
  }
  return chain
}

/* ────────────────────────── ⋯ 菜单 ────────────────────────── */

function PageMenu({
  ctx,
  id,
  title,
  docs,
  onClose,
}: {
  ctx: Context
  id: string
  title: string
  docs: readonly DocMeta[]
  onClose: () => void
}) {
  const [view, setView] = useState<'menu' | 'fonts' | 'move' | 'icon' | 'tags'>('menu')
  // 这一篇的当前元数据（标签行要它）。页头外面已经 find 过一次，这里再 find 是另一层组件。
  const here = docs.find((d) => d.id === id)

  /** 动作都是异步的：先关菜单再跑，失败走统一出口（AGENTS.md §3）。 */
  const run = (fn: () => Promise<void>) => {
    onClose()
    void fn().catch((err) => reportError('doc.menu', err))
  }

  const font = ctx.settings.get<string>(docFontKey(id))
  // 两个页面开关（D-0076）。用 hook 读 —— 拨完开关这一行要立刻跟着变。
  const small = useSetting(ctx, docSmallKey(id)) === true
  const wide = useSetting(ctx, docWideKey(id)) === true

  const items: {
    key: string
    label: string
    icon: IconType
    hint?: string
    /** 有它就是开关行（右端一个 Switch），没有就是普通动作行。 */
    toggle?: { on: boolean; set: (next: boolean) => void }
    onClick?: () => void
  }[] = [
    // 图标在第一位 —— Notion 里给一页挑 emoji 是最常用的一个动作。
    {
      key: 'icon',
      label: ctx.i18n.t('doc.icon'),
      icon: PageIcon,
      onClick: () => setView('icon'),
    },
    {
      key: 'font',
      label: ctx.i18n.t('font.title'),
      icon: FontIcon,
      // 当前这一篇实际用的字体名（没单设就是它跟着的那个）
      hint: entryOf(font).name,
      // 不关菜单 —— 换成字体列表接着选（同下面的「移动到」）。
      onClick: () => setView('fonts'),
    },
    // 页面级外观的两个开关（D-0076），照 Notion ⋯ 菜单那两行：点整行或点开关都算。
    {
      key: 'small',
      label: ctx.i18n.t('doc.smallText'),
      icon: TextIcon,
      toggle: { on: small, set: (next) => ctx.settings.set(docSmallKey(id), next) },
      onClick: () => ctx.settings.set(docSmallKey(id), !small),
    },
    {
      key: 'wide',
      label: ctx.i18n.t('doc.wide'),
      icon: ExpandWideIcon,
      toggle: { on: wide, set: (next) => ctx.settings.set(docWideKey(id), next) },
      onClick: () => ctx.settings.set(docWideKey(id), !wide),
    },
    // 标签那一行（D-0086）：**和别的行一模一样的一行**，点开进标签那一页（`TagPanel`）。
    // ★ 输入框曾经直接摆在这一行右端 —— 那行就不是菜单行了（两个菜单的行样式是两份，见 D-0102）。
    {
      key: 'tags',
      label: ctx.i18n.t('doc.tags.label'),
      icon: TagIcon,
      hint: here?.tags.length ? here.tags.join(', ') : ctx.i18n.t('doc.tags.placeholder'),
      onClick: () => setView('tags'),
    },
    {
      key: 'link',
      label: ctx.i18n.t('doc.link'),
      icon: LinkIcon,
      onClick: () => run(() => copyText(`self-notion://doc/${id}`)),
    },
    { key: 'copy', label: ctx.i18n.t('doc.copy'), icon: CopyIcon, onClick: () => run(() => copyBody(ctx, id)) },
    {
      key: 'dup',
      label: ctx.i18n.t('doc.duplicate'),
      icon: DuplicateIcon,
      onClick: () => run(() => duplicate(ctx, id, title)),
    },
    {
      key: 'history',
      label: ctx.i18n.t('doc.history'),
      icon: HistoryIcon,
      // 面板本体在 `version-history` 插件里（软依赖：它不在就没有这个入口）。
      onClick: () => {
        onClose()
        ctx.get('version')?.open()
      },
    },
    // 「移动到」不关菜单 —— 换成目标列表接着选。
    { key: 'move', label: ctx.i18n.t('doc.move'), icon: MoveToIcon, onClick: () => setView('move') },
    { key: 'trash', label: ctx.i18n.t('doc.trash'), icon: DeleteTemporarilyIcon, onClick: () => run(() => trash(ctx, id)) },
  ]

  return (
    <div className={s.menu}>
      {/* 字体 / 移动到是同一个菜单换内容（不关菜单），所以得有一条回主菜单的路 ——
          用户原话：「没有退回键 退回上个菜单」。 */}
      {view === 'menu' ? null : (
        <button type="button" className={s.backRow} onClick={() => setView('menu')}>
          <ArrowLeftSmallIcon width={16} height={16} />
          <span>{ctx.i18n.t('doc.back')}</span>
        </button>
      )}
      {view === 'move' ? (
        <MoveList ctx={ctx} id={id} docs={docs} onClose={onClose} />
      ) : view === 'fonts' ? (
        <FontPanel ctx={ctx} id={id} />
      ) : view === 'icon' ? (
        <IconPanel ctx={ctx} id={id} />
      ) : view === 'tags' && here ? (
        <TagPanel ctx={ctx} doc={here} />
      ) : (
        items.map((it) =>
          it.toggle ? (
            // ★ 开关行是 `div` 不是 `button`：`Switch` 自己就是一个 button，套在 button 里是非法 HTML。
            //   整行可点（Notion 也是），所以开关那层要把点击拦一下，不然一次点两个翻两次等于没动。
            <div key={it.key} className={s.item} role="presentation" onClick={it.onClick}>
              <span className={s.itemIcon}>
                <it.icon width={ICON} height={ICON} />
              </span>
              <span className={s.itemLabel}>{it.label}</span>
              <span className={s.itemSwitch} onClick={(e) => e.stopPropagation()}>
                <Switch on={it.toggle.on} onChange={it.toggle.set} label={it.label} />
              </span>
            </div>
          ) : (
            <button key={it.key} type="button" className={s.item} onClick={it.onClick}>
              <span className={s.itemIcon}>
                <it.icon width={ICON} height={ICON} />
              </span>
              <span className={s.itemLabel}>{it.label}</span>
              {it.hint === undefined ? null : <span className={s.itemHint}>{it.hint}</span>}
            </button>
          ),
        )
      )}
    </div>
  )
}

/**
 * 单篇覆盖。第一行永远是「跟随默认」（= 不单设），下面按 中文 / 英文 / 代码 分组。
 * 面板只有 264 宽，所以用紧凑一行版：名字在左、字样在右。
 */
function FontPanel({ ctx, id }: { ctx: Context; id: string }) {
  const own = useSetting(ctx, docFontKey(id))
  const docDefault = useSetting(ctx, DOC_FONT_KEY)
  const ui = useSetting(ctx, UI_FONT_KEY)
  // 不单设时实际生效的是文章默认；文章默认也没设就是全局。
  const follows = entryOf((docDefault ?? ui) as string | undefined)

  return (
    <div className={s.fontPanel}>
      <div className={s.menuLabel}>{ctx.i18n.t('font.page')}</div>
      <FontPicker
        ctx={ctx}
        value={typeof own === 'string' ? own : null}
        groups={GROUPS}
        compact
        inherit={{ name: ctx.i18n.t('font.inheritDefault'), note: follows.name }}
        // 「跟随」存 null：三级级联靠 `??`，存个 'default' 会把它变成真选了一个字体。
        onPick={(next) => ctx.settings.set(docFontKey(id), next)}
      />
    </div>
  )
}

/** 挑 emoji 的那一屏。点一下就写库（`doc:icon`），不关菜单 —— 可以连着改。 */
const EMOJI = [
  '📄', '📝', '📌', '✅', '🎯', '📚', '💡', '🔖', '🗂️', '📊',
  '🧪', '⚙️', '🌱', '🔥', '⭐', '❤️', '🎨', '🎧', '🍀', '🧭',
  '🚀', '🧠', '🏠', '📅', '🔍', '✏️', '📦', '🌙', '☀️', '🧩',
]

function IconPanel({ ctx, id }: { ctx: Context; id: string }) {
  const pick = (icon: string | null) => {
    void ctx.rpc
      .call('doc:icon', { id, icon })
      .then(() => ctx.emit(DOCS_CHANGED))
      .catch((err: unknown) => reportError('doc.header', err))
  }

  return (
    <>
      <div className={s.menuLabel}>{ctx.i18n.t('doc.icon')}</div>
      <div className={s.iconGrid}>
        <button type="button" className={s.iconCell} title={ctx.i18n.t('doc.icon.clear')} onClick={() => pick(null)}>
          <PageIcon width={18} height={18} />
        </button>
        {EMOJI.map((emoji) => (
          <button key={emoji} type="button" className={s.iconCell} onClick={() => pick(emoji)}>
            {emoji}
          </button>
        ))}
      </div>
    </>
  )
}

/**
 * 历史版本搬到了自己的插件（`plugins/version-history`）：右上角一颗时钟图标 + 右侧时间线。
 * 原来是这儿的二级菜单页，恢复靠 `location.reload()` 把整个应用重启 —— 现在走
 * `ctx.editor.reload`，只把那一篇的 Y.Doc 丢掉重读，标签页和别的窗口状态都留着。
 */
function MoveList({
  ctx,
  id,
  docs,
  onClose,
}: {
  ctx: Context
  id: string
  docs: readonly DocMeta[]
  onClose: () => void
}) {
  // 不能移进自己的子树 —— 那会在树里成环。
  const blocked = new Set(subtreeIds(docs, id))
  const targets = docs.filter((d) => !blocked.has(d.id))

  const move = (parentId: string | null) => {
    onClose()
    void ctx.rpc
      .call('doc:move', { id, parentId })
      .then(() => ctx.emit(DOCS_CHANGED))
      .catch((err) => reportError('doc.menu', err))
  }

  return (
    <>
      <div className={s.menuLabel}>{ctx.i18n.t('doc.move.to')}</div>
      <button type="button" className={s.item} onClick={() => move(null)}>
        <span className={s.itemIcon}>
          <AllDocsIcon width={ICON} height={ICON} />
        </span>
        <span className={s.itemLabel}>{ctx.i18n.t('doc.move.root')}</span>
      </button>
      {targets.map((doc) => (
        <button key={doc.id} type="button" className={s.item} onClick={() => move(doc.id)}>
          <span className={s.itemIcon}>
            <PageIcon width={ICON} height={ICON} />
          </span>
          <span className={s.itemLabel}>{doc.title || ctx.i18n.t('doc.untitled')}</span>
        </button>
      ))}
    </>
  )
}

/** 自己 + 全部后代。 */
function subtreeIds(docs: readonly DocMeta[], root: string): string[] {
  const children = new Map<string, string[]>()
  for (const d of docs) {
    if (d.parentId === null) continue
    const list = children.get(d.parentId)
    if (list) list.push(d.id)
    else children.set(d.parentId, [d.id])
  }
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const cur = stack.pop()
    if (cur === undefined) break
    out.push(cur)
    for (const kid of children.get(cur) ?? []) stack.push(kid)
  }
  return out
}

/* ────────────────────────── 三个前端拼的动作 ────────────────────────── */

/** 拷页面正文。来源是库里的 `doc_text` 投影 —— **纯文本，不带格式**（要富文本得走 BlockSuite adapter）。 */
async function copyBody(ctx: Context, id: string): Promise<void> {
  const rows = await ctx.rpc.call<DocSummary[]>('doc:summary', { ids: [id] })
  await copyText(rows[0]?.body ?? '')
}

/** 创建副本：建一篇新的，把源文档的正文灌进去。后端没有 duplicate，用现成的 open + apply 拼。 */
async function duplicate(ctx: Context, id: string, title: string): Promise<void> {
  const src = await ctx.rpc.call<{ content: string | null }>('doc:open', { id })
  const made = await ctx.rpc.call<DocMeta>('doc:create', {
    parentId: null,
    title: `${title} ${ctx.i18n.t('doc.copySuffix')}`,
  })
  if (src.content !== null) await ctx.rpc.call('doc:apply', { id: made.id, content: src.content })
  ctx.emit(DOCS_CHANGED)
  ctx.emit(OPEN_DOC, { id: made.id })
}

/** 移至垃圾箱：进回收站（可恢复），然后回首页 —— 这篇已经不在列表里了。 */
async function trash(ctx: Context, id: string): Promise<void> {
  await ctx.rpc.call('doc:trash', { id })
  ctx.emit(DOCS_CHANGED)
  ctx.emit(CLOSE_ALL)
}

/* ────────────────────────── 字体 ────────────────────────── */

/**
 * 字体选择器：一行「跟随」+ 若干分组，每组一张卡片一个字体。
 *
 * `compact` 是窄面板（⋯ 菜单）那版：名字在左、字样在右、一行一个；
 * 默认那版是设置页用的两行卡片，长句预览 + 名字/出处。
 */
function FontPicker({
  ctx,
  value,
  groups,
  inherit,
  compact,
  onPick,
}: {
  ctx: Context
  /** null = 没单设，跟着上一层。 */
  value: string | null
  groups: readonly FontGroup[]
  inherit?: { name: string; note: string }
  compact?: boolean
  onPick: (id: string | null) => void
}) {
  const check = (on: boolean) =>
    on ? (
      <span className={s.pickCheck}>
        <DoneIcon width={14} height={14} />
      </span>
    ) : null

  /** 一个字体。紧凑版一行（名字 · 字样 · 勾），设置页版两行（字样 / 名字 · 出处 · 勾）。 */
  const one = (f: FontEntry, preview: string) => {
    const on = f.id === value
    const sample = (
      <span className={s.pickSample} style={{ fontFamily: f.stack }}>
        {preview}
      </span>
    )
    const name = <span className={s.pickName}>{f.name}</span>
    return (
      <button
        key={f.id}
        type="button"
        title={f.note}
        className={`${compact ? s.pickRow : s.pickCard} ${on ? s.pickOn : ''}`}
        onClick={() => onPick(f.id)}
      >
        {compact ? (
          <>
            {name}
            {sample}
            {check(on)}
          </>
        ) : (
          <>
            {sample}
            <span className={s.pickFoot}>
              {name}
              <span className={s.pickNote}>{f.note}</span>
              {check(on)}
            </span>
          </>
        )}
      </button>
    )
  }

  return (
    <div className={s.picker}>
      {inherit ? (
        <button
          type="button"
          className={`${s.pickFollow} ${value === null ? s.pickOn : ''}`}
          onClick={() => onPick(null)}
        >
          <span className={s.pickName}>{inherit.name}</span>
          <span className={s.pickFollowNote}>现在跟的是「{inherit.note}」</span>
          {check(value === null)}
        </button>
      ) : null}
      {groups.map((group) => (
        <Fragment key={group}>
          {/* 只有一组（代码字体）时上面已经有块标题了，再来一行「代码」是重复。 */}
          {groups.length > 1 ? <div className={s.pickGroup}>{ctx.i18n.t(`font.group.${group}`)}</div> : null}
          <div className={compact ? s.pickGridCompact : s.pickGrid}>
            {groupOf(group).map((f) => one(f, compact ? SHORT[group] : PREVIEW[group]))}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

/** 紧凑版的字样：一行放得下，又要看得出中文、拉丁和符号。 */
const SHORT: Readonly<Record<FontGroup, string>> = {
  zh: '永久 Ag',
  en: 'Ag Wq 8',
  code: 'a = 1 → 2',
}

/**
 * 设置页的「字体」段：三个层级各一个选择器。
 * 全局 → 文章默认 → 单篇（单篇在文档页的 ⋯ 菜单里，这个槽里给不了「哪一篇」）。
 */
export function FontSection({ ctx }: { ctx: Context }) {
  const ui = useSetting(ctx, UI_FONT_KEY)
  const doc = useSetting(ctx, DOC_FONT_KEY)
  const code = useSetting(ctx, CODE_FONT_KEY)
  const uiId = typeof ui === 'string' ? ui : DEFAULT_FONT
  // 「文章默认」那一格的说明里要写出「不设时跟谁走」，所以它得知道全局是谁。
  const docNote = entryOf(uiId).name

  return (
    <div className={s.section}>
      <Block title={ctx.i18n.t('font.global')} hint={ctx.i18n.t('font.globalHint')}>
        <FontPicker
          ctx={ctx}
          value={uiId}
          // 英文在前：`默认` 那一条在英文组里，它是界面的出厂值。
          groups={['en', 'zh']}
          onPick={(id) => ctx.settings.set(UI_FONT_KEY, id ?? DEFAULT_FONT)}
        />
      </Block>

      <Block title={ctx.i18n.t('font.doc')} hint={ctx.i18n.t('font.docHint')}>
        <FontPicker
          ctx={ctx}
          value={typeof doc === 'string' ? doc : null}
          groups={GROUPS}
          inherit={{ name: ctx.i18n.t('font.inheritGlobal'), note: docNote }}
          onPick={(id) => ctx.settings.set(DOC_FONT_KEY, id)}
        />
      </Block>

      <Block title={ctx.i18n.t('font.code')} hint={ctx.i18n.t('font.codeHint')}>
        <FontPicker
          ctx={ctx}
          value={typeof code === 'string' ? code : DEFAULT_CODE_FONT}
          groups={['code']}
          onPick={(id) => ctx.settings.set(CODE_FONT_KEY, id ?? DEFAULT_CODE_FONT)}
        />
      </Block>

      <Block title={ctx.i18n.t('font.scale')} hint={ctx.i18n.t('font.scaleHint')}>
        <ScaleRow ctx={ctx} />
      </Block>
    </div>
  )
}

/** 正文字号：⌘± 那套的可见入口 —— 否则用户不知道现在多少、怎么回去。 */
function ScaleRow({ ctx }: { ctx: Context }) {
  const raw = useSetting(ctx, FONT_SCALE_KEY)
  const scale = Number(raw) || FONT_SCALE_DEFAULT
  const at = FONT_SCALES.indexOf(scale)
  const step = (delta: number) => {
    const next = FONT_SCALES[
      Math.min(FONT_SCALES.length - 1, Math.max(0, (at < 0 ? 2 : at) + delta))
    ]
    if (next !== undefined) ctx.settings.set(FONT_SCALE_KEY, String(next))
  }
  const button = {
    height: 26,
    minWidth: 28,
    padding: '0 8px',
    border: 'none',
    borderRadius: 6,
    background: 'var(--affine-v2-button-secondary)',
    color: 'var(--affine-v2-text-primary)',
    fontFamily: 'inherit',
    fontSize: 14,
    cursor: 'pointer',
  } as const
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button type="button" style={button} title={ctx.i18n.t('font.scale')} onClick={() => step(-1)}>
        −
      </button>
      <span style={{ minWidth: 48, textAlign: 'center', fontSize: 13 }}>
        {Math.round(scale * 100)}%
      </span>
      <button type="button" style={button} title={ctx.i18n.t('font.scale')} onClick={() => step(1)}>
        +
      </button>
      <button
        type="button"
        style={button}
        onClick={() => ctx.settings.set(FONT_SCALE_KEY, String(FONT_SCALE_DEFAULT))}
      >
        {ctx.i18n.t('font.scaleReset')}
      </button>
    </div>
  )
}

/** 一段 = 标题 + 一行说明 + 选择器。 */
function Block({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className={s.block}>
      <h3 className={s.blockTitle}>{title}</h3>
      <p className={s.hint}>{hint}</p>
      {children}
    </section>
  )
}
