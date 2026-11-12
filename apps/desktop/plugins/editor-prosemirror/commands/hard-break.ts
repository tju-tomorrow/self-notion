/** Shift+Enter：块内换行。代码块里就是换行符，别的块插 `hardBreak` 节点。 */
import type { Command } from 'prosemirror-state'

import { schema } from '../schema'

export const hardBreak: Command = (state, dispatch) => {
  const { $from } = state.selection
  if (!$from.parent.isTextblock) return false
  if (dispatch) {
    if ($from.parent.type.spec.code) dispatch(state.tr.insertText('\n'))
    else dispatch(state.tr.replaceSelectionWith(schema.nodes.hardBreak.create()).scrollIntoView())
  }
  return true
}
