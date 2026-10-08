/**
 * `ctx.editor` 的提供者 —— 整个插件对外的全部。形状照 `editor-blocksuite/index.ts`，基座换成 ProseMirror。
 *
 * ★ **编辑器本体（PM 那一坨）是懒装载的**（契约 `ready()` 那条注释）：首页 / 搜索 / 设置页都不需要它，
 *   只有真要挂编辑器时才 `import('./editor')`。
 * ★ 换基座后契约变了（D-0129）：`blocks()` / `defineBlock()` 没了，新增 `schema()`。
 *   服务名 / 槽位名 / 事件名**一个不动**。
 */
import type { Context } from 'cordis'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

import {
  DOC_SAVED,
  DOCS_CHANGED,
  OPEN_DOC,
  type CommentState,
  type CommentTarget,
  type DocMeta,
} from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { setLoadBacklinks } from './backlinks'
import { setPutBlob } from './blob'
import { setCreateDoc, setDocs, setLoadDoc, setOpenDoc } from './doc-meta'
import { setSyncApi } from './sync'
import { FindPanel, type FindApi } from './find-panel'
import { registerEditorView, reloadDoc } from './view'

type EditorModule = typeof import('./editor')

export const name = 'editor-prosemirror'

// 硬依赖（CONVENTIONS §6.4）：docs 没就位就不装载 —— 与其给一个打不开文档的编辑器，不如没有编辑器。
// rpc：栏头的页名要 `doc:list`（跟标签条同一条路）。
export const inject = ['docs', 'rpc']

/** 字节 → base64。一次喂太多会爆栈（`String.fromCharCode` 约 6.5 万参数上限）—— 按块切。 */
const CHUNK = 0x8000
function toBase64(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    raw += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(raw)
}

