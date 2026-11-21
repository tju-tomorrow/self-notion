/**
 * 极简 markdown → React（模型回的那些字）。**不引 markdown 库**（最小依赖），
 * 也**不认 HTML** —— 全靠 React 建节点，没有 `dangerouslySetInnerHTML`，所以不担心注入。
 *
 * 认这些（模型实际会写的就这些）：围栏代码、标题、有序/无序列表（带缩进层次）、
 * 表格（含模型惯用的 ``` 包裹）、引用、分隔线、**加粗**、*斜体*、`行内码`、[链接](url)。
 * 不认的：脚注、数学、HTML —— 要加之前先问一句为什么。
 * 段落里的单个换行当换行（`<br/>`）—— 聊天里它就是换行的意思，按 CommonMark 吞掉反而不对。
 */
import { Fragment, memo, type ReactNode } from 'react'
import * as s from './ai.css'
import type { RagChunk } from './rag'

/** 引用那一组的上下文：编号 → 片段，点一下回原文。 */
export interface CiteCtx {
  chunks: readonly RagChunk[]
  open: (chunk: RagChunk) => void
}

const INLINE = /(\*\*[^*]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\)|\[\d{1,2}\](?!\())/g
const FENCE = /^\s*```/
const HEADING = /^(#{1,6})\s+(.*)$/
const HR = /^\s*(?:[-*_])\s*(?:[-*_])\s*(?:[-*_])[\s\-*_]*$/
const QUOTE = /^\s*>\s?(.*)$/
const ITEM = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function isTableStart(lines: readonly string[], i: number): boolean {
  return (lines[i] ?? '').includes('|') && TABLE_DELIM.test(lines[i + 1] ?? '')
}

interface TableData {
  header: string[]
  rows: string[][]
}

/** 表格从哪行开始、到哪行结束，以及拆开的表头/表体。 */
function parseTable(
  lines: readonly string[],
): (TableData & { start: number; end: number }) | null {
  const start = lines.findIndex((_, i) => isTableStart(lines, i))
  if (start < 0) return null
  const cells = (line: string): string[] => {
    let s = line.trim()
    if (s.startsWith('|')) s = s.slice(1)
    if (s.endsWith('|')) s = s.slice(0, -1)
    return s.split('|').map((c) => c.trim())
  }
  const header = cells(lines[start] ?? '')
  const rows: string[][] = []
  let end = start + 2
  while (end < lines.length) {
    const line = lines[end] ?? ''
    if (!line.trim() || !line.includes('|')) break
    rows.push(cells(line))
    end++
  }
  return { start, end, header, rows }
}

export function looksLikeTable(lines: readonly string[]): boolean {
  return parseTable(lines) !== null
}

/** 整段围栏就是一张表（前后只有空行）才算 —— 带散文的代码块不能吞字。 */
function tableOnly(lines: readonly string[]): TableData | null {
  let start = 0
  let end = lines.length
  while (start < end && !(lines[start] ?? '').trim()) start++
  while (end > start && !(lines[end - 1] ?? '').trim()) end--
  const body = lines.slice(start, end)
  const table = parseTable(body)
  return table && table.start === 0 && table.end === body.length ? table : null
}

/**
 * 模型常把表格包进 ``` 里。剪贴板是 Markdown，包着粘进笔记就成代码块了；
 * 表格围栏拆掉，粘贴时编辑器才会按表格块解析。
 */
export function unfenceTables(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE.test(lines[i] ?? '')) {
      out.push(lines[i] ?? '')
      continue
    }
    let end = i + 1
    while (end < lines.length && !FENCE.test(lines[end] ?? '')) end++
    const body = lines.slice(i + 1, end)
    if (looksLikeTable(body)) out.push(...body.map((line) => line.replace(/^\s{1,3}/, '')))
    else out.push(...lines.slice(i, end + 1))
    i = end
  }
  return out.join('\n')
}

