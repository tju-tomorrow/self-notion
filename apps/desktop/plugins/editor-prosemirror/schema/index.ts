/**
 * schema 全量（P1-0）—— 照 `docs/editor-architecture.md` §2.2 那张表。
 *
 *   doc ─ blockGroup ─ blockContainer(id) ─ blockContent | blockGroup?
 *
 * ★ 节点名与 attrs 是**持久化格式**，冻在架构文档里，不许改名（契约 `schema()` 那条注释）。
 * ★ 需要**交互**的那几个（todoItem 的勾选框、toggle 的折叠箭头、image 的实际渲染、列表标记）
 *   这里只给基础 DOM —— 真正的 NodeView 是 P1-1。toDOM 够 PM 摆出占位形状即可。
 */
import { Schema, type DOMOutputSpec, type MarkSpec, type Node as PMNode, type NodeSpec } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'

/** blockContent 组的节点 —— 一个块的「内容类型」，共用一个 group 好按类找（架构 §2.2）。 */
const content = (spec: NodeSpec): NodeSpec => ({ group: 'blockContent', ...spec })

/** 字节走 blob（`self-notion://blob/<id>`）；URL 现算，JSON 里只存 blobId（+ 显示名 name）。 */
const BLOB_PREFIX = 'self-notion://blob/'

/** video / audio / file 三个媒体块只有一处不同：宿主标签。`a` 那个把显示名当文字，其余是空元素。 */
function mediaNode(tag: 'video' | 'audio' | 'a', cls: string): NodeSpec {
  const srcAttr = tag === 'a' ? 'href' : 'src'
  return {
    atom: true,
    attrs: { blobId: { default: '' }, name: { default: '' } },
    parseDOM: [
      {
        tag: `${tag}[${srcAttr}^="${BLOB_PREFIX}"]`,
        getAttrs: (el) => {
          const src = (el as HTMLElement).getAttribute(srcAttr) ?? ''
          return { blobId: src.slice(BLOB_PREFIX.length), name: (el as HTMLElement).dataset.name ?? '' }
        },
      },
    ],
    toDOM: (node): DOMOutputSpec => {
      const attrs = { [srcAttr]: BLOB_PREFIX + String(node.attrs.blobId ?? ''), class: cls, 'data-name': node.attrs.name }
      return tag === 'a' ? ['a', attrs, String(node.attrs.name ?? '') || 'file'] : [tag, attrs]
    },
  }
}

/* ─────────────────────── 表格（P3，D-0135）：官方 prosemirror-tables，只补 `sn-*` 类名 ─────────────────────── */
// 节点名（table / table_row / table_cell / table_header）与 colspan / rowspan / colwidth 是**持久化格式**，一个都不许改。
const tableSpecs = tableNodes({ tableGroup: 'blockContent', cellContent: 'blockContent+', cellAttributes: {} })

/** 官方 toDOM 不带我们的类名 —— 只在它的 DOM 规格上补一个 class；attrs（colspan…）与 parseDOM 原样不动。 */
function snClass(spec: NodeSpec, cls: string): NodeSpec {
  const base = spec.toDOM as (node: PMNode) => DOMOutputSpec
  return {
    ...spec,
    toDOM(node) {
      const out = base(node) as unknown as unknown[]
      const head = out[1]
      const attrs = head !== null && typeof head === 'object' && !Array.isArray(head)
      return [out[0], { ...(attrs ? (head as Record<string, unknown>) : {}), class: cls }, ...out.slice(attrs ? 2 : 1)] as unknown as DOMOutputSpec
    },
  }
}

