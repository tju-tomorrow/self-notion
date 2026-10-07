/**
 * ⌘V 的调度归我们（D-0125）。
 *
 * 上游那条路是「按优先级挨个 adapter 试」—— 可 `toSlice()` 里**顺手就把块插进文档了**，
 * 返回空就换下一条再插一遍，一次粘贴能出好几份（D-0124 实测：文本 5～6 份、图片 2 份）。
 * 这个文件只换掉「试」这一层：**解析（不碰文档）可以试，插入只发生一次**。
 * HTML → 块、图片落库、撤销记账全用他们现成的，我们一行不重写。
 *
 * 顶掉他们那条靠注册顺序：`std.event` 的 handler **后注册的先跑**，谁返回真值剩下的就不跑
 * （`@blocksuite/std` 的 `event/dispatcher.ts` 里 `if (result) { …; return }` 那句）。
 * 所以本 watcher 必须排在 `RootViewExtension` **后面** —— 顺序在 `editor.ts` 的 `viewProviders`。
 */
import { ViewExtensionProvider, type ViewExtensionContext } from '@blocksuite/affine/ext-loader'
import { deleteTextCommand } from '@blocksuite/affine/inlines/preset'
import {
  clearAndSelectFirstModelCommand,
  deleteSelectedModelsCommand,
  getBlockIndexCommand,
  getBlockSelectionsCommand,
  getImageSelectionsCommand,
  getSelectedModelsCommand,
  getTextSelectionCommand,
  retainFirstModelCommand,
} from '@blocksuite/affine/shared/commands'
import {
  ClipboardAdapterConfigIdentifier,
  LifeCycleWatcher,
  type BlockStdScope,
  type ClipboardAdapterConfig,
  type UIEventHandler,
} from '@blocksuite/affine/std'
import type { Transformer } from '@blocksuite/affine/store'
import { reportError } from '../../src/kernel/errors'

/** 借他们那台 job：中间件（`PasteTr` 的段落合并 / replace-id / upload / 图片落库）是他们的
 *  `PageClipboard` 装上的，我们只借用 —— 自己装一份清单就是抄，早晚跟他们漂。 */
const jobOf = (std: BlockStdScope) =>
  (std.clipboard as unknown as { _getJob(): Transformer })._getJob()

/** 文件归哪条 adapter：通配那条（星号 + 斜杠 + 星号）全收，其余按文件自己的 MIME 对
 *  —— 跟上游同一条判据。 */
const takes = (files: readonly File[], mime: string) =>
  mime === '*/*' || files.every((f) => f.type === mime)

export class SnPasteScheduler extends LifeCycleWatcher {
  static override key = 'sn-paste-scheduler'

  private readonly _onPaste: UIEventHandler = (ctx) => {
    const e = ctx.get('clipboardState').raw
    e.preventDefault()
    // ★ 返回值是真值 = 上游那条 `onPagePaste` 不再执行（见文件头）。
    if (this.std.store.readonly) return true

    this.std.store.captureSync()
    this.std.command
      .chain()
      // 一、先把会被替换掉的那段删掉（跨块文本选区 / 选中的块）—— 同上游那两条命令。
      .try<{}>((cmd) => [
        cmd.pipe(getTextSelectionCommand).pipe((c, next) => {
          const { currentTextSelection } = c
          if (!currentTextSelection) return
          const { from, to } = currentTextSelection
          if (to && from.blockId !== to.blockId) {
            this.std.command.exec(deleteTextCommand, { currentTextSelection })
          }
          return next()
        }),
        cmd
          .pipe(getSelectedModelsCommand)
          .pipe(clearAndSelectFirstModelCommand)
          .pipe(retainFirstModelCommand)
          .pipe(deleteSelectedModelsCommand),
      ])
      // 二、落点：文本 / 块 / 图片选区，谁活着听谁的。
      .try<{ currentSelectionPath: string }>((cmd) => [
        cmd.pipe(getTextSelectionCommand).pipe((c, next) => {
          const sel = c.currentTextSelection
          if (!sel) return
          next({ currentSelectionPath: sel.from.blockId })
        }),
        cmd.pipe(getBlockSelectionsCommand).pipe((c, next) => {
          const last = c.currentBlockSelections?.at(-1)
          if (!last) return
          next({ currentSelectionPath: last.blockId })
        }),
        cmd.pipe(getImageSelectionsCommand).pipe((c, next) => {
          const last = c.currentImageSelections?.at(-1)
          if (!last) return
          next({ currentSelectionPath: last.blockId })
        }),
      ])
      .pipe(getBlockIndexCommand)
      // 三、插。上游这一步调 `std.clipboard.paste()`（那条会重插的循环），换成我们自己的。
      .pipe((c, next) => {
        const parent = c.parentBlock
        if (!parent) return
        void pasteOnce(this.std, e, parent.model.id, c.blockIndex ? c.blockIndex + 1 : 1).catch(
          (err: unknown) => reportError('paste', err),
        )
        return next()
      })
      .run()

    return true
  }

