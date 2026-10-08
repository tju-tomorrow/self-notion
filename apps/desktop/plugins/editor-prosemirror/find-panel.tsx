/**
 * 查找替换面板 —— 右上角一个小浮层，⌘F 开、Esc 关、Enter 下一处。UI/行为照抄 `editor-blocksuite/find-panel.tsx`。
 *
 * 依赖是**倒过来的**：编辑器的块包（PM 那一坨）是懒加载的，面板自己不 import 它，只拿一个 `FindApi`
 * （由 `index.ts` 在装载后接线）。所以这个文件进启动路径是安全的。
 *
 * 高亮由 `api` 那侧用 decoration 画（`find.ts`），这里只负责发号施令 —— 查找不该改文档。
 */
import {
  createElement as h,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { Context } from 'cordis'
import { OPEN_DOC } from '../../src/kernel/contract'
import * as s from './find.css'
import type { FindApi, Match } from './find'

export type { FindApi, Match } from './find'

export function FindPanel({ ctx, api }: { ctx: Context; api: FindApi }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matches, setMatches] = useState<readonly Match[]>([])
  const [at, setAt] = useState(0)
  const [note, setNote] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const close = () => {
    setOpen(false)
    // 高亮是挂在视图上的，面板关了要还回去 —— 空查询就是「清掉」。
    void api.search('')
  }

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

  // 换文档就把结果清掉 —— 匹配是按位置算的，换了文档全是废的。
  useEffect(() => {
    const off = ctx.on(OPEN_DOC, () => {
      setMatches([])
      setAt(0)
      setNote('')
      void api.search('')
    })
    return () => void off()
  }, [ctx, api])

  useEffect(() => {
    if (!open) return
    if (query === '') {
      setMatches([])
      void api.search('')
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
      close()
    }
  }

  if (!open) return null

  return createPortal(
    h(
      'div',
      { className: s.panel },
      h(
        'div',
        { className: s.row },
        h('input', {
          ref: input,
          className: s.input,
          value: query,
          placeholder: ctx.i18n.t('find.placeholder'),
          spellCheck: false,
          onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
          onKeyDown,
        }),
        h(
          'span',
          { className: s.count },
          query === ''
            ? ''
            : matches.length === 0
              ? ctx.i18n.t('find.empty')
              : `${at + 1}/${matches.length}`,
        ),
        h('button', { type: 'button', className: s.btn, title: ctx.i18n.t('find.prev'), onClick: () => go(-1) }, '↑'),
        h('button', { type: 'button', className: s.btn, title: ctx.i18n.t('find.next'), onClick: () => go(1) }, '↓'),
        h(
          'button',
          { type: 'button', className: s.btn, title: ctx.i18n.t('settings.close'), onClick: close },
          '×',
        ),
      ),
      h(
        'div',
        { className: s.row },
        h('input', {
          className: s.input,
          value: replacement,
          placeholder: ctx.i18n.t('find.replacePlaceholder'),
          spellCheck: false,
          onChange: (e: { target: { value: string } }) => setReplacement(e.target.value),
          onKeyDown,
        }),
        h('button', { type: 'button', className: s.btn, onClick: () => void doReplace() }, ctx.i18n.t('find.replace')),
        h(
          'button',
          { type: 'button', className: s.btn, onClick: () => void doReplaceAll() },
          ctx.i18n.t('find.replaceAll'),
        ),
      ),
      note ? h('div', { className: s.note }, note) : null,
    ),
    document.body,
  )
}
