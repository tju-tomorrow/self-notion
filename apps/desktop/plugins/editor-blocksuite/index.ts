/**
 * `ctx.editor` 的提供者 —— 整个插件对外的全部。
 *
 * 形状（冻结契约 contract.ts）：
 *   ready() → Promise        装载完 + 接完线
 *   mount(el, doc) → 卸载函数
 *   defineBlock(spec, view) → 注销函数
 *
 * ★ **编辑器本体（BlockSuite + `blocks/`）是懒装载的。** 它是构建产物里最大的那块
 *   （4 MB+），而首页 / 搜索 / 设置页一个都不需要它。插件扫描器一视同仁地 `await import()`
 *   所有插件，原来 `./editor` 是静态 import，于是这几 MB 的解析执行费算在了冷启动上。
 *   现在只有**真要挂编辑器**时才 import：打开一篇文档（`view.ts` 那边）或有人
 *   `await ctx.editor.ready()`。
 *
 *   代价写在契约里：`blocks()` 是同步的，装载完之前没有清单，所以要清单的人先 await ready。
 */
import type { Context } from 'cordis'

import { DOCS_CHANGED, DOC_SAVED, OPEN_DOC, type CommentState, type CommentTarget, type DocMeta } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { registerEditorView, reloadDoc, openDocIds } from './view'
import {
  applyCaretColor,
  applyCaretShape,
  CARET_COLOR_KEY,
  CARET_KEY,
  caretColorOf,
  caretShapeOf,
  clearCaretColor,
  clearCaretShape,
} from './caret'
import { CaretSection } from './settings'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { FindPanel, type FindApi } from './find-panel'

type EditorModule = typeof import('./editor')

export const name = 'editor-blocksuite'

// ★ 硬依赖 `docs`（CONVENTIONS §6.4）。Stage 1 时这里**故意空着** —— `ctx.docs` 没人提供，
//   而 cordis 的 inject 等待**没有超时**（D-0045），硬声明会让这个 fiber 永远 PENDING，
//   内核 `settled()` 见到非 ACTIVE 直接抛错，把所有人的应用一起拦停。
//   现在 `plugin-storage`（inject `rpc`）提供了它，链路是完整的 —— 声明回来，缺了就**不装载**：
//   与其给一个打不开文档的编辑器，不如没有编辑器。
//   `rpc`：在正文里新建的子页面要落库（`doc:create`）—— 也在 D-0045 的必 inject 清单里。
export const inject = ['docs', 'rpc', 'settings']