  override mounted(): void {
    this.std.event.add('paste', this._onPaste)
  }
}

/**
 * 剪贴板 → **只插一次**。
 * ① 解析可以试：`toSliceSnapshot()` 不碰文档，解不出来才换下一条 adapter；
 * ② 定下来之后 `snapshotToSlice()` 只调一次 —— 哪怕它的善后钩子抛错，也不再换别人重插。
 */
async function pasteOnce(
  std: BlockStdScope,
  event: ClipboardEvent,
  parent: string,
  index: number,
): Promise<void> {
  const data = event.clipboardData
  if (!data) return
  const doc = std.store
  const job = jobOf(std)
  const files = Array.from(data.files)
  const pick = picker(data, std)
  const adapters: ClipboardAdapterConfig[] = [
    ...std.provider.getAll(ClipboardAdapterConfigIdentifier).values(),
  ].sort((a, b) => b.priority - a.priority)

  for (const config of adapters) {
    const item = pick(config.mimeType)
    if (!item) continue
    if (Array.isArray(item)) {
      if (!takes(files, config.mimeType)) continue
    } else if (files.length && config.mimeType.startsWith('text/')) {
      // 剪贴板里同时有「文件」和一段 HTML（macOS 上一张图就是这样）：只认文件那条 ——
      // HTML 解出来的图指向原始 URL，不进我们的 blob 库。
      continue
    }

    // ★ 先落成变量再传：`workspaceId` / `pageId` 不在 payload 的类型里，但图片和附件那两条
    //   adapter 会读它们（写进自己造的快照）。字面量直传会被「多余属性」检查拦下，变量不会。
    const payload = {
      file: item,
      assets: job.assetsManager,
      workspaceId: doc.workspace.id,
      pageId: doc.id,
    }
    const snapshot = await new config.adapter(job, doc.provider).toSliceSnapshot(payload)
    if (!snapshot) continue

    await job.snapshotToSlice(snapshot, doc, parent, index)
    return
  }
}

/** 那一项从哪儿取：先认我们自己压进 HTML 属性的快照（应用内复制），认不出再按类型取。
 *  ★ 那份压缩包里只有 `BLOCKSUITE/SNAPSHOT` 一个键（纯文本 / HTML / PNG 都不进去），
 *  所以应用内复制永远走快照那条，不会被「有文件就别信 HTML」那条拦掉。 */
function picker(data: DataTransfer, std: BlockStdScope) {
  try {
    const json = std.clipboard.readFromClipboard(data) as Record<string, string>
    return (mime: string): string | File[] | null => json[mime] ?? null
  } catch {
    const files = Array.from(data.files)
    return (mime: string): string | File[] => {
      const text = data.getData(mime)
      if (text) return text
      return files.length ? files : ''
    }
  }
}

/** 挂进 view 侧。**必须排在 `RootViewExtension` 后面** —— 后注册的先跑，我们才有得抢。 */
export class SnPasteProvider extends ViewExtensionProvider {
  override setup(context: ViewExtensionContext) {
    context.register(SnPasteScheduler)
  }
}
