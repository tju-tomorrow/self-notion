/**
 * 编辑器本体：装配 BlockSuite，挂到一个 DOM 元素上。
 *
 * 0.22.4 的装配面是「provider 类 + 两个 manager」：
 *   StoreExtensionManager → store 侧（块 schema、adapter、DI）
 *   ViewExtensionManager  → view 侧（块视图、快捷键、自定义元素）
 * 两边都用 `.get('store' | 'page')` 拿到最后那一坨 extension 数组，再喂给
 * `Doc.getStore({ extensions })` / `new BlockStdScope({ extensions })`。
 *
 * ★ 这里**没有**手搓任何服务：EditorSetting / DocMode / Theme / 剪贴板 / 选区…
 *   0.22.4 全都有默认实现（DI 自带，或 `getOptional` 降级）。缺了才补。
 *
 * ponytail: 只搬了 M1 要用的 provider，没搬整个 BlockSuite 家族 —— 每多一个 provider
 * 就多进几百 KB 的 bundle（D-0041 要的正是这个数）。加块 = 往下面两个数组里加一行。
 */
import {
  StoreExtensionManager,
  StoreExtensionProvider,
  ViewExtensionManager,
  ViewExtensionProvider,
  type ViewExtensionContext,
} from '@blocksuite/affine/ext-loader'
import { FoundationStoreExtension } from '@blocksuite/affine/foundation/store'
import { FoundationViewExtension } from '@blocksuite/affine/foundation/view'
import { CodeStoreExtension } from '@blocksuite/affine/blocks/code/store'
import { CodeBlockViewExtension } from '@blocksuite/affine/blocks/code/view'
import { DividerStoreExtension } from '@blocksuite/affine/blocks/divider/store'
import { DividerViewExtension } from '@blocksuite/affine/blocks/divider/view'
import { ImageStoreExtension } from '@blocksuite/affine/blocks/image/store'
import { ImageViewExtension } from '@blocksuite/affine/blocks/image/view'
// ★ 子页面 = 上游现成的 `affine:embed-linked-doc`。store 侧给 schema、view 侧给卡片，
//   缺一个的表现都是「斜杠菜单里有、点了没反应」。
import { EmbedDocStoreExtension } from '@blocksuite/affine/blocks/embed-doc/store'
import { EmbedDocViewExtension } from '@blocksuite/affine/blocks/embed-doc/view'
import { LinkedDocSlashMenuConfigIdentifier } from '@blocksuite/affine/blocks/embed-doc'
// `[[` / `@` 的选页面弹层（含「新建文档」那条）。没有它，「链接页面」菜单项不出现。
import { LinkedDocViewExtension } from '@blocksuite/affine/widgets/linked-doc/view'
import { insertContent } from '@blocksuite/affine/rich-text'
import { REFERENCE_NODE } from '@blocksuite/affine/shared/consts'
import type { SlashMenuConfig } from '@blocksuite/affine/widgets/slash-menu'
// 选中一段字浮出来的那条工具条（B / I / U 那条）的注册口子（D-0079）。
import {
  ActionPlacement,
  type ToolbarActionGenerator,
  ToolbarModuleExtension,
} from '@blocksuite/affine/shared/services'
import { BlockFlavourIdentifier } from '@blocksuite/affine/std'
import { ChatWithAiIcon, CommentIcon, LinkedPageIcon, NewPageIcon } from '@blocksuite/icons/lit'
// 点正文里的页面链接时上游只往这个 Subject 发一声 —— 导航是应用的事（AFFiNE 前端就在这儿接）。
import { RefNodeSlotsProvider } from '@blocksuite/affine/inlines/reference'
import { ListStoreExtension } from '@blocksuite/affine/blocks/list/store'
import { ListViewExtension } from '@blocksuite/affine/blocks/list/view'
import { NoteStoreExtension } from '@blocksuite/affine/blocks/note/store'
import { NoteViewExtension } from '@blocksuite/affine/blocks/note/view'
import { ParagraphStoreExtension } from '@blocksuite/affine/blocks/paragraph/store'
import { ParagraphViewExtension } from '@blocksuite/affine/blocks/paragraph/view'
import { RootStoreExtension } from '@blocksuite/affine/blocks/root/store'
import { RootViewExtension } from '@blocksuite/affine/blocks/root/view'
import { InlinePresetStoreExtension } from '@blocksuite/affine/inlines/preset/store'
import { InlinePresetViewExtension } from '@blocksuite/affine/inlines/preset/view'
import { LinkStoreExtension } from '@blocksuite/affine/inlines/link/store'
import { LinkViewExtension } from '@blocksuite/affine/inlines/link/view'
import { LatexStoreExtension } from '@blocksuite/affine/inlines/latex/store'
import { LatexViewExtension } from '@blocksuite/affine/inlines/latex/view'
// 公式有**两个** latex 包：`inlines/latex` 是行内 `$x$`，`blocks/latex` 是独立一行的公式块。
// 两个包的导出类名一模一样，所以下面这份改名 —— 用的是**块**那一份。
import { LatexStoreExtension as LatexBlockStoreExtension } from '@blocksuite/affine/blocks/latex/store'
import { LatexViewExtension as LatexBlockViewExtension } from '@blocksuite/affine/blocks/latex/view'
// 表格：Notion 的简单表格导进来就是它（上游自带 schema / adapter / selection）。
import { TableStoreExtension } from '@blocksuite/affine/blocks/table/store'
import { TableViewExtension } from '@blocksuite/affine/blocks/table/view'
import { ReferenceStoreExtension } from '@blocksuite/affine/inlines/reference/store'
import { ReferenceViewExtension } from '@blocksuite/affine/inlines/reference/view'
import { FootnoteStoreExtension } from '@blocksuite/affine/inlines/footnote/store'
import { FootnoteViewExtension } from '@blocksuite/affine/inlines/footnote/view'
import { MentionViewExtension } from '@blocksuite/affine/inlines/mention/view'
import { DragHandleViewExtension } from '@blocksuite/affine/widgets/drag-handle/view'
import { PageDraggingAreaViewExtension } from '@blocksuite/affine/widgets/page-dragging-area/view'
import { SlashMenuViewExtension } from '@blocksuite/affine/widgets/slash-menu/view'
import { ToolbarViewExtension } from '@blocksuite/affine/widgets/toolbar/view'
import { ViewportOverlayViewExtension } from '@blocksuite/affine/widgets/viewport-overlay/view'
import { DocTitleViewExtension } from '@blocksuite/affine/fragments/doc-title/view'
import { OutlineViewExtension } from '@blocksuite/affine/fragments/outline/view'
// 自己造的三个块（上游没有）：目录 / 面包屑 / 分栏。看 `blocks/` 目录。
import {
  BreadcrumbStoreExtension,
  BreadcrumbViewExtension,
} from './blocks/breadcrumb'
import {
  ColumnListViewExtension,
  ColumnStoreExtension,
  ColumnViewExtension,
} from './blocks/columns'
import { TOCStoreExtension, TOCViewExtension } from './blocks/toc'
import { NoteDisplayMode } from '@blocksuite/affine/model'
import { BlockStdScope, TextSelection, type BlockComponent } from '@blocksuite/affine/std'
import { createIdentifier } from '@blocksuite/affine/global/di'
import { Text, type BlockModel, type ExtensionType, type Store } from '@blocksuite/affine/store'
import { focusBlockStart } from '@blocksuite/affine/shared/commands'
// 格式命令要过的那道闸：块里那个 inline editor 的宿主属性（诊断用，见 `selectionFacts`）。
import { INLINE_ROOT_ATTR } from '@blocksuite/affine/std/inline'
import { TestWorkspace } from '@blocksuite/affine/store/test'

import type {
  CommentState,
  CommentTarget,
  DocLink,
  DocMem,
  DocMeta,
  DocSummary,
  DocsService,
  RpcService,
} from '../../src/kernel/contract'
// 内存监控量 Y.Doc 的大小用（`encodeStateAsUpdate`）—— 只读，不改任何文档。
import * as Y from 'yjs'
import { reportError, reportNote } from '../../src/kernel/errors'
import { docsBacking, type DocsBacking, type Projection } from './doc-source'
import {
  CommentViewExtension,
  addInlineAnchor,
  readBlockSelection,
  readTextSelection,
  removeAnchor,
  revealComment,
  setCommentStates,
} from './inline-comment'
import { shouldTransact, withoutHistory } from './history'
import { NotionShortcutsProvider } from './notion-shortcuts'
import { SnPasteProvider } from './paste'
import { watchControlChars } from './sanitize'
import { SlashMenuZhProvider } from './slash-menu-cn'
import { SlashMenuTrimProvider } from './slash-menu-trim'
import { mountCaret } from './caret'
import { mountBlockDrag } from './block-drag'
import { selectAnywhere } from './select-anywhere'
// 编辑器要往外说的话在 `shell.ts`（块组件也要读它，放这儿会转成循环 import）。
import { shell } from './shell'

export { connectShell, type ShellHooks } from './shell'

type StoreProvider = typeof StoreExtensionProvider
type ViewProvider = typeof ViewExtensionProvider

/**
 * 斜杠菜单里那两条页面命令上游写的是英文（`New Doc` / `Linked Doc`）—— 中文界面里串味，
 * 更要命的是**搜不到**：菜单只拿 `name` + `searchAlias` 做模糊匹配（`slash-menu-popover.ts`），
 * 打 `/page` 跟 `New Doc` 一个字都对不上，看着就像「没有子页面这个功能」。
 * 所以整条换成本地的两条，关键词中英文都铺上。
 */
/** 子页面在正文里就长成**一行**：左边一张文档小图标、右边下划线标题（Notion 那样）。
 *  也就是上游那条行内 `@链接`（`REFERENCE_NODE` + `reference: LinkedPage`）—— 不是那张大卡片。 */
const SUBPAGE_REFERENCE = { type: 'LinkedPage' } as const

