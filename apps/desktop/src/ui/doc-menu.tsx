/**
 * 文档行上右键 / 点 ⋯ 弹出的菜单 —— 侧栏和首页共用这一份。
 *
 * 为什么落在外壳层（`src/`）而不是某个插件里：侧栏和首页要的动作一模一样（打开 / 拷贝链接 /
 * 创建副本 / 重命名 / 移动到 / 移入垃圾箱 / 收藏），而插件之间不许 import 对方的内部文件
 * （CONVENTIONS §6.2）。放这儿，两边 import 的都是外壳。
 *
 * 动作一律「调 rpc + 广播 DOCS_CHANGED」—— 菜单改库，各视图自己重取，菜单不碰别人的状态。
 * 重命名是例外：输入框得长在那一行上，所以菜单只负责通知视图「该改名了」。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from 'cordis'
import {
  AllDocsIcon,
  DeletePermanentlyIcon,
  DeleteTemporarilyIcon,
  DuplicateIcon,
  EditIcon,
  FavoriteIcon,
  FavoritedIcon,
  LinkIcon,
  MoveToIcon,
  NewPageIcon,
  PageIcon,
  ResetIcon,
  TagIcon,
} from '@blocksuite/icons/rc'
import { DOCS_CHANGED, OPEN_DOC, type DocMeta } from '../kernel/contract'
import { reportError } from '../kernel/errors'
import { copyText } from './clipboard'
import { confirmDialog } from './confirm'
import { toast } from './toast'
import { TagPanel } from './tags'
import * as s from './doc-menu.css'

const ICON = 20
/** 离视口边缘留的缝，免得菜单贴着屏幕边、圆角被切掉。 */
const GAP = 8

export interface DocMenuState {
  readonly doc: DocMeta
  readonly x: number
  readonly y: number
  /** 从光标弹（右键）还是从按钮弹（⋯）：按钮要右对齐，不然菜单会甩出窗口。 */
  readonly anchor: 'cursor' | 'right'
}

/**
 * 右键 / ⋯ 的状态。挂在哪一行、弹在哪儿都是视图自己的事，菜单只认坐标。
 *
 * `openFromEvent` 要 `preventDefault` —— 不拦掉弹出来的就是浏览器那个「重新加载 / 检查元素」。
 */
export function useDocMenu() {
  const [menu, setMenu] = useState<DocMenuState | null>(null)

  const open = useCallback((doc: DocMeta, x: number, y: number, anchor: DocMenuState['anchor']) => {
    setMenu({ doc, x, y, anchor })
  }, [])

  return {
    menu,
    openFromEvent: (
      e: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number },
      doc: DocMeta,
    ) => {
      e.preventDefault()
      e.stopPropagation()
      open(doc, e.clientX, e.clientY, 'cursor')
    },
    openFromButton: (e: { stopPropagation(): void; currentTarget: HTMLElement }, doc: DocMeta) => {
      e.stopPropagation()
      const rect = e.currentTarget.getBoundingClientRect()
      open(doc, rect.right, rect.bottom + 6, 'right')
    },
    closeMenu: useCallback(() => setMenu(null), []),
  }
}

/* ────────────────────────── 动作（菜单里点一下会发生什么） ────────────────────────── */

/** 链接是 `self-notion://doc/<id>` —— 和文档页顶栏那个 ⋯ 菜单同一个格式。 */
function copyLink(id: string): Promise<void> {
  return copyText(`self-notion://doc/${id}`)
}

/** 创建副本：后端没有 duplicate，用现成的 open + create + apply 拼一个。
 *  副本留在**原文档同一层**（parentId 跟着源走），不是每次都甩到顶层。 */
async function duplicate(ctx: Context, doc: DocMeta): Promise<void> {
  const title = doc.title || ctx.i18n.t('doc.untitled')
  const src = await ctx.rpc.call<{ snapshot: string | null; updates: string[] }>('doc:open', {
    id: doc.id,
  })
  const made = await ctx.rpc.call<DocMeta>('doc:create', {
    parentId: doc.parentId,
    title: `${title} ${ctx.i18n.t('doc.copySuffix')}`,
  })
  if (src.snapshot !== null) await ctx.rpc.call('doc:apply', { id: made.id, snapshot: src.snapshot })
  for (const update of src.updates) await ctx.rpc.call('doc:apply', { id: made.id, update })
  ctx.emit(DOCS_CHANGED)
  ctx.emit(OPEN_DOC, { id: made.id })
}

/** 自己 + 全部后代 —— 移动的目标里不能出现它们，否则树里成环。 */
export function subtreeIds(docs: readonly DocMeta[], root: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const doc of docs) {
    if (doc.parentId === null) continue
    const list = children.get(doc.parentId)
    if (list) list.push(doc.id)
    else children.set(doc.parentId, [doc.id])
  }
  const out = new Set<string>()
  const stack = [root]
  while (stack.length) {
    const cur = stack.pop()
    if (cur === undefined) break
    out.add(cur)
    for (const kid of children.get(cur) ?? []) stack.push(kid)
  }
  return out
}

