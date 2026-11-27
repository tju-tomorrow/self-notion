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

import { schema } from './schema'
import { bookmarkIcon, listIcon, mapIcon } from './icons'
import { mountVerso } from './structure/view'
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

interface AnchorEntry {
  id: string
  from: number
  to: number
  text: string
}

/** 正文里所有锚点（同一 id 的 mark 跨多个 text 节点是常态，按 id 合起来）。 */
function anchorEntries(doc: PMNode): AnchorEntry[] {
  const out = new Map<string, AnchorEntry>()
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    for (const mark of node.marks) {
      if (mark.type !== schema.marks.anchor) continue
      const id = String(mark.attrs.id ?? '')
      if (id === '') continue
      const cur = out.get(id)
      if (cur) {
        cur.to = pos + node.text.length
        cur.text += node.text
      } else {
        out.set(id, { id, from: pos, to: pos + node.text.length, text: node.text })
      }
    }
    return true
  })
  return [...out.values()].sort((a, b) => a.from - b.from)
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

      // 锚点那颗跟大纲并排（`outline.css.ts` 里挪到左边一格）。
      const anchorButton = document.createElement('button')
      anchorButton.type = 'button'
      anchorButton.className = 'sn-outline-toggle sn-anchor-toggle'
      anchorButton.title = '锚点'
      anchorButton.setAttribute('aria-label', '锚点')
      anchorButton.appendChild(bookmarkIcon(15))

      // 锚点左边：同一篇的结构面（D-0220）。
      const versoButton = document.createElement('button')
      versoButton.type = 'button'
      versoButton.className = 'sn-outline-toggle sn-verso-toggle'
      versoButton.title = '结构'
      versoButton.setAttribute('aria-label', '结构')
      versoButton.setAttribute('aria-pressed', 'false')
      versoButton.appendChild(mapIcon(15))

      const verso = mountVerso(scroller, {
        onOpenChange: open => versoButton.setAttribute('aria-pressed', open ? 'true' : 'false'),
        focusToggle: () => versoButton.focus(),
      })

      const panel = document.createElement('div')
      panel.className = 'sn-outline'
      const list = document.createElement('div')
      list.className = 'sn-outline-list'
      const anchorList = document.createElement('div')
      anchorList.className = 'sn-anchor-list'
      panel.append(list, anchorList)

      host.append(versoButton, anchorButton, button, panel)
      let mode: 'outline' | 'anchors' = host.dataset.mode === 'anchors' ? 'anchors' : 'outline'
      host.dataset.mode = mode

      /** 渲染那一刻每行对应的正文 DOM（滚动跟踪用）。第 0 位是标题行，对应 null。 */
      let targets: (HTMLElement | null)[] = []
      /** 上一份内容。一样就不重建 DOM —— 每次敲键都重建会把滚动位置和 hover 打断。 */
      let key: string | null = null
      let raf = 0
      let activeRaf = 0
      let open = false

      const paintActive = (): void => {
        activeRaf = 0
        if (!open || mode !== 'outline') return
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

      /** 跳到一处锚点：滚过去；先摘一下类再挂，动画才会重放。 */
      const jump = (a: AnchorEntry): void => {
        const el = view.dom.querySelector(`.sn-anchor[data-id="${a.id}"]`)
        if (!(el instanceof HTMLElement)) return
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.classList.remove('sn-anchor-flash')
        void el.offsetWidth
        el.classList.add('sn-anchor-flash')
        window.setTimeout(() => el.classList.remove('sn-anchor-flash'), 1200)
      }

      const renderAnchors = (items: AnchorEntry[]): void => {
        anchorList.replaceChildren()
        if (items.length === 0) {
          const empty = document.createElement('div')
          empty.className = 'sn-outline-empty'
          empty.textContent = '还没有锚点：选中文字，点工具条上的书签'
          anchorList.appendChild(empty)
          return
        }
        for (const a of items) {
          const line = document.createElement('div')
          line.className = 'sn-anchor-row'
          const go = document.createElement('button')
          go.type = 'button'
          go.className = 'sn-outline-item sn-anchor-item'
          go.textContent = a.text.trim() || '（空）'
          go.title = a.text
          go.addEventListener('click', () => jump(a))
          const del = document.createElement('button')
          del.type = 'button'
          del.className = 'sn-anchor-del'
          del.textContent = '×'
          del.title = '移除这个锚点'
          del.addEventListener('click', (e) => {
            e.stopPropagation()
            view.dispatch(view.state.tr.removeMark(a.from, a.to, schema.marks.anchor.create({ id: a.id })))
          })
          line.append(go, del)
          anchorList.appendChild(line)
        }
      }

      const render = (): void => {
        raf = 0
        const doc = view.state.doc
        const title = String(doc.attrs.title ?? '') || strings.untitled
        const items = headings(doc)
        const anchors = anchorEntries(doc)
        const next = [
          title,
          ...items.map((i) => `${i.level}:${i.pos}:${i.text}`),
          ...anchors.map((a) => `${a.id}:${a.from}:${a.to}:${a.text}`),
        ].join('\n')
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
        } else {
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
        }

        renderAnchors(anchors)
        paintActive()
      }

      const schedule = (): void => {
        if (raf) return
        raf = requestAnimationFrame(render)
      }

      const setOpen = (v: boolean): void => {
        open = v
        host.dataset.on = v ? '1' : '0'
        button.setAttribute('aria-expanded', v && mode === 'outline' ? 'true' : 'false')
        anchorButton.setAttribute('aria-expanded', v && mode === 'anchors' ? 'true' : 'false')
        // 打开时补一次高亮：内容没变的话 `render` 会直接返回，那就没人画了。
        if (v) paintActive()
      }

      /** 两颗按钮共用同一列：点哪颗开哪份列表，再点同一颗收起。 */
      const openAs = (next: 'outline' | 'anchors'): void => {
        if (open && mode === next) {
          setOpen(false)
          return
        }
        mode = next
        host.dataset.mode = next
        setOpen(true)
      }

      button.addEventListener('click', () => openAs('outline'))
      anchorButton.addEventListener('click', () => openAs('anchors'))
      versoButton.addEventListener('click', () => {
        // 手机上这一列是底部 sheet，开着会挡住翻过去的那一面。
        const mobile =
          window.innerWidth <= 720 || document.documentElement.dataset.mobile === '1'
        if (open && mobile) setOpen(false)
        verso.toggle(view)
      })
      scroller.addEventListener('scroll', onScroll, { passive: true })
      // ★ 视图会被**重建**（`find.ts` / `comment.ts` 的 `reconfigure` 把所有插件视图 destroy 再建一遍），
      //   所以「开着没过」这件事存在 `data-on` 上 —— destroy 时故意不清，换篇 / 拔插件由 `view.ts` 清。
      setOpen(host.dataset.on === '1')
      render()

      return {
        update: (next, prev) => {
          if (next.state.doc === prev.doc) return
          schedule()
          verso.sync(next)
        },
        destroy: () => {
          scroller.removeEventListener('scroll', onScroll)
          if (raf) cancelAnimationFrame(raf)
          if (activeRaf) cancelAnimationFrame(activeRaf)
          // `data-on` **不清**（见上面 `setOpen` 那句）—— 换篇 / 拔插件由 `view.ts` 的 teardown 清。
          verso.destroy()
          versoButton.remove()
          button.remove()
          anchorButton.remove()
          panel.remove()
        },
      }
    },
  })
}