export function apply(ctx: Context) {
  /** 装载完的模块。同步口子（`schema()`）靠它 —— 装载前是 null。 */
  let mod: EditorModule | null = null

  /** 判据（`diagnose.ts`）的卸载函数 —— 它装在懒装载那一侧，所以单独收着。 */
  let offDiagnostics: (() => void) | undefined
  let disposed = false

  /** 装载 + 接线。整块只有一次：重复接会互相覆盖。★ 它是**懒的**：第一次调用才真的 import。 */
  let loading: Promise<EditorModule> | undefined
  const load = () =>
    (loading ??= import('./editor').then((editor) => {
      // 字节路径接上 `ctx.docs`：落库成功由编辑器那边回叫，这里转成 `DOC_SAVED`（顶栏显示「已保存」）。
      editor.connectDocs(ctx.docs, {
        saved: (docId) => ctx.emit(DOC_SAVED, { id: docId }),
        // 编辑器那层不认识 i18n，占位文案装载时写进去。
        untitled: ctx.i18n.t('doc.untitled'),
        outline: ctx.i18n.t('editor.outline'),
        outlineEmpty: ctx.i18n.t('editor.outlineEmpty'),
        createdAt: ctx.i18n.t('editor.createdAt'),
        words: ctx.i18n.t('editor.words'),
        // 评论插件那一侧（软依赖：它不在，高亮就点不动、按钮也没反应 —— 跟别处一个规矩）。
        comment: {
          open: (id) => ctx.get('comment')?.open(id),
          selection: (at) => ctx.get('comment')?.onSelection(at),
        },
      })
      mod = editor
      // 判据（D-0126）：DOM 与模型那一组不变量。★ 装在**懒装载这一侧** —— `./diagnose` 要读
      // `./editor` 的活状态，别为了它把编辑器本体拖回冷启动。
      void import('./diagnose').then(({ installDiagnostics }) => {
        if (disposed) return
        offDiagnostics = installDiagnostics(ctx)
      })
      return editor
    }))

  // `mount()` 那条口子（契约里没人调，应用走 `view.ts`）挂出去的编辑器，拔插件时要摘干净。
  const live = new Set<() => void>()

  ctx.effect(() => [
    ctx.provide('editor', {
      /** 契约里那条 `ready()`：装载 + 接线都完成了才算数。 */
      ready: () => load().then(() => undefined),

      /**
       * 契约的签名是**同步**的，真实路径是异步的（先等装载、再接 `await ctx.docs.load`）。
       * 立刻返回卸载函数，挂载在后台完成；失败**不吞** —— 落到 errors.log。
       */
      mount(el: HTMLElement, doc: { readonly id: string }) {
        let undo: (() => void) | undefined
        let cancelled = false
        void load()
          .then((editor) => editor.mountEditor(el, doc.id))
          .then((handle) => {
            if (cancelled) {
              handle.unmount()
              return
            }
            undo = () => handle.unmount()
            live.add(undo)
          })
          .catch((err) => reportError('editor-prosemirror', err))

        return () => {
          cancelled = true
          if (!undo) return
          live.delete(undo)
          undo()
          undo = undefined
        }
      },

      /** ★ 装载完才有东西（契约里写了要先 `await ready()`）。没装载就明说，别给个空对象。 */
      schema() {
        if (mod === null) throw new Error('编辑器还没装载：先 await ctx.editor.ready()')
        return mod.schemaOf()
      },

      /** markdown → 整篇 doc JSON（契约 `docFromMarkdown`）。解析器在编辑器那一侧 —— 跟 `schema()` 一个规矩。 */
      docFromMarkdown(markdown: string): string {
        if (mod === null) throw new Error('编辑器还没装载：先 await ctx.editor.ready()')
        return mod.docFromMarkdown(markdown)
      },

      /** 还没装载过 = 一篇都没打开过 → null。 */
      text: (id: string) => mod?.liveText(id) ?? null,

      /**
       * 库里这篇的字节换过了（恢复历史版本，D-0043）→ 丢掉手里的活编辑器、用库里那份重建。
       * ★ 不能把新 JSON 塞进现有的 doc —— 那样选区和撤销历史会跟内容对不上（契约 `reload` 注释）。
       */
      async reload(id: string) {
        if (loading === undefined) return
        const editor = await loading
        editor.muteDoc(id)
        // 不是当前这篇就没人重挂，闸门得自己放开（否则这一篇从此不再落库）。
        if (!reloadDoc(id)) editor.unmuteDoc(id)
      },

      /** 攒着的改动立刻落库 —— 内置助手的写工具读库之前必须调它（契约 `flush` 注释）。 */
      async flush(id: string) {
        if (loading === undefined) return
        const editor = await loading
        await editor.flushDoc(id)
      },

      /* 评论（D-0067）：都过 `mod`，装载前一律空转 —— 没开文档时本来就该是 null。 */
      textSelection: () => mod?.commentTextSelection() ?? null,
      blockSelection: () => mod?.commentBlockSelection() ?? null,
      addCommentAnchor: (id: string, at: CommentTarget) => mod?.addCommentAnchor(id, at),
      removeCommentAnchor: (id: string) => mod?.removeCommentAnchor(id),
      revealComment: (id: string) => mod?.revealCommentAnchor(id),
      setCommentStates: (list: readonly CommentState[]) => mod?.pushCommentStates(list),

      /** 内存监控（D-0088）。没装载过编辑器就是空表 —— 那是实话（这会儿确实没有文档在内存里）。 */
      stats: () => mod?.memoryStats() ?? [],
    }),

    // 把编辑器放进 `main.view`，并订阅 `OPEN_DOC`（点哪篇文档就挂哪篇）。
    registerEditorView(ctx),

    // 拔插件：先把攒着的改动落完，再摘编辑器。顺序不能反 —— 摘了之后就没地方读了。
    () => {
      disposed = true
      offDiagnostics?.()
      // 用 loading 而不是 mod：正好在装载途中拔插件时，也等它落地再落库。
      if (loading) void loading.then((editor) => editor.flushAll())
      for (const off of live) off()
      live.clear()
    },
  ])

  // 别的文档的元数据 + 「打开它」—— 子页面卡片 / @提及 / 面包屑要（`doc-meta.ts`）。
  // ★ 这一段是**轻的**：`doc:list` 走 rpc，不碰编辑器本体，所以进得了启动路径。
  ctx.effect(() => {
    setOpenDoc((id) => ctx.emit(OPEN_DOC, { id }))
    // 存图片 / 附件。字节走 base64（线格式，D-0047），Rust 按 sha256 去重。
    setPutBlob(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const meta = await ctx.rpc.call<{ id: string }>('blob:put', {
        bytes: toBase64(bytes),
        mime: file.type || 'application/octet-stream',
      })
      return meta.id
    })
    const refresh = () => {
      void ctx.rpc
        .call<DocMeta[]>('doc:list', { includeTrashed: false })
        .then((all) => {
          setDocs(all)
          // 库里的名字要回到正文顶上那个大标题 —— 侧栏重命名 / 导入 / 助手都改的是库里那份，
          // 不写回去，下一次落库就把新名字盖成旧的（旧插件叫 `applyTitle`）。
          if (mod === null) return
          for (const meta of all) mod.applyTitle(meta.id, meta.title)
        })
        .catch((err: unknown) => reportError('editor-prosemirror', err))
    }
    refresh()
    // 文档集合一变（新建 / 改名 / 删除 / 移动）就重取 —— 卡片上的标题跟着走。
    const off = ctx.on(DOCS_CHANGED, refresh)
    // 反向链接（谁提到了这一篇）—— 也是轻的，走 rpc。
    setLoadBacklinks((id) => ctx.rpc.call<DocMeta[]>('link:backlinks', { id }))
    // 新建一篇（斜杠菜单的「子页面」用）。落库那条记录先有，正文随后跟着写。
    setCreateDoc(async (title, parentId) => {
      const meta = await ctx.rpc.call<DocMeta>('doc:create', { parentId, title })
      ctx.emit(DOCS_CHANGED)
      return meta.id
    })
    // 读别篇的正文（模板按钮「拷一份块过来」用）。
    setLoadDoc(async (id) => (await ctx.docs.load(id)).content)
    // 同步块的源（D-0136：内容只有一份，所以「一致」是免费的）。
    setSyncApi({
      newSrc: async () => (await ctx.rpc.call<{ id: string }>('sync:new', {})).id,
      get: async (id) => (await ctx.rpc.call<{ content: string }>('sync:get', { id })).content,
      put: async (id, content) => {
        await ctx.rpc.call('sync:put', { id, content })
      },
    })
    return () => void off()
  })

  // 查找替换（⌘F）。★ 面板自己不 import PM 那一坨 —— api 的每个方法都 `await load()`
  // 才拿到编辑器，所以这一段进不了启动路径（跟 `editor-blocksuite` 同一套做法）。
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const api: FindApi = {
      search: async (query) => (await load()).findApiForCurrentView().search(query),
      focus: async (match) => (await load()).findApiForCurrentView().focus(match),
      replace: async (match, text) => (await load()).findApiForCurrentView().replace(match, text),
      replaceAll: async (query, text) =>
        (await load()).findApiForCurrentView().replaceAll(query, text),
    }
    root.render(createElement(FindPanel, { ctx, api }))
    return () => {
      root.unmount()
      host.remove()
    }
  })

  // 关窗口前把攒着的改动落完 —— 300ms 的窗口期里点红点会丢那一截。
  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    let unlisten: (() => void) | undefined
    let dead = false
    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        const off = await win.onCloseRequested(async (event) => {
          event.preventDefault()
          try {
            const editor = await load()
            await editor.flushAll()
          } catch (err) {
            reportError('editor-prosemirror', err)
          }
          await win.destroy()
        })
        if (dead) off()
        else unlisten = off
      })
      .catch((err: unknown) => reportError('editor-prosemirror', err))
    return () => {
      dead = true
      unlisten?.()
    }
  })
}
