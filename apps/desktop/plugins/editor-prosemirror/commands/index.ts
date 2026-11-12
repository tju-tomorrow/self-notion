/**
 * Notion 那套编辑命令（架构 §4.5）。挂的时候**必须排在 baseKeymap 前面** ——
 * 认不出的键返回 false，自然落到 baseKeymap（方向键 / 选删 / 代码块换行那些）。
 *
 * ★ 新建块一律走 `newBlockId()`：PM 默认拆块会把 `blockContainer` 拆成两个、复制同一个 id，
 *   而 id 是持久化格式的一部分（架构 §3.1），重复了评论锚点和拖拽定位就全错。
 */
import { toggleMark } from 'prosemirror-commands'
import type { Command } from 'prosemirror-state'
import { isInTable } from 'prosemirror-tables'

import { schema } from '../schema'
import { backspace } from './backspace'
import { toggleBlock } from './convert'
import { duplicateBlock } from './duplicate'
import { enter } from './enter'
import { hardBreak } from './hard-break'
import { indent, outdent } from './indent'
import { moveBlockDown, moveBlockUp } from './move-block'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  mergeCells,
  nextCell,
  prevCell,
  splitCell,
} from './table'

/** ⌘⇧S 在表格里是拆分单元格，别处是删除线（Notion 的删除线就在这个键上）。 */
const strikeOrSplit: Command = (state, dispatch) =>
  isInTable(state) ? splitCell(state, dispatch) : toggleMark(schema.marks.strike)(state, dispatch)

export const notionKeymap: Record<string, Command> = {
  Enter: enter,
  Backspace: backspace,
  'Shift-Enter': hardBreak,
  // Tab：表格里是「下一格 / 上一格」，表格外落回缩进 —— 分派在 `nextCell` / `prevCell` 里。
  Tab: nextCell,
  'Shift-Tab': prevCell,
  'Mod-Shift-ArrowUp': moveBlockUp,
  'Mod-Shift-ArrowDown': moveBlockDown,
  'Mod-d': duplicateBlock,
  // 行内格式（Notion 同款键位）。
  'Mod-b': toggleMark(schema.marks.bold),
  'Mod-i': toggleMark(schema.marks.italic),
  'Mod-u': toggleMark(schema.marks.underline),
  'Mod-e': toggleMark(schema.marks.code),
  'Mod-Shift-s': strikeOrSplit,
  // 切列表类型（⌘⇧7 有序 / 8 无序 / 9 待办）。
  'Mod-Shift-7': toggleBlock(schema.nodes.numberedListItem),
  'Mod-Shift-8': toggleBlock(schema.nodes.bulletedListItem),
  'Mod-Shift-9': toggleBlock(schema.nodes.todoItem, { checked: false }),
  // 表格结构（增删行列 / 合并拆分）：不在表格里一律 false，绑在全局也不误伤正文。
  'Mod-Enter': addRowAfter,
  'Mod-Shift-Enter': addRowBefore,
  'Mod-Alt-Enter': addColumnAfter,
  'Mod-Alt-Shift-Enter': addColumnBefore,
  'Mod-Shift-Backspace': deleteRow,
  'Mod-Alt-Backspace': deleteColumn,
  'Mod-Shift-m': mergeCells,
}

export { newBlockId } from './id'
export { backspace, enter, indent, outdent, moveBlockDown, moveBlockUp }
