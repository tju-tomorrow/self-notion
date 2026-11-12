/** 光标停在空段落里时给一句「输入 / 唤起菜单」的灰字（Notion 那条）。装饰不写进文档。 */
import { Plugin, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const HINT = '输入 “/” 唤起菜单'

export function blockHintPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const sel = state.selection
        if (!(sel instanceof TextSelection) || !sel.empty) return DecorationSet.empty
        const $pos = sel.$from
        let depth = -1
        for (let d = $pos.depth; d > 0; d -= 1) {
          if ($pos.node(d).type.name === 'blockContainer') {
            depth = d
            break
          }
        }
        if (depth < 0) return DecorationSet.empty
        const content = $pos.node(depth).firstChild
        if (!content || content.type.name !== 'paragraph' || content.content.size > 0) {
          return DecorationSet.empty
        }
        const at = $pos.before(depth) + 1
        return DecorationSet.create(state.doc, [
          Decoration.node(at, at + content.nodeSize, { class: 'sn-block-hint', 'data-hint': HINT }),
        ])
      },
    },
  })
}
