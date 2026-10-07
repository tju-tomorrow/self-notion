/**
 * 面包屑块 —— 上游没有（自己造的）。
 *
 * ★ 它的内容**不在文档里**：祖先是谁，住在库里的 `documents.parent_id`。
 *   所以块自己不存 props，挂载时问一句 `shell.trail(docId)`，渲染成「祖页 / 父页 / 本页」。
 *   点前面的跳过去，本页不点（已经在看了）。
 *
 * ponytail: 只在自己挂载时取一次。上游改了标题/拖动了层级要重开这篇才刷新 ——
 *   要实时就得把 `DOCS_CHANGED` 也接进来（块不知道外面的 ctx，得再开一根线）。
 */
import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
  nanoid,
} from '@blocksuite/affine/store'
import { BlockComponent, BlockViewExtension } from '@blocksuite/affine/std'
import { BlockNotionHtmlAdapterExtension, HastUtils } from '@blocksuite/affine/shared/adapters'
import {
  type StoreExtensionContext,
  StoreExtensionProvider,
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine/ext-loader'
import { RightLayoutIcon } from '@blocksuite/icons/lit'
import {
  type SlashMenuConfig,
  SlashMenuConfigExtension,
} from '@blocksuite/affine/widgets/slash-menu'
import { css, html } from 'lit'
import { literal } from 'lit/static-html.js'

import { insertAfter } from './insert'
import { shell } from '../shell'

export const BREADCRUMB_FLAVOUR = 'self:breadcrumb'

const BreadcrumbSchema = defineBlockSchema({
  flavour: BREADCRUMB_FLAVOUR,
  metadata: {
    version: 1,
    role: 'content',
    parent: ['affine:note', 'self:column'],
    children: [],
  },
  toModel: () => new BreadcrumbBlockModel(),
})

export const BreadcrumbBlockSchemaExtension = BlockSchemaExtension(BreadcrumbSchema)

type Props = Record<string, never>

export class BreadcrumbBlockModel extends BlockModel<Props> {}

const BreadcrumbBlockNotionAdapter = BlockNotionHtmlAdapterExtension({
  flavour: BREADCRUMB_FLAVOUR,
  // Notion 里那个面包屑块导出成 `<div class="breadcrumb">` 或 `<nav class="breadcrumbs">`
  toMatch: o =>
    HastUtils.isElement(o.node) &&
    /(^|\s)breadcrumbs?(\s|$)/.test(String(o.node.properties.className ?? '')),
  fromMatch: () => false,
  toBlockSnapshot: {
    enter: (_o, context) => {
      // 祖先路径是运行时问库的，Notion 那份链接地址没用 —— 空着。
      context.walkerContext
        .openNode(
          {
            type: 'block',
            id: nanoid(),
            flavour: BREADCRUMB_FLAVOUR,
            props: {},
            children: [],
          },
          'children',
        )
        .closeNode()
      context.walkerContext.skipAllChildren()
    },
  },
  fromBlockSnapshot: {},
})

export class BreadcrumbStoreExtension extends StoreExtensionProvider {
  override name = 'self-breadcrumb'

  override setup(context: StoreExtensionContext) {
    super.setup(context)
    context.register([BreadcrumbBlockSchemaExtension, BreadcrumbBlockNotionAdapter])
  }
}

const slashMenu: SlashMenuConfig = {
  items: [
    {
      name: '面包屑',
      description: '显示这篇文档的路径（祖页 / 父页 / 本页），点了可以跳过去。',
      icon: RightLayoutIcon(),
      group: '4_Content & Media@21',
      searchAlias: ['breadcrumb', 'path', 'mianbaoxie', 'mian bao xie', 'lujing'],
      when: ({ model }) => !!model.store.schema.get(BREADCRUMB_FLAVOUR),
      action: ({ model }) => insertAfter(model, BREADCRUMB_FLAVOUR),
    },
  ],
}

const styles = css`
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--affine-text-secondary-color);
  }
  .crumbs a {
    color: var(--affine-text-secondary-color);
    text-decoration: none;
    cursor: pointer;
  }
  .crumbs a:hover {
    color: var(--affine-text-primary-color);
    text-decoration: underline;
  }
  .crumbs .me {
    color: var(--affine-text-primary-color);
  }
  .crumbs .sep {
    opacity: 0.5;
  }
`

export class BreadcrumbBlockComponent extends BlockComponent<BreadcrumbBlockModel> {
  static override styles = styles

  private trail: { id: string; title: string }[] = []

  override connectedCallback() {
    super.connectedCallback()
    this.contentEditable = 'false'
    const docId = this.store.id
    void shell
      ?.trail(docId)
      .then(items => {
        // 取回来的路上这篇可能已经被卸掉了 —— 别往死掉的元素上写。
        if (!this.isConnected) return
        this.trail = items
        this.requestUpdate()
      })
      .catch(() => {
        // 拿不到就当没有祖先，不是错（库这会儿要是查不动，别把编辑器带崩）
      })
  }

  override renderBlock() {
    if (!this.trail.length) return html`<div class="crumbs"></div>`
    return html`<div class="crumbs">
      ${this.trail.map((item, index) => {
        const last = index === this.trail.length - 1
        return html`${index ? html`<span class="sep">/</span>` : null}${last
            ? html`<span class="me">${item.title || '未命名'}</span>`
            : html`<a @click=${() => shell?.openDoc(item.id)}>${item.title || '未命名'}</a>`}`
      })}
    </div>`
  }

  accessor useZeroWidth = true
}

export class BreadcrumbViewExtension extends ViewExtensionProvider {
  override name = 'self-breadcrumb'

  override effect() {
    super.effect()
    // 插件热重载会再跑一次 effect —— 重名 define 会抛，先问一句。
    if (!customElements.get('self-breadcrumb')) customElements.define('self-breadcrumb', BreadcrumbBlockComponent)
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register([
      BlockViewExtension(BREADCRUMB_FLAVOUR, literal`self-breadcrumb`),
      SlashMenuConfigExtension(BREADCRUMB_FLAVOUR, slashMenu),
    ])
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'self-breadcrumb': BreadcrumbBlockComponent
  }
}
