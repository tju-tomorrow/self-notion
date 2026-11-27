/**
 * 从正文现算一棵结构树（D-0220）。
 * 只留短标题和位置，正文留在文档里，展开时再去读。
 */
import type { Node as PMNode } from 'prosemirror-model'

export type Kind =
  | 'doc'
  | 'section'
  | 'prose'
  | 'paragraph'
  | 'list'
  | 'item'
  | 'todo'
  | 'quote'
  | 'callout'
  | 'toggle'
  | 'code'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'table'
  | 'equation'
  | 'columns'
  | 'subpage'
  | 'synced'
  | 'template'
  | 'drawio'
  | 'voice'
  | 'raw'
  | 'block'

export type Payload = 'none' | 'text' | 'code' | 'image' | 'video' | 'audio' | 'table' | 'tex' | 'raw'

export interface MapNode {
  kind: Kind
  label: string
  meta: string
  pos: number
  end: number
  own: number
  weight: number
  children: MapNode[]
  payload: Payload
  ref: string
  checked: boolean
}

interface Raw {
  content: PMNode
  pos: number
  kids: PMNode | null
  kidsPos: number
}

const LIST = new Set(['bulletedListItem', 'numberedListItem', 'todoItem'])
const SKIP = new Set(['divider', 'tableOfContents', 'breadcrumb'])

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/** 取到第一个句号为止，卡片上只放一句。 */
function clause(s: string, max: number): string {
  const t = clean(s)
  if (!t) return ''
  const cut = t.search(/[。！？!?；;]/)
  return clip(cut >= 6 ? t.slice(0, cut) : t, max)
}

function preview(n: PMNode, max: number): string {
  let s = ''
  n.descendants(ch => {
    if (s.length >= max) return false
    const room = max - s.length
    if (ch.isText && ch.text) s += ch.text.length > room ? ch.text.slice(0, room) : ch.text
    else if (ch.type.name === 'hardBreak') s += ' '
    else if (ch.type.name === 'inlineEquation' || ch.type.name === 'equation') {
      const tex = String(ch.attrs.tex ?? '')
      s += tex.length > room ? tex.slice(0, room) : tex
    } else if (ch.type.name === 'mention') s += '@'
    return s.length < max
  })
  return s
}

function textSize(n: PMNode): number {
  let s = 0
  n.descendants(ch => {
    if (ch.isText) s += ch.text?.length ?? 0
  })
  return s
}

function make(part: Omit<MapNode, 'weight'>): MapNode {
  return { weight: 0, ...part }
}

function weigh(n: MapNode): number {
  let w = n.own
  for (const c of n.children) w += weigh(c)
  n.weight = w
  return w
}

/** 外面只包了一层「列表 / 正文 / 分栏」时拆掉，少点一次。 */
function flatten(children: MapNode[]): MapNode[] {
  if (
    children.length === 1 &&
    (children[0].kind === 'list' || children[0].kind === 'prose' || children[0].kind === 'columns')
  ) {
    return children[0].children
  }
  return children
}

function levelOf(n: PMNode): number {
  const level = Number(n.attrs.level)
  return level === 2 || level === 3 ? level : 1
}

/** `groupPos` 是 blockGroup 前面那个位置，和 `nodeAt` 对齐。 */
function blocksOf(group: PMNode, groupPos: number): Raw[] {
  const out: Raw[] = []
  let pos = groupPos + 1
  for (let i = 0; i < group.childCount; i += 1) {
    const box = group.child(i)
    const content = box.firstChild
    if (!content || box.type.name !== 'blockContainer' || content.type.name === 'blockGroup') {
      pos += box.nodeSize
      continue
    }
    const contentPos = pos + 1
    const second = box.childCount > 1 ? box.child(1) : null
    const kids = second && second.type.name === 'blockGroup' ? second : null
    out.push({
      content,
      pos: contentPos,
      kids,
      kidsPos: contentPos + content.nodeSize,
    })
    pos += box.nodeSize
  }
  return out
}