const pageSlashMenu: SlashMenuConfig = {
  items: [
    {
      name: '子页面',
      description: '在当前文档下新建一篇子页面。',
      searchAlias: ['page', 'subpage', 'new page', 'ziyemian', 'zhiyemian', 'ye mian'],
      icon: NewPageIcon(),
      group: '3_Page@0',
      when: ({ model }) => model.store.schema.flavourSchemaMap.has('affine:embed-linked-doc'),
      action: ({ std, model }) => {
        // ★ 不用上游的 `createDefaultDoc`。它会往新文档里塞一个 `affine:surface`，
        //   而我们的 schema 里**没有 surface**（没装 edgeless 那套）→ 半路抛错，
        //   后面那句「把链接插进正文」根本跑不到，用户拿到一个空壳子页面。
        //   自己种一棵我们支持的树（就是 `seed()` 那棵）。
        //   `createDoc()` **不带 id** → 走 `openVault` 里那层 override：落库 + 挂到当前文档下面。
        const workspace = std.host.store.workspace
        const doc = workspace.createDoc()
        doc.load()
        seed(doc.getStore({ id: doc.id }))
        // 正文里留下的就是 Notion 那一行（D-0091）。
        insertContent(std, model, REFERENCE_NODE, {
          reference: { ...SUBPAGE_REFERENCE, pageId: doc.id },
        })
      },
    },
    {
      name: '链接页面',
      description: '链接到已有的一篇文档。',
      searchAlias: ['link', 'link page', 'dual link', 'lianjie', 'lian jie', 'ye mian'],
      icon: LinkedPageIcon(),
      group: '3_Page@1',
      when: ({ std, model }) => {
        const root = model.store.root
        if (!root) return false
        if (!std.view.getWidget('affine-linked-doc-widget', root.id)) return false
        return model.store.schema.flavourSchemaMap.has('affine:embed-linked-doc')
      },
      action: ({ std, model }) => {
        const root = model.store.root
        if (!root) return
        // 上游自己也是这么调的（那句 `// TODO: make linked-doc-widget as extension`），
        // 它没给类型，我们只好自己写一个。
        const widget = std.view.getWidget('affine-linked-doc-widget', root.id) as unknown as
          | { show(options: { addTriggerKey: boolean }): void }
          | undefined
        widget?.show({ addTriggerKey: true })
      },
    },
  ],
}

/** 只干一件事：把上面那条配置盖到上游那条头上（identifier 的键就是块名，两边同一个键）。 */
class PageSlashMenuProvider extends ViewExtensionProvider {
  override name = 'self-notion-page-slash-menu'

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register({
      setup: (di) => {
        di.override(LinkedDocSlashMenuConfigIdentifier, () => pageSlashMenu)
      },
    })
  }
}

/**
 * store 侧：块 schema（没有 schema，`addBlock` 直接抛 "schema not found"）。
 * `foundation` 不是可选的 —— 它带来 selection / adapter / FeatureFlag 这一撮基础服务。
 */
const storeProviders: StoreProvider[] = [
  FoundationStoreExtension,
  RootStoreExtension,
  NoteStoreExtension,
  ParagraphStoreExtension,
  ListStoreExtension,
  CodeStoreExtension,
  DividerStoreExtension,
  EmbedDocStoreExtension,
  // 图片：Notion 导入进来的图存进 blob 表，文档里只留一个 `sourceId`，
  // 渲染时由下面 `blobSources` 那个取法把它取回来。
  ImageStoreExtension,
  // 表格与公式块：两个 provider 都自洽（schema / adapter / selection 自己在 setup 里注册齐）。
  TableStoreExtension,
  LatexBlockStoreExtension,
  // 自己造的三个块
  TOCStoreExtension,
  BreadcrumbStoreExtension,
  ColumnStoreExtension,
  // 行内的 store 侧：markdown adapter（`**x**`、`$x$` 这些粘贴/导出要用的匹配器）。
  // 少了它只丢 adapter，不炸；和下面 view 侧那几行配套。
  //
  // ★ preset 这份**不能少**：Notion 导出的正文全是裸文本节点，而 notion-html 的
  //   文本 matcher（`notionHtmlTextToDeltaMatcher`）就注册在它里面（`InlineAdapterExtensions`）。
  //   少了它，导入出来的每一页都是「结构对、字全空」——块建出来了，文本一个不留（D-0092）。
  InlinePresetStoreExtension,
  LinkStoreExtension,
  LatexStoreExtension,
  ReferenceStoreExtension,
  FootnoteStoreExtension,
]

/* ── 白板遗留 slot 的最小替身 ─────────────────────────────────────────────
 * 工具条（`affine-widget-toolbar`）一挂载就 `std.get(EdgelessLegacySlotIdentifier)` ——
 * **硬取，不是 getOptional** —— 拿不到就抛
 * `Service [AffineEdgelessLegacySlotService] not found in container`，组件当场挂不上，
 * 界面上就是「选中块没有那条工具条 / hover 没反应」（D-0070）。
 *
 * 白板我们整块没装，但这个服务本身**只是一组 rxjs Subject**（白板拿它们广播拖拽 / 缩放的动静），
 * 一丁点白板逻辑都没有。补一个同名的最小替身，工具条就能在 page-only 的容器里立起来。
 *
 * ★ 不 import 上游那份：它的出口在 `@blocksuite/affine-block-surface` 的**包入口**上，
 *   走那条会把整个白板拖进包里 —— 为一个 stub 不值。identifier 是**按名字**寻址的
 *  （`createIdentifier(name)` → `{ identifierName }`），同名就能被取到。
 * ★ 也不 import rxjs：它不是本包的依赖，而这个替身只需要 `subscribe`。
 */
interface LegacySlot<T> {
  subscribe(listener: (value: T) => void): { unsubscribe(): void }
  next(value: T): void
}

interface EdgelessLegacySlots {
  readonlyUpdated: LegacySlot<boolean>
  navigatorSettingUpdated: LegacySlot<{
    hideToolbar?: boolean
    blackBackground?: boolean
    fillScreen?: boolean
  }>
  navigatorFrameChanged: LegacySlot<unknown>
  fullScreenToggled: LegacySlot<unknown>
  elementResizeStart: LegacySlot<unknown>
  elementResizeEnd: LegacySlot<unknown>
  toggleNoteSlicer: LegacySlot<unknown>
  toolbarLocked: LegacySlot<boolean>
}

/** 只够用的一小撮：`subscribe` / `next`。白板那套事件一个都不会真的发出来。 */
function slot<T>(): LegacySlot<T> {
  const listeners = new Set<(value: T) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return { unsubscribe: () => void listeners.delete(listener) }
    },
    next(value) {
      for (const listener of listeners) listener(value)
    },
  }
}

const EDGELESS_LEGACY_SLOTS: ExtensionType = {
  setup: di => {
    di.addImpl(createIdentifier<EdgelessLegacySlots>('AffineEdgelessLegacySlotService'), () => ({
      readonlyUpdated: slot(),
      navigatorSettingUpdated: slot(),
      navigatorFrameChanged: slot(),
      fullScreenToggled: slot(),
      elementResizeStart: slot(),
      elementResizeEnd: slot(),
      toggleNoteSlicer: slot(),
      toolbarLocked: slot(),
    }))
  },
}

/** 把上面那个替身挂进 DI。`name` 是 `ViewExtensionProvider` 要的，取什么都行。 */
class EdgelessLegacySlotsProvider extends ViewExtensionProvider {
  override name = 'sn-edgeless-legacy-slots'

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register(EDGELESS_LEGACY_SLOTS)
  }
}

/* ── 选中的那条工具条上，我们自己的两颗（D-0079） ───────────────────────────
 * 挂的名字是 `custom:affine:*` —— `renderToolbar` 会把它**并进每一条工具栏**
 * （`affine-widget-toolbar/src/utils.ts` 里那份合并名单），所以不管选中的是段落、
 * 标题还是列表，这两颗都在。`ActionPlacement.Start`（0）排在 B / I / U 那一片
 * （Normal）前面，正合「评论 │ 问 AI │ B </> I …」这个次序。
 *
 * ★ 用 `generate` 不用静态 action：文案是**运行期**的（i18n 由 `index.ts` 装载时写进来），
 *   而且没有文字选区时整颗要消失 —— 静态 action 两样都做不到。这一条也正是
 *   「选中浮层」那种做法（原来的两颗 `position: fixed` 药丸）被替掉的原因：它们各自
 *   按选区算位置，一个在上一个在下，凑不到一条线上（用户：「这个排版太奇怪」）。
 */
let selectionLabels = { comment: '评论', askAi: '问 AI' }

/** 两颗按钮的文案。由 `index.ts` 装载时按当前语言写进来（同 `view.ts` 那两个文案）。 */
export function setSelectionLabels(next: { comment: string; askAi: string }): void {
  selectionLabels = next
}

/** 整段选中的文字。★ 别拿 `at.quote` 去喂 AI —— 那个只覆盖**一个块**
 *  （`readTextSelection` 是给评论锚点量的，锚点本来就跨不了块），跨块选一段会被截掉后半截。
 *  DOM 那边是完整的，ai-web 原来那颗浮出按钮就是这么取的。 */
function fullSelectionText(): string {
  return (window.getSelection()?.toString() ?? '').trim()
}

/** 有文字选区才出；点了把这段字交给插件层（`shell` 那两个钩子）。
 *
 * ★ `when` 和 `generate` **两条都要**：`combine`（上游 `widget-toolbar/utils.ts:154`）里
 *   `generate` 返回 null 时是把 null 摊进那个对象 —— `{...null}` 什么也不加，于是**底子那条
 *   action 会留在清单里**：没有图标、没有文字、没有 run。那种按钮点了当然没反应，
 *   而且它占着位置。`when` 是过筛子那一步（`filtered`），它才真的把这条拿掉。 */
function selectionActions(): ToolbarActionGenerator[] {
  const make = (
    id: string,
    label: () => string,
    icon: typeof CommentIcon,
    run: (at: NonNullable<ReturnType<typeof readTextSelection>>) => void,
  ): ToolbarActionGenerator => ({
    id,
    placement: ActionPlacement.Start,
    when: (cx) => readTextSelection(cx.std) !== null,
    generate: (cx) => {
      const at = readTextSelection(cx.std)
      if (!at) return null
      return {
        placement: ActionPlacement.Start,
        label: label(),
        showLabel: true,
        icon: icon({ width: '20', height: '20' }),
        run: () => run(at),
      }
    },
  })

  return [
    make('sn.comment', () => selectionLabels.comment, CommentIcon, (at) =>
      shell?.commentSelection?.(at),
    ),
    make('sn.ai', () => selectionLabels.askAi, ChatWithAiIcon, () =>
      shell?.askSelection?.(fullSelectionText()),
    ),
  ]
}

const SELECTION_TOOLBAR: ExtensionType = ToolbarModuleExtension({
  id: BlockFlavourIdentifier('custom:affine:*'),
  config: { actions: selectionActions() },
})

class SelectionToolbarProvider extends ViewExtensionProvider {
  override name = 'sn-selection-toolbar'

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register(SELECTION_TOOLBAR)
  }
}

/**
 * view 侧。`note` 是必须的：page 模式下 root block 找不到 note 就自己补一个，
 * 没有 note 的 view extension 会渲染失败。
 */
