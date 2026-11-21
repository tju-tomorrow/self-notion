/**
 * 手机端块级入口：右下角「＋」+ 底部快插 sheet。DOM 全挂 body，显隐交给 CSS 的 data-mobile。
 * 条目和落块都复用 slash.ts，不另抄一份块类型。
 */
import { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import { reportError } from '../../../src/kernel/errors'
import { insertItemAt, quickInsertItems } from './slash'
import './mobile-insert.css'

export function mobileInsertPlugin(): Plugin {
  return new Plugin({
    view: (view: EditorView) => {
      const root = document.createElement('div')
      root.className = 'sn-mobile-insert'
      root.dataset.on = '0'

      const fab = document.createElement('button')
      fab.type = 'button'
      fab.className = 'sn-mobile-fab'
      fab.textContent = '＋'
      fab.setAttribute('aria-label', '插入')
      fab.setAttribute('aria-expanded', 'false')

      const setOpen = (on: boolean): void => {
        root.dataset.on = on ? '1' : '0'
        fab.setAttribute('aria-expanded', String(on))
      }

      const scrim = document.createElement('div')
      scrim.className = 'sn-mobile-scrim'

      const sheet = document.createElement('div')
      sheet.className = 'sn-mobile-sheet'
      sheet.setAttribute('role', 'dialog')
      const title = document.createElement('div')
      title.className = 'sn-mobile-sheet-title'
      title.textContent = '插入'
      const grid = document.createElement('div')
      grid.className = 'sn-mobile-grid'
      sheet.append(title, grid)

      for (const item of quickInsertItems()) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'sn-mobile-item'
        btn.dataset.id = item.id
        const ico = document.createElement('span')
        ico.className = 'sn-mobile-item-ico'
        ico.textContent = item.icon
        const label = document.createElement('span')
        label.className = 'sn-mobile-item-label'
        label.textContent = item.label
        btn.append(ico, label)
        btn.addEventListener('click', () => {
          setOpen(false)
          try {
            insertItemAt(view, item.id)
          } catch (err) {
            reportError('editor-prosemirror', err)
          }
        })
        grid.appendChild(btn)
      }

      root.append(fab, scrim, sheet)
      document.body.appendChild(root)

      fab.addEventListener('click', () => setOpen(root.dataset.on !== '1'))
      scrim.addEventListener('click', () => setOpen(false))

      return {
        destroy: () => root.remove(),
      }
    },
  })
}