const nodes: Record<string, NodeSpec> = {
  // 标题是 doc 的 attr、不进 block 树（架构 §3.3）—— 所以根节点带 attrs，落库跟正文一起走。
  // `icon` 是 emoji（落库时同步到 Rust 的 documents.icon，侧栏要显示）；`cover` 只在文档页显示，不进 Rust。
  doc: {
    content: 'blockGroup',
    attrs: { title: { default: '' }, icon: { default: '' }, cover: { default: '' } },
    toDOM: () => ['div', 0],
  },

  // 容器：文档根和每个块的 children 都是它。`sn-group` 只是个 DOM 类名（**不进 JSON**，
  // 不碰持久化格式）—— 缩进样式挂它身上：嵌进它里面的块整体右移，而不是给子块再加一层 padding。
  blockGroup: {
    content: 'blockContainer+',
    group: 'childContainer',
    // 跨文档复制来的块要能反解回这一层（`toDOM` 那个 class 就是给它的）。
    parseDOM: [{ tag: 'div.sn-group' }],
    toDOM: () => ['div', { class: 'sn-group' }, 0],
  },

  // 一个块 = blockContainer。`id` 是持久化格式的一部分（评论锚点 / 拖拽 / 落库对齐都靠它，架构 §3.1）。
  // ★ `default: ''` 不是随手加的：PM ≥1.25 的 generatable 判据（`checkForDeadEnds`）要求
  //   `blockGroup` 的 `blockContainer+` 这个必需位能被「可生成」的节点填上，而**带必需 attrs 的节点不可生成**
  //   —— 写成 §2.2 字面的 `attrs: { id: {} }` 时 `new Schema()` 直接抛
  //   "Only non-generatable nodes (blockContainer) in a required position"。attr 的**名字/key 没变**，
  //   持久化形状照旧；只是少了「必需」这条，PM 才肯在填位时造一个空 id 的块。
  blockContainer: {
    content: 'blockContent blockGroup?',
    group: 'blockNode',
    defining: true,
    attrs: { id: { default: '' } },
    // 反解这一层（跨文档贴块）；id 读回来**只是形状**，换新归粘贴那一侧（`plugins/paste.ts` 的
    // `transformPasted`）—— 这里保持纯映射，同一个 HTML 解两次得同一份，schema 不该有身份副作用。
    parseDOM: [
      { tag: 'div.sn-block', getAttrs: (el) => ({ id: (el as HTMLElement).dataset.id ?? '' }) },
    ],
    // 命中靠 data-id 兜底，不靠 posAtDOM 猜（架构 §4.1）。
    toDOM: (node) => ['div', { class: 'sn-block', 'data-id': node.attrs.id }, 0],
  },

  paragraph: content(
    {
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    }),
  heading: content(
    {
      content: 'inline*',
      attrs: { level: { default: 1 } },
      // Notion 只有 h1-h3；markdown 的 h4-h6 落到 h3（少一层总比丢掉整个块强）。
      parseDOM: [
        { tag: 'h1', attrs: { level: 1 } },
        { tag: 'h2', attrs: { level: 2 } },
        { tag: 'h3', attrs: { level: 3 } },
        { tag: 'h4', attrs: { level: 3 } },
        { tag: 'h5', attrs: { level: 3 } },
        { tag: 'h6', attrs: { level: 3 } },
      ],
      toDOM: (node) => [`h${clampLevel(node.attrs.level as number)}`, 0],
    }),
  bulletedListItem: content(
    {
      content: 'inline*',
      parseDOM: [{ tag: 'div.sn-bulleted' }, { tag: 'ul > li' }],
      // 标记（`•`）由 P1-1 的 NodeView 画，这里只给容器。
      toDOM: () => ['div', { class: 'sn-bulleted' }, 0],
    }),
  numberedListItem: content(
    {
      content: 'inline*',
      parseDOM: [{ tag: 'div.sn-numbered' }, { tag: 'ol > li' }],
      toDOM: () => ['div', { class: 'sn-numbered' }, 0],
    }),
  todoItem: content(
    {
      content: 'inline*',
      attrs: { checked: { default: false } },
      parseDOM: [
        { tag: 'div.sn-todo', getAttrs: (el) => ({ checked: (el as HTMLElement).dataset.checked === 'true' }) },
        { tag: 'li[data-checked]', getAttrs: (el) => ({ checked: (el as HTMLElement).dataset.checked === 'true' }) },
      ],
      toDOM: (node) => ['div', { class: 'sn-todo', 'data-checked': String(node.attrs.checked) }, 0],
    }),
  toggle: content(
    {
      content: 'inline*',
      // 折叠态**落库**，是属性不是 UI 状态（notion-parity §1）—— 箭头归 P1-1 的 NodeView。
      attrs: { open: { default: true } },
      parseDOM: [
        { tag: 'div.sn-toggle', getAttrs: (el) => ({ open: (el as HTMLElement).dataset.open !== 'false' }) },
      ],
      toDOM: (node) => ['div', { class: 'sn-toggle', 'data-open': String(node.attrs.open) }, 0],
    }),
  quote: content(
    {
      content: 'inline*',
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: () => ['blockquote', 0],
    }),
  codeBlock: content(
    {
      content: 'text*',
      attrs: { language: { default: '' } },
      // `code: true` 让 PM 知道这里不解析标记 / 输入规则（D-0014 要保留语言高亮，语言存在 attrs）。
      code: true,
      defining: true,
      parseDOM: [
        {
          tag: 'pre',
          preserveWhitespace: 'full',
          getAttrs: (el) => ({ language: (el as HTMLElement).dataset.language ?? '' }),
        },
      ],
      toDOM: (node) => ['pre', { class: 'sn-code', 'data-language': node.attrs.language }, ['code', 0]],
    }),
  divider: content(
    {
      atom: true,
      parseDOM: [{ tag: 'hr' }],
      toDOM: () => ['hr'],
    }),
  image: content(
    {
      atom: true,
      // 持久化就是 `blobId`（+ 可选 width）—— 字节走 `self-notion://blob/<id>`，URL 是现算的，不进 JSON。
      attrs: { blobId: { default: '' }, width: { default: null } },
      parseDOM: [
        {
          tag: 'img[src^="self-notion://blob/"]',
          getAttrs: (el) => {
            const src = (el as HTMLImageElement).getAttribute('src') ?? ''
            const width = (el as HTMLImageElement).getAttribute('width')
            return { blobId: src.slice('self-notion://blob/'.length), width: width ? Number(width) : null }
          },
        },
      ],
      toDOM: (node) => {
        const attrs: Record<string, string> = { src: `self-notion://blob/${node.attrs.blobId}` }
        if (typeof node.attrs.width === 'number') attrs.width = String(node.attrs.width)
        return ['img', attrs]
      },
    }),
  callout: content(
    {
      content: 'inline*',
      attrs: { icon: { default: '' } },
      parseDOM: [
        { tag: 'div.sn-callout', getAttrs: (el) => ({ icon: (el as HTMLElement).dataset.icon ?? '' }) },
      ],
      toDOM: (node) => ['div', { class: 'sn-callout', 'data-icon': node.attrs.icon }, 0],
    }),
  /* ─────────────────────────── P2 增补（架构 §2.2.1）─────────────────────────── */

  // 分栏容器。Notion 至少两列，所以是 `column column+`。它本身是 blockContent（一个块）。
  columnList: content(
    {
      content: 'column column+',
      parseDOM: [{ tag: 'div.sn-columns' }],
      toDOM: () => ['div', { class: 'sn-columns' }, 0],
    }),
  // 一列。里面是 blockGroup（结构与文档根一致）——**不是** blockContainer+，别抄错（架构 §2.2.1）。
  column: {
    content: 'blockGroup',
    parseDOM: [{ tag: 'div.sn-column' }],
    toDOM: () => ['div', { class: 'sn-column' }, 0],
  },
  // 子页面卡片。atom：没有 content，字节（标题 / 图标）是现读的；docId 是出链来源之一。
  subpage: content(
    {
      atom: true,
      // `docId` 空串是合法默认（编辑器补：新建子页面时回填）。
      attrs: { docId: { default: '' } },
      parseDOM: [
        { tag: 'div.sn-subpage', getAttrs: (el) => ({ docId: (el as HTMLElement).dataset.docId ?? '' }) },
      ],
      toDOM: (node) => ['div', { class: 'sn-subpage', 'data-doc-id': node.attrs.docId }],
    }),
  // 同步块（P3-4 / D-0136）：**引用式** —— 节点只存一个 `srcId`，内容在源里只有一份。
  // 别按「复制一份内容」想它：多处引用同一个 id，任意一处改的都是那一份，所以不用 CRDT 也对得上。
  syncedBlock: content(
    {
      atom: true,
      // `srcId` 空串是合法默认（编辑器补：斜杠菜单建完源回填，跟 subpage 同一套两拍）。
      attrs: { srcId: { default: '' } },
      parseDOM: [
        { tag: 'div.sn-synced', getAttrs: (el) => ({ srcId: (el as HTMLElement).dataset.srcId ?? '' }) },
      ],
      toDOM: (node) => ['div', { class: 'sn-synced', 'data-src-id': node.attrs.srcId }],
    }),
  // 模板按钮（P3-5 / D-0136）：模板就是一篇普通文档，节点只存指过去的 `docId`（+ 可选 `label`）。
  // 点它 = 把那篇的块**拷一份**插进来 —— 跟 syncedBlock 正相反：这里是复制，不是引用。
  templateButton: content(
    {
      atom: true,
      // 两个都空串是合法默认（斜杠菜单先插空节点，选完模板再回填）。
      attrs: { docId: { default: '' }, label: { default: '' } },
      parseDOM: [
        {
          tag: 'div.sn-template',
          getAttrs: (el) => {
            const t = el as HTMLElement
            return { docId: t.dataset.docId ?? '', label: t.dataset.label ?? '' }
          },
        },
      ],
      toDOM: (node) => [
        'div',
        { class: 'sn-template', 'data-doc-id': node.attrs.docId, 'data-label': node.attrs.label },
      ],
    }),
  // 块级公式。`tex` 只在 attrs 里 —— **绝不往 text 里补控制符**（D-0127 那把火烧在这里）。
  equation: content(
    {
      atom: true,
      attrs: { tex: { default: '' } },
      parseDOM: [
        { tag: 'div.sn-equation', getAttrs: (el) => ({ tex: (el as HTMLElement).dataset.tex ?? '' }) },
      ],
      toDOM: (node) => ['div', { class: 'sn-equation', 'data-tex': node.attrs.tex }],
    }),
  // 目录 / 面包屑：内容现算（目录扫 block 树，面包屑从库里 parent_id 数上去），不落库 —— 所以也是 atom。
  tableOfContents: content(
    {
      atom: true,
      parseDOM: [{ tag: 'div.sn-toc' }],
      toDOM: () => ['div', { class: 'sn-toc' }],
    }),
  breadcrumb: content(
    {
      atom: true,
      parseDOM: [{ tag: 'div.sn-breadcrumb' }],
      toDOM: () => ['div', { class: 'sn-breadcrumb' }],
    }),
  // 外部文件模式下「我们看不懂的整块」（frontmatter / markdown 表格 / 块级 HTML）—— 原文照抄（D-0142，架构 §2.2.2）。
  // ★ 只在 `file:` 那条路上出现，**不落库**：块树是从磁盘现解析的，`doc` / `doc_text` 里不会有这个名字。
  // ★ atom + 无 content = 只读（能删、能整块移动，改不了）；原文就在 attr 里。
  rawBlock: content(
    {
      atom: true,
      attrs: { text: { default: '' } },
      parseDOM: [{ tag: 'div.sn-raw', getAttrs: (el) => ({ text: (el as HTMLElement).textContent ?? '' }) }],
      toDOM: (node) => ['div', { class: 'sn-raw' }, ['pre', String(node.attrs.text ?? '')]],
    }),
  // 媒体 / 附件：字节走 blob（`self-notion://blob/<id>`），JSON 里只存 blobId（+ 显示名）。
  video: content(mediaNode('video', 'sn-video')),
  audio: content(mediaNode('audio', 'sn-audio')),
  file: content(mediaNode('a', 'sn-file')),

  /* ─────────────────────────── P3 表格（D-0135）─────────────────────────── */

  // 普通块类型：`blockContainer > table`。单元格里是 `blockContent+`（普通块，**不**套 blockContainer）。
  table: snClass(tableSpecs.table, 'sn-table'),
  table_row: snClass(tableSpecs.table_row, 'sn-table-row'),
  table_cell: snClass(tableSpecs.table_cell, 'sn-table-cell'),
  // 表头格跟普通格共用一套样式，多一个 sn-table-header 供以后区分。
  table_header: snClass(tableSpecs.table_header, 'sn-table-cell sn-table-header'),

  /* ─────────────────────────── 行内（group 'inline'）─────────────────────────── */

  // @提及。inline atom：一个 docId，出链来源之一（DocLink.kind = 'mention'）。
  mention: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { docId: { default: '' } },
    parseDOM: [
      { tag: 'span.sn-mention', getAttrs: (el) => ({ docId: (el as HTMLElement).dataset.docId ?? '' }) },
    ],
    toDOM: (node) => ['span', { class: 'sn-mention', 'data-doc-id': node.attrs.docId }, node.attrs.docId || '@'],
  },
  // 行内公式。同块级那条：tex 在 attrs 里，text 干净。
  inlineEquation: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { tex: { default: '' } },
    parseDOM: [
      {
        tag: 'span.sn-inline-equation',
        getAttrs: (el) => ({ tex: (el as HTMLElement).dataset.tex ?? '' }),
      },
    ],
    toDOM: (node) => ['span', { class: 'sn-inline-equation', 'data-tex': node.attrs.tex }],
  },

  text: { group: 'inline' },
}

