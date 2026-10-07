/**
 * ⌘K 全文搜索 —— 只搜文档（D-0070）。形状照 AFFiNE 的搜索页：上面一条搜索框，
 * 下面左边是**按更新时间分段**的结果，右边是选中那篇的正文预览（D-0071）。
 *
 * 覆盖层**不走槽**（契约的槽只装内联元素），所以本插件在 body 上建一个空锚，
 * 面板本体再 `createPortal` 到 body —— 弹在 body 下也照样拿得到 `--affine-*`：
 * 那张表挂在 `<html>` 上（见 theme/tokens.ts 的 applyScheme）。
 *
 * 数据来源：空查询 → `doc:list`（近期更新的排前面）；打了字 → `search:query`（防抖），
 * 命中正文由 Rust 用 `HIT_OPEN`/`HIT_CLOSE` 包好，前端只切成 run 渲染，绝不碰 HTML；
 * 右侧预览 → `doc:text`。三份结果都缓存（`./cache.ts`），分段与切块是纯函数（`./group.ts`）。
 */
import {
  createElement as h,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type {
  ChangeEvent as ReactChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { PageIcon, SearchIcon } from '@blocksuite/icons/rc'
import type { Context } from 'cordis'
import { DOCS_CHANGED, OPEN_DOC } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import {
  body,
  ensureDocs,
  getRev,
  invalidate,
  peekBody,
  peekDocs,
  peekSearch,
  search,
  subscribe,
  RECENT_LIMIT,
} from './cache'
import {
  ancestorPath,
  GROUP_LABEL,
  groupByDate,
  mdBlocks,
  parseSnippet,
  recentDocs,
  type MdKind,
} from './group'
import * as s from './search-panel.css'

export const name = 'search-panel'

// 硬依赖（CONVENTIONS §6.4「依赖走 inject 声明，不许手动探测」）。
export const inject = ['rpc', 'i18n', 'theme']

const SEARCH_DEBOUNCE_MS = 150
const ICON = 20

/** 列表里的一行 —— 检索结果和「最近」两种来源归一成这一种。 */
interface Row {
  id: string
  title: string
  updatedAt: number
  /** 命中正文（只搜到标题时是 `null`）。 */
  snippet: string | null
}

const MD_CLASS: Readonly<Record<MdKind, string>> = {
  h: s.mdH,
  p: s.mdP,
  li: s.mdLi,
  quote: s.mdQuote,
  code: s.mdCode,
}

/** 正文片段：命中处包 `<mark>`。key 用下标 —— 同一份片段的段序是稳定的。 */
function Snippet({ body: text }: { body: string }) {
  return h(
    'span',
    null,
    ...parseSnippet(text).map((seg, i) =>
      seg.hit
        ? h('mark', { key: i, className: s.mark }, seg.text)
        : h('span', { key: i }, seg.text),
    ),
  )
}

function SearchPanel({ ctx }: { ctx: Context }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLElement | null)[]>([])

  // 缓存里一有动静（清单到了 / 结果到了 / 正文到了）就重画。缓存是唯一的真相源。
  const rev = useSyncExternalStore(subscribe, getRev)

  // ⌘K 开关 + Esc 关。这是**窗口内**的 document 监听，不是 Tauri 的 OS 级全局快捷键
  // （那要 Rust 侧注册，现在没消费者）。用 `e.key`，不碰 keyCode。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // 打开：清空上一次打的字、把焦点给输入框。★ 清的是**输入**，不是结果 ——
  // 空查询底下那串最近文档是缓存里的，立刻就在（这就是「要缓存」那条）。
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSel(0)
    inputRef.current?.focus()
  }, [open])

  // 清单的兜底：启动时已经预取过一次，这里通常直接命中缓存。
  useEffect(() => {
    if (!open) return
    void ensureDocs(ctx).catch((err) => reportError('search-panel', err))
  }, [open, ctx])

  const q = query.trim()

  // 打字 → 搜（防抖）。命中缓存的查询串不再问 Rust。
  useEffect(() => {
    if (!open || !q || peekSearch(q)) return
    const timer = setTimeout(() => {
      void search(ctx, q).catch((err) => reportError('search-panel', err))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [open, q, ctx])

  const docs = peekDocs()
  const byId = useMemo(() => new Map((docs ?? []).map((doc) => [doc.id, doc])), [docs])

  const rows = useMemo<Row[]>(() => {
    if (q) {
      return (peekSearch(q) ?? []).map((hit) => ({
        id: hit.id,
        title: hit.title,
        updatedAt: hit.updatedAt,
        snippet: hit.body,
      }))
    }
    return recentDocs(docs ?? [], RECENT_LIMIT).map((doc) => ({
      id: doc.id,
      title: doc.title,
      updatedAt: doc.updatedAt,
      snippet: null,
    }))
    // rev 是快照号：缓存写进来时 `q` 和 `docs` 都可能没变，只有它知道。
  }, [q, docs, rev])

  const sections = groupByDate(rows, Date.now())
  const active = rows.length === 0 ? 0 : Math.min(sel, rows.length - 1)
  const activeRow = rows[active]
  const previewId = activeRow?.id
  const md = previewId ? peekBody(previewId) : undefined

  // 选中那一篇的正文（没缓存才取）。上下键划过好几十行时，取重的位置在 cache 里。
  useEffect(() => {
    if (!open || !previewId || peekBody(previewId) !== undefined) return
    void body(ctx, previewId).catch((err) => reportError('search-panel', err))
  }, [open, previewId, ctx])

  // 换一篇就把预览卷回顶部（否则看的是上一段落的中间）。
  useEffect(() => {
    const el = previewRef.current
    if (el) el.scrollTop = 0
  }, [previewId])

  // 键盘上下走的时候，选中的那行要自己进视野。
  useEffect(() => {
    if (!open) return
    rowRefs.current[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const run = (index: number) => {
    const row = rows[index]
    if (!row) return
    setOpen(false)
    // 打开文档：发事件，不等回话（契约 OPEN_DOC）。标签条 / 编辑器谁在谁收。
    ctx.emit(OPEN_DOC, { id: row.id })
  }

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((i) => Math.min(i + 1, Math.max(0, rows.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  if (!open) return null

  const renderRow = (row: Row, index: number) => {
    const path = ancestorPath(row.id, byId)
    return h(
      'div',
      {
        key: row.id,
        ref: (el: HTMLElement | null) => {
          rowRefs.current[index] = el
        },
        className: index === active ? `${s.row} ${s.rowOn}` : s.row,
        // 鼠标划过即选中，跟键盘上下键走同一条选择线
        onMouseMove: () => setSel(index),
        onClick: () => run(index),
      },
      h('span', { className: s.rowIcon }, h(PageIcon, { width: ICON, height: ICON })),
      h(
        'span',
        { className: s.rowMain },
        h(
          'div',
          { className: s.rowTitle },
          h('span', { className: s.rowName }, row.title || ctx.i18n.t('titlebar.untitled')),
          path ? h('span', { className: s.rowPath }, ` — ${path}`) : null,
        ),
        row.snippet ? h('div', { className: s.rowHint }, h(Snippet, { body: row.snippet })) : null,
      ),
    )
  }

  let counter = -1
  const list = sections.map((sec) =>
    h(
      'div',
      { key: sec.key },
      h('div', { className: s.group }, ctx.i18n.t(GROUP_LABEL[sec.key])),
      ...sec.rows.map((row) => renderRow(row, ++counter)),
    ),
  )

  return createPortal(
    h(
      'div',
      {
        className: s.overlay,
        // 点空白处关（点面板本体不关）
        onMouseDown: (e: ReactMouseEvent) => {
          if (e.target === e.currentTarget) setOpen(false)
        },
      },
      h(
        'div',
        { className: s.panel },
        h(
          'div',
          { className: s.inputRow },
          h(SearchIcon, { width: ICON, height: ICON }),
          h('input', {
            ref: inputRef,
            className: s.input,
            value: query,
            placeholder: ctx.i18n.t('search.placeholder'),
            spellCheck: false,
            onChange: (e: ReactChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value)
              setSel(0)
            },
            onKeyDown: onInputKeyDown,
          }),
        ),
        h(
          'div',
          { className: s.body },
          h(
            'div',
            { className: s.list },
            list.length > 0
              ? list
              : h(
                  'div',
                  { className: s.empty },
                  ctx.i18n.t(q ? 'search.empty' : 'search.noDocs'),
                ),
          ),
          h(
            'div',
            { className: s.preview, ref: previewRef },
            previewId
              ? [
                  h(
                    'div',
                    { key: 'title', className: s.previewTitle },
                    activeRow?.title || ctx.i18n.t('titlebar.untitled'),
                  ),
                  md === undefined
                    ? null
                    : md.trim()
                      ? h(
                          'div',
                          { key: 'body', className: s.previewBody },
                          ...mdBlocks(md).map((block, i) =>
                            h('div', { key: i, className: MD_CLASS[block.kind] }, block.text),
                          ),
                        )
                      : h(
                          'div',
                          { key: 'body', className: s.previewEmpty },
                          ctx.i18n.t('search.preview.blank'),
                        ),
                ]
              : h(
                  'div',
                  { className: s.previewEmpty },
                  ctx.i18n.t('search.preview.empty'),
                ),
          ),
        ),
        h('div', { className: s.footer }, ctx.i18n.t('search.hint')),
      ),
    ),
    document.body,
  )
}

export function apply(ctx: Context) {
  // body 上的空锚 + 自己的 React root。面板本体 portal 到 body（覆盖层不走槽）。
  // 逆函数只拆自己建的东西，**不在 disposer 里注册任何 effect**（D-0045 硬纪律 9）。
  ctx.effect(() => {
    // 清单**开机就取**，不等用户按 ⌘K —— 缓存的意义就在这儿。
    void ensureDocs(ctx).catch((err) => reportError('search-panel', err))
    // 别处改动了文档（改名 / 删 / 导入）→ 三份缓存整片作废，顺手重新热身。
    const off = ctx.on(DOCS_CHANGED, () => {
      invalidate()
      void ensureDocs(ctx).catch((err) => reportError('search-panel', err))
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(h(SearchPanel, { ctx }))
    return () => {
      off()
      root.unmount()
      host.remove()
      invalidate()
    }
  })
}