function textBlock(raw: Raw, depth: number, kind: Kind, fallback: string): MapNode | null {
  const nested = raw.kids ? parseSequence(blocksOf(raw.kids, raw.kidsPos), depth + 1) : []
  const children = flatten(nested)
  const text = clean(preview(raw.content, 160))
  if (!text && children.length === 0) return null
  const icon = kind === 'callout' ? String(raw.content.attrs.icon ?? '').trim() : ''
  const label = [icon, clause(text, 42)].filter(Boolean).join(' ') || fallback
  return make({
    kind,
    label,
    meta: '',
    pos: raw.pos,
    end: raw.pos + raw.content.nodeSize,
    own: textSize(raw.content),
    children,
    payload: text ? 'text' : 'none',
    ref: '',
    checked: false,
  })
}

function itemNode(raw: Raw, name: string, indexLabel: string, depth: number): MapNode {
  const nested = raw.kids ? parseSequence(blocksOf(raw.kids, raw.kidsPos), depth + 1) : []
  const text = clean(preview(raw.content, 160))
  const checked = raw.content.attrs.checked === true
  const fallback = name === 'todoItem' ? '待办' : '（空）'
  return make({
    kind: name === 'todoItem' ? 'todo' : 'item',
    label: clause(text, 42) || fallback,
    meta: indexLabel || (checked ? '✓' : ''),
    pos: raw.pos,
    end: raw.pos + raw.content.nodeSize,
    own: textSize(raw.content),
    children: flatten(nested),
    payload: text ? 'text' : 'none',
    ref: '',
    checked,
  })
}

function listNode(name: string, items: MapNode[]): MapNode {
  const n = items.length
  let label = `${n} 条`
  if (name === 'todoItem') {
    const done = items.filter(item => item.checked).length
    label = `待办 ${done}/${n}`
  } else if (name === 'numberedListItem') label = `${n} 步`
  return make({
    kind: 'list',
    label,
    meta: '',
    pos: items[0].pos,
    end: items[n - 1].end,
    own: 0,
    children: items,
    payload: 'none',
    ref: '',
    checked: false,
  })
}

function proseNode(items: MapNode[]): MapNode {
  return make({
    kind: 'prose',
    label: `${items.length} 段正文`,
    meta: '',
    pos: items[0].pos,
    end: items[items.length - 1].end,
    own: 0,
    children: items,
    payload: 'none',
    ref: '',
    checked: false,
  })
}

