/**
 * markdown 快捷输入（架构 §4.4）—— `prosemirror-inputrules` 的标准用法。
 *
 * 块级清单照旧插件那份（`editor-blocksuite/notion-shortcuts.ts` 的分法）：`>` + 空格是**折叠块**，
 * 引用是 `"` / `|` + 空格。`blockContent` 那一组节点都是 textblock，换类型走 `textblockTypeInputRule`
 * —— 段落变标题 / 列表时，外面的 `blockContainer` 和它的 id 原样不动。
 */
import { InputRule, inputRules, textblockTypeInputRule } from 'prosemirror-inputrules'
import type { MarkType, Node as PMNode, ResolvedPos } from 'prosemirror-model'
import type { Plugin } from 'prosemirror-state'
import { TextSelection } from 'prosemirror-state'

import { schema } from '../schema'

export function inputRulesPlugin(): Plugin {
  return inputRules({ rules: buildRules() })
}

function buildRules(): InputRule[] {
  const n = schema.nodes
  const m = schema.marks
  return [
    // `# ` `## ` `### ` —— Notion 只有三级，多的落 h3（schema 的 clampLevel 兜）。
    textblockTypeInputRule(/^(#{1,3})\s$/, n.heading, (x) => ({ level: x[1].length })),
    textblockTypeInputRule(/^\s*([-*])\s$/, n.bulletedListItem),
    textblockTypeInputRule(/^\s*(\d+)\.\s$/, n.numberedListItem),
    // `[] ` / `[ ] ` 都认（Notion 两种都吃）。
    textblockTypeInputRule(/^\s*\[\s?\]\s$/, n.todoItem),
    textblockTypeInputRule(/^\s*>\s$/, n.toggle, () => ({ open: true })),
    textblockTypeInputRule(/^\s*["|]\s$/, n.quote),
    textblockTypeInputRule(/^```$/, n.codeBlock),
    dividerRule(),
    // 行内：`**x**` / `*x*` / `~~x~~` / `` `x` `` —— 都要求成对闭合，跟「行首 + 空格」的块级规则不打架。
    markRule(/^\*\*([^*]+)\*\*$/, m.bold),
    markRule(/^\*([^*]+)\*$/, m.italic),
    markRule(/^~~([^~]+)~~$/, m.strike),
    markRule(/^`([^`]+)`$/, m.code),
  ]
}

/**
 * `markInputRule` 那套：把两侧的定界符吃掉，给中间那段加 mark。
 * `prosemirror-inputrules` 没导出它（那是 example-setup 里的），照官方算法自己写一条。
 */
function markRule(regexp: RegExp, markType: MarkType): InputRule {
  return new InputRule(regexp, (state, match, start, end) => {
    const inner = match[1]
    if (inner === undefined) return null

    const tr = state.tr
    const textStart = start + match[0].indexOf(inner)
    const textEnd = textStart + inner.length
    if (textEnd < end) tr.delete(textEnd, end)
    if (textStart > start) tr.delete(start, textStart)
    tr.addMark(start, start + inner.length, markType.create())
    tr.removeStoredMark(markType)
    return tr
  })
}

/**
 * `---` → 分割线。
 *
 * ★ `divider` 是**原子**，替换掉原段落之后光标就没了落点 —— 所以顺手补一个空段落块，
 *   不然用户在分隔线那一块里打不了字（`blockContent` 只能有一个孩子，必须另起一块）。
 */
function dividerRule(): InputRule {
  return new InputRule(/^---$/, (state, _match, start) => {
    const $from = state.doc.resolve(start)
    const depth = containerDepth($from)
    if (depth < 0) return null

    const container = $from.node(depth)
    const from = $from.before(depth)
    const to = from + container.nodeSize

    const div = wrapBlock(schema.nodes.divider.create())
    const para = wrapBlock(schema.nodes.paragraph.create())

    const tr = state.tr.replaceWith(from, to, [div, para])
    // 光标落到新段落里（divider 块之后那一块）。
    return tr.setSelection(TextSelection.near(tr.doc.resolve(from + div.nodeSize), 1))
  })
}

/** 光标所在的那一层 `blockContainer`（可能嵌在上一块的 children 里，不一定是第二层）。 */
function containerDepth($from: ResolvedPos): number {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === schema.nodes.blockContainer) return d
  }
  return -1
}

function wrapBlock(content: PMNode): PMNode {
  return schema.nodes.blockContainer.create({ id: blockId() }, content)
}

/** 跟 `editor.ts` 那份同形 —— 那边没导出，跨文件拿不到（架构 §3.1 要唯一 id）。 */
function blockId(): string {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
