/**
 * 「附件板」—— 图片 blob 的可见面。
 *
 * 三种来源都汇进同一个 `accept()`：粘贴（paste）/ 拖拽（drop）/ 文件选择（input）。
 *
 * ★ **零等待**（D-0027）是这块的核心：拿到 File 的下一行就 `URL.createObjectURL` 进 state，
 *   `<img>` 立刻画出来；`blob:put` 是**背后**的事 —— 成功才把 `src` 换成稳定 URL
 *   （`self-notion://blob/<id>`）并 `revokeObjectURL` 掉临时的。**没有 loading 态、没有占位图。**
 *
 * 挂载方式：**入口在 `titlebar.right`**，板子在**覆盖层**里（`createPortal` 到 body）——
 * 覆盖层不走槽（契约里写死的），主区归编辑器，两者不再叠。等 Stage 2 的图片块落地，
 * 这个入口从「临时粘贴口」变成「附件管理」。
 *
 * 约定：只有 `ctx` 拿能力（slot / rpc / i18n），不 import 别的插件的内部文件（§6.2）。
 */
import type { Context } from 'cordis'
import { AttachmentIcon } from '@blocksuite/icons/rc'
// 顶栏那个图标按钮的样式跟外壳共用一份 —— 顶栏右侧的槽里挂的是好几个插件，
// 各抄一份 28×28 迟早会漂。
import * as s from '../../src/shell/shell.css'
import {
  createElement as h,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import { putBlob, type StoredBlob } from './blob'

interface Item {
  key: number
  name: string
  mime: string
  /** 当前显示的 src：先是临时 objectURL，落库后换成稳定 URL */
  src: string
  /** 还没回收的临时 objectURL（回收 / 换掉后置 undefined） */
  temp?: string
  stored?: StoredBlob
  error?: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function BlobBoard({ ctx }: { ctx: Context }): ReactElement {
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const nextKey = useRef(0)
  // 临时 URL 要能在**卸载时**逐个收回去（否则整块 blob 泄漏）—— 所以单独记账。
  const temps = useRef<Set<string>>(new Set())
  const alive = useRef(true)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      for (const url of temps.current) URL.revokeObjectURL(url)
      temps.current.clear()
    }
  }, [])

  const accept = useCallback(
    (files: File[]) => {
      for (const file of files) {
        // ★ 零等待的两行：先取临时 URL 进 state，慢的那条腿（落库）在下面异步走。
        const temp = URL.createObjectURL(file)
        temps.current.add(temp)
        const key = ++nextKey.current
        const mime = file.type || 'application/octet-stream'
        setItems((prev) => [
          ...prev,
          { key, name: file.name || ctx.i18n.t('blob.unnamed'), mime, src: temp, temp },
        ])

        // 落库（Rust 按内容 sha 去重）。成功 → 换成稳定 URL；失败 → 就地标错，临时 URL 留着还能看。
        putBlob(ctx.rpc, file).then(
          (stored) => {
            URL.revokeObjectURL(temp)
            temps.current.delete(temp)
            if (!alive.current) return
            setItems((prev) =>
              prev.map((it) =>
                it.key === key ? { ...it, src: stored.url, temp: undefined, stored } : it,
              ),
            )
          },
          (err: unknown) => {
            if (!alive.current) return
            setItems((prev) => prev.map((it) => (it.key === key ? { ...it, error: String(err) } : it)))
          },
        )
      }
    },
    [ctx],
  )

  const renderItem = (item: Item): ReactElement => {
    const isImage = item.stored ? item.stored.isImage : item.mime.startsWith('image/')
    if (isImage) {
      return h('figure', { key: item.key, style: FIGURE }, [
        h('img', { key: 'img', src: item.src, alt: item.name, style: IMAGE }),
        h(
          'figcaption',
          { key: 'cap', style: CAPTION },
          item.error ? item.error : item.stored?.dedup ? ctx.i18n.t('blob.dedup') : item.name,
        ),
      ])
    }
    // 附件（非图片）：照存不误，只是不渲染成 <img> —— 一个文件名 + 大小。
    const size = item.stored ? ` · ${formatSize(item.stored.size)}` : ''
    return h('div', { key: item.key, style: FILE }, item.error ? `${item.name} —— ${item.error}` : `${item.name}${size}`)
  }

  const boardStyle: CSSProperties = {
    ...BOARD,
    borderColor: dragging ? 'var(--affine-primary-color)' : 'var(--affine-border-color)',
  }

  return h(
    'div',
    {
      tabIndex: 0,
      style: boardStyle,
      // 粘贴只在**这块拿到焦点时**触发 —— 不去 window 上抢，免得跟编辑器抢 paste。
      onPaste: (e) => {
        const files = Array.from(e.clipboardData.files)
        if (!files.length) return
        e.preventDefault()
        accept(files)
      },
      onDragOver: (e) => {
        e.preventDefault()
        if (!dragging) setDragging(true)
      },
      onDragLeave: () => setDragging(false),
      onDrop: (e) => {
        e.preventDefault()
        setDragging(false)
        accept(Array.from(e.dataTransfer.files))
      },
    },
    [
      h('div', { key: 'hint', style: HINT }, ctx.i18n.t('blob.hint')),
      h(
        'button',
        { key: 'pick', type: 'button', style: PICK, onClick: () => input.current?.click() },
        ctx.i18n.t('blob.pick'),
      ),
      h('input', {
        key: 'input',
        ref: input,
        type: 'file',
        multiple: true,
        style: { display: 'none' },
        onChange: (e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = '' // 清空：同一个文件选第二次也要能触发 change
          accept(files)
        },
      }),
      h('div', { key: 'list', style: LIST }, items.map(renderItem)),
    ],
  )
}

