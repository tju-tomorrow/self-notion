/**
 * 有序列表的序号。序号只数前面**紧挨着**的有序项（跟 markdown 序列化那边同一条），
 * 中间夹一个段落就归零 —— 所以不能交给 CSS counter（它不会断）。
 */
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

export function listNumberPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decos: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.isLeaf || node.isTextblock) return false
          let run = 0
          node.forEach((child, offset) => {
            // 普通块是 blockContainer 包着的；表格单元格里直接是 textblock。
            // blockContainer 自己的正文子节点跳过 —— 它已经被上一层数过了。
            const box = child.type.name === 'blockContainer' ? child : null
            if (!box && node.type.name === 'blockContainer') return
            const content = box ? box.firstChild : child
            if (!content || content.type.name !== 'numberedListItem') {
              run = 0
              return
            }
            run++
            const start = pos + 1 + offset + (box ? 1 : 0)
            decos.push(Decoration.node(start, start + content.nodeSize, { 'data-num': String(run) }))
          })
        })
        return DecorationSet.create(state.doc, decos)
      },
    },
  })
}
