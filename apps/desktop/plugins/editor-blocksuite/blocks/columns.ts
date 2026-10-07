/**
 * 分栏 —— 上游没有（`affine` 的块清单里没有 column 这类 flavour，我查过）。自己造的，
 * 两个块：`self:column-list`（横向容器）包着若干个 `self:column`（一列）。
 *
 * ★ 为什么是两个块而不是「一个块里存数组」：块树的父子关系、拖拽、复制粘贴、undo
 *   全都按「父子」理解 —— 把列藏进 props 里，这些能力一个都用不上，
 *   还会让文本块没法落在列里（BlockSuite 的块必须有 tree 上的 parent）。
 *
 * ★ 导入对上了 Notion 的形状：`.column-list > .column`。
 *
 * ponytail: 只做到「能显示、能打字、能导入」。**没做**跨列拖拽、列宽拖拽、
 *   在列尾按回车跳出去 —— 这些都要改键盘/拖拽那套，留给下一轮（Notion 有）。
 */
import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
  nanoid,
} from '@blocksuite/affine/store'
import { BlockComponent, BlockViewExtension, TextSelection } from '@blocksuite/affine/std'
import { focusTextModel } from '@blocksuite/affine/rich-text'
import { BlockNotionHtmlAdapterExtension, HastUtils } from '@blocksuite/affine/shared/adapters'
import {
  type StoreExtensionContext,
  StoreExtensionProvider,
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine/ext-loader'
import { LayoutIcon } from '@blocksuite/icons/lit'
import { type SlashMenuConfig, SlashMenuConfigExtension } from '@blocksuite/affine/widgets/slash-menu'
import { css, html } from 'lit'
import { literal } from 'lit/static-html.js'

import { insertColumns } from './insert'

export const COLUMN_LIST_FLAVOUR = 'self:column-list'
export const COLUMN_FLAVOUR = 'self:column'

const ColumnListSchema = defineBlockSchema({
  flavour: COLUMN_LIST_FLAVOUR,
  metadata: {
    version: 1,
    role: 'hub',
    // 正文里能放，列里也能再套一层分栏
    parent: ['affine:note', 'self:column'],
    children: [COLUMN_FLAVOUR],
  },
  toModel: () => new ColumnListBlockModel(),
})

const ColumnSchema = defineBlockSchema({
  flavour: COLUMN_FLAVOUR,
  metadata: {
    version: 1,
    role: 'hub',
    parent: [COLUMN_LIST_FLAVOUR],
    // 列里能放正文里那些块，也能再套一层分栏
    children: ['@content', COLUMN_LIST_FLAVOUR],
  },
  toModel: () => new ColumnBlockModel(),
})

export const ColumnListBlockSchemaExtension = BlockSchemaExtension(ColumnListSchema)
export const ColumnBlockSchemaExtension = BlockSchemaExtension(ColumnSchema)

type Props = Record<string, never>

export class ColumnListBlockModel extends BlockModel<Props> {}
export class ColumnBlockModel extends BlockModel<Props> {}

/** class 要按**词**比 —— `column-list` 里也含 `column`，用 includes 会把容器当成列。 */
const hasClass = (value: unknown, name: string): boolean =>
  String(value ?? '')
    .split(/\s+/)
    .includes(name)

const ColumnListBlockNotionAdapter = BlockNotionHtmlAdapterExtension({
  flavour: COLUMN_LIST_FLAVOUR,
  toMatch: o => HastUtils.isElement(o.node) && hasClass(o.node.properties.className, 'column-list'),
  fromMatch: () => false,
  toBlockSnapshot: {
    // 容器自己没内容，里面的列交给 `.column` 那条 matcher
    enter: (_o, context) => {
      context.walkerContext.openNode(
        {
          type: 'block',
          id: nanoid(),
          flavour: COLUMN_LIST_FLAVOUR,
          props: {},
          children: [],
        },
        'children',
      )
    },
    leave: (_o, context) => {
      context.walkerContext.closeNode()
    },
  },
  fromBlockSnapshot: {},
})

const ColumnBlockNotionAdapter = BlockNotionHtmlAdapterExtension({
  flavour: COLUMN_FLAVOUR,
  toMatch: o => HastUtils.isElement(o.node) && hasClass(o.node.properties.className, 'column'),
  fromMatch: () => false,
  toBlockSnapshot: {
    enter: (_o, context) => {
      context.walkerContext.openNode(
        { type: 'block', id: nanoid(), flavour: COLUMN_FLAVOUR, props: {}, children: [] },
        'children',
      )
    },
    leave: (_o, context) => {
      context.walkerContext.closeNode()
    },
  },
  fromBlockSnapshot: {},
})

export class ColumnStoreExtension extends StoreExtensionProvider {
  override name = 'self-columns'

  override setup(context: StoreExtensionContext) {
    super.setup(context)
    context.register([
      ColumnListBlockSchemaExtension,
      ColumnBlockSchemaExtension,
      ColumnListBlockNotionAdapter,
      ColumnBlockNotionAdapter,
    ])
  }
}

export class ColumnListViewExtension extends ViewExtensionProvider {
  override name = 'self-column-list'

  override effect() {
    super.effect()
    // 插件热重载会再跑一次 effect —— 重名 define 会抛，先问一句。
    if (!customElements.get('self-column-list'))
      customElements.define('self-column-list', ColumnListBlockComponent)
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register([
      BlockViewExtension(COLUMN_LIST_FLAVOUR, literal`self-column-list`),
      // 菜单项挂在**容器**上（用户点的是「分栏」，不是「一列」）
      SlashMenuConfigExtension(COLUMN_LIST_FLAVOUR, slashMenu),
    ])
  }
}

export class ColumnViewExtension extends ViewExtensionProvider {
  override name = 'self-column'

  override effect() {
    super.effect()
    // 插件热重载会再跑一次 effect —— 重名 define 会抛，先问一句。
    if (!customElements.get('self-column')) customElements.define('self-column', ColumnBlockComponent)
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register(BlockViewExtension(COLUMN_FLAVOUR, literal`self-column`))
  }
}

const slashMenu: SlashMenuConfig = {
  items: [
    {
      name: '分栏',
      description: '把内容排成两列；⌥← / ⌥→ 把当前块移到相邻列，末行回车跳出分栏。',
      icon: LayoutIcon(),
      group: '5_Layout@0',
      searchAlias: ['columns', 'column', 'layout', 'fenlan', 'fen lan', 'liang lan'],
      when: ({ model }) => !!model.store.schema.get(COLUMN_LIST_FLAVOUR),
      action: ({ model }) =>
        insertColumns(model, COLUMN_LIST_FLAVOUR, COLUMN_FLAVOUR),
    },
  ],
}

/**
 * 容器是纯布局：`display:flex`，每个列 `flex:1` 平分。
 * 列与列之间一条细线 —— 不分隔的话两块文字看着会连成一段。
 */
const styles = css`
  .cols {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    margin: 4px 0;
  }
  .col {
    flex: 1 1 0;
    min-width: 0;
  }
  .col + .col {
    border-left: 1px solid var(--affine-border-color);
    padding-left: 20px;
  }
  /* 空列得有高度和落点，否则鼠标点不进去、也没法往里打字 */
  .col > * {
    min-width: 0;
  }
`

export class ColumnListBlockComponent extends BlockComponent<ColumnListBlockModel> {
  static override styles = styles

  override renderBlock() {
    return html`<div class="cols">${this.renderChildren(this.model)}</div>`
  }
}

export class ColumnBlockComponent extends BlockComponent<ColumnBlockModel> {
  static override styles = styles

  override connectedCallback() {
    super.connectedCallback()
    this.addEventListener('keydown', this.onKeyDown)
    // 空列是个点不进去的黑洞（`renderChildren` 什么都不画）—— 补一个空段落当落点。
    if (this.store.readonly) return
    if (this.model.children.length) return
    this.store.addBlock('affine:paragraph', {}, this.model)
  }

  override disconnectedCallback() {
    this.removeEventListener('keydown', this.onKeyDown)
    super.disconnectedCallback()
  }

  /**
   * 两块键盘能力（跨列拖拽那两个缺口）：
   *   ⌥←/⌥→   把光标所在的块挪到相邻列
   *   末尾回车  在最后一列的最后一个块末尾回车 → 跳出分栏
   */
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      this.moveToNeighbour(e)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      this.leaveAtEnd(e)
    }
  }

  private moveToNeighbour(e: KeyboardEvent): void {
    const std = this.std
    const sel = std.selection.find(TextSelection)
    if (!sel) return
    const block = this.store.getModelById(sel.start.blockId)
    if (!block) return
    const list = this.store.getParent(this.model)
    if (!list) return
    const at = list.children.indexOf(this.model)
    const target = list.children[e.key === 'ArrowLeft' ? at - 1 : at + 1]
    if (!target) return
    e.preventDefault()
    e.stopPropagation()
    this.store.moveBlocks([block], target, null, false)
    focusTextModel(std, block.id)
  }

  private leaveAtEnd(e: KeyboardEvent): void {
    const std = this.std
    const sel = std.selection.find(TextSelection)
    if (!sel || !sel.isCollapsed()) return
    const list = this.store.getParent(this.model)
    if (!list) return
    // 只在「最后一列的最后一个块的行尾」跳出；中间回车交回上游（在段之间新建）。
    if (list.children[list.children.length - 1] !== this.model) return
    const last = this.lastTextBlock()
    if (!last || last.id !== sel.start.blockId) return
    if (sel.start.index !== (last.text?.length ?? 0)) return
    e.preventDefault()
    e.stopPropagation()
    const [id] = this.store.addSiblingBlocks(list, [{ flavour: 'affine:paragraph' }], 'after')
    if (id) focusTextModel(std, id)
  }

  private lastTextBlock(): BlockModel | undefined {
    let hit: BlockModel | undefined
    const walk = (model: BlockModel): void => {
      if (model.text) hit = model
      for (const child of model.children) walk(child)
    }
    walk(this.model)
    return hit
  }

  override renderBlock() {
    return html`<div class="col">${this.renderChildren(this.model)}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'self-column-list': ColumnListBlockComponent
    'self-column': ColumnBlockComponent
  }
}