/**
 * 顶栏入口：一个按钮 + 覆盖层。板子 portal 到 `document.body`（覆盖层不走槽）。
 * 关闭：再点一次入口 / 点背景 / Esc —— 三条都留，免得找不到出口。
 */
export function BlobLauncher({ ctx }: { ctx: Context }): ReactElement {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return h(
    Fragment,
    null,
    h(
      'button',
      {
        type: 'button',
        className: s.iconButton,
        // 入口按钮开的是**附件板**，不是系统文件选择框 —— 所以用 `blob.open` 而不是
        // `blob.pick`（板子里那个「选择文件」才是 pick）。两者混用会让顶栏出现两个"选择文件"。
        title: ctx.i18n.t('blob.open'),
        'aria-label': ctx.i18n.t('blob.open'),
        onClick: () => setOpen((prev) => !prev),
      },
      // 顶栏右侧一律是图标（AFFiNE 的 IconButton），文字留给 title / aria-label。
      h(AttachmentIcon, { width: 20, height: 20 }),
    ),
    open
      ? createPortal(
          h(
            'div',
            { style: OVERLAY, onClick: () => setOpen(false) },
            // 停掉冒泡：点板子内部不该把覆盖层关掉。
            h('div', { style: PANEL, onClick: (e) => e.stopPropagation() }, h(BlobBoard, { ctx })),
          ),
          document.body,
        )
      : null,
  )
}

/* ────────────────────────── 样式（颜色走 var(--affine-*)，由组合根挂到根元素） ────────────────────────── */

const BOARD: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  border: '1px dashed var(--affine-border-color)',
  borderRadius: 8,
  color: 'var(--affine-text-primary-color)',
}

const HINT: CSSProperties = { color: 'var(--affine-text-secondary-color)', fontSize: 12 }

const PICK: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '4px 12px',
  border: '1px solid var(--affine-border-color)',
  borderRadius: 6,
  background: 'var(--affine-background-primary-color)',
  color: 'var(--affine-text-primary-color)',
  cursor: 'pointer',
}

const LIST: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }

const FIGURE: CSSProperties = { margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }

const IMAGE: CSSProperties = { maxWidth: 240, maxHeight: 180, borderRadius: 4, objectFit: 'contain' }

const CAPTION: CSSProperties = { fontSize: 11, color: 'var(--affine-text-secondary-color)' }

const FILE: CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--affine-border-color)',
  borderRadius: 6,
  fontSize: 12,
}

/** 顶栏入口按钮（titlebar.right 槽，跟深浅色徽标并排）。 */
/** 覆盖层：铺满窗口、压暗背景。portal 到 body，所以 position: fixed 是相对视口。 */
const OVERLAY: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.35)',
}

const PANEL: CSSProperties = {
  width: '90%',
  maxWidth: 720,
  maxHeight: '80vh',
  overflowY: 'auto',
  padding: 16,
  borderRadius: 12,
  background: 'var(--affine-background-primary-color)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.24)',
}
