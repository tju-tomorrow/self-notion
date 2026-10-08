/**
 * 右侧大纲面板 —— 从 `view.state.doc` 现算，**不进 doc、不落库**（跟 `nodes/table-of-contents.ts` 一个道理，
 * 区别只是那个是正文里的一块，这个是栏边上的一栏）。
 *
 * ★ 挂在**栏的 side 列**（`view.ts` 的 `.sn-pane-side`，在滚动区之外）：按钮不跟正文一起滚走。
 *   收起时那一列宽度是 0，只剩右上角那颗按钮 —— 所以「常驻」和「不占地方」不冲突。
 * ★ 用插件而不是手工接线：刷新点就是 PM 自己的 `update`，销毁由 `view.destroy()` 带走。
 */
import type { Node as PMNode } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'

import { listIcon } from './icons'
import './outline.css'

export interface OutlineStrings {
  /** 「大纲」——按钮的 title / aria-label。 */
  readonly label: string
  readonly empty: string
  readonly untitled: string
}

interface Entry {
  pos: number
  level: number
  text: string
}

function headings(doc: PMNode): Entry[] {
  const out: Entry[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    // 标题只有行内内容，不必再往下走。
    out.push({ pos, level: Number(node.attrs.level) || 1, text: node.textContent })
    return false
  })
  return out
}

/** 每级缩一格。★ 缩进用 `margin` 不用 `padding` —— 二级往下那条竖线要落在**缩进的位置**上。 */
const STEP = 14

export function outlinePlugin(host: HTMLElement, scroller: HTMLElement, strings: OutlineStrings): Plugin {
  return new Plugin({
    view: (view) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'sn-outline-toggle'
      button.title = strings.label
      button.setAttribute('aria-label', strings.label)
      button.appendChild(listIcon(15))

      const panel = document.createElement('div')
      panel.className = 'sn-outline'
      const list = document.createElement('div')
      list.className = 'sn-outline-list'
      panel.appendChild(list)

      host.append(button, panel)

      /** 渲染那一刻每行对应的正文 DOM（滚动跟踪用）。第 0 位是标题行，对应 null。 */
      let targets: (HTMLElement | null)[] = []
      /** 上一份内容。一样就不重建 DOM —— 每次敲键都重建会把滚动位置和 hover 打断。 */
      let key: string | null = null
      let raf = 0
      let activeRaf = 0
      let open = false

      const paintActive = (): void => {
        activeRaf = 0
        if (!open) return
        const line = scroller.getBoundingClientRect().top + 8
        let at = 0
        for (let i = 1; i < targets.length; i += 1) {
          const dom = targets[i]
          if (dom && dom.getBoundingClientRect().top <= line) at = i
        }
        const rows = list.children
        for (let i = 0; i < targets.length; i += 1) {
          const row = rows[i]
          if (!(row instanceof HTMLElement)) continue
          if (i === at) row.dataset.active = '1'
          else delete row.dataset.active
        }
      }

      const onScroll = (): void => {
        if (activeRaf) return
        activeRaf = requestAnimationFrame(paintActive)
      }

      const row = (text: string, level: number): HTMLButtonElement => {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'sn-outline-item'
        el.dataset.level = String(level)
        el.textContent = text || strings.untitled
        el.style.marginLeft = `${(level - 1) * STEP}px`
        if (level > 1) el.style.borderLeft = '1px solid var(--sn-line, rgba(0, 0, 0, .1))'
        return el
      }

      const render = (): void => {
        raf = 0
        const doc = view.state.doc
        const title = String(doc.attrs.title ?? '') || strings.untitled
        const items = headings(doc)
        const next = [title, ...items.map((i) => `${i.level}:${i.pos}:${i.text}`)].join('\n')
        if (next === key) return
        key = next

        list.replaceChildren()
        targets = []

        const top = row(title, 1)
        top.classList.add('sn-outline-title')
        top.style.marginLeft = '0'
        top.addEventListener('click', () => scroller.scrollTo({ top: 0, behavior: 'smooth' }))
        list.appendChild(top)
        targets.push(null)

        if (items.length === 0) {
          const empty = document.createElement('div')
          empty.className = 'sn-outline-empty'
          empty.textContent = strings.empty
          list.appendChild(empty)
          paintActive()
          return
        }

        for (const item of items) {
          const el = row(item.text, item.level)
          // `item.pos` 只对**这一份** doc 有效 —— 下一次 doc 变了自己就会重算。
          el.addEventListener('click', () => {
            const dom = view.nodeDOM(item.pos)
            if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' })
          })
          list.appendChild(el)
          const dom = view.nodeDOM(item.pos)
          targets.push(dom instanceof HTMLElement ? dom : null)
        }
        paintActive()
      }

      const schedule = (): void => {
        if (raf) return
        raf = requestAnimationFrame(render)
      }

      const setOpen = (v: boolean): void => {
        open = v
        host.dataset.on = v ? '1' : '0'
        button.setAttribute('aria-expanded', v ? 'true' : 'false')
        // 打开时补一次高亮：内容没变的话 `render` 会直接返回，那就没人画了。
        if (v) paintActive()
      }

      button.addEventListener('click', () => setOpen(!open))
      scroller.addEventListener('scroll', onScroll, { passive: true })
      // ★ 视图会被**重建**（`find.ts` / `comment.ts` 的 `reconfigure` 把所有插件视图 destroy 再建一遍），
      //   所以「开着没过」这件事存在 `data-on` 上 —— destroy 时故意不清，换篇 / 拔插件由 `view.ts` 清。
      setOpen(host.dataset.on === '1')
      render()

      return {
        update: (next, prev) => {
          if (next.state.doc !== prev.doc) schedule()
        },
        destroy: () => {
          scroller.removeEventListener('scroll', onScroll)
          if (raf) cancelAnimationFrame(raf)
          if (activeRaf) cancelAnimationFrame(activeRaf)
          // `data-on` **不清**（见上面 `setOpen` 那句）—— 换篇 / 拔插件由 `view.ts` 的 teardown 清。
          button.remove()
          panel.remove()
        },
      }
    },
  })
}
