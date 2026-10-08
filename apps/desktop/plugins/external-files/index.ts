/**
 * `external-files` —— 外部 Markdown 文件（D-0137 ~ D-0142，全文 `docs/external-md.md`）。
 *
 * 三件事，全在这一页/这一条路上：
 *   1. `ctx.files`（`FilesService`）—— 侧栏那一行靠它探在不在、点它 `open()`；
 *   2. 挂在 `main.home` 的那一页（`./page.tsx`）：挂载的根 + **真实目录树**（按需展开）；
 *   3. `FILE_OPENED` → 不在任何已挂载根之下的先把它所在目录挂上，再 `OPEN_DOC`（§1.1）。
 *
 * ★ 为什么不只是监听事件：**打开事件可能早于前端起来**（macOS 把 Apple Event 交给一个
 *   还在启动的实例）—— 那会儿 Rust 先收进信箱，boot 时 `file:drainOpened` 取走（取走即清空）。
 *   只监听会丢那一批（D-0050 第 4 条那条纪律）。
 */
import { createElement } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { Context } from 'cordis'
import {
  FILE_OPENED,
  OPEN_DOC,
  SHOW_LIST,
  fileId,
  type FilesService,
} from '../../src/kernel/contract'
import { reportError, reportNote } from '../../src/kernel/errors'
import { FilesPage, setFilesPage } from './page'
import { FilesSection } from './settings'
import { addRoot, dirOf, loadRoots, underRoot } from './tree'

export const name = 'plugin-external-files'

// hard 依赖（CONVENTIONS §6.4）：没有 rpc 就一条 `file:*` 都调不了。
export const inject = ['rpc', 'slot', 'i18n']

/** 只有 `.md` 进编辑器 —— 别的（`.txt` / 图片 / 附件）在这一页看得到、打不开。 */
const MARKDOWN = /\.(md|markdown)$/i

/** Rust 那边还没有落地，形状按契约是 `{ paths }`，也认一下裸数组（合同写的是前者）。 */
function pathsOf(payload: unknown): string[] {
  const raw = Array.isArray(payload) ? payload : (payload as { paths?: unknown } | null)?.paths
  if (!Array.isArray(raw)) return []
  return raw.filter((path): path is string => typeof path === 'string')
}

export function apply(ctx: Context) {
  const rpc = ctx.rpc

  const files: FilesService = {
    // 首页靠这条值让开（`plugins/home/group.ts` 的 'files' 那一格），不让就两页叠在一起。
    open: () => {
      ctx.emit(SHOW_LIST, { group: 'files' })
      setFilesPage(true)
    },
  }

  /** 打开一个路径：不在任何已挂载的根之下 → **先挂它所在的目录**（§1.1），再交给编辑器。 */
  const openPath = async (path: string): Promise<void> => {
    await loadRoots(rpc)
    if (!underRoot(path)) await addRoot(rpc, dirOf(path))
    ctx.emit(OPEN_DOC, { id: fileId(path) })
  }

  /** 一个失败不拖累其余的 —— 一批里总有几个是被删掉的旧址。 */
  const openAll = async (paths: readonly string[]): Promise<void> => {
    for (const path of paths) {
      if (!MARKDOWN.test(path)) {
        reportNote('external-files', `不是 markdown，没开：${path}`)
        continue
      }
      try {
        await openPath(path)
      } catch (err) {
        reportError('external-files', err)
      }
    }
  }

  const section = () => createElement(FilesSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('files.settings.title')
  ;(section as { group?: string }).group = 'system'

  ctx.effect(() => [
    ctx.provide('files', files),
    // 跟 `vfs` / `bugs` 同一条路：这一页在主区切过去时自己显，别人显示时自己让开。
    ctx.on(SHOW_LIST, ({ group }) => setFilesPage(group === 'files')),
    ctx.slot.register('main.home', () => createElement(FilesPage, { ctx })),
    ctx.slot.register('settings.section', section),

    ctx.effect(() => {
      let dead = false
      let off: (() => void) | null = null
      void listen(FILE_OPENED, (event: { payload: unknown }) => void openAll(pathsOf(event.payload)))
        .then((un) => {
          if (dead) un()
          else off = un
        })
        .catch((err: unknown) => reportError('external-files', err))
      // 前端起来之前到的那些在 Rust 的信箱里。卸载后不再动手。
      void rpc
        .call<string[]>('file:drainOpened')
        .then((paths) => {
          if (!dead) return openAll(paths)
        })
        .catch((err: unknown) => reportError('external-files', err))
      return () => {
        dead = true
        off?.()
      }
    }),
  ])
}