/** 架构 §2.2 只认 1|2|3 —— 落库形状里 level 只有这三个值。 */
function clampLevel(level: unknown): 1 | 2 | 3 {
  return level === 2 || level === 3 ? level : 1
}

const marks: Record<string, MarkSpec> = {
  bold: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
    toDOM: () => ['strong', 0],
  },
  italic: {
    parseDOM: [{ tag: 'em' }, { tag: 'i' }],
    toDOM: () => ['em', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
    toDOM: () => ['s', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
  link: {
    attrs: { href: { default: '' } },
    inclusive: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (el) => ({ href: (el as HTMLAnchorElement).getAttribute('href') ?? '' }),
      },
    ],
    toDOM: (mark) => ['a', { href: mark.attrs.href, rel: 'noopener noreferrer', target: '_blank' }, 0],
  },
  highlight: {
    attrs: { color: { default: '' } },
    parseDOM: [
      { tag: 'mark', getAttrs: (el) => ({ color: (el as HTMLElement).dataset.color ?? '' }) },
      // style 规则拿到的是**样式值**本身（不是元素）
      { style: 'background-color', getAttrs: (value) => ({ color: String(value) }) },
    ],
    // `data-color` 留着（插件内复制粘贴靠它回读）；`--sn-hl` 是给 CSS 读的 ——
    // 选择器读不了属性**值**，颜色只能从自定义属性递进去（`editor.css.ts` 那条）。
    toDOM: (mark) => {
      const color = String(mark.attrs.color ?? '')
      return color
        ? ['mark', { 'data-color': color, style: `--sn-hl:${color}` }, 0]
        : ['mark', { 'data-color': '' }, 0]
    },
  },
  textColor: {
    attrs: { color: { default: '' } },
    parseDOM: [{ style: 'color', getAttrs: (value) => ({ color: String(value) }) }],
    toDOM: (mark) => ['span', { style: `color:${String(mark.attrs.color)}` }, 0],
  },
  // 评论锚点（P3，架构 §3.2）—— **不是**高亮：高亮由 decoration 画，这个 mark 只挂 id。
  // id 拼成一个列表（`ids`）而不是一个 id 一个 mark：PM 同一 mark 类型在同一位置互相排斥
  // （`MarkType.excluded` 默认含自己），一条文字被两条评论锚住时单 id 存不下（docs/comment.md §三）。
  comment: {
    attrs: { ids: { default: '' } },
    // 贴着评论末尾打字不该把新字吞进锚点里（跟 link 同一条理由）。
    inclusive: false,
    parseDOM: [{ tag: 'span.sn-comment', getAttrs: (el) => ({ ids: (el as HTMLElement).dataset.ids ?? '' }) }],
    toDOM: (mark) => ['span', { class: 'sn-comment', 'data-ids': mark.attrs.ids }, 0],
  },
}

export const schema = new Schema({ nodes, marks })
