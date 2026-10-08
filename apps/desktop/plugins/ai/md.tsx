/**
 * 极简 markdown → React（模型回的那些字）。**不引 markdown 库**（最小依赖），
 * 也**不认 HTML** —— 全靠 React 建节点，没有 `dangerouslySetInnerHTML`，所以不担心注入。
 *
 * 认这些（模型实际会写的就这些）：围栏代码、标题、有序/无序列表（带缩进层次）、
 * 引用、分隔线、**加粗**、*斜体*、`行内码`、[链接](url)。
 * 不认的：表格、脚注、数学、HTML —— 要加之前先问一句为什么。
 * 段落里的单个换行当换行（`<br/>`）—— 聊天里它就是换行的意思，按 CommonMark 吞掉反而不对。
 */
import { Fragment, memo, type ReactNode } from 'react'
import * as s from './ai.css'

const INLINE = /(\*\*[^*]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\))/g
const FENCE = /^\s*```/
const HEADING = /^(#{1,6})\s+(.*)$/
const HR = /^\s*(?:[-*_])\s*(?:[-*_])\s*(?:[-*_])[\s\-*_]*$/
const QUOTE = /^\s*>\s?(.*)$/
const ITEM = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/

export const Markdown = memo(function Markdown({ text }: { text: string }): ReactNode {
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
      blocks.push(
        <pre key={blocks.length} className={s.mdPre}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const head = HEADING.exec(line)
    if (head) {
      // 六级标题一律一个尺寸：聊天里没人靠字号分辨 3 级还是 4 级。
      blocks.push(
        <h3 key={blocks.length} className={s.mdH}>
          {inline(head[2] ?? '')}
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
          <Markdown text={quote.join('\n')} />
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
              {inline(item.text)}
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
      if (next.trim() === '' || FENCE.test(next) || HEADING.test(next) || ITEM.test(next) || QUOTE.test(next)) {
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
            {inline(one)}
          </Fragment>
        ))}
      </p>,
    )
  }

  return blocks
})

/** 行内那一层：加粗、行内码、斜体、链接。**不认转义** —— 模型回的字里没有这种需求。 */
function inline(text: string): ReactNode[] {
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
    else if (token.startsWith('[')) {
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