const viewProviders: ViewProvider[] = [
  FoundationViewExtension,
  RootViewExtension,
  // ★ 必须排在 `RootViewExtension` **后面** —— `RootViewExtension` 里注册了上游那条
  //   `PageClipboard`（它的 onPagePaste 就是「挨个 adapter 试」），而 paste handler 是
  //   后注册的先跑。我们这条 watcher 挂得晚，才有得抢（见 `paste.ts` 顶部）。
  SnPasteProvider,
  NoteViewExtension,
  // ★ 必须在 `ParagraphViewExtension` **前面**：抢的就是上游那个 `>`，
  //   而 markdown matcher 是先注册先赢（见 `notion-shortcuts.ts` 顶部）。
  NotionShortcutsProvider,
  ParagraphViewExtension,
  ListViewExtension,
  CodeBlockViewExtension,
  DividerViewExtension,
  // 子页面：卡片块 + 选页面弹层。这两行是「Notion 的子页面」的全部依赖。
  EmbedDocViewExtension,
  LinkedDocViewExtension,
  // ★ 必须排在上面两个**后面** —— 它 `di.override` 上游那条斜杠菜单配置，后注册的才盖得住。
  PageSlashMenuProvider,
  // 基本项那 13 条的中文 / 拼音搜索别名（D-0089）。名字保持英文，只是能被中文搜到。
  SlashMenuZhProvider,
  ImageViewExtension,
  TableViewExtension,
  LatexBlockViewExtension,
  // 自己造的三个块（目录 / 面包屑 / 分栏）
  TOCViewExtension,
  BreadcrumbViewExtension,
  ColumnListViewExtension,
  ColumnViewExtension,
  // ★ 富文本。`InlinePresetViewExtension` 里的 DefaultInlineManager **硬点名**了一批
  //   行内 spec（粗斜体/代码/高亮/颜色 + latex/reference/link/footnote/mention），
  //   少一个就在建 DefaultInlineManager 时抛
  //   `Missing dependency [AffineInlineSpec](latex)` —— 它是**建服务时**炸，
  //   不是渲染时炸；并且被 catch 成 console error，界面看着还活着，所以容易漏。
  //   → 点名的那些 view extension 必须一个不少地在这儿出现（下面是全套）。
  //   mention 没有 store 侧（0.22.4 只有 view），不用管。
  InlinePresetViewExtension,
  LinkViewExtension,
  LatexViewExtension,
  ReferenceViewExtension,
  FootnoteViewExtension,
  MentionViewExtension,
  // 行内评论：`comment` 属性 → `<inline-comment>` 底色（D-0067）。DefaultInlineManager 没点名它，
  // 加进来只是多一条 spec，不影响上面那份「一个不少」的清单。
  CommentViewExtension,
  // 斜杠菜单 + 拖拽手柄；后两个是它们的前置（视口遮罩、页面拖拽区）
  SlashMenuViewExtension,
  // ★ 必须排在上一行**后面** —— 它盖的是 `SlashMenuExtension` 这个**服务**，
  //   而上游那行 `di.add` 先跑，反过来的话 override 会被后面那次 add 撞个正着。
  SlashMenuTrimProvider,
  DragHandleViewExtension,
  // ★ 选中块时浮出的那条工具栏（D-0070）。图片那块在 `affine-block-image` 里注册了自己的
  //   模块（下载 / 加标题 / 复制 / 创建副本 / 删除），所以接上这个 widget 图片就有工具栏了。
  //   ★ 它一挂载就**硬取**「白板遗留 slot」服务（`get`，不是 `getOptional`），缺了就抛
  //   `Service [AffineEdgelessLegacySlotService] not found`、工具条整套挂不上 ——
  //   曾经因此被判定为「装不了」（要它就得连白板一起装，和 D-0004 冲突）而删掉这行。
  //   但那个服务只是一个 stub 就够，见下面的 `EDGELESS_LEGACY_SLOTS`：不装白板也能要工具条。
  ToolbarViewExtension,
  // ★ 上面那条工具条要的服务（白板遗留 slot，一组 rxjs 小管道，没有白板逻辑）。
  EdgelessLegacySlotsProvider,
  // ★ 往那条工具条上再挂两颗：评论 / 问 AI（D-0079）。
  SelectionToolbarProvider,
  ViewportOverlayViewExtension,
  PageDraggingAreaViewExtension,
  // ★ 页面标题。它**只注册 `<doc-title>` 这个元素**，不往 page-root 里塞东西 ——
  //   真正渲染标题的是消费方（AFFiNE 前端自己挂，见 `mountEditor`）。
  //   少了它，一篇文档打开后没有标题栏，看着就不像一个页面。
  DocTitleViewExtension,
  // ★ 右侧目录刻度条（D-0070）。同上：它只注册 `<affine-outline-viewer>` 这个元素，
  //   真正挂它的是 `mountEditor`。
  OutlineViewExtension,
]

/** 段落占位符。BlockSuite 默认是英文的 `Type '/' for commands`，界面上是中文就串味了。
 *  ★ 空标题不给占位文字（用户：不要「一级标题」这些）—— 级别在左边那颗 H 上看得见，
 *    正文里再喊一声只是噪音。`quote` 空着是原本就这样。 */
const PLACEHOLDER: Readonly<Record<string, string>> = {
  text: '输入 "/" 唤起命令',
  toggle: '折叠列表',
  h1: '',
  h2: '',
  h3: '',
  h4: '',
  h5: '',
  h6: '',
  quote: '',
}

/** 折叠块**里面**那句话。Notion 中文版就是这个说法。 */
const TOGGLE_HINT = '空白折叠块。点击或拖动块到这里。'

/**
 * 占位文字。BlockSuite 只把 model 给过来，所以「在里面还是在外面」得自己看父块 ——
 * 空折叠块的内层段落和正文里的普通空段落，`props.type` 都是 `text`，只看自己分不出来。
 */
function placeholderOf(model: BlockModel): string {
  const type = (model.props as { type?: string }).type ?? ''
  const parent = model.parent
  if (
    type === 'text' &&
    parent !== null &&
    parent !== undefined &&
    parent.flavour === 'affine:list' &&
    (parent.props as { type?: string }).type === 'toggle'
  ) {
    return TOGGLE_HINT
  }
  return PLACEHOLDER[type] ?? ''
}

/**
 * 图片字节在**库里**（blob 表，D-0027），不在 Y.Doc 里。
 *
 * 图片块拿 `sourceId` 问 `blobSync.get(...)` 要字节 —— 默认那个是内存实现，什么也取不到
 * （图全裂），所以换成走 `self-notion://blob/<id>` 的取法：字节由 webview 自己拉，
 * 不过 IPC，也就是 D-0027 那条「字节不来回搬」。`set` 是贴图那条路：写进 blob 表，
 * **返回内容 sha** —— 和 Rust 侧的 id 同一个算法，同一个 id。
 */
interface BlobSourceLike {
  name: string
  readonly: boolean
  get(key: string): Promise<Blob | null>
  set(key: string, value: Blob): Promise<string>
  delete(key: string): Promise<void>
  list(): Promise<string[]>
}

let blobs: BlobSourceLike | undefined

// `String.fromCharCode(...bytes)` 一个字节一个参数，整块喂进去会爆栈（同 plugin-storage）
const CHUNK = 0x8000 // 32768

/** BlockSuite 的 base64url 内容 sha → Rust 那边的 hex id。**同一个摘要两种写法**。
 *
 *  ★ 它的 `sha()`（`@blocksuite/global`）只把 `+`/`/` 换成 `-`/`_`，**末尾那个 `=` 留着** ——
 *   所以真实长度是 **44**（43 个字符 + 一个 padding）。之前这里只认 43，于是 44 的 key 原样
 *   丢给 Rust，查不到 → 404 → 界面上就是「Failed to retrieve Image」。两种都认：包里那个 `=`
 *   的去留不是这儿能决定的。
 *
 *  认不出来的（万一上游把 key 换成 nanoid 之类）就原样返回，让它照旧去查 —— 查不到是裂图，
 *  不是崩，比在这儿抛出去强。 */
function hexId(key: string): string {
  if (!/^[A-Za-z0-9_-]{43}=?$/.test(key)) return key
  try {
    // `atob` 要求长度是 4 的倍数：43 个字符补一个 `=`，本来带 `=` 的不能再补（补了是 `==`）。
    const b64 = key.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64.endsWith('=') ? b64 : b64 + '=')
    let out = ''
    for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0')
    return out
  } catch {
    return key
  }
}

/** 最近几次入库：BlockSuite 的 key → Rust 给的 id。取图失败时一并写进日志，
 *  一眼就能看出两边是不是同一份。只当诊断用，不参与任何逻辑。 */
const recent = new Map<string, string>()

function lastPuts(): string {
  if (recent.size === 0) return '（本次会话还没入库过）'
  return `；最近入库 ${[...recent].map(([k, v]) => `${k} → ${v}`).join(' | ')}`
}

function toBase64(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    raw += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(raw)
}

/** 接上 `ctx.rpc`。没接上只是图片取不到字节，编辑器照旧能用。 */
export function connectBlobs(rpc: RpcService): void {
  blobs = {
    name: 'self-notion-blob',
    readonly: false,
    async get(key) {
      // ★ key 要翻一道再查库。BlockSuite 的 BlobManager 自己算 key = sha256 的 base64url
      //   （`@blocksuite/global` 的 `sha()` —— 那个 `=` 它没去掉），而 Rust 那边 id = 同一个
      //   摘要的 hex。两种写法，不翻的话写进去了也取不回来，界面上就是「Failed to retrieve Image」。
      const id = hexId(key)
      try {
        const res = await fetch(`self-notion://blob/${id}`)
        if (res.ok) return await res.blob()
        // 裂图不能是静默的：把「拿什么 key 去查的」写进 errors.log，一眼就能和入库时那个对上。
        reportError('blob', new Error(`取图 ${res.status}：key=${key} → id=${id}${lastPuts()}`))
        return null
      } catch (err) {
        // 走到这儿 = 请求根本没到 Rust（CSP / scheme / 协议没注册）。
        reportError('blob', new Error(`取图请求失败：id=${id}（${String(err)}）${lastPuts()}`))
        return null
      }
    },
    async set(key, value) {
      const bytes = new Uint8Array(await value.arrayBuffer())
      const meta = await rpc.call<{ id: string }>('blob:put', {
        bytes: toBase64(bytes),
        mime: value.type || 'application/octet-stream',
      })
      recent.set(key, meta.id)
      if (recent.size > 3) recent.delete(recent.keys().next().value as string)
      return meta.id
    },
    // 库里没有「列全部 / 删一个」这条路（图片按内容寻址，删了别处还会用）——
    // 空实现，不假装。
    async delete() {},
    async list() {
      return []
    },
  }
}

/** 视图扩展的 provider 管理器。**只建一次** —— `configure` 要赶在 `get()` 之前，
 *  每次挂载新建一个就来不及把选项传下去。`defineBlock` 加了新 provider 会把它作废。 */
let viewManager: ViewExtensionManager | undefined

function pageExtensions() {
  viewManager ??= (() => {
    const manager = new ViewExtensionManager(viewProviders)
    manager.configure(ParagraphViewExtension, {
      getPlaceholder: (model: BlockModel) => placeholderOf(model),
    })
    return manager
  })()
  return viewManager.get('page')
}

