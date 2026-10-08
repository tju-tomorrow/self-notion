/**
 * 表格（P3，D-0135）—— 逻辑全在官方 `prosemirror-tables`，这里只做接线。
 *
 * ★ 接线顺序（重要）：这个插件要排在 `notionKeymap` **之前**。tableEditing 在表格里接管
 *   方向键与 Backspace（删单元格选区），排在后面的话 Notion 那套 backspace 会先吃掉这些键。
 * ★ Tab / Shift-Tab（下一格 / 上一格）**不在** tableEditing 里 —— 那是 `commands/table.ts` 的
 *   `nextCell` / `prevCell`，绑在 notionKeymap 上；表格外 goToNextCell 返回 false，自然落回缩进。
 */
import type { Node as PMNode } from 'prosemirror-model'
import type { Plugin } from 'prosemirror-state'
import { tableEditing } from 'prosemirror-tables'

import { schema } from '../schema'
import './table.css'

export function tablePlugin(): Plugin {
  return tableEditing()
}

/** 3×3 空表的行 —— 每格一个空段落（cellContent 是 `blockContent+`，空单元格建不出来）。 */
export function emptyTableRows(rows = 3, cols = 3): readonly PMNode[] {
  const cell = () => schema.nodes.table_cell.create(null, [schema.nodes.paragraph.create()])
  const row = () => schema.nodes.table_row.create(null, Array.from({ length: cols }, cell))
  return Array.from({ length: rows }, row)
}
