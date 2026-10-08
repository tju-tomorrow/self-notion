/**
 * 选中**一整块**时浮出来的那颗「评论此块」。
 *
 * ★ 选文字那颗已经**不在这儿**了：D-0079 把它挪进了编辑器那条工具条（跟 B / I / U 同一条），
 *   走的 `ctx.get('comment')?.onSelection`。剩下的这一颗是块选区专用的 —— 图片 / 表格这类
 *   没有文字、工具条也就不出来的东西，还得靠它浮一颗。
 *
 * `selectionchange` / `pointerup` 都过 rAF 节流 —— 拖一次选区这两个事件能来几十回，
 * 每回都 setState 会白渲染一串。量到的东西按 `rect` 定位：选区上方，顶不下就落到下方。
 * 挂在 `doc.header` 那一项里（文档开着它才在），只要不在文档页就什么都不做。
 */
import { useEffect, useState, type CSSProperties } from 'react'
import type { Context } from 'cordis'
import { CommentIcon } from '@blocksuite/icons/rc'
import { reportError } from '../../src/kernel/errors'
import { commentOnSelection, type Selection } from './actions'
import { getCommentState } from './state'
import * as s from './comment.css'

/** 上方留不出这么多像素就翻到选区下面去。 */
const ROOM = 64

/** 量出来的矩形靠不靠得住。★ 块选区没有文字、拖拽手柄那边拿不到 Range 时，
 *  `rectOf()` 会回一个全 0 的 DOMRect —— 那种「选区在左上角第一个像素上」的假位置
 *  会让这颗按钮钉在窗口左上角，压着红绿灯（用户：「会有奇怪报错在左上角」，读出来是「评论此块」）。 */
function usable(rect: DOMRect): boolean {
  return rect.width > 0 || rect.height > 0
}

export function CommentBubble({ ctx }: { ctx: Context }) {
  const [at, setAt] = useState<Selection & { rect: DOMRect } | null>(null)

  useEffect(() => {
    let raf = 0
    let live = true

    const measure = async (): Promise<void> => {
      raf = 0
      if (getCommentState().docId === null) return setAt(null)
      try {
        await ctx.editor.ready()
        if (!live) return
        const block = ctx.editor.blockSelection()
        // 文字选区那边不再回头看 `textSelection()` —— 它有工具条了（D-0079）。
        setAt(
          block && usable(block.rect)
            ? { kind: 'block', blockId: block.blockId, quote: block.quote, rect: block.rect }
            : null,
        )
      } catch (err) {
        reportError('comment', err)
      }
    }

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => void measure())
    }

    document.addEventListener('selectionchange', schedule)
    document.addEventListener('pointerup', schedule)
    return () => {
      live = false
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('pointerup', schedule)
    }
  }, [ctx])

  if (!at) return null

  const above = at.rect.top > ROOM
  // 夹一下：靠边的选区（行首 / 行尾）算出来的中心点会让按钮半个身子探出窗口 ——
  // 有了这条，按钮永远整颗在窗口里。
  const half = 52
  const left = Math.min(window.innerWidth - half, Math.max(half, at.rect.left + at.rect.width / 2))
  const box: CSSProperties = {
    left,
    top: above ? at.rect.top - 8 : at.rect.bottom + 8,
    transform: above ? 'translate(-50%, -100%)' : 'translateX(-50%)',
  }

  return (
    <button
      type="button"
      className={s.bubble}
      style={box}
      // 不让点按钮这一步把正文的选区弄没了（选区没了这颗按钮下一帧就消失，点击落不到）
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const sel = at
        setAt(null)
        void commentOnSelection(ctx, sel)
      }}
    >
      <CommentIcon width={16} height={16} />
      {ctx.i18n.t('comment.bubble.block')}
    </button>
  )
}