function formatDur(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function tableShape(table: PMNode): { rows: number; cols: number } {
  let rows = 0
  let cols = 0
  table.forEach(row => {
    if (row.type.name !== 'table_row') return
    rows += 1
    if (row.childCount > cols) cols = row.childCount
  })
  return { rows, cols }
}

function walkColumns(list: PMNode, listPos: number, depth: number): MapNode[] {
  const out: MapNode[] = []
  let pos = listPos + 1
  for (let i = 0; i < list.childCount; i += 1) {
    const col = list.child(i)
    const group = col.firstChild
    const groupPos = pos + 1
    const inner =
      group && group.type.name === 'blockGroup'
        ? flatten(parseSequence(blocksOf(group, groupPos), depth + 1))
        : []
    out.push(
      make({
        kind: 'section',
        label: `栏 ${i + 1}`,
        meta: '',
        pos: groupPos,
        end: pos + col.nodeSize,
        own: 0,
        children: inner,
        payload: 'none',
        ref: '',
        checked: false,
      }),
    )
    pos += col.nodeSize
  }
  return out
}

function blockFrom(raw: Raw, depth: number): MapNode | null {
  const made = buildBlock(raw, depth)
  if (!made || made.children.length > 0 || !raw.kids) return made
  const children = flatten(parseSequence(blocksOf(raw.kids, raw.kidsPos), depth + 1))
  return children.length === 0 ? made : { ...made, children }
}

function buildBlock(raw: Raw, depth: number): MapNode | null {
  const name = raw.content.type.name
  const at = (label: string, kind: Kind, payload: Payload, extra?: Partial<Omit<MapNode, 'weight'>>): MapNode =>
    make({
      kind,
      label,
      meta: '',
      pos: raw.pos,
      end: raw.pos + raw.content.nodeSize,
      own: textSize(raw.content),
      children: [],
      payload,
      ref: '',
      checked: false,
      ...extra,
    })

  switch (name) {
    case 'paragraph':
      return textBlock(raw, depth, 'paragraph', '段落')
    case 'quote':
      return textBlock(raw, depth, 'quote', '引用')
    case 'callout':
      return textBlock(raw, depth, 'callout', '标注')
    case 'toggle':
      return textBlock(raw, depth, 'toggle', '折叠')
    case 'codeBlock': {
      const lang = String(raw.content.attrs.language ?? '').trim()
      const line = preview(raw.content, 80)
        .split('\n')
        .map(s => s.trim())
        .find(Boolean)
      return at(clip(clean(line ?? ''), 42) || lang || '代码', 'code', 'code', { meta: lang || '代码', own: textSize(raw.content) })
    }
    case 'image': {
      const caption = clean(String(raw.content.attrs.caption ?? ''))
      return at(clip(caption, 42) || '图片', 'image', 'image', {
        meta: '图',
        own: 1,
        ref: String(raw.content.attrs.blobId ?? ''),
        children: [],
      })
    }
    case 'video':
    case 'audio':
    case 'file': {
      const kind = name === 'video' ? 'video' : name === 'audio' ? 'audio' : 'file'
      const payload: Payload = kind === 'file' ? 'none' : kind
      const fallback = kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '文件'
      return at(clip(clean(String(raw.content.attrs.name ?? '')), 42) || fallback, kind, payload, {
        meta: fallback,
        own: 1,
        ref: String(raw.content.attrs.blobId ?? ''),
        children: [],
      })
    }
    case 'table': {
      const { rows, cols } = tableShape(raw.content)
      return at(rows === 0 ? '空表' : `表 ${rows}×${cols}`, 'table', rows === 0 ? 'none' : 'table', {
        own: textSize(raw.content),
        children: [],
      })
    }
    case 'equation': {
      const tex = String(raw.content.attrs.tex ?? '')
      return at(clip(clean(tex), 42) || '公式', 'equation', tex.trim() ? 'tex' : 'none', {
        meta: '公式',
        own: tex.length,
        children: [],
      })
    }
    case 'columnList': {
      const cols = walkColumns(raw.content, raw.pos, depth)
      return at(`${Math.max(cols.length, 1)} 栏`, 'columns', 'none', { own: 0, children: cols })
    }
    case 'subpage':
      return at('子页面', 'subpage', 'none', { own: 1, children: [] })
    case 'syncedBlock':
      return at('同步块', 'synced', 'none', { own: 1, children: [] })
    case 'templateButton': {
      const custom = clean(String(raw.content.attrs.label ?? ''))
      return at(clip(custom, 42) || '模板', 'template', 'none', { own: 1, children: [] })
    }
    case 'drawio':
      return at('图', 'drawio', 'none', { own: 1, children: [] })
    case 'voiceNote': {
      const transcript = String(raw.content.attrs.transcript ?? '')
      const sec = Number(raw.content.attrs.duration) || 0
      return at(clause(transcript, 42) || '语音', 'voice', transcript.trim() ? 'text' : 'none', {
        meta: sec > 0 ? formatDur(sec) : '',
        own: transcript.length,
        ref: String(raw.content.attrs.blobId ?? ''),
        children: [],
      })
    }
    case 'rawBlock': {
      const text = String(raw.content.attrs.text ?? '')
      const first = text.slice(0, 80).split('\n').find(line => line.trim()) ?? ''
      return at(clip(clean(first), 42) || '原文', 'raw', text.trim() ? 'raw' : 'none', {
        own: text.length,
        children: [],
      })
    }
    default: {
      const text = clean(preview(raw.content, 80))
      const children = raw.kids ? flatten(parseSequence(blocksOf(raw.kids, raw.kidsPos), depth + 1)) : []
      return at(clause(text, 42) || name, 'block', text ? 'text' : 'none', {
        children,
        own: text ? textSize(raw.content) : 0,
      })
    }
  }
}

function groupBodies(blocks: Raw[], depth: number): MapNode[] {
  const out: MapNode[] = []
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]
    const name = b.content.type.name
    if (SKIP.has(name)) {
      i += 1
      continue
    }
    if (LIST.has(name)) {
      const run = [b]
      i += 1
      while (i < blocks.length && blocks[i].content.type.name === name) {
        run.push(blocks[i])
        i += 1
      }
      let num = 1
      const items = run.map((raw, k) => {
        if (k === 0 && name === 'numberedListItem') num = Number(raw.content.attrs.start) || 1
        const indexLabel = name === 'numberedListItem' ? String(num) : ''
        if (name === 'numberedListItem') num += 1
        return itemNode(raw, name, indexLabel, depth)
      })
      out.push(items.length === 1 ? items[0] : listNode(name, items))
      continue
    }
    // 连着的纯段落收成一块，免得一节下面铺开几十张卡片。
    if (name === 'paragraph' && !b.kids) {
      const run = [b]
      i += 1
      while (i < blocks.length && blocks[i].content.type.name === 'paragraph' && !blocks[i].kids) {
        run.push(blocks[i])
        i += 1
      }
      const paras: MapNode[] = []
      for (const raw of run) {
        const para = textBlock(raw, depth, 'paragraph', '段落')
        if (para) paras.push(para)
      }
      if (paras.length >= 3) out.push(proseNode(paras))
      else out.push(...paras)
      continue
    }
    const one = blockFrom(b, depth)
    if (one) out.push(one)
    i += 1
  }
  return out
}