export const Markdown = memo(function Markdown({
  text,
  cite,
}: {
  text: string
  cite?: CiteCtx
}): ReactNode {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      i++
      continue
    }

    if (FENCE.test(line)) {
      const code: string[] = []
      i++
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '')
        i++
      }
      i++ // 收尾那道围栏
      const table = tableOnly(code)
      blocks.push(
        table ? (
          <Table key={blocks.length} table={table} cite={cite} />
        ) : (
          <pre key={blocks.length} className={s.mdPre}>
            <code>{code.join('\n')}</code>
          </pre>
        ),
      )
      continue
    }

    if (isTableStart(lines, i)) {
      const table = parseTable(lines.slice(i))
      if (table) {
        blocks.push(<Table key={blocks.length} table={table} cite={cite} />)
        i += table.end
        continue
      }
    }

    const head = HEADING.exec(line)
    if (head) {
      // 六级标题一律一个尺寸：聊天里没人靠字号分辨 3 级还是 4 级。
      blocks.push(
        <h3 key={blocks.length} className={s.mdH}>
          {inline(head[2] ?? '', cite)}
        </h3>,
      )
      i++
      continue
    }

    if (HR.test(line)) {
      blocks.push(<hr key={blocks.length} className={s.mdHr} />)
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const quote: string[] = []
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i] ?? '')
        if (!m) break
        quote.push(m[1] ?? '')
        i++
      }
      blocks.push(
        <blockquote key={blocks.length} className={s.mdQuote}>
          <Markdown text={quote.join('\n')} cite={cite} />
        </blockquote>,
      )
      continue
    }

    if (ITEM.test(line)) {
      const ordered = ITEM.exec(line)?.[3] !== undefined
      const items: { depth: number; text: string }[] = []
      while (i < lines.length) {
        const m = ITEM.exec(lines[i] ?? '')
        if (!m) break
        items.push({ depth: Math.floor((m[1]?.length ?? 0) / 2), text: m[4] ?? '' })
        i++
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List key={blocks.length} className={ordered ? s.mdOl : s.mdUl}>
          {items.map((item, n) => (
            // 层次靠缩进推 —— 不套嵌套列表，省一层标签
            <li key={n} className={s.mdLi} style={{ marginLeft: item.depth * 16 }}>
              {inline(item.text, cite)}
            </li>
          ))}
        </List>,
      )
      continue
    }

    // 段落：收到空行（或碰到下一块的结构）为止。
    const para: string[] = []
    while (i < lines.length) {
      const next = lines[i] ?? ''
      if (
        next.trim() === '' ||
        FENCE.test(next) ||
        HEADING.test(next) ||
        ITEM.test(next) ||
        QUOTE.test(next) ||
        isTableStart(lines, i)
      ) {
        break
      }
      para.push(next)
      i++
    }
    blocks.push(
      <p key={blocks.length} className={s.mdP}>
        {para.map((one, n) => (
          <Fragment key={n}>
            {n > 0 ? <br /> : null}
            {inline(one, cite)}
          </Fragment>
        ))}
      </p>,
    )
  }

  return blocks
})

/** 表格：单元格里仍然走同一套行内规则（加粗、行内码、引用角标都能用）。 */
function Table({ table, cite }: { table: TableData; cite?: CiteCtx }) {
  const width = table.header.length
  return (
    <div className={s.mdTableWrap}>
      <table className={s.mdTable}>
        <thead>
          <tr>
            {table.header.map((cell, n) => (
              <th key={n} className={s.mdTh}>
                {inline(cell, cite)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {Array.from({ length: width }, (_, n) => (
                <td key={n} className={s.mdTd}>
                  {inline(row[n] ?? '', cite)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 行内那一层：加粗、行内码、斜体、链接、引用角标。**不认转义** —— 模型回的字里没有这种需求。 */
function inline(text: string, cite?: CiteCtx): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  const re = new RegExp(INLINE.source, 'g')
  let m = re.exec(text)
  while (m) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const token = m[0]
    const key = out.length
    if (token.startsWith('**')) out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`'))
      out.push(
        <code key={key} className={s.mdCode}>
          {token.slice(1, -1)}
        </code>,
      )
    else if (/^\[\d{1,2}\]$/.test(token)) {
      const n = Number(token.slice(1, -1))
      const chunk = cite?.chunks.find((one) => one.n === n)
      if (chunk && cite) {
        out.push(
          <button
            key={key}
            type="button"
            className={s.cite}
            title={`${n} · ${chunk.title}\n${chunk.text.slice(0, 120)}`}
            aria-label={`${n} · ${chunk.title}`}
            onClick={() => cite.open(chunk)}
          >
            {n}
          </button>,
        )
      } else out.push(token)
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      out.push(
        <a key={key} className={s.mdLink} href={link?.[2] ?? '#'} target="_blank" rel="noreferrer">
          {link?.[1] ?? token}
        </a>,
      )
    } else out.push(<em key={key}>{token.slice(1, -1)}</em>)
    last = m.index + token.length
    m = re.exec(text)
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