// ponytail: 一个窗口一个 Workspace，doc 是它的 subdoc —— 和 AFFiNE 同构，也是
// 「Y.Doc 全保活」（CONVENTIONS §4）最省事的落法。视图只保活最近 3 个是卷帘条的事。
let vault: TestWorkspace | undefined
let backing: DocsBacking | undefined
/** `connectDocs` 顺手接的 `ctx.rpc` —— 只给打开时那一次投影自查用。 */
let wire: RpcService | undefined

/** 现在挂着的是哪一篇 —— 在它正文里新建的子页面，就是它的孩子。 */
let openDocId: string | null = null

/** 现在挂着的那个编辑器作用域。评论那几个**同步**口子（读选区 / 打标记）要它。 */
let activeStd: BlockStdScope | undefined

/** 判据那边（`diagnose.ts`）要读的活状态 —— 只读，别拿它去改东西。 */
export const liveStd = (): BlockStdScope | undefined => activeStd
export const liveDocId = (): string | null => openDocId

/** 打开过的 Store，用来在落库时读正文做投影（`doc_text` 的 payload）。键是 docId。 */
const stores = new Map<string, Store>()

/** 切走时记住滚动位置 —— 每次打开都是新造的 DOM，不然长文再进来总是回到开头。 */
const scrollPositions = new Map<string, number>()

/**
 * 接上 `ctx.docs`。`apply()` 里第一句就调它 —— 之后的打开 / 落库都走这条路。
 * 没接上就挂编辑器是**编程错误**，`openVault` 会当场抛，不静默降级成内存。
 */
export function connectDocs(docs: DocsService, rpc: RpcService): void {
  // 覆盖而不是「已接上就返回」：拔插件重装时 `ctx.docs` 是新的实例，
  // 抱着旧的 source 会往一条已经断掉的 rpc 上写。
  backing = docsBacking(docs, markDirty)
  wire = rpc
}

function openVault(): TestWorkspace {
  if (vault) return vault
  if (!backing) {
    throw new Error('editor-blocksuite: 存储没接上（`connectDocs(ctx.docs)` 没调）')
  }
  vault = new TestWorkspace({
    id: 'self-notion',
    docSources: { main: backing.source },
    ...(blobs ? { blobSources: { main: blobs } } : {}),
  })
  // ★ Workspace 也得知道块 schema。上游建新文档走的是 `doc.getStore()`（**不带** extensions），
  //   而 Store 按 doc id 缓存、先到先得 —— 那次建出来的店没有 schema，之后我们再传也补不上，
  //   于是那篇新文档 `addBlock` 报 "schema for flavour"、`root` 永远是空的。
  vault.storeExtensions = buildStoreExtensions()
  // ★ 必须显式 initialize：TestWorkspace 的构造器**不**调它，而 `meta.docs` 没建起来时
  //   `addDocMeta` 会**静默 return**（源码里那句 `if (!this.docs) return`）——
  //   于是 createDoc 返回 null，一路炸在 `doc.load()` 上，看不出和 meta 有关系。
  // ★ 上游的「新建文档」（斜杠菜单 / `[[` 弹层）走 `createDefaultDoc`，它调的是**不带 id**
  //   的 `createDoc`；我们自己打开一篇已有的文档时都带 id。按这个区别认人：
  //   不带 id = 正文里新建的子页面 → 补一条库里的记录、挂到当前文档下面。
  //   不补的话它只活在内存的 Workspace 里 —— 侧栏没有它，重启也没了。
  const rawCreateDoc = vault.createDoc.bind(vault)
  vault.createDoc = (id?: string) => {
    const doc = rawCreateDoc(id)
    if (id === undefined) {
      // 建完就进去（Notion 那样，好立刻给子页面命名）。
      // 要等 `doc:create` 回来再跳 —— 否则打开时 `doc:open` 查不到这条刚建的。
      void shell?.createChildDoc(doc.id, openDocId).then(() => shell?.openDoc(doc.id))
    }
    return doc
  }

  vault.meta.initialize()
  vault.start()
  return vault
}

/* ─────────────────────────── 落库 ─────────────────────────── */

// 用户编辑 → 落库的节流窗口。Rust 侧 `docs.rs` 的注释写的就是「user 的 300ms flush」，
// 两边对齐：前端 300ms 攒一次，Rust 那边一次 doc:apply 换一次 snapshot。
const FLUSH_MS = 300

const dirty = new Set<string>()
let timer: ReturnType<typeof setTimeout> | undefined

/**
 * 闸门：这些文档**不许落库**。恢复历史版本时用（D-0043）。
 *
 * 恢复的时序是「改库 → 丢掉活 Y.Doc → 重新 hydrate」，中间任何一次落库都会把还没
 * hydrate 完的空文档写进库，把恢复结果毁掉。`muteDoc` 到 `unmuteDoc` 之间就是那道闸。
 */
const muted = new Set<string>()

/** 关上闸门。顺手把攒着的改动扔掉 —— 那正是马上要被恢复盖掉的旧状态。 */
export function muteDoc(docId: string): void {
  muted.add(docId)
  dirty.delete(docId)
}

export function unmuteDoc(docId: string): void {
  muted.delete(docId)
  dirty.delete(docId)
}

/**
 * 丢掉这一篇的活文档与 Store —— 下次 `openStore` 会从库里重建一个全新的 Y.Doc。
 *
 * ★ 恢复历史版本**只能**走这条路，不能在旧 Y.Doc 上 apply 一遍：Yjs 的删除是墓碑
 *   （tombstone），往活文档上灌历史字节，被删掉的内容回不来。要真回到那一刻，只能重开。
 */
export function dropDoc(docId: string): void {
  stores.delete(docId)
  dirty.delete(docId)
  if (!vault?.meta.getDocMeta(docId)) return
  // removeDoc 会先 `_yBlocks.clear()`（于是又标一次 dirty）再摘掉 subdoc。
  // 顺序无所谓 —— 闸门挡着，那一次落库不会发生。
  vault.removeDoc(docId)
  dirty.delete(docId)
}

/** 有本地改动。攒够 300ms 落一次库 —— 每次按键都发一次 RPC 是没必要的。 */
function markDirty(docId: string) {
  dirty.add(docId)
  if (timer !== undefined) return
  timer = setTimeout(() => {
    timer = undefined
    void flushDirty()
  }, FLUSH_MS)
}

async function flushDirty() {
  const ids = [...dirty]
  dirty.clear()
  for (const id of ids) await flushDoc(id)
}

/** 格式按钮的 `data-testid`（上游 `renderActionItem` 取的是 action id 的最后一段）。 */
const FORMAT_IDS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link'])

/**
 * 在**合成路径**上找最近的匹配元素。
 *
 * ★ 不能用 `e.target.closest(...)`：工具条在**影子 DOM** 里 —— `editor-toolbar` 是那个
 *   widget 的影子树，按钮又是 `<editor-icon-button>` 的影子。`closest()` 不跨影子边界，
 *   点下去 `target` 是按钮影子里最里面那个节点，一路 closest 上去只会拿到 null，
 *   监听器等于没装（第一次就是这么栽的：日志里一个字都没有）。
 *   `composedPath()` 是唯一穿得过去的。
 */
function inPath(e: Event, selector: string): Element | null {
  for (const node of e.composedPath()) {
    if (node instanceof Element && node.matches(selector)) return node
  }
  return null
}

/**
 * 工具条上点一下 = 一次**命令**（加粗 / 高亮 / 转成数据库…），跟打字不是一回事。
 *
 * 打字攒 300ms 再落库是为了省 RPC；命令是人一下一下点的，等这 300ms 没有意义 ——
 * 用户要的是「点完就在库里」。命令本身在上游的 action 里，看不见，那就听它落到 DOM 上的
 * 那一下 —— 工具条那两层壳是 `affine-toolbar-widget` / `editor-toolbar`（上游那段 static styles）。
 *
 * ★ 顺带当**诊断**用：点了格式按钮却一个字都没改的时候，把失败现场写进 errors.log。
 *   上游那条链是**静默失败**的 —— `Chain.run()` 把异常 catch 住只 `console.error`
 *   （`std/src/command/manager.ts`），用户看不见、我们也看不见，症状就是「点了没反应」。
 *   它要过的四道闸（`affine-inline-preset/src/command/format-text.ts`）：std 里得有一个
 *   不塌的 TextSelection → 那个块得在 DOM 里 → 块里得有 `[data-v-root]` → 那块 inline
 *   editor 得拿得出 inlineRange。缺哪一道，日志里就写哪一道。
 *
 * ★ 让一拍再判断：改动是 click 处理里才写进 Y.Doc 的，同一拍读到的还是旧的。
 * ★ 捕获阶段听：浮层里的按钮自己 `stopPropagation` 也拦不住这一下。
 * ★ 只落**脏**的：点「复制」这种不碰正文的命令不该白写一遍全量快照。
 */
