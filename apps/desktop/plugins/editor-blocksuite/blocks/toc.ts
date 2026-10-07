/**
 * 目录块 —— 上游**没有**这个块（我查过 0.22.4 的块清单：没有 breadcrumb / column / outline），
 * 所以这一份是我们自己造的。
 *
 * 它不存内容：每次渲染现读本文的标题（h1–h6 就是 type 为 h1…h6 的段落块），
 * 所以改了标题、加了标题，目录自己就变了 —— 跟 Notion 那个目录块一个脾气。
 */
import { TocIcon } from '@blocksuite/icons/lit'
import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
  nanoid,
} from '@blocksuite/affine/store'
import { BlockComponent, BlockSelection, BlockViewExtension } from '@blocksuite/affine/std'
import { BlockNotionHtmlAdapterExtension, HastUtils } from '@blocksuite/affine/shared/adapters'
import {
  type StoreExtensionContext,
  StoreExtensionProvider,
  type ViewExtensionContext,
  ViewExtensionProvider,
} from '@blocksuite/affine/ext-loader'
import { type SlashMenuConfig, SlashMenuConfigExtension } from '@blocksuite/affine/widgets/slash-menu'
import { css, html } from 'lit'
import { literal } from 'lit/static-html.js'

import { insertAfter } from './insert'

export const TOC_FLAVOUR = 'self:toc'

const TOCSchema = defineBlockSchema({
  flavour: TOC_FLAVOUR,
  metadata: {
    version: 1,
    role: 'content',
    // 能待在正文里，也能待在分栏的列里
    parent: ['affine:note', 'self:column'],
    children: [],
  },
  toModel: () => new TOCBlockModel(),
})

export const TOCBlockSchemaExtension = BlockSchemaExtension(TOCSchema)

type Props = Record<string, never>

export class TOCBlockModel extends BlockModel<Props> {}

/** Notion 导出的目录块：`<div class="table_of_contents">` 里一串指向块 id 的锚点。 */
const TOCBlockNotionAdapter = BlockNotionHtmlAdapterExtension({
  flavour: TOC_FLAVOUR,
  // 只认 class，不认标签：Notion 老版本是 div、新版本是 nav
  toMatch: o =>
    HastUtils.isElement(o.node) &&
    String(o.node.properties.className ?? '').includes('table_of_contents'),
  fromMatch: () => false,
  toBlockSnapshot: {
    enter: (_o, context) => {
      // 那串锚点指的全是 Notion 自己的块 id，搬过来全是死链 —— 空着让块自己重建。
      context.walkerContext
        .openNode(
          { type: 'block', id: nanoid(), flavour: TOC_FLAVOUR, props: {}, children: [] },
          'children',
        )
        .closeNode()
      context.walkerContext.skipAllChildren()
    },
  },
  fromBlockSnapshot: {},
})

export class TOCStoreExtension extends StoreExtensionProvider {
  override name = 'self-toc'

  override setup(context: StoreExtensionContext) {
    super.setup(context)
    context.register([TOCBlockSchemaExtension, TOCBlockNotionAdapter])
  }
}

/**
 * 斜杠菜单里那一项。菜单只按 `name` + `searchAlias` 做模糊匹配，
 * 所以中文名 + 中英关键词都得给（不然打 `/toc` 跟「目录」一个字都对不上）。
 */
const slashMenu: SlashMenuConfig = {
  items: [
    {
      name: '目录',
      description: '按本文的标题自动生成目录，点了跳过去。',
      icon: TocIcon(),
      group: '4_Content & Media@20',
      searchAlias: ['toc', 'table of contents', 'outline', 'mulu', 'mu lu', 'mulu'],
      when: ({ model }) => !!model.store.schema.get(TOC_FLAVOUR),
      action: ({ model }) => insertAfter(model, TOC_FLAVOUR),
    },
  ],
}

const styles = css`
  .toc {
    padding: 4px 0;
    font-size: 14px;
    line-height: 1.9;
    color: var(--affine-text-secondary-color);
  }
  .toc p {
    margin: 0;
  }
  .toc a {
    color: var(--affine-text-primary-color);
    text-decoration: none;
    cursor: pointer;
  }
  .toc a:hover {
    color: var(--affine-link-color, #1e96eb);
    text-decoration: underline;
  }
  .toc .empty {
    color: var(--affine-text-disable-color);
  }
`

export class TOCBlockComponent extends BlockComponent<TOCBlockModel> {
  static override styles = styles

  private off?: { unsubscribe(): void }

  override connectedCallback() {
    super.connectedCallback()
    this.contentEditable = 'false'
    // 本文的块一变（加标题、改标题）就重画 —— 目录块自己不存东西。
    this.off = this.store.slots.blockUpdated.subscribe(() => this.requestUpdate())
  }

  override disconnectedCallback() {
    super.disconnectedCallback()
    this.off?.unsubscribe()
    this.off = undefined
  }

  /** 按文档顺序收标题。深度优先，跟正文里看的顺序一致。 */
  private headings(): { id: string; text: string; level: number }[] {
    const out: { id: string; text: string; level: number }[] = []
    const root = this.store.root
    if (!root) return out
    const walk = (block: BlockModel): void => {
      if (block.flavour === 'affine:paragraph') {
        const type = String((block.props as { type?: unknown }).type ?? '')
        if (/^h[1-6]$/.test(type)) {
          out.push({ id: block.id, text: block.text?.toString() ?? '', level: Number(type[1]) })
        }
      }
      for (const child of block.children) walk(child)
    }
    walk(root)
    return out
  }

  private jump(blockId: string) {
    this.std.view.getBlock(blockId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    this.host.selection.setGroup('note', [
      this.host.selection.create(BlockSelection, { blockId }),
    ])
  }

  override renderBlock() {
    const items = this.headings()
    if (!items.length) {
      return html`<div class="toc"><p class="empty">（本文还没有标题）</p></div>`
    }
    return html`<div class="toc">
      ${items.map(
        item => html`<p style="padding-left: ${(item.level - 1) * 16}px">
          <a @click=${() => this.jump(item.id)}>${item.text || '（无标题）'}</a>
        </p>`,
      )}
    </div>`
  }

  accessor useZeroWidth = true
}

export class TOCViewExtension extends ViewExtensionProvider {
  override name = 'self-toc'

  override effect() {
    super.effect()
    // 插件热重载会再跑一次 effect —— 重名 define 会抛，先问一句。
    if (!customElements.get('self-toc')) customElements.define('self-toc', TOCBlockComponent)
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register([
      BlockViewExtension(TOC_FLAVOUR, literal`self-toc`),
      SlashMenuConfigExtension(TOC_FLAVOUR, slashMenu),
    ])
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'self-toc': TOCBlockComponent
  }
}