/* ────────────────────────── 菜单本体 ────────────────────────── */

export function DocMenu({
  ctx,
  menu,
  docs,
  onClose,
  onRename,
}: {
  ctx: Context
  menu: DocMenuState
  docs: readonly DocMeta[]
  onClose: () => void
  /** 交给视图：输入框要长在那一行上。 */
  onRename: (doc: DocMeta) => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: menu.x, top: menu.y })
  /** 「移动到」不关菜单 —— 换成目标列表接着选（跟文档页那个 ⋯ 菜单一样）。 */
  const [picking, setPicking] = useState(false)
  /** 「标签」也一样：点开换成标签那一页（`TagPanel`），不关菜单。 */
  const [tagging, setTagging] = useState(false)

  // 量完真实尺寸再摆：菜单高度随项数变，估算一定错。夹在视口里，别顶出去。
  useLayoutEffect(() => {
    const rect = panel.current?.getBoundingClientRect()
    if (!rect) return
    const left = menu.anchor === 'right' ? menu.x - rect.width : menu.x
    setAt({
      left: Math.max(GAP, Math.min(left, window.innerWidth - rect.width - GAP)),
      top: Math.max(GAP, Math.min(menu.y, window.innerHeight - rect.height - GAP)),
    })
  }, [menu, picking, tagging])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  /** 点一下就走：先关菜单再跑，失败进 errors.log（AGENTS.md §3），别卡在菜单里。 */
  const run = (fn: () => Promise<void>) => {
    onClose()
    void fn().catch((err) => reportError('doc.menu', err))
  }

  const call = (method: `${string}:${string}`, args: unknown) => () =>
    ctx.rpc.call(method, args).then(() => ctx.emit(DOCS_CHANGED))

  const trashed = menu.doc.deletedAt !== null

  return createPortal(
    <div
      className={s.menu}
      ref={panel}
      style={{ left: at.left, top: at.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className={s.label}>
        {ctx.i18n.t(trashed ? 'sidebar.group.trash' : 'doc.menu.page')}
      </span>
      {tagging ? (
        <TagPanel ctx={ctx} doc={menu.doc} />
      ) : picking ? (
        <MoveList ctx={ctx} doc={menu.doc} docs={docs} onClose={onClose} />
      ) : trashed ? (
        <>
          <Item
            icon={<ResetIcon width={ICON} height={ICON} />}
            label={ctx.i18n.t('sidebar.restore')}
            onClick={() => run(call('doc:restore', { id: menu.doc.id }))}
          />
          <Item
            icon={<DeletePermanentlyIcon width={ICON} height={ICON} />}
            label={ctx.i18n.t('sidebar.remove')}
            onClick={() => {
              const title = menu.doc.title || ctx.i18n.t('sidebar.untitled')
              const kids = subtreeIds(docs, menu.doc.id).size - 1
              void confirmDialog({
                title:
                  kids > 0
                    ? ctx.i18n.t('sidebar.confirm-remove-sub', { title, n: kids })
                    : ctx.i18n.t('sidebar.confirm-remove', { title }),
                ok: ctx.i18n.t('common.delete'),
                danger: true,
              }).then((ok) => {
                if (ok) run(call('doc:remove', { id: menu.doc.id }))
              })
            }}
          />
        </>
      ) : (
        <>
          <Item
            icon={<PageIcon width={ICON} height={ICON} />}
            label={ctx.i18n.t('doc.open')}
            onClick={() => {
              onClose()
              ctx.emit(OPEN_DOC, { id: menu.doc.id })
            }}
          />
          {/* Notion 那样：在某一行的菜单里直接开一篇子页面，建完就进去（好立刻命名）。 */}
          <Item
            icon={<NewPageIcon width={ICON} height={ICON} />}
            label={ctx.i18n.t('doc.subpage')}
            onClick={() =>
              run(async () => {
                const made = await ctx.rpc.call<DocMeta>('doc:create', {
                  parentId: menu.doc.id,
                  title: '',
                })
                ctx.emit(DOCS_CHANGED)
                ctx.emit(OPEN_DOC, { id: made.id })
              })
            }
          />
          <Item
            icon={<LinkIcon width={ICON} height={ICON} />}
            label={ctx.i18n.t('doc.link')}
            onClick={() => run(() => copyLink(menu.doc.id))}
          />
          <Item
            icon={<DuplicateIcon width={ICON} height={ICON} />}
            label={ctx.i18n.t('doc.duplicate')}
            onClick={() => run(() => duplicate(ctx, menu.doc))}
          />
          <Item
            icon={<EditIcon width={ICON} height={ICON} />}
            label={ctx.i18n.t('doc.rename')}
            onClick={() => {
              onClose()
              onRename(menu.doc)
            }}
          />
          <Item
            icon={<MoveToIcon width={ICON} height={ICON} />}
            label={ctx.i18n.t('doc.move')}
            onClick={() => setPicking(true)}
          />
          <Item
            icon={
              menu.doc.isFavorite ? (
                <FavoritedIcon width={ICON} height={ICON} />
              ) : (
                <FavoriteIcon width={ICON} height={ICON} />
              )
            }
            label={ctx.i18n.t(menu.doc.isFavorite ? 'doc.unfavorite' : 'doc.favorite')}
            onClick={() =>
              run(call('doc:favorite', { id: menu.doc.id, value: !menu.doc.isFavorite }))
            }
          />
          <Item
            icon={<TagIcon width={ICON} height={ICON} />}
            label={ctx.i18n.t('doc.tags.label')}
            hint={
              menu.doc.tags.length
                ? menu.doc.tags.join(', ')
                : ctx.i18n.t('doc.tags.placeholder')
            }
            onClick={() => setTagging(true)}
          />
          <Item
            icon={<DeleteTemporarilyIcon width={ICON} height={ICON} />}
            label={ctx.i18n.t('doc.trash')}
            onClick={() => {
              run(call('doc:trash', { id: menu.doc.id }))
              toast({
                text: ctx.i18n.t('sidebar.trashed'),
                action: {
                  label: ctx.i18n.t('common.undo'),
                  run: () => {
                    void ctx.rpc
                      .call('doc:restore', { id: menu.doc.id })
                      .then(() => ctx.emit(DOCS_CHANGED))
                      .catch((err: unknown) => reportError('doc.menu', err))
                  },
                },
              })
            }}
          />
        </>
      )}
    </div>,
    document.body,
  )
}

function Item({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode
  label: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button type="button" className={s.item} onClick={onClick}>
      <span className={s.itemIcon}>{icon}</span>
      <span className={s.itemLabel}>{label}</span>
      {hint === undefined ? null : <span className={s.itemHint}>{hint}</span>}
    </button>
  )
}

/** 移动到哪儿：顶层 + 所有不在自己子树里的活文档。 */
function MoveList({
  ctx,
  doc,
  docs,
  onClose,
}: {
  ctx: Context
  doc: DocMeta
  docs: readonly DocMeta[]
  onClose: () => void
}) {
  const blocked = subtreeIds(docs, doc.id)
  const targets = docs.filter((d) => d.deletedAt === null && !blocked.has(d.id))

  const move = (parentId: string | null) => {
    onClose()
    void ctx.rpc
      .call('doc:move', { id: doc.id, parentId })
      .then(() => ctx.emit(DOCS_CHANGED))
      .catch((err: unknown) => reportError('doc.menu', err))
  }

  return (
    <>
      <span className={s.label}>{ctx.i18n.t('doc.move.to')}</span>
      <Item
        icon={<AllDocsIcon width={ICON} height={ICON} />}
        label={ctx.i18n.t('doc.move.root')}
        onClick={() => move(null)}
      />
      {targets.map((target) => (
        <Item
          key={target.id}
          icon={<PageIcon width={ICON} height={ICON} />}
          label={target.title || ctx.i18n.t('doc.untitled')}
          onClick={() => move(target.id)}
        />
      ))}
    </>
  )
}

/**
 * 原地改名。挂在那一行上、受视图的 `renaming` 状态控制，所以视图自己决定什么时候渲染它。
 *
 * Esc 要「取消」，但 Esc 之后 blur 还是会到 —— 用 `cancelled` 记一笔，blur 时吞掉，
 * 否则一按 Esc 反而把没写完的名字提交了。
 */
export function InlineRename({
  ctx,
  doc,
  className,
  onDone,
}: {
  ctx: Context
  doc: DocMeta
  className?: string
  onDone: () => void
}) {
  const cancelled = useRef(false)
  return (
    <input
      className={className === undefined ? s.renameInput : `${className} ${s.renameInput}`}
      defaultValue={doc.title}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const value = e.currentTarget.value
        if (cancelled.current) {
          cancelled.current = false
          onDone()
          return
        }
        onDone()
        if (value === doc.title) return
        void ctx.rpc
          .call('doc:rename', { id: doc.id, title: value })
          .then(() => ctx.emit(DOCS_CHANGED))
          .catch((err: unknown) => reportError('doc.rename', err))
      }}
      onKeyDown={(e) => {
        // Enter 交给 onBlur 落地 —— 提交只留一条路径。
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') cancelled.current = true
      }}
    />
  )
}
