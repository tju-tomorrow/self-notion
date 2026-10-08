/**
 * 正文里**不许出现的字符**：C0 控制符（`\n` / `\t` 除外）与 C1 控制符。
 *
 * ★ 为什么在模型这层堵（照搬 `editor-blocksuite/sanitize.ts` 的结论，D-0127）：
 *   这些字符**不是我们任何代码写的** —— 仓库和全部依赖的 src/dist 都扫过（原始字节、转义串、
 *   `fromCharCode` 三种写法），一处都没有。它们是**从 DOM 那侧**进来的：每按一次 `→`，
 *   正文就多一个 `U+001D`，DOM 和模型同时有。渲染出来就是**一排缺字方框**（2026-10-08 换基座后
 *   又见到一次：标题 `sda\x1d\x1d\x1d`、正文 `\x1c\x1d\x1d\x1d`）。
 *
 *   所以这里不猜来源（输入法？WebKit？），只守**结果**：谁写了这种字符，当场按位置删掉。
 *
 * ★ ProseMirror 版比 Yjs 那版简单：不需要 observer + 微任务 —— `appendTransaction` 本来就是
 *   「事务之后、渲染之前」这一拍，在那里改不掉 DOM 重入的坑。
 */
import { Plugin } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'

/** 控制符（`\n`=0x0a / `\t`=0x09 留着，它们在正文里是正常排版）。 */
function bad(code: number): boolean {
  return (code < 0x20 && code !== 0x0a && code !== 0x09) || (code >= 0x7f && code <= 0x9f)
}

function hasBad(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) if (bad(s.charCodeAt(i))) return true
  return false
}

/**
 * 剔掉一段文本里的控制符（按原顺序拼回去）。
 *
 * ★ 给**标题那个 `input`** 用的：插件只能清模型，清不掉框里那份 —— 框里留着就是「一排缺字方框」
 *   （2026-10-08 用户：「标题又出现框框了」）。两边必须用**同一份**判据，不然框里和模型里对不上。
 */
export function stripBad(s: string): string {
  let out = ''
  for (const ch of s) if (!bad(ch.codePointAt(0) ?? 0)) out += ch
  return out
}

/** 把一段文本里所有控制符按**位置**从后往前删掉（整段重写会把行内格式一起抹掉）。 */
function cleanText(tr: EditorState['tr'], pos: number, text: string): boolean {
  let touched = false
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (bad(text.charCodeAt(i))) {
      tr.delete(pos + i, pos + i + 1)
      touched = true
    }
  }
  return touched
}

export function sanitizePlugin(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, next) {
      if (!trs.some((tr) => tr.docChanged)) return null
      const tr = next.tr
      let touched = false

      next.doc.descendants((node, pos) => {
        if (node.isText && node.text && hasBad(node.text)) {
          touched = cleanText(tr, pos, node.text) || touched
        }
        return undefined
      })

      // 标题是 doc 的 attr（不在 text 里），单独扫一遍。
      const title = String(next.doc.attrs.title ?? '')
      if (hasBad(title)) {
        tr.setDocAttribute('title', stripBad(title))
        touched = true
      }

      if (!touched) return null
      // 不进撤销栈：⌘Z 该撤销用户自己敲的字，不是这个。
      tr.setMeta('addToHistory', false)
      return tr
    },
  })
}
