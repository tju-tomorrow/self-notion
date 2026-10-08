/**
 * Notion 那套编辑命令（架构 §4.5）。挂的时候**必须排在 baseKeymap 前面** ——
 * 认不出的键返回 false，自然落到 baseKeymap（方向键 / 选删 / 代码块换行那些）。
 *
 * ★ 新建块一律走 `newBlockId()`：PM 默认拆块会把 `blockContainer` 拆成两个、复制同一个 id，
 *   而 id 是持久化格式的一部分（架构 §3.1），重复了评论锚点和拖拽定位就全错。
 */
import type { Command } from 'prosemirror-state'

import { backspace } from './backspace'
import { enter } from './enter'
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

export const notionKeymap: Record<string, Command> = {
  Enter: enter,
  Backspace: backspace,
  // Tab：表格里是「下一格 / 上一格」，表格外落回缩进 —— 分派在 `nextCell` / `prevCell` 里。
  Tab: nextCell,
  'Shift-Tab': prevCell,
  'Mod-Shift-ArrowUp': moveBlockUp,
  'Mod-Shift-ArrowDown': moveBlockDown,
  // 表格结构（增删行列 / 合并拆分）：不在表格里一律 false，绑在全局也不误伤正文。
  'Mod-Enter': addRowAfter,
  'Mod-Shift-Enter': addRowBefore,
  'Mod-Alt-Enter': addColumnAfter,
  'Mod-Alt-Shift-Enter': addColumnBefore,
  'Mod-Shift-Backspace': deleteRow,
  'Mod-Alt-Backspace': deleteColumn,
  'Mod-Shift-m': mergeCells,
  'Mod-Shift-s': splitCell,
}

export { newBlockId } from './id'
export { backspace, enter, indent, outdent, moveBlockDown, moveBlockUp }
