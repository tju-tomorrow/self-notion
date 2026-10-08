/**
 * Notion 的 markdown 快捷输入。
 *
 * ★ 上游那套是**标准 markdown**：`ParagraphMarkdownExtension` 的 pattern 里 `>` + 空格
 *   出**引用**。Notion 不是这么分的 —— `>` + 空格出**折叠块**（`affine:list` 的
 *   `type: 'toggle'`），引用是 `"` + 空格（Notion 帮助文档原话）。
 *   `|` 也认 —— 用户点名要的，比 `"` 好按，也拦不住谁。
 *
 * ★ 为什么必须是一条新 matcher 而不是「改上游」：两个 pattern 抢同一个字符，
 *   而 inline manager 是**先注册先赢**（`rich-text.ts` 里
 *   `for (const match of markdownMatches) { … return true }`，命中就收工）。
 *   所以这条得排在 `ParagraphViewExtension` **前面**注册 —— 顺序在 `editor.ts` 的
 *   `viewProviders` 数组里定，改那一行之前先回头看这段注释。
 */
import {
  ListBlockModel,
  ListBlockSchema,
  ParagraphBlockModel,
  ParagraphBlockSchema,
} from '@blocksuite/affine/model'
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types'
import { matchModels } from '@blocksuite/affine/shared/utils'
import { focusTextModel } from '@blocksuite/affine/rich-text'
import { type ViewExtensionContext, ViewExtensionProvider } from '@blocksuite/affine/ext-loader'
import type { BlockComponent } from '@blocksuite/affine/std'
import { InlineMarkdownExtension } from '@blocksuite/affine/std/inline'

/** `>` + 空格 → 折叠块；`"` / `|` + 空格 → 引用。 */
export const NotionBlockMarkdownExtension = InlineMarkdownExtension<AffineTextAttributes>({
  name: 'self-notion-block',

  // 组 1 是那个字符本身。上游拦的 `\n` 是同一套：只管**本行开头**，正文中间的 `>` 不碰。
  pattern: /^(>|"|\|)\s$/,

  action: ({ inlineEditor, pattern, inlineRange, prefixText }) => {
    if (inlineEditor.yTextString.slice(0, inlineRange.index).includes('\n')) return

    const match = prefixText.match(pattern)
    if (!match) return

    const toggle = match[1] === '>'

    if (!inlineEditor.rootElement) return
    const block = inlineEditor.rootElement.closest<BlockComponent>('[data-block-id]')
    if (!block) return

    const { model, std, store } = block
    const parent = store.getParent(model)
    if (!parent) return

    const index = parent.children.indexOf(model)
    const text = model.text?.clone()
    const children = model.children

    // 已经是目标块：就地换类型，保住子块和光标，别重建。
    if (toggle && matchModels(model, [ListBlockModel])) {
      if (model.props.type === 'toggle') return
      store.captureSync()
      inlineEditor.deleteText({ index: 0, length: inlineRange.index })
      store.updateBlock(model, { type: 'toggle' })
      focusTextModel(std, model.id)
      return
    }
    if (!toggle && matchModels(model, [ParagraphBlockModel])) {
      if (model.props.type === 'quote') return
      store.captureSync()
      inlineEditor.deleteText({ index: 0, length: inlineRange.index })
      store.updateBlock(model, { type: 'quote' })
      focusTextModel(std, model.id)
      return
    }

    // 跨块类型只能重建：`affine:paragraph` 和 `affine:list` 是两套 schema，没有互转命令。
    // 顺序照上游 `ParagraphMarkdownExtension`：先删掉前缀文字，再建新的、删旧的、把光标挪过去。
    store.captureSync()
    inlineEditor.deleteText({ index: 0, length: inlineRange.index })

    if (toggle) {
      const id = store.addBlock<ListBlockModel>(
        ListBlockSchema.model.flavour,
        { type: 'toggle', text, children },
        parent,
        index,
      )
      store.deleteBlock(model, { deleteChildren: false })
      focusTextModel(std, id)
      return
    }

    const id = store.addBlock<ParagraphBlockModel>(
      ParagraphBlockSchema.model.flavour,
      { type: 'quote', text, children },
      parent,
      index,
    )
    store.deleteBlock(model, { deleteChildren: false })
    focusTextModel(std, id)
  },
})

/** 把上面那条挂进 view 侧。**必须排在 `ParagraphViewExtension` 前面**（先注册先赢）。 */
export class NotionShortcutsProvider extends ViewExtensionProvider {
  override name = 'self-notion-notion-shortcuts'

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register([NotionBlockMarkdownExtension])
  }
}