function makeSection(raw: Raw, children: MapNode[]): MapNode {
  const label = clip(clean(preview(raw.content, 120)), 80)
  return make({
    kind: 'section',
    label: label || '空标题',
    meta: '',
    pos: raw.pos,
    end: raw.pos + raw.content.nodeSize,
    own: textSize(raw.content),
    children: flatten(children),
    payload: 'none',
    ref: '',
    checked: false,
  })
}

function preamble(blocks: Raw[], children: MapNode[]): MapNode {
  const last = blocks[blocks.length - 1]
  return make({
    kind: 'section',
    label: '引言',
    meta: '',
    pos: blocks[0].pos,
    end: last.pos + last.content.nodeSize,
    own: 0,
    children: flatten(children),
    payload: 'none',
    ref: '',
    checked: false,
  })
}

function parseSequence(blocks: Raw[], depth: number): MapNode[] {
  if (depth > 32 || blocks.length === 0) return []
  const out: MapNode[] = []
  let i = 0
  const head: Raw[] = []
  while (i < blocks.length && blocks[i].content.type.name !== 'heading') {
    head.push(blocks[i])
    i += 1
  }
  if (head.length > 0) {
    const grouped = groupBodies(head, depth)
    if (grouped.length > 0) {
      if (i < blocks.length) out.push(preamble(head, grouped))
      else out.push(...grouped)
    }
  }
  while (i < blocks.length) {
    const heading = blocks[i]
    const level = levelOf(heading.content)
    i += 1
    const body: Raw[] = []
    while (i < blocks.length) {
      const next = blocks[i]
      if (next.content.type.name === 'heading' && levelOf(next.content) <= level) break
      body.push(next)
      i += 1
    }
    const nested = heading.kids ? parseSequence(blocksOf(heading.kids, heading.kidsPos), depth + 1) : []
    const after = parseSequence(body, depth + 1)
    out.push(makeSection(heading, [...nested, ...after]))
  }
  return out
}

export function structureOf(doc: PMNode, title: string): MapNode {
  const group = doc.firstChild
  const children =
    group && group.type.name === 'blockGroup' ? flatten(parseSequence(blocksOf(group, 0), 0)) : []
  const root = make({
    kind: 'doc',
    label: clean(title) || '无标题',
    meta: '',
    pos: 0,
    end: doc.content.size,
    own: 0,
    children,
    payload: 'none',
    ref: '',
    checked: false,
  })
  weigh(root)
  return root
}
