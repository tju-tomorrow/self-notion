/**
 * 抽正文里的出链（架构 §7 · D-0085）—— 喂 `DocHandle.links`，Rust 拿它重建这篇的出链图谱。
 *
 * 只有两个来源：`subpage`（块级子页面卡片）和 `mention`（行内 @提及）。都是 `docId` 一条边。
 * `docId` 还是空串的（引用没写完）**不算一条边** —— 别往图里塞空节点。
 */
import type { Node as PMNode } from 'prosemirror-model'

import type { DocLink } from '../../../src/kernel/contract'
import { asString } from '../nodes/attrs'

export function docLinks(doc: PMNode): DocLink[] {
  const out: DocLink[] = []
  doc.descendants((node) => {
    const name = node.type.name
    if (name !== 'subpage' && name !== 'mention') return true
    const toId = asString(node.attrs.docId)
    if (toId) out.push({ toId, kind: name })
    return true
  })
  return out
}