function watchToolbarClicks(docId: () => string | null): () => void {
  const onClick = (e: MouseEvent) => {
    // 认**按钮自己**（上游 `renderActionItem` / `renderMenuActionItem` 用的那两个标签），
    // 不认外面那层容器 —— 容器叫什么、隔几层影子树都不影响这一条。
    // 诊断：点完 80ms 选区**还挂着**（用户：「点空白部分无法退」）—— 这一下到底落在谁身上。
    // 落点是 `CANVAS` 那种就说明**有别的东西铺在正文上、把这一下吃了**，
    // 落点是页面根就是编辑器收到了、只是没清掉 —— 两种的修法完全不同。
    //
    // ★ 必须在**派发期间**取：事件派发一结束 `composedPath()` 就清空了（第一次就栽在这，
    //   日志打出来是 `落点=`）。`elementFromPoint` 也同一时刻问 —— 它给的是那一点上**最上面**
    //   那个元素，正好回答「谁挡住了编辑器」。
    const where = describePath(e)
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.tagName.toLowerCase() ?? '?'
    window.setTimeout(() => {
      const std = activeStd
      if (!std) return
      const still = std.selection.find(TextSelection)
      if (!still || still.isCollapsed()) return
      reportNote('editor', `点了之后选区还在：落点=${where} · 坐标那一点最上面是 ${hit}`)
    }, 80)

    const button = inPath(e, 'editor-icon-button, editor-menu-action')
    if (!button) return
    const key = button.getAttribute('data-testid') ?? ''
    const id = docId()
    if (id === null) return

    // 两拍，不能合成一拍：
    //   0ms  —— 命令改了正文就**马上落库**（不等打字节流那 300ms）。
    //   300ms —— 才判断「上游是不是真没写」。判早了会**误判**：`markDirty` 是排在 Yjs
    //            更新之后的异步那一段，一拍看不到它就把上游刚写的再写一遍 ——
    //            而格式是开关，写第二遍正好**把第一遍抵消掉**（库里那份 delta 就是这么没的）。
    let wrote = false
    window.setTimeout(() => {
      if (dirty.has(id)) {
        wrote = true
        void flushDoc(id)
      }
    }, 0)

    if (!FORMAT_IDS.has(key)) return
    window.setTimeout(() => {
      // 脏信号已经响了（引擎那一拍快）—— 0ms 那次已经落过库。
      if (wrote || dirty.has(id)) return
      // ★ 上游那条链**改得了活文档、却不出脏信号**（实测：文本在累积 bold / italic /
      //   underline，两份文本一致，而 0ms 与 300ms 都不脏）。脏信号是落库的**唯一**入口，
      //   所以这里自己补一个：点了格式按钮 = 正文一定被改过。
      //   不补的话格式只活在内存里 —— 切走再进来就没了（用户：「一定要保存修改」）。
      reportNote('editor', `工具条「${key}」没出脏信号，自己标脏落库：${selectionFacts()}`)
      markDirty(id)
      // 不等那 300ms 的打字节流：命令是人点的，点完就该在库里。
      void flushDoc(id)
    }, 300)
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

/** inline editor 我们只用这一个方法（结构类型，省得为这一处引一个类）。 */
interface InlineEditorLike {
  /** 编辑器手里那块 Y.Text 的样子（诊断用：跟模型那份对不上就是「两块文本」）。 */
  readonly yTextDeltas?: ReadonlyArray<{ insert: unknown; attributes?: Record<string, unknown> }>
  getInlineRange(): { index: number; length: number } | null
}

/** 某个块里那个 inline editor。`data-block-id` 是 BlockSuite 给块元素挂的（`BLOCK_ID_ATTR`）。 */
function inlineEditorAt(blockId: string): InlineEditorLike | null {
  const el = document.querySelector(`[data-block-id="${blockId}"]`)
  const root = el?.querySelector(`[${INLINE_ROOT_ATTR}]`)
  return (root as unknown as { inlineEditor?: InlineEditorLike } | null)?.inlineEditor ?? null
}

/** 这一下点击落在谁身上 —— 取合成路径前几层（跨影子边界）。 */
function describePath(e: Event): string {
  return e
    .composedPath()
    .slice(0, 6)
    .map((node) => (node instanceof Element ? node.tagName.toLowerCase() : String(node)))
    .join(' > ')
}

/** 那条块**画出来**的 HTML（截断）—— 样式有没有落进 DOM，看它最直接。 */
function renderedHtml(el: Element | null): string {
  const root = el?.querySelector(`[${INLINE_ROOT_ATTR}]`)
  if (!root) return '没有 inline root'
  return (root.innerHTML ?? '').replace(/\s+/g, ' ').slice(0, 240)
}

/** 上游那道前置闸的结果 —— 它空转不出声，只能自己把它头两步走一遍。 */
function upstreamGateFacts(): string {
  const std = activeStd
  if (!std) return ''
  const sel = std.selection.find(TextSelection)
  if (!sel) return ''
  try {
    const range = std.range.textSelectionToRange(sel)
    if (!range) return '上游 range=null'
    const blocks = std.range.getSelectedBlockComponentsByRange(range, {
      match: (el: BlockComponent) => el.model.role === 'content',
      mode: 'flat',
    })
    return `上游 range=有 · blocks=${blocks.length}`
  } catch (err) {
    return `上游 range 抛了：${String(err)}`
  }
}

/** 格式命令空转时，把「卡在哪一道闸」一次说清（只进日志，不弹红框）。 */
function selectionFacts(): string {
  const std = activeStd
  if (!std) return '没有活的编辑器作用域'
  const sel = std.selection.find(TextSelection)
  if (!sel) return 'std 里没有 TextSelection'
  if (sel.isCollapsed()) return 'TextSelection 是塌的（没选中东西）'
  const blockId = sel.start.blockId
  const model = std.store.getModelById(blockId)
  const editor = inlineEditorAt(blockId)
  // ★ 两份文本摆一起比：**编辑器手里那块**（`yText.toDelta()`）与**模型那块**
  //   （`model.text.toDelta()`）。这俩本该是同一个 Y.Text —— 对不上就说明编辑器绑到了
  //   另一块文本上，那「改了就落库」这条路整个是断的（点了不脏、库里没属性都能解释）。
  const modelText = model?.text as { toDelta?(): unknown } | undefined
  return [
    `block=${blockId}`,
    `flavour=${model?.flavour ?? '?'}`,
    `readonly=${std.store.readonly}`,
    `inlineEditor=${editor ? '在' : '没有'}`,
    // 打原始值：上游对**塌 range**（length 0）走的是「只设标记不写正文」那条路，
    // 光看「有没有」看不出这一层。
    `inlineRange=${JSON.stringify(editor?.getInlineRange() ?? null)}`,
    `编辑器文本=${JSON.stringify(editor?.yTextDeltas ?? null)}`,
    `模型文本=${JSON.stringify(modelText?.toDelta?.() ?? null)}`,
    // ★ 画出来的是什么 —— 这一条是**确定**的：样式到底有没有落进 DOM。
    `渲染=${JSON.stringify(renderedHtml(document.querySelector(`[data-block-id="${blockId}"]`)))}`,
    `焦点=${document.activeElement?.tagName ?? '无'}`,
    upstreamGateFacts(),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** 立刻落一篇文档。切文档 / 卸载 / 拔插件前必须 await 它。 */
export async function flushDoc(docId: string): Promise<void> {
  if (!backing) return
  dirty.delete(docId)
  if (muted.has(docId)) return
  // 活的 Y.Doc：`spaceDoc` 就是它。不从 DocSource 那边取镜像 —— 那份可能是旧的。
  const live = vault?.getDoc(docId)?.spaceDoc
  if (!live) return
  const project = projectOf(docId)
  await backing.flush(docId, live, project)
  // 诊断：这次落库时那一篇里有几个图片块 —— 「块自己没了」只能靠时间线对齐。
  logImageBlocks(docId)
  // 真的写完了才说「已保存」—— 这条是给顶栏看的，不是给逻辑用的。
  shell?.saved?.(docId)
  // 名字跟着写进库了 —— 外面（侧栏/标签条/顶栏）得知道（D-0073）。
  // 只在**这一次和上一次不一样**时说：正文里每一次按键都会走到这儿，每次都广播
  // 等于让所有人每 300ms 重取一遍文档表。
  const name = project?.title ?? ''
  if (lastNames.get(docId) !== name) {
    lastNames.set(docId, name)
    // 名字真的变了才记一条：这条是「标题到底有没有走到落库」唯一的一手证据（D-0073）。
    reportNote('title', `落库 ${docId}：名字「${name}」`)
    shell?.renamed?.(docId)
  }
}

/** 上一次落库时这一篇的名字。区分「真改了名」和「只是正文改了」用。 */
const lastNames = new Map<string, string>()

/**
 * 诊断用：这一篇里现在有几个图片块。
 *
 * 「块自己没了」这种事只能靠时间线对齐 —— 所以每次落库核一次。数目没变就不重复记
 *（打字时 300ms 一条会把 errors.log 刷爆）。
 */
const lastImages = new Map<string, number>()

function logImageBlocks(docId: string): void {
  const store = stores.get(docId)
  if (!store?.root) return
  let n = 0
  const walk = (m: BlockModel) => {
    if (m.flavour === 'affine:image') n++
    for (const kid of m.children) walk(kid)
  }
  walk(store.root)
  if (lastImages.get(docId) === n) return
  lastImages.set(docId, n)
  reportNote('image', `落库 ${docId}：图片块 ${n} 个`)
}

/**
 * 外面改的名字（侧栏重命名 / 导入）落到**活的** Y.Doc 的标题块上 —— 跟正文里打字顺便改
 * 名字是同一条路上的两个方向，两边必须是同一个名字。
 *
 * ★ 三种情形一律不动，否则会拿一个旧名字盖掉新的：
 *   这一篇有还没落库的改动（用户刚敲的字）、定时器刚起了还没落（同一个意思）、
 *   落库闸门关着（正在恢复历史版本，D-0043）。
 * ★ 写进去之后 `lastNames` 先记上 —— 跟上来的那次落库不该再广播一圈。
 */
/**
 * 把**全库**登记进工作区 —— 只建文档壳 + 一条元数据，正文一个字都不 load。
 *
 * ★ 正文里那行 `@链接` 的图标和标题查的是 `workspace.getDoc(pageId)` 和 `meta.docMetas`
 *   （`doc-display-meta-service.ts`）：查不到就当「这篇被删了」—— 图标换垃圾桶、标题划掉写
 *   `Deleted doc`。而工作区原来只知道**打开过的**那几篇，于是「没点进去过的页面全显示成
 *   deleted」（用户原话），点进去一次再出来又好了。库里的 `doc:list` 才是真相。
 * ★ 只能在**连 DOM 之前**调：那行的标题在第一次渲染就定下来了，渲染完再登记来不及。
 * ★ 打开着的那些跳过：名字归 `applyTitle` 和正文自己同步，拿库里的旧名字写回去会盖掉刚敲的字。
 * ★ 标题没变就不写 —— 元数据写在根 Y.Doc 上，每一次按键触发的 `DOCS_CHANGED` 都写一遍是白抖。
 */
export function registerDocs(docs: readonly DocMeta[]): void {
  for (const doc of docs) {
    if (doc.deletedAt !== null || stores.has(doc.id)) continue
    ensureDocShell(doc.id, doc.title)
  }
}

/**
 * 确保工作区**认识**这一篇：建一个文档壳 + 登记一条元数据（正文一个字都不 load）。
 * 返回「是不是新建的」（新建 = 之前不认识）。
 *
 * ★ 正文里那行引用渲染时查的是 `workspace.getDoc(pageId)` 和 `meta.docMetas`，
 *   查不到就画成划掉的 `Deleted doc`。所以**往正文里插引用之前必须先走这一下** ——
 *   只靠「打开时全库登记」盖不到「拖进来的那一篇」（用户 2026-10-07：拖成子页面后那行
 *   一直是 deleted，点进去一次再出来才好）。
 */
function ensureDocShell(id: string, title: string): boolean {
  const workspace = openVault()
  const made = !workspace.getDoc(id)
  if (made) workspace.createDoc(id)
  if (workspace.meta.getDocMeta(id)?.title !== title) {
    workspace.meta.setDocMeta(id, { title })
  }
  return made
}

/**
 * 正文里的子页面那行，跟着**库里的树**走（D-0091）。参数是**全库**（`doc:list` 那一份），
 * 孩子在这里面现筛 —— 一次 rpc 干两件事（登记全库 + 对齐正文）。
 *
 * ★ 库里的 `parent_id` 才是树的真相（侧栏照它画），正文里那几行是另一份 —— 从侧栏右键建的、
 *   拖进去的、导入进来的孩子，正文里本来一行都没有，看着就是「说好的子页面呢」（用户原话）。
 *   打开一篇、树一变，就把缺的那几行补上。
 * ★ 孩子那一行**只补不删**（除了卡片换行，见下）：那一行也可能是「链接页面」故意链的一篇
 *   **不是孩子**的文档，按树去删会把用户自己放的删掉。
 * ★ 行内 `@链接` 也算「正文里已经有这个孩子了」—— `/子页面` 和 `[[` 那两条路会在正文里
 *   留下它，不认的话同一个孩子会多出一行。
 */
export function syncSubpages(docId: string, all: readonly DocMeta[]): void {
  const store = stores.get(docId)
  const root = store?.root
  if (!store || !root || store.readonly) return

  const children = all
    .filter((doc) => doc.parentId === docId && doc.deletedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((doc) => ({ id: doc.id, title: doc.title }))
  if (children.length === 0) return

  // 孩子那一行是**行内链接**，不是那张大卡片：库里是孩子、正文里却是卡片 → 把卡片换成一行。
  // 链的是**不是孩子**的文档的卡片一律不动 —— 那是「链接页面」，有它自己的意思。
  const childIds = new Set(children.map((child) => child.id))
  for (const model of store.getModelsByFlavour('affine:embed-linked-doc')) {
    const pageId = (model.props as { pageId?: unknown }).pageId
    if (typeof pageId === 'string' && childIds.has(pageId)) store.deleteBlock(model.id)
  }

  // 坏链接（`reference` 里没有 `pageId`）是垃圾 —— 渲染出来就是划掉的「Deleted doc」。
  // 认出来就删：这种行没有任何内容可丢（只有空白 + 一个指不到东西的链接）。
  for (const model of store.getModelsByFlavour('affine:paragraph')) {
    const deltas = model.text?.toDelta() ?? []
    if (!deltas.some((delta) => (delta.attributes as { reference?: unknown })?.reference)) continue
    const junk = deltas.every((delta) => {
      const ref = (delta.attributes as { reference?: { pageId?: unknown } })?.reference
      if (ref) return typeof ref.pageId !== 'string' || ref.pageId === ''
      return typeof delta.insert === 'string' && delta.insert.trim() === ''
    })
    if (junk) store.deleteBlock(model.id)
  }

  const taken: DocLink[] = []
  collectLinks(root, taken)
  const shown = new Set(taken.map((link) => link.toId))
  const missing = children.filter((child) => child.id !== docId && !shown.has(child.id))
  if (missing.length === 0) return

  const notes = store.getModelsByFlavour('affine:note')
  const note = notes[notes.length - 1]
  if (!note) return

  // 插在末尾那个空段落**前面** —— 它是接着打字的那一行，子页面排到它下面等于把光标顶到最底。
  let at = note.children.length
  const last = note.children[at - 1]
  if (last?.flavour === 'affine:paragraph' && (last.text?.length ?? 0) === 0) at -= 1

  for (const child of missing) {
    // ★ 插之前先确保工作区认识它 —— 不然那一行当场就画成「Deleted doc」（`ensureDocShell`）。
    //   真要新建壳就是「之前没登记」的铁证，记一行备查。
    if (ensureDocShell(child.id, child.title)) {
      reportNote('editor', `子页面登记兜底：${child.id}「${child.title}」`)
    }
    const blockId = store.addBlock('affine:paragraph', {}, note, at)
    store
      .getModelById(blockId)
      ?.text?.insert(REFERENCE_NODE, 0, { reference: { ...SUBPAGE_REFERENCE, pageId: child.id } })
    at += 1
  }
  markDirty(docId)
}

/**
 * 外面改的名字（侧栏重命名 / 导入）落到**活的** Y.Doc 的标题块上 —— 跟正文里打字顺便改
 * 名字是同一条路上的两个方向，两边必须是同一个名字。
 *
 * ★ 三种情形一律不动，否则会拿一个旧名字盖掉新的：
 *   这一篇有还没落库的改动（用户刚敲的字）、定时器刚起了还没落（同一个意思）、
 *   落库闸门关着（正在恢复历史版本，D-0043）。
 * ★ 写进去之后 `lastNames` 先记上 —— 跟上来的那次落库不该再广播一圈。
 */
export function applyTitle(docId: string, name: string): void {
  if (dirty.has(docId) || timer !== undefined || muted.has(docId)) return
  const store = stores.get(docId)
  const page = store?.getModelsByFlavour('affine:page')[0]
  const title = (page?.props as { title?: Text } | undefined)?.title
  if (!store || !title || title.toString() === name) return
  lastNames.set(docId, name)
  store.transact(() => {
    title.clear()
    if (name) title.insert(name, 0)
  })
}

/** 把所有攒着的改动落完。拔插件、关窗口之前调。 */
export async function flushAll(): Promise<void> {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  await flushDirty()
}

/** 空文档：page → note → 一个空段落。少了这步就是个没法打字的空壳。 */
function seed(store: Store) {
  const root = store.addBlock('affine:page', { title: new Text('') })
  const note = store.addBlock(
    'affine:note',
    { displayMode: NoteDisplayMode.DocAndEdgeless },
    root,
  )
  store.addBlock('affine:paragraph', {}, note)
}

export interface EditorHandle {
  unmount(): void
  /** 给测试用的口子 —— 契约里没有，别拿它当契约。 */
  store: Store
}

/**
 * 打开一篇文档的 **数据侧**：库里字节 → Y.Doc → Store → （真的空的才）种一棵初始块树。
 *
 * ★ `await hydrate(...)` 这一句是**必须且必须在 `getStore` 之前**的：
 *   `doc.load()` 是**同步**的（`load(initFn?): void`），它不会等同步引擎那条异步 pull。
 *   不显式灌一把，`getStore` 会建在空块树上 → `store.root` 为 null → 我们种一棵初始块树
 *   → 随后 pull 的字节才到 → **两棵树**（真文档上面多出一个空 page）。
 *   灌进去是幂等的（Yjs 按 client id 去重），同步引擎之后再 pull 一次也没有副作用。
 */
export async function openStore(docId: string, readonly = false): Promise<Store> {
  const workspace = openVault()
  const doc = workspace.getDoc(docId) ?? workspace.createDoc(docId)
  if (!doc) throw new Error(`editor-blocksuite: 建不出 doc「${docId}」`)

  // 先 load 再 getStore：Store 建的时候要读块树，块树没 ready 会读到空。
  doc.load()
  if (backing) await backing.hydrate(docId, doc.spaceDoc)

  // ★ extensions **不往这里传** —— Store 是按 doc id 缓存的，先到先得，后传的直接被丢掉。
  //   给它设到 workspace 上，Workspace 自己建 store 时（上游 `createDefaultDoc` 那条路）
  //   也拿得到同一份 schema。参 `openVault` 那段注释。
  workspace.storeExtensions = buildStoreExtensions()
  let store = doc.getStore({ id: docId, readonly })

  // ★ 缓存里坐着的如果是**没 schema** 的那家店（上游 `doc.getStore()` 不带 extensions 建的），
  //   这里再传什么都改不了它（命中缓存就返回）—— `addBlock` 会一直报 "schema for flavour"，
  //   连 `seed()` 都种不出 root。认出来就丢掉重开一家。
  if (!store.schema.flavourSchemaMap.has('affine:page')) {
    doc.removeStore({ id: docId })
    store = doc.getStore({ id: docId, readonly })
  }

  // 到这儿 root 还是空 = 库里本来就没内容（不是「还没到」）—— 种一棵能打字的空树。
  if (!store.root) seed(store)

  // ★ `store.load()` —— **Store 的生命周期整个从这里开始**，跟上面那句 `doc.load()` 是两码事。
  //   少了它，每个 store 扩展的 `loaded()` 都不跑；`HistoryExtension.loaded()` 里才是接
  //   `stack-item-added` 等监听、刷新 `canUndo` / `canRedo` 那两个 signal 的地方 ——
  //   于是 `canUndo` 永远 false，BlockSuite 那条 `Mod-z`（`if (canUndo) undo()`）成了空操作，
  //   表现就是「⌘Z 按了没反应」。
  store.load()
  // 种出来的初始树不该能被 ⌘Z 撤掉：撤销栈里只该有用户敲的东西。
  store.resetHistory()

  stores.set(docId, store)
  return store
}

/**
 * 打开时自查：库里的正文投影是空、活文档却有字 → 立刻落一次库补齐（D-0109）。
 * 老导入把 `doc_text.md` 写成空，这些篇会被朗读 / 总结 / 搜索判成「还没写正文」。
 */
async function repairProjection(docId: string): Promise<void> {
  const rpc = wire
  if (!rpc || !projectOf(docId)?.md.trim()) return
  const row = await rpc.call<{ md: string }>('doc:text', { id: docId })
  if (row.md.trim()) return
  await flushDoc(docId)
}

/**
 * 存量补齐：老导入把 `doc_text.md` 写成空（D-0109），而搜索 / 首页摘要读的就是这份投影 ——
 * 只靠「开一篇补一篇」那些**没打开过的**永远是空的。挂上第一个编辑器之后（块包已在内存里）跑一次。
 * 自己开自己的库：不碰 `stores` 里还开着的那几篇（它们归 `repairProjection`）。
 */
let backfilled = false
async function backfillProjections(): Promise<void> {
  const rpc = wire
  if (backfilled || !rpc) return
  backfilled = true
  const metas = await rpc.call<DocMeta[]>('doc:list', { includeTrashed: false })
  const ids = metas.map((m) => m.id)
  const rows = await rpc.call<DocSummary[]>('doc:summary', { ids })
  // 没有这一行的（`doc:summary` 只回有投影的那几篇）和空串一样，都要补。
  const have = new Set(rows.filter((r) => r.body.trim()).map((r) => r.id))
  for (const id of ids) {
    if (have.has(id) || stores.has(id)) continue
    try {
      await openStore(id)
      const project = projectOf(id)
      const doc = vault?.getDoc(id)
      // 真没字的（空篇 / 只有图片）不动它的投影。
      if (!project?.md.trim() || !doc) continue
      await rpc.call('doc:apply', {
        id,
        snapshot: toBase64(Y.encodeStateAsUpdate(doc.spaceDoc)),
        title: project.title,
        md: project.md,
        links: project.links,
      })
    } catch (err) {
      reportError('backfill', err)
    } finally {
      // 一篇一篇来：写完就把它从 vault 里摘掉，几百篇也不堆内存。
      dropDoc(id)
      await new Promise((next) => setTimeout(next, 0))
    }
  }
  // ★ 收尾：这一趟把每篇都从工作区里摘过（`dropDoc`），而**全库的壳本该一直都有**
  //   （`registerDocs` 每次挂载都建一遍）。不补回来的话，正文里指向它们的引用会显示成
  //   「Deleted doc」。这里只补壳，不 load 正文 —— 内存还是省的。
  registerDocs(metas)
}

/** 活文档的正文（“用户正看着这篇”的人读它）。没打开过 → null。 */
export function liveText(docId: string): string | null {
  return projectOf(docId)?.md ?? null
}

/** 块 schema 那一坨 extension。Workspace 和每个 Store 都得是同一份。 */
function buildStoreExtensions(): ExtensionType[] {
  return new StoreExtensionManager(storeProviders).get('store')
}

/**
 * 挂一个编辑器。`docId` 就是契约里 `DocHandle.id`（不透明，这边只当字符串 key）。
 *
 * 生命周期：Store 交给 `Doc.getStore({ id })` 缓存（同一个 id 只会有一个 Store），
 * 视图每次挂载重建 —— 卸载重挂是瞬时的，因为 Y.Doc 一直在 vault 里。
 */
export async function mountEditor(
  el: HTMLElement,
  docId: string,
  readonly = false,
): Promise<EditorHandle> {
  const store = await openStore(docId, readonly)
  openDocId = docId
  // 只读挂载是历史预览那种 —— 把旧状态的投影写进库就乱套了。
  if (!readonly) {
    // 「最近」按真的打开来排：要字节那一步（`doc:open`）不再刷 `last_opened_at`（D-0109）。
    void wire?.call('doc:touch', { id: docId }).catch((err) => reportError('editor', err))
    void repairProjection(docId).catch((err) => reportError('editor', err))
    // 让一拍：先把这一篇挂起来，存量的补齐不跟打开抢那一下。
    setTimeout(() => void backfillProjections().catch((err) => reportError('backfill', err)), 2000)
  }

  // ★ 全库先登记再连 DOM —— 没登记的那些，正文里的 `@链接` 第一眼就是划掉的
  //   「Deleted doc」（`registerDocs` 上面那段）。拿回来的同一份表顺手对齐子页面那几行。
  //   抛了不该拦住挂载：编辑器能开，只是那几行名字可能不对。
  const all = await shell?.library().catch((err) => {
    reportError('editor', err)
    return undefined
  })
  if (all) {
    registerDocs(all)
    syncSubpages(docId, all)
  }

  // 连 DOM 前 root 必须已经在 —— `LitEditorHostElement.connectedCallback` 见到空 root 会直接抛
  // "missing root block"，而且**那个异常不会传回这里**（它是 DOM 回调里的异常，只会进 errors.log），
  // 表现就是「页面像开了但一个字都打不进去」。所以提前自己报一声。
  if (!store.root) {
    reportError(
      'editor',
      new Error(
        `doc「${docId}」连 DOM 前没有 root：schema ${store.schema.flavourSchemaMap.size} 个`,
      ),
    )
  }

  const std = new BlockStdScope({ store, extensions: pageExtensions() })
  const host = std.render()

  // ★ 必须有个 `.affine-page-viewport` 祖先。RootViewExtension 注册的是
  //   `ViewportElementExtension('.affine-page-viewport')`，而 page-root 一渲染就读
  //   `std.host.closest('.affine-page-viewport')` —— 找不到就抛
  //   `ViewportElementProvider: viewport element is not found`。
  //
  // ★ 版心靠这两个变量：page-root 与标题都写 `max-width: var(--affine-editor-width)`
  //   **没有兜底值** —— 不设就是整条声明作废，正文顶到左边缘铺满全宽。
  const viewport = document.createElement('div')
  viewport.className = 'affine-page-viewport'
  viewport.style.cssText = [
    'height:100%',
    // ★ 这一层**不滚**（用户：「正文字直接滑到标题上了 正文应该限制区域」）。
    'overflow:hidden',
    'display:flex',
    'flex-direction:column',
    // ★ 版心宽度不写死：`<html>` 上的 `--sn-editor-width` 是「全宽」那个开关写的（`fonts.ts`）。
    //   兜底必须留着 —— 取不到变量又没兜底，整条声明作废，正文会顶到左边缘铺满全宽。
    '--affine-editor-width:var(--sn-editor-width,720px)',
    '--affine-editor-side-padding:24px',
  ].join(';')

  // 正文自己的滚动区，在标题下面。标题固定在上头 —— 正文再怎么滚都压不到它。
  // ★ **滚动容器也得带 `.affine-page-viewport` 这个类**：BlockSuite 那套滚动/吸附
  //   （拖拽手柄、scroll-into-view、目录跳转）都是 `closest('.affine-page-viewport')` 找容器，
  //   从正文往里找第一个带这个类的祖先就是它。外面那层留着同名类是为了让标题也还在
  //   「viewport 子树」里（`doc-title` 的内部编辑器要这个祖先）。
  const scroller = document.createElement('div')
  scroller.className = 'affine-page-viewport'
  scroller.style.cssText =
    'flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;' +
    'overscroll-behavior:contain'

  // 标题在编辑器**外面**（BlockSuite 只注册元素，AFFiNE 前端自己挂）。它要能找到
  // `<editor-host>` 取 `std`（回车/下箭头靠这个跳到正文），所以必须是同一层里的兄弟。
  const title = document.createElement('doc-title') as HTMLElement & { doc: Store }
  title.doc = store

  // ★ **标题改了要算「这篇脏了」**（D-0073）—— 光靠同步引擎那条 push 是靠不住的：
  //   大标题活在**根文档**上，库里的实测结果是「标题写了、正文没动 → 一个字节都没落库」，
  //   症状就是标签条 / 侧栏 / 面包屑永远停在「未命名」。这里直接盯着那个 Y.Text 自己报。
  const titleY = titleYText(store)
  const onTitle = () => markDirty(docId)
  titleY?.observe(onTitle)

  // ★ 标题上下 padding（上 38 / 下 12，见 `editor.css.ts`）挂在外层 `.doc-title-container` 上，它**不是编辑区**
  //   （真正 contenteditable 的是内层 `.inline-editor`）—— 点在那块 padding 上什么都不会发生，
  //   于是标题和正文之间留出一条点了没反应的死带。把这点点击转给标题编辑区。
  title.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.inline-editor')) return
    e.preventDefault()
    focusTitle(title)
  })

  // ★ 标题**在滚动区里面**，跟正文一起滚（用户：「下滑应该就不要看见标题了 这种长标题影响阅读」）。
  //   曾经把它拿出来钉在滚动区上方 —— 那是为了修「正文滑到标题上」（两者当时重叠）；
  //   但钉住的代价是长标题永远占着上方一大块。放进同一个滚动流里两个毛病都没有。
  //   把它拿出滚动区还会引来一个难查的抖动：标题一收，滚动区变高 → `scrollTop` 被夹回 0
  //   → 标题又弹回来 → 再来一遍（用户：「无法拉到最下面 一直把我拉走」）。
  //
  // ★ 它还是能找到 `editor-host`：`doc-title` 是 `this.closest('.affine-page-viewport')`
  //   再 `querySelector('editor-host')`，而 `scroller` 自己也带这个类（下面那条注释）。
  scroller.append(title, host)

  // 右侧目录（D-0070）：AFFiNE 的 `affine-outline-viewer` 就是这套 —— 右缘一列短横条，
  // 悬停出标题清单，点一条跳过去，滚到哪一节哪条高亮。我们只挂它，几何在 `editor.css.ts`。
  // ★ 挂在 viewport **外面**（同一层）：viewport 自己是滚动容器，绝对定位的后代跟着内容滚。
  const outline = document.createElement('affine-outline-viewer') as HTMLElement & { editor: unknown }
  outline.className = 'sn-outline-rail'
  outline.editor = host

  el.append(viewport, outline)
  std.mount()
  // 自绘插入点（D-0076）。挂在 body 上的 fixed 层，不碰编辑器这棵树 —— 直接读选区量位置。
  const unmountCaret = mountCaret(el)
  // 正文里混进来的控制符（缺字方框，D-0127）当场删掉 —— 只读挂载不动别人的历史字节。
  const unmountSanitize = readonly ? () => {} : watchControlChars(store)
  // 每个块的 ⠿ 拖动手柄（D-0117）。只读挂载（历史预览）不给拖。
  const unmountDrag = readonly ? () => {} : mountBlockDrag(el, store)
  // 「行尾那片空白也能起手拖选」（D-0090）—— 只在可编辑区外接管，别的地方一律放行。
  const unmountSelect = selectAnywhere(el)
  // 工具条上点完命令马上落库（不用等那 300ms 的打字节流）；点了没变就写进 errors.log。
  const unmountToolbarFlush = watchToolbarClicks(() => docId)
  activeStd = std

  // ★ 并排时「当前这一篇」得跟着**你点的那一栏**走（D-0118）：评论锚点、⌘F 查找、
  //   正文里新建子页面认的父级都读 `openDocId` / `activeStd`，而这里只把它们设成
  //   「最后挂上的那一篇」—— 三栏并排时另外两栏的评论会打到最后那一篇上去。
  const onPaneDown = () => {
    openDocId = docId
    activeStd = std
  }
  el.addEventListener('pointerdown', onPaneDown, true)
  reportNote('editor', `撤销现场：canUndo=${store.canUndo} 记历史开关=${shouldTransact(store)}`)

  /**
   * ⌘Z / ⇧⌘Z。**这一条是探针，先别当定论**。
   *
   * 撤不掉有三条互斥的可能，一次按键 + 一行日志就能分辨：
   *   ① 按键根本没到 DOM（被菜单的键等价吃了）→ 日志里没有这一行
   *   ② 到了 DOM，但撤销栈是空的（`canUndo=false`）→ 记下来了但撤不动
   *   ③ 到了 DOM、栈里也有东西，只是 BlockSuite 那条键位没触发 → 记下来并当场撤掉
   *
   * ③ 就顺手自己接住（`preventDefault` + `stopPropagation`，不让它再往上走一遍）。
   */
  const onUndoKey = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return
    // 别人已经处理过（上游那条键位先接到）就别再来一遍 —— 否则一次按键撤两步。
    if (e.defaultPrevented) return
    const redo = e.shiftKey
    reportNote(
      'editor',
      `⌘Z 到 DOM：redo=${redo} canUndo=${store.canUndo} canRedo=${store.canRedo} 记历史开关=${shouldTransact(store)} 默认已被拦=${e.defaultPrevented}`,
    )
    if (redo ? store.canRedo : store.canUndo) {
      e.preventDefault()
      e.stopPropagation()
      if (redo) store.redo()
      else store.undo()
    }
  }
  el.addEventListener('keydown', onUndoKey, true)

  // 回到上次滚到的地方。★ 滚的是 `scroller` 不是 `viewport` —— 后者 `overflow: hidden`，读它永远是 0。
  const savedScroll = scrollPositions.get(docId)
  if (savedScroll) requestAnimationFrame(() => (scroller.scrollTop = savedScroll))

  viewport.append(scroller)

  // 点正文里的页面链接（内联引用 / 子页面卡片）→ 切到那一篇。
  const linkSub = std
    .getOptional(RefNodeSlotsProvider)
    ?.docLinkClicked.subscribe(({ pageId }) => {
      if (pageId && pageId !== docId) shell?.openDoc(pageId)
    })

  // 新文档还没有标题：光标给标题，顺手就能命名（不然满列表的「未命名」）。
  if (pageTitle(store.getModelsByFlavour('affine:page')[0]) === '') {
    focusTitle(title)
  } else {
    // 打开就聚焦第一个可写块（A5）—— 否则用户得先点一下正文才能打字。
    await focusFirstText(std, store, () => viewport.isConnected)
  }

  return {
    store,
    unmount() {
      unmountCaret()
      unmountSanitize()
      unmountDrag()
      unmountSelect()
      unmountToolbarFlush()
      el.removeEventListener('pointerdown', onPaneDown, true)
      el.removeEventListener('keydown', onUndoKey, true)
      titleY?.unobserve(onTitle)
      linkSub?.unsubscribe()
      if (openDocId === docId) openDocId = null
      if (activeStd === std) activeStd = undefined
      scrollPositions.set(docId, scroller.scrollTop)
      std.unmount()
      viewport.remove()
      stores.delete(docId)
    },
  }
}

/** 把光标放回标题末尾。标题内部那块才是 contenteditable，外面那圈 padding 是死区。 */
function focusTitle(title: HTMLElement): void {
  const editor = title.querySelector<HTMLElement>('.inline-editor')
  if (!editor) return
  editor.focus()
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** 第一个带 text 的块 —— 打开文档时聚焦到它。 */
function firstTextBlock(model: BlockModel): BlockModel | undefined {
  if (model.text) return model
  for (const child of model.children) {
    const hit = firstTextBlock(child)
    if (hit) return hit
  }
  return undefined
}

/**
 * 等第一个文本块的视图渲染出来，再把光标放进去。
 *
 * 一轮一轮等（每帧一次，最多 120 帧）—— 首帧异步，早一帧拿到的是 undefined。
 */
async function focusFirstText(
  std: BlockStdScope,
  store: Store,
  alive: () => boolean,
): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const model = store.root ? firstTextBlock(store.root) : undefined
    const view = model ? std.view.getBlock(model.id) : undefined
    if (view) {
      std.command.exec(focusBlockStart, { focusBlock: view })
      return
    }
    if (!alive()) return
    await new Promise((next) => requestAnimationFrame(next))
  }
}

/** 正文投影：把块树里的 text 按顺序摊平（Rust 拿去喂 FTS / 首页摘要）+ 出链（D-0085）。 */
function projectOf(docId: string): Projection | undefined {
  const store = stores.get(docId)
  if (!store) return undefined
  const lines: string[] = []
  const links: DocLink[] = []
  if (store.root) {
    collectText(store.root, lines)
    collectLinks(store.root, links)
  }
  return {
    title: pageTitle(store.getModelsByFlavour('affine:page')[0]),
    md: lines.join('\n\n'),
    links,
  }
}

function collectText(model: BlockModel, out: string[]): void {
  const text = model.text?.toString().trim()
  if (text) out.push(text)
  for (const child of model.children) collectText(child, out)
}

/** 出链抽取（D-0085）：`@提及` = 行内 reference · `子页面` = `affine:embed-linked-doc`。
 *  **全量** —— 抽出来空数组 = 这篇没有出链，Rust 拿它替换式重建（先删后插）。
 *  抽不到的（pageId 不是字符串）直接丢：宁可少一条边，也不要让落库报错。 */
function collectLinks(model: BlockModel, out: DocLink[]): void {
  if (model.flavour === 'affine:embed-linked-doc') {
    const pageId = (model.props as { pageId?: unknown }).pageId
    if (typeof pageId === 'string' && pageId !== '') out.push({ toId: pageId, kind: 'subpage' })
  }
  for (const delta of model.text?.toDelta() ?? []) {
    const ref = (delta.attributes as { reference?: { pageId?: unknown } } | undefined)?.reference
    if (ref && typeof ref.pageId === 'string' && ref.pageId !== '') {
      out.push({ toId: ref.pageId, kind: 'mention' })
    }
  }
  for (const child of model.children) collectLinks(child, out)
}

function pageTitle(page: BlockModel | undefined): string {
  const title = (page?.props as { title?: { toString(): string } } | undefined)?.title
  return title ? title.toString() : ''
}

/** 大标题那个 `Y.Text` —— 就是 `<doc-title>` 渲染的那一个，也是 `pageTitle` 读的那个。 */
function titleYText(store: Store): Y.Text | undefined {
  return (store.root?.props as { title?: { yText?: Y.Text } } | undefined)?.title?.yText
}

/* ─────────────────────────── 内存监控（D-0079） ─────────────────────────── */

/**
 * 当前**加载在内存里**的每一篇的运行时占用。
 *
 * `bytes` 是这篇 Y.Doc 编码出来的字节数 —— 「这篇现在占了多少」的代理指标。
 * 拿不到真 heap（WebKit 没有 per-page 的那个 API），所以别在这儿假装它是。
 *
 * ★ `store.spaceDoc` 上游标了 `@internal`。用它是因为没有公开的等价物，
 *   而监控器只读不写 —— 哪天它改了，这里量不出（`catch` 兜住）也不会影响别的功能。
 */
export function memoryStats(): DocMem[] {
  const out: DocMem[] = []
  for (const [id, store] of stores) {
    let blocks = 0
    let chars = 0
    const walk = (model: BlockModel): void => {
      blocks++
      if (model.text) chars += model.text.length
      for (const child of model.children) walk(child)
    }
    if (store.root) walk(store.root)

    let bytes = 0
    try {
      bytes = Y.encodeStateAsUpdate(store.spaceDoc).byteLength
    } catch {
      // 量不到就算了 —— 监控器不该因为量不到把自己搞崩
    }
    out.push({ id, title: pageTitle(store.getModelsByFlavour('affine:page')[0]), bytes, blocks, chars })
  }
  return out.sort((a, b) => b.bytes - a.bytes)
}

/**
 * 已经登记过的 store 侧 provider（副本）。
 *
 * ★ 为什么要有这个口子：**导入**这类插件需要「和编辑器一模一样的 schema」——
 *   它要把一批块写成 Yjs 字节，schema 少一个 flavour 那个块就写不进去（`Transformer` 直接抛）。
 *   没有这条口子，它只能把这份清单**再拄一份**，两边就会漂（D-0064）。
 */
export function storeExtensionList(): readonly unknown[] {
  return [...storeProviders]
}

/**
 * `ctx.editor.defineBlock(spec, view)` —— 契约里两个参数都是 `unknown`，
 * 这边按「块插件已经把 spec/view 造成 BlockSuite 的 provider 类了」来收：
 * spec 进 store 侧（schema），view 进 view 侧（块视图）。
 *
 * ponytail: 只影响**之后**挂载的编辑器；已经挂着的那个要重挂才看得到新块
 * （BlockStdScope 的 userExtensions 是构造时定死的，没有增量接口）。
 * 想热生效得改成「重挂之后仍然保留滚动位置 + 选区」，Stage 2 再说。
 */
export function defineBlock(spec: unknown, view: unknown): () => void {
  const addedStore = spec === null || spec === undefined ? [] : [spec as StoreProvider]
  const addedView = view === null || view === undefined ? [] : [view as ViewProvider]
  storeProviders.push(...addedStore)
  viewProviders.push(...addedView)
  viewManager = undefined // 新 provider 得进下一轮的 extensions 数组

  return () => {
    drop(storeProviders, addedStore)
    drop(viewProviders, addedView)
    viewManager = undefined
  }
}

function drop<T>(list: T[], removed: T[]) {
  for (const item of removed) {
    const at = list.indexOf(item)
    if (at >= 0) list.splice(at, 1)
  }
}

/* ─────────────────────────── 评论：契约那五个口子（D-0067） ─────────────────────────── */

/** 引擎没挂（没开文档 / 还在装载）时全是空转 —— 评论插件那边按降级处理。 */
export function commentTextSelection() {
  return activeStd ? readTextSelection(activeStd) : null
}

export function commentBlockSelection() {
  return activeStd ? readBlockSelection(activeStd) : null
}

export function addCommentAnchor(id: string, at: CommentTarget): void {
  if (at.kind === 'inline') {
    const store = stores.get(openDocId ?? '')
    if (store) addInlineAnchor(store, at.blockId, id, at.index, at.length)
    // 锚点是直接写 Y.Text 的，不经过编辑器那条落库链 —— 手动喊一声，别赌同步引擎看得到。
    if (openDocId) markDirty(openDocId)
    return
  }
  // 块级 / 页面级的锚点只在库里，正文里不留东西（那个块可能压根没有 text）
}

export function removeCommentAnchor(id: string): void {
  const store = stores.get(openDocId ?? '')
  if (store) removeAnchor(store, id)
  if (openDocId) markDirty(openDocId)
}

export function revealCommentAnchor(id: string): void {
  revealComment(id)
}

export function pushCommentStates(list: readonly CommentState[]): void {
  setCommentStates(list)
}

/* ─────────────────────────── 查找替换 ─────────────────────────── */

/** 一处匹配。`length` 就是查询串的长度（不分大小写的字面匹配）。 */
export interface FindMatch {
  blockId: string
  index: number
  length: number
}

/** 当前打开的文档 id —— 面板靠它认出「切走了」。 */
export function currentDocId(): string | null {
  return openDocId
}

/** 当前文档里所有匹配。只读，不碰正文。 */
export function findMatches(query: string): FindMatch[] {
  const store = stores.get(openDocId ?? '')
  if (!store || query === '') return []
  const needle = query.toLowerCase()
  const out: FindMatch[] = []
  const walk = (model: BlockModel): void => {
    const text = model.text?.toString()
    if (text) {
      const hay = text.toLowerCase()
      let at = hay.indexOf(needle)
      while (at >= 0) {
        out.push({ blockId: model.id, index: at, length: query.length })
        at = hay.indexOf(needle, at + needle.length)
      }
    }
    for (const child of model.children) walk(child)
  }
  if (store.root) walk(store.root)
  return out
}

/** 跳到一处匹配：选中它 + 滚到视野中间（选中就是高亮，不往文档里写标记）。 */
export function focusFindMatch(match: FindMatch): void {
  const std = activeStd
  if (!std) return
  std.view.getBlock(match.blockId)?.scrollIntoView({ block: 'center' })
  std.host.selection.setGroup('note', [
    std.host.selection.create(TextSelection, {
      from: { blockId: match.blockId, index: match.index, length: match.length },
      to: null,
    }),
  ])
}

/** 替换一处。替换之后同一篇里的偏移会变，调用方要重新 `findMatches`。 */
export function replaceFindMatch(match: FindMatch, replacement: string): void {
  const store = stores.get(openDocId ?? '')
  const text = store?.getModelById(match.blockId)?.text
  if (!store || !text) return
  withoutHistory(store, () => {
    text.replace(match.index, match.length, replacement)
  })
  if (openDocId) markDirty(openDocId)
}

/** 全部替换。**从后往前**改 —— 前面的替换不会挪动后面那些匹配的偏移。 */
export function replaceAllFindMatches(query: string, replacement: string): number {
  const found = findMatches(query)
  for (let i = found.length - 1; i >= 0; i--) {
    const match = found[i]
    if (match) replaceFindMatch(match, replacement)
  }
  return found.length
}
