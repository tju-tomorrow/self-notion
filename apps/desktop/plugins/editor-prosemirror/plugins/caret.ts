/**
 * 短光标（用户 2026-11-26）。
 *
 * 正文行高 1.7（长文别挤成一堵墙），但 WebKit 的原生光标按整条行盒画，就成了 1.7 个字高。
 * 原生光标没有单独调长度的办法，于是把原生的藏掉，自己画一条只比字高一点点的。
 * 只做桌面端：手机上的选区手柄和输入法光标不该由我们接管。
 */
import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import './caret.css'

const isMobile = (): boolean => document.documentElement.dataset.mobile === '1'

class Caret {
  private el: HTMLDivElement
  private raf = 0
  private off: Array<() => void> = []

  constructor(private view: EditorView) {
    this.el = document.createElement('div')
    this.el.className = 'sn-caret'
    this.el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(this.el)

    const schedule = (): void => this.schedule()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    window.addEventListener('focusin', schedule)
    window.addEventListener('focusout', schedule)
    this.off.push(
      () => window.removeEventListener('scroll', schedule, true),
      () => window.removeEventListener('resize', schedule),
      () => window.removeEventListener('focusin', schedule),
      () => window.removeEventListener('focusout', schedule),
    )
  }

  schedule(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.place()
    })
  }

  private place(): void {
    const view = this.view
    const sel = view.state.selection
    // 只有「正在正文里打字」才画：焦点在标题 / 图片说明 / 公式输入框时，原生光标还在，别画两条。
    const active = document.activeElement
    if (
      !view.dom.isConnected ||
      active !== view.dom ||
      !(sel instanceof TextSelection) ||
      !sel.empty
    ) {
      this.el.style.display = 'none'
      return
    }

    let box: { left: number; top: number; bottom: number }
    try {
      box = view.coordsAtPos(sel.head)
    } catch {
      this.el.style.display = 'none'
      return
    }

    const at = view.domAtPos(sel.head)
    const node = at.node
    const host = (node.nodeType === 1 ? node : node.parentElement) as HTMLElement | null
    const style = host ? getComputedStyle(host) : null
    const fs = style ? parseFloat(style.fontSize) || 16 : 16
    const line = Math.max(1, box.bottom - box.top)
    const height = Math.min(fs * 1.25, line)
    const top = box.top + (line - height) / 2

    this.el.style.display = 'block'
    this.el.style.left = `${box.left}px`
    this.el.style.top = `${top}px`
    this.el.style.height = `${height}px`
    this.el.style.color = style?.color ?? 'inherit'
    // 每挪一次就重新开始闪 —— 不然移动时正好落在「灭」的那半秒，像卡住。
    this.el.style.animation = 'none'
    void this.el.offsetWidth
    this.el.style.animation = ''
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    for (const off of this.off) off()
    this.off.length = 0
    this.el.remove()
  }
}

export function caretPlugin(): Plugin {
  return new Plugin({
    view(editorView) {
      if (isMobile()) return {}
      const caret = new Caret(editorView)
      caret.schedule()
      return {
        update: () => caret.schedule(),
        destroy: () => caret.destroy(),
      }
    },
  })
}