export function apply(ctx: Context) {
  /** 装载完的模块。同步口子（`blocks()`）靠它 —— 装载前是 null。 */
  let mod: EditorModule | null = null

  /** 评论的解决状态。存一份在这儿，装载晚于第一次推送时补得上（见 `load()`）。 */
  let commentStates: CommentState[] = []

  /**
   * 装载 + **接一次线**。`connectDocs` / `connectBlobs` / `connectShell` 都是模块级单例，
   * 重复接会互相覆盖，所以整个 apply 只接一次。★ 它**是懒的**：第一次调用才真的 import。
   */
  let loading: Promise<EditorModule> | undefined
  const load = () =>
    (loading ??= import('./editor').then((editor) => {
      // 字节路径接上 `ctx.docs`。必须在这儿、在任何人调用 `mountEditor` 之前。
      editor.connectDocs(ctx.docs, ctx.rpc)

      // 图片的字节在库里，渲染要现取 —— 接上 rpc（走 `self-notion://blob/<id>`）。
      editor.connectBlobs(ctx.rpc)

      // 正文里的子页面要往外说两句：打开谁、新建成谁的孩子。
      // 只有认识 `ctx` 的这一层知道怎么办（`editor.ts` 那边不认识）。
      editor.connectShell({
        openDoc: (docId) => ctx.emit(OPEN_DOC, { id: docId }),
        createChildDoc: async (docId, parentId) => {
          // id 是上游（Workspace）生成的，我们照抄给库里 —— 两边必须同一个 id，
          // 否则打开子页面时 `doc:open` 找不到字节，白建。
          await ctx.rpc.call('doc:create', { id: docId, parentId, title: '' })
          ctx.emit(DOCS_CHANGED)
        },
        // 面包屑：从这篇往上数到顶层。库里的 parent_id 才是真相，正文里没有这个信息。
        trail: async (docId) => {
          const all = await ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false })
          const byId = new Map(all.map(meta => [meta.id, meta]))
          const out: { id: string; title: string }[] = []
          const seen = new Set<string>()
          let cursor = byId.get(docId)
          while (cursor && !seen.has(cursor.id)) {
            // 环（父子互指）不该有，但真发生了不能让面包屑无限长
            seen.add(cursor.id)
            out.unshift({ id: cursor.id, title: cursor.title })
            cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
          }
          return out
        },
        // 正文里那几行子页面对齐库里的树、全库登记进工作区（D-0091 / D-0094）。
        library: () => ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false }),
        // 点了正文里的评论高亮 → 评论面板。**软依赖**：插件不在就是个死高亮（D-0067）。
        openComment: (commentId) => ctx.get('comment')?.open(commentId),
        // 工具条上那两颗（D-0079）。都走软依赖：插件不在，按钮点了就是没反应 ——
        // 比「按钮根本不出现」差一点，但按钮归编辑器画，它不知道谁装了谁没装。
        commentSelection: (at) => ctx.get('comment')?.onSelection(at),
        askSelection: (text) => ctx.get('webai')?.askSelection(text),
        // 顶栏的「已保存」。写库完成才发，不猜。
        saved: (docId) => ctx.emit(DOC_SAVED, { id: docId }),
        // 正文里的标题就是这篇的**名字**，落了库就得让侧栏/标签条/顶栏跟着改（D-0073）。
        renamed: () => ctx.emit(DOCS_CHANGED),
      })

      mod = editor
      // 工具条那两颗按钮的文案：编辑器那层不认识 i18n，装载时把当前语言的写进去。
      editor.setSelectionLabels({
        comment: ctx.i18n.t('comment.bubble'),
        askAi: ctx.i18n.t('webai.bubble'),
      })
      // 装载前推过来的解决状态补上 —— 评论插件是先 await ready() 再推的，这条是兜底。
      editor.pushCommentStates(commentStates)
      return editor
    }))

  // 已经挂出去的编辑器。拔插件时要把它们从 DOM 上摘干净，
  // 否则界面上留一个失去服务的死 Lit 元素（CONVENTIONS §6.2 / §6.3）。
  const live = new Set<{ unmount(): void }>()

  /**
   * 库里的树 → 正文里的子页面那行 + 工作区里的登记（D-0091 / D-0094）。
   * 侧栏一动（新建 / 拖拽 / 重命名 / 导入）就核一次。
   *
   * ★ 库里的 `parent_id` 才是树的真相（侧栏照它画），正文里那几行是**另一份** ——
   *   从侧栏右键建的、拖进去的、导入进来的孩子，正文里一行的没有，看着就是
   *   「说好的子页面呢」（用户原话）。
   * ★ 一次 `doc:list` 干三件事（名字 / 登记 / 孩子）：两边要的本来就是同一张表。
   */
  const syncSubpageCards = (docId: string) => {
    if (mod === null) return
    void ctx.rpc.call<DocMeta[]>('doc:list', { includeTrashed: false }).then((all) => {
      if (mod === null) return
      mod.registerDocs(all)
      mod.applyTitle(docId, all.find((d) => d.id === docId)?.title ?? '')
      mod.syncSubpages(docId, all)
    })
  }

  /**
   * 契约的 `defineBlock` 是**同步**的，而模块是懒的。装载完之前先记账，装载完补登记；
   * 注销函数两种情形都得管用（还没登记就直接从账上划掉）。
   */
  const pending: { spec: unknown; view: unknown }[] = []
  const defineBlock = (spec: unknown, view: unknown) => {
    const entry = { spec, view }
    pending.push(entry)
    let undo: (() => void) | null = null
    void load().then((editor) => {
      const at = pending.indexOf(entry)
      if (at < 0) return // 装载前就被注销了
      pending.splice(at, 1)
      undo = editor.defineBlock(spec, view)
    })
    return () => {
      const at = pending.indexOf(entry)
      if (at >= 0) {
        pending.splice(at, 1)
        return
      }
      undo?.()
    }
  }

  // 反方向：别处改的名字（侧栏重命名 / 导入）要回到正文顶上那个大标题 ——
  // 两边必须是同一个名字，否则下一次落库会把旧名字盖回去。
  // 顺带把**子页面卡片**对齐库里的树（D-0091），两边看的是同一张 `doc:list`。
  ctx.effect(() => {
    const off = ctx.on(DOCS_CHANGED, () => {
      // 并排时**每一栏都要对齐**（D-0118）—— 只对齐「当前」那一篇的话，
      // 别的栏里那几行子页面卡片会一直挂着旧名字。
      for (const id of openDocIds()) syncSubpageCards(id)
    })
    return () => void off()
  })

  ctx.effect(() => [
    ctx.provide('editor', {
      /** 契约里那条 `ready()`：装载 + 接线都完成了才算数。 */
      ready: () => load().then(() => undefined),

      /**
       * ★ 签名是**同步**的（契约冻结：`mount(...) => () => void`），而真实路径是异步的
       * （先等装载、再接 `await ctx.docs.load`）。解法：立刻返回卸载函数，挂载在后台完成；
       * 失败**不吞** —— 打到控制台，由调用方在自己的 DOM 里决定怎么显示。
       * 契约没写「挂载可能失败」这件事，这是它的一个小缺口（已在报告里说）。
       */
      mount(el: HTMLElement, doc: { readonly id: string }) {
        let handle: { unmount(): void } | undefined
        let cancelled = false

        void load()
          .then((editor) => editor.mountEditor(el, doc.id))
          .then((mounted) => {
            if (cancelled) {
              mounted.unmount()
              return
            }
            handle = mounted
            live.add(mounted)
            // ★ 应用真正走的那条路是 `view.ts` 直接调 `mountEditor`（这个 `mount` 口子没人调），
            //   所以补卡片在 `mountEditor` 里做 —— 这句只是让契约这条路径也自洽。
            syncSubpageCards(doc.id)
          })
          .catch((err) => {
            console.error(`[editor-blocksuite] mount「${doc.id}」失败：`, err)
          })

        return () => {
          cancelled = true
          if (!handle) return
          live.delete(handle)
          handle.unmount()
          handle = undefined
        }
      },
      defineBlock,
      /** ★ 装载完才有东西（契约里写了要先 `await ready()`）。没装载就说清楚，
       *  别给个空数组让调用方以为「编辑器里一个块都没有」。 */
      blocks() {
        if (mod === null) throw new Error('编辑器还没装载：先 await ctx.editor.ready()')
        return mod.storeExtensionList()
      },
      /** 还没装载 = 一篇都没打开过 → null；打开过则给活文档的正文。 */
      text(id: string) {
        return mod?.liveText(id) ?? null
      },

      /**
       * 库里这篇的字节换过了（恢复历史版本，D-0043）→ 重读一遍。
       *
       * ★ 必须是「丢掉重读」而不是往活文档上 apply：Yjs 的删除是墓碑，灌历史字节
       *   不能让删掉的内容回来。
       * ★ 第一句是**同步**的 `muteDoc`（落库闸门）：调用方在 `version:restore` 返回后的
       *   同一个任务里 await 它，而旧的落库定时器排在后面 —— 掐得掉。
       * ★ 没装载过就没有活文档，什么也不用做：下次打开自然是新字节。
       */
      async reload(id: string) {
        if (loading === undefined) return
        const editor = await loading
        editor.muteDoc(id)
        // 不是当前这篇就没人重挂，闸门得自己放开（否则这一篇从此不再落库）。
        if (!reloadDoc(id)) editor.unmuteDoc(id)
      },

      /**
       * 攒着的改动立刻落库 —— 内置助手的写工具在读库之前必须调它（D-0087 的一个缺口）。
       *
       * ★ 编辑器每 300ms 才落一次，而写工具是拿**库里的字节**重做一篇、末尾还把活文档丢掉；
       *   不先落库，用户最后敲的那几下就随着旧字节一起没了。
       * ★ 没装载过（`loading === undefined`）就没有活文档，`flushDoc` 自己也会挡掉
       *   "这篇没开着"的情况 —— 所以这里不判断，直接转。
       */
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
      setCommentStates(list: readonly CommentState[]) {
        commentStates = [...list]
        mod?.pushCommentStates(commentStates)
      },

      /** 内存监控（D-0079）。软依赖的另一端：`mem-monitor` 插件 `ctx.get('mem')` 拿它。
       *  没装载过编辑器就是空表 —— 那是实话（这会儿确实没有文档在内存里）。 */
      stats: () => mod?.memoryStats() ?? [],
    }),

    // 把编辑器放进 `main.view`，并订阅 `OPEN_DOC`（点哪篇文档就挂哪篇）。
    // 这一步是**轻的** —— 只是注册槽位 + 订阅事件，重活留到真去挂的那一刻。
    registerEditorView(ctx),

    // 拔插件：先把攒着的改动落完，再摘编辑器。
    // 顺序不能反 —— 摘了之后 `spaceDoc` 就没地方读了。没装载过就没有要落的。
    () => {
      // 用 loading 而不是 mod：正好在装载途中拔插件时，也等它落地再落库
      if (loading) void loading.then((editor) => editor.flushAll())
      for (const handle of live) handle.unmount()
      live.clear()
    },
  ])

  // 光标形状 + 颜色（D-0076 / D-0103）。**只在这儿写** `<html data-caret>` 和
  // `--sn-caret-color`，不做第二份注入。
  ctx.effect(() => {
    const apply = () => {
      applyCaretShape(caretShapeOf(ctx.settings.get(CARET_KEY)))
      applyCaretColor(caretColorOf(ctx.settings.get(CARET_COLOR_KEY)))
    }
    apply()
    const offs = [
      ctx.settings.onChange(CARET_KEY, apply),
      ctx.settings.onChange(CARET_COLOR_KEY, apply),
    ]
    return () => {
      for (const off of offs) off()
      clearCaretShape()
      clearCaretColor()
    }
  })

  // 「光标」设置页。这一段是**轻的** —— 它不 import 编辑器本体，所以不会把 4 MB 拖进启动路径。
  ctx.effect(() => {
    const section = () => createElement(CaretSection, { ctx })
    ;(section as { label?: string }).label = ctx.i18n.t('caret.title')
    ;(section as { group?: string }).group = 'look'
    return ctx.slot.register('settings.section', section)
  })

  // 查找替换（⌘F）。面板自己不碰块包 —— 这几条接口都在 `load()` 之后才接线，
  // 所以这一块不会把 4 MB 的编辑器拖进启动路径。
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const api: FindApi = {
      search: async (query) => (await load()).findMatches(query),
      focus: async (match) => {
        const editor = await load()
        editor.focusFindMatch(match)
      },
      replace: async (match, text) => {
        const editor = await load()
        editor.replaceFindMatch(match, text)
      },
      replaceAll: async (query, text) => (await load()).replaceAllFindMatches(query, text),
    }
    root.render(createElement(FindPanel, { ctx, api }))
    return () => {
      root.unmount()
      host.remove()
    }
  })

  // 关窗口前把攒着的改动落完 —— 300ms 的窗口期里点红点会丢那一截。
  // 放在这个插件里是对的：没装载过编辑器 = 没有脏数据，懒装载也不会因此破。
  // `win.destroy()` 需要 `core:window:allow-destroy`（见 tauri 的 capabilities）。
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
            reportError('editor-blocksuite', err)
          }
          await win.destroy()
        })
        if (dead) off()
        else unlisten = off
      })
      .catch((err: unknown) => reportError('editor-blocksuite', err))
    return () => {
      dead = true
      unlisten?.()
    }
  })
}
