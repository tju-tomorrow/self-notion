/**
 * 块 DSL → 整篇 doc JSON。模型不用懂 ProseMirror 的持久化形状：这里把
 * 「类型 + 文本 + 几个属性」翻成 schema 节点（callout / 折叠 / 公式 / 分栏这些 markdown 表达不了）。
 */
import { Node as PMNode } from 'prosemirror-model'
import { schema } from '../schema'
import { inlineFromMarkdown } from './markdown'

type Spec = Record<string, unknown>

const TYPES =
  'paragraph / heading / quote / callout / codeBlock / equation / divider / ' +
  'bulletedListItem / numberedListItem / todoItem / toggle / table / image / video / audio / file / ' +
  'voiceNote / subpage / syncedBlock / templateButton / columnList / tableOfContents / breadcrumb'

export function docFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) throw new Error('doc_blocks：blocks 必须是数组')
  const built = blocks.map((spec, at) => block(spec, `第 ${at + 1} 个块`))
  if (!built.length) built.push(emptyBlock())
  const group = schema.nodes.blockGroup.create(null, built)
  return JSON.stringify(schema.nodes.doc.create({ title: '' }, group).toJSON())
}

/** 一个 DSL 块 → `blockContainer`。`where` 只用来在报错里说清是哪一块。 */
function block(raw: unknown, where: string): PMNode {
  const spec = record(raw, where)
  const type = str(spec.type)
  const label = `doc_blocks：${where}`

  switch (type) {
    case 'paragraph':
    case 'quote':
    case 'bulletedListItem':
    case 'callout':
    case 'toggle':
    case 'todoItem': {
      const attrs =
        type === 'callout'
          ? { icon: str(spec.icon) }
          : type === 'toggle'
            ? { open: spec.open !== false }
            : type === 'todoItem'
              ? { checked: spec.checked === true }
              : null
      const content = schema.nodes[type].create(attrs, inlineFromMarkdown(str(spec.text)))
      return container(content, children(spec, where), spec)
    }
    case 'numberedListItem': {
      const start = Math.max(1, num(spec.start) ?? 1)
      return container(
        schema.nodes.numberedListItem.create({ start }, inlineFromMarkdown(str(spec.text))),
        children(spec, where),
        spec,
      )
    }
    case 'heading': {
      const level = num(spec.level)
      const content = schema.nodes.heading.create(
        { level: level === 2 || level === 3 ? level : 1 },
        inlineFromMarkdown(str(spec.text)),
      )
      return container(content, children(spec, where), spec)
    }
    case 'codeBlock': {
      const text = str(spec.text)
      return container(
        schema.nodes.codeBlock.create(
          { language: str(spec.language) },
          text ? [schema.text(text)] : [],
        ),
        [],
        spec,
      )
    }
    case 'divider':
      return container(schema.nodes.divider.create(), [], spec)
    case 'equation':
      return container(schema.nodes.equation.create({ tex: str(spec.tex) }), [], spec)
    case 'tableOfContents':
      return container(schema.nodes.tableOfContents.create(), [], spec)
    case 'breadcrumb':
      return container(schema.nodes.breadcrumb.create(), [], spec)
    case 'rawBlock':
      return container(schema.nodes.rawBlock.create({ text: str(spec.text) }), [], spec)
    case 'image': {
      const width = num(spec.width)
      const content = schema.nodes.image.create({
        blobId: str(spec.blobId),
        width: width ?? null,
        caption: str(spec.caption),
        align: str(spec.align),
      })
      return container(content, [], spec)
    }
    case 'video':
    case 'audio':
    case 'file':
      return container(
        schema.nodes[type].create({ blobId: str(spec.blobId), name: str(spec.name) }),
        [],
        spec,
      )
    case 'voiceNote':
      return container(
        schema.nodes.voiceNote.create({
          blobId: str(spec.blobId),
          duration: num(spec.duration) ?? 0,
          transcript: str(spec.transcript),
        }),
        [],
        spec,
      )
    case 'subpage':
      return container(schema.nodes.subpage.create({ docId: str(spec.docId) }), [], spec)
    case 'syncedBlock':
      return container(schema.nodes.syncedBlock.create({ srcId: str(spec.srcId) }), [], spec)
    case 'templateButton':
      return container(
        schema.nodes.templateButton.create({ docId: str(spec.docId), label: str(spec.label) }),
        [],
        spec,
      )
    case 'columnList': {
      const columns = Array.isArray(spec.columns) ? spec.columns : []
      if (!columns.length) throw new Error(`${label}：columnList 缺 columns（几列的块数组）`)
      const nodes = columns.map((column, ci) => {
        if (!Array.isArray(column)) throw new Error(`${label}：columns[${ci}] 不是数组`)
        const kids = column.map((one, i) => block(one, `${where} 的 columns[${ci}][${i}]`))
        return schema.nodes.column.create(null, schema.nodes.blockGroup.create(null, kids.length ? kids : [emptyBlock()]))
      })
      return container(schema.nodes.columnList.create(null, nodes), [], spec)
    }
    case 'table': {
      const rows = Array.isArray(spec.rows) ? spec.rows : []
      const width = Array.isArray(rows[0]) ? rows[0].length : 0
      if (!rows.length || !width) throw new Error(`${label}：table 缺 rows（第一行是表头）`)
      const nodes = rows.map((row, ri) => {
        const cells = Array.isArray(row) ? row.map((cell) => str(cell)) : []
        const padded = [...cells.slice(0, width), ...Array<string>(Math.max(0, width - cells.length)).fill('')]
        return schema.nodes.table_row.create(
          null,
          padded.map((cell) =>
            (ri === 0 ? schema.nodes.table_header : schema.nodes.table_cell).create(
              null,
              schema.nodes.paragraph.create(null, inlineFromMarkdown(cell)),
            ),
          ),
        )
      })
      return container(schema.nodes.table.create(null, nodes), [], spec)
    }
    default:
      throw new Error(`${label}：type ${type ? `「${type}」` : ''}不认识。可用：${TYPES}`)
  }
}

function container(content: PMNode, kids: PMNode[], spec: Spec): PMNode {
  const inner: PMNode[] = [content]
  if (kids.length) inner.push(schema.nodes.blockGroup.create(null, kids))
  return schema.nodes.blockContainer.create(
    { id: blockId(), color: str(spec.color), bg: str(spec.bg) },
    inner,
  )
}

/** `children` 是嵌套块（列表 / 折叠 / 引用下面那一层）。 */
function children(spec: Spec, where: string): PMNode[] {
  if (!Array.isArray(spec.children)) return []
  return spec.children.map((one, i) => block(one, `${where} 的 children[${i}]`))
}

function emptyBlock(): PMNode {
  return schema.nodes.blockContainer.create({ id: blockId() }, schema.nodes.paragraph.create())
}

function record(raw: unknown, where: string): Spec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${where} 不是一个对象`)
  }
  return raw as Spec
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function blockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
