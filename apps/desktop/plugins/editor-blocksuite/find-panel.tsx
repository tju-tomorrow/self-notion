/**
 * 查找替换面板 —— 右上角一个小浮层，⌘F 开、Esc 关、Enter 下一处。
 *
 * 依赖是**倒过来的**：编辑器的块包是懒加载的几 MB，面板自己不 import 它，只拿一个 `FindApi`
 * （由 `index.ts` 在装载后接线）。所以这个文件进启动路径是安全的。
 *
 * 高亮靠**选中**，不往正文里写标记 —— 查找不该改文档。
 */
import {
  createElement as h,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { Context } from 'cordis'
import { CloseIcon } from '@blocksuite/icons/rc'
import { OPEN_DOC } from '../../src/kernel/contract'

export interface FindMatch {
  blockId: string
  index: number
  length: number
}

export interface FindApi {
  search(query: string): Promise<FindMatch[]>
  focus(match: FindMatch): Promise<void>
  replace(match: FindMatch, text: string): Promise<void>
  replaceAll(query: string, text: string): Promise<number>
}

const PANEL: CSSProperties = {
  position: 'fixed',
  top: 56,
  right: 24,
  zIndex: 2000,
  width: 340,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 10,
  borderRadius: 10,
  background: 'var(--affine-v2-layer-background-primary, #fff)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border, rgba(0,0,0,.1))',
  boxShadow: 'var(--affine-menu-shadow, 0 8px 24px rgba(0,0,0,.18))',
  color: 'var(--affine-v2-text-primary, #222)',
  fontFamily: 'var(--affine-font-family, inherit)',
  fontSize: 13,
}

const ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 }

const INPUT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 28,
  padding: '0 8px',
  border: '1px solid var(--affine-v2-layer-insideBorder-border, rgba(0,0,0,.12))',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
}

const BTN: CSSProperties = {
  height: 26,
  padding: '0 8px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary, #666)',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
}

export function FindPanel({ ctx, api }: { ctx: Context; api: FindApi }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matches, setMatches] = useState<readonly FindMatch[]>([])
  const [at, setAt] = useState(0)
  const [note, setNote] = useState('')
  const input = useRef<HTMLInputElement>(null)

  // ⌘F / Ctrl+F 开关。窗口内监听，跟 ⌘K 同一条路（不是 OS 级全局快捷键）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      setOpen(true)
      setNote('')
      requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.select()
      })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // 换文档就把结果清掉 —— 匹配是按块 id 算的，换了文档全是废的。
  useEffect(() => {
    const off = ctx.on(OPEN_DOC, () => {
      setMatches([])
      setAt(0)
      setNote('')
    })
    return () => void off()
  }, [ctx])

  useEffect(() => {
    if (!open) return
    if (query === '') {
      setMatches([])
      return
    }
    let live = true
    const timer = setTimeout(() => {
      void api.search(query).then((found) => {
        if (!live) return
        setMatches(found)
        setAt(0)
        setNote('')
        if (found[0]) void api.focus(found[0])
      })
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [open, query, api])

  const go = (delta: number) => {
    if (!matches.length) return
    const next = (at + delta + matches.length) % matches.length
    setAt(next)
    const match = matches[next]
    if (match) void api.focus(match)
  }

  const doReplace = async () => {
    const match = matches[at]
    if (!match) return
    await api.replace(match, replacement)
    const found = await api.search(query)
    setMatches(found)
    const next = found.length === 0 ? 0 : Math.min(at, found.length - 1)
    setAt(next)
    const hit = found[next]
    if (hit) void api.focus(hit)
  }

  const doReplaceAll = async () => {
    if (query === '') return
    const n = await api.replaceAll(query, replacement)
    setMatches([])
    setAt(0)
    setNote(ctx.i18n.t('find.replaced', { n }))
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      go(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  if (!open) return null

  return createPortal(
    h(
      'div',
      { style: PANEL },
      h(
        'div',
        { style: ROW },
        h('input', {
          ref: input,
          style: INPUT,
          value: query,
          placeholder: ctx.i18n.t('find.placeholder'),
          spellCheck: false,
          onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
          onKeyDown,
        }),
        h(
          'span',
          { style: { minWidth: 48, textAlign: 'center', fontSize: 12, color: 'var(--affine-v2-text-tertiary)' } },
          query === ''
            ? ''
            : matches.length === 0
              ? ctx.i18n.t('find.empty')
              : `${at + 1}/${matches.length}`,
        ),
        h('button', { type: 'button', style: BTN, title: ctx.i18n.t('find.prev'), onClick: () => go(-1) }, '↑'),
        h('button', { type: 'button', style: BTN, title: ctx.i18n.t('find.next'), onClick: () => go(1) }, '↓'),
        h(
          'button',
          {
            type: 'button',
            style: BTN,
            title: ctx.i18n.t('settings.close'),
            onClick: () => setOpen(false),
          },
          h(CloseIcon, { width: 14, height: 14 }),
        ),
      ),
      h(
        'div',
        { style: ROW },
        h('input', {
          style: INPUT,
          value: replacement,
          placeholder: ctx.i18n.t('find.replacePlaceholder'),
          spellCheck: false,
          onChange: (e: { target: { value: string } }) => setReplacement(e.target.value),
          onKeyDown,
        }),
        h('button', { type: 'button', style: BTN, onClick: () => void doReplace() }, ctx.i18n.t('find.replace')),
        h('button', { type: 'button', style: BTN, onClick: () => void doReplaceAll() }, ctx.i18n.t('find.replaceAll')),
      ),
      note ? h('div', { style: { fontSize: 12, color: 'var(--affine-v2-text-tertiary)' } }, note) : null,
    ),
    document.body,
  )
}
