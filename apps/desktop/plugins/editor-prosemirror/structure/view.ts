/**
 * 结构这一面的交互（D-0220）。
 * 翻页只在进出；点进一层是锁进，不是再翻一次。
 */
import type { Node as PMNode } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'

import { blobUrl } from '../../../src/platform/blob-url'
import { reportError } from '../../../src/kernel/errors'
import { structureOf, type MapNode, type Payload } from './tree'
import './verso.css'

const SVG = 'http://www.w3.org/2000/svg'
const CAP = 5000
const FAN_MAX = 12

export interface VersoHooks {
  onOpenChange(open: boolean): void
  focusToggle(): void
}

interface Verso {
  toggle(view: EditorView): void
  sync(view: EditorView): void
  destroy(): void
}

function motionOk(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function setPx(node: HTMLElement, prop: 'left' | 'top' | 'width' | 'height', value: number): void {
  const next = `${Math.round(value)}px`
  if (node.style[prop] !== next) node.style[prop] = next
}

function stepFor(nodes: MapNode[]): number {
  return nodes.some(n => n.children.length > 0) ? 78 : 58
}

function peekOf(n: MapNode): string {
  if (n.children.length === 0) return ''
  const names = n.children.slice(0, 3).map(c => c.label)
  const extra = n.children.length > 3 ? ` +${n.children.length - 3}` : ''
  return `${names.join(' / ')}${extra}`
}

function gist(n: MapNode, depth: number): string {
  const head = depth > 0 ? `第 ${depth} 层` : ''
  if (n.children.length === 0) {
    if (head) return head
    return n.weight > 0 ? `${n.weight} 字` : '没有再往下的一层'
  }
  const unit = n.children.every(c => c.kind === 'section') ? '节' : '块'
  const bits = [head, `${n.children.length} ${unit}`]
  if (n.weight > 0) bits.push(`${n.weight} 字`)
  return bits.filter(Boolean).join('，')
}

function readWord(payload: Payload): string {
  switch (payload) {
    case 'code':
      return '看代码'
    case 'image':
      return '看图'
    case 'video':
      return '看视频'
    case 'audio':
      return '听这段'
    case 'table':
      return '看表'
    case 'tex':
      return '看公式'
    case 'raw':
      return '看原文'
    default:
      return '展开这段'
  }
}

function fallbackTree(): MapNode {
  return {
    kind: 'doc',
    label: '结构没能展开',
    meta: '',
    pos: 0,
    end: 0,
    own: 0,
    weight: 0,
    children: [],
    payload: 'none',
    ref: '',
    checked: false,
  }
}

export function mountVerso(scroller: HTMLElement, hooks: VersoHooks): Verso {
  let phase: 'closed' | 'open' | 'shutting' = 'closed'
  let editor: EditorView | null = null
  let main: HTMLElement | null = null
  let root: HTMLDivElement | null = null
  let map: HTMLDivElement | null = null
  let leaf: HTMLDivElement | null = null
  let fan: HTMLDivElement | null = null
  let cards: HTMLDivElement | null = null
  let svg: SVGSVGElement | null = null
  let crumbs: HTMLDivElement | null = null
  let edge: HTMLDivElement | null = null
  let spineTitle: HTMLDivElement | null = null
  let spineGist: HTMLDivElement | null = null
  let backBtn: HTMLButtonElement | null = null
  let readBtn: HTMLButtonElement | null = null
  let jumpBtn: HTMLButtonElement | null = null
  let flap: HTMLDivElement | null = null
  let tree: MapNode | null = null
  let here: MapNode | null = null
  let current: MapNode[] = []
  let path: number[] = []
  /** -1 = 当前这层自己的正文，>=0 = 某一张卡片。 */
  let flapAt: number | null = null
  let cursor = 0
  let openToken = 0
  let renderGen = 0
  let enterTimer = 0
  let closeTimer = 0
  let resizeRaf = 0

  const ro = new ResizeObserver(() => {
    if (resizeRaf) return
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0
      onResize()
    })
  })

  function raiseSide(on: boolean): void {
    const side = main?.querySelector('.sn-pane-side')
    if (side instanceof HTMLElement) side.style.zIndex = on ? '6' : ''
  }

  function place(): void {
    if (!root || !main || !map) return
    const br = scroller.getBoundingClientRect()
    const mr = main.getBoundingClientRect()
    setPx(root, 'left', br.left - mr.left)
    setPx(root, 'top', br.top - mr.top)
    setPx(root, 'width', br.width)
    setPx(root, 'height', br.height)
    const side = main.querySelector('.sn-pane-side')
    const overlap = side instanceof HTMLElement && side.clientWidth < 8
    const pad = overlap ? '96px' : '20px'
    if (map.style.paddingRight !== pad) map.style.paddingRight = pad
    const narrow = root.clientWidth < 640 ? '1' : '0'
    if (root.dataset.narrow !== narrow) root.dataset.narrow = narrow
  }

  function wantColumn(nodes: MapNode[]): boolean {
    if (!fan) return false
    if (nodes.length === 0) return false
    if (nodes.length > FAN_MAX) return true
    const h = fan.clientHeight
    if (h < 40) return true
    const need = nodes.length * stepFor(nodes)
    const currently = fan.dataset.mode === 'column'
    return currently ? need > h - 120 : need > h - 24
  }

  function locate(): { node: MapNode; chain: MapNode[] } {
    const chain: MapNode[] = []
    let node = tree ?? fallbackTree()
    chain.push(node)
    const kept: number[] = []
    for (const i of path) {
      if (i < 0 || i >= node.children.length) break
      node = node.children[i]
      kept.push(i)
      chain.push(node)
    }
    path = kept
    return { node, chain }
  }

  function paintChrome(node: MapNode, chain: MapNode[], enter: boolean): void {
    if (!spineTitle || !spineGist || !readBtn || !backBtn || !crumbs || !edge) return
    here = node
    backBtn.hidden = chain.length < 2
    spineTitle.textContent = node.label
    spineTitle.title = node.label
    spineTitle.dataset.root = chain.length === 1 ? '1' : '0'
    if (enter && motionOk()) spineTitle.dataset.enter = '1'
    else delete spineTitle.dataset.enter
    spineGist.textContent = gist(node, chain.length - 1)
    if (node.payload === 'none') readBtn.hidden = true
    else {
      readBtn.hidden = false
      readBtn.textContent = readWord(node.payload)
      readBtn.setAttribute('aria-expanded', flapAt === -1 ? 'true' : 'false')
    }
    const ancestors = chain.slice(0, -1)
    const crumbRow = crumbs
    const edgeRow = edge
    crumbRow.replaceChildren()
    crumbRow.hidden = ancestors.length === 0
    edgeRow.replaceChildren()
    ancestors.forEach((anc, i) => {
      if (i > 0) crumbRow.appendChild(el('span', 'sn-verso-slash', '/'))
      const crumb = el('button', 'sn-verso-crumb', anc.label)
      crumb.type = 'button'
      crumb.title = anc.label
      crumb.addEventListener('click', () => goDepth(i))
      crumbRow.appendChild(crumb)
      const stripe = el('button', 'sn-verso-stripe')
      stripe.type = 'button'
      stripe.title = anc.label
      stripe.setAttribute('aria-label', anc.label)
      stripe.addEventListener('click', () => goDepth(i))
      edgeRow.appendChild(stripe)
    })
  }

  function cardEl(node: MapNode, index: number, share: number): HTMLButtonElement {
    const btn = el('button', 'sn-verso-card')
    btn.type = 'button'
    btn.dataset.i = String(index)
    btn.dataset.kind = node.kind
    btn.title = node.label
    btn.tabIndex = index === cursor ? 0 : -1
    const opens = node.children.length > 0 || node.payload !== 'none'
    if (opens) btn.dataset.branch = '1'
    if (node.payload !== 'none' && node.children.length === 0) {
      btn.setAttribute('aria-expanded', flapAt === index ? 'true' : 'false')
    }
    if (flapAt === index) btn.dataset.open = '1'
    btn.style.setProperty('--i', String(Math.min(index, 14)))
    const ink = el('span', 'sn-verso-ink')
    ink.setAttribute('aria-hidden', 'true')
    ink.style.setProperty('--ink', share.toFixed(3))
    const label = el('span', 'sn-verso-label', node.label)
    btn.append(ink, label)
    if (node.meta) btn.appendChild(el('span', 'sn-verso-meta', node.meta))
    const peek = peekOf(node)
    if (peek) btn.appendChild(el('span', 'sn-verso-peek', peek))
    return btn
  }

  function clearAbs(): void {
    svg?.replaceChildren()
    cards?.querySelectorAll<HTMLElement>('.sn-verso-card').forEach(card => {
      card.style.left = ''
      card.style.top = ''
      card.style.width = ''
      card.style.height = ''
    })
  }

  function layoutFan(nodes: MapNode[]): void {
    if (!fan || !cards || !svg) return
    const n = nodes.length
    const w = fan.clientWidth
    const h = fan.clientHeight
    if (n === 0 || w < 8 || h < 8) {
      svg.replaceChildren()
      return
    }
    const box = stepFor(nodes)
    const cardH = box - 12
    const total = n * box
    const top0 = Math.max(8, (h - total) / 2)
    const mid = (n - 1) / 2
    const bulge = mid * 14
    const cardW = Math.max(150, Math.min(340, w - 28 - bulge - 16))
    const originY = h / 2
    const parts: string[] = []
    cards.querySelectorAll<HTMLElement>('.sn-verso-card').forEach((card, i) => {
      const x = 28 + Math.abs(i - mid) * 14
      const y = top0 + i * box
      card.style.left = `${x}px`
      card.style.top = `${y}px`
      card.style.width = `${cardW}px`
      card.style.height = `${cardH}px`
      const cy = y + cardH / 2
      parts.push(
        `M0 ${originY.toFixed(1)} C ${(x * 0.45).toFixed(1)} ${originY.toFixed(1)}, ${(x * 0.55).toFixed(1)} ${cy.toFixed(1)}, ${x} ${cy.toFixed(1)}`,
      )
    })
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', parts.join(' '))
    svg.replaceChildren(path)
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  }

  function paintCards(nodes: MapNode[], fanMode: boolean): void {
    if (!cards || !fan) return
    const total = nodes.reduce((sum, n) => sum + n.weight, 0)
    const frag = document.createDocumentFragment()
    nodes.forEach((node, i) => {
      const share = total > 0 ? Math.max(0.08, node.weight / total) : 1 / nodes.length
      frag.appendChild(cardEl(node, i, share))
    })
    cards.replaceChildren(frag)
    fan.dataset.mode = fanMode ? 'fan' : 'column'
    fan.dataset.empty = nodes.length === 0 ? '1' : '0'
    if (fanMode && nodes.length > 0) layoutFan(nodes)
    else clearAbs()
  }

  function renderLevel(enter: boolean, attempt = 0): void {
    if (attempt === 0) renderGen += 1
    const token = renderGen
    if (phase !== 'open' || !tree || !fan) return
    if (fan.clientHeight < 40 && attempt < 8) {
      requestAnimationFrame(() => {
        if (token !== renderGen || phase !== 'open') return
        renderLevel(enter, attempt + 1)
      })
      return
    }
    if (token !== renderGen) return
    const { node, chain } = locate()
    const animate = enter && motionOk()
    paintChrome(node, chain, animate)
    current = node.children
    if (cursor >= current.length) cursor = 0
    const keep = document.activeElement instanceof HTMLElement && cards?.contains(document.activeElement)
    if (animate) {
      fan.dataset.enter = '1'
      if (enterTimer) window.clearTimeout(enterTimer)
      enterTimer = window.setTimeout(() => {
        delete fan?.dataset.enter
        delete spineTitle?.dataset.enter
        enterTimer = 0
      }, 980)
    } else {
      delete fan.dataset.enter
      delete spineTitle?.dataset.enter
    }
    const fanMode = !wantColumn(current)
    paintCards(current, fanMode)
    if (flapAt === null) {
      stopMedia()
      if (flap) {
        flap.dataset.on = '0'
        flap.replaceChildren()
      }
    } else restoreFlap(node)
    if (keep) focusIndex(cursor)
  }

  function focusIndex(i: number): void {
    if (!cards || current.length === 0) return
    const n = current.length
    cursor = ((i % n) + n) % n
    cards.querySelectorAll<HTMLElement>('.sn-verso-card').forEach(card => {
      card.tabIndex = Number(card.dataset.i) === cursor ? 0 : -1
    })
    const card = cards.querySelector<HTMLElement>(`[data-i="${cursor}"]`)
    card?.focus({ preventScroll: true })
    card?.scrollIntoView({ block: 'nearest' })
  }

  function goDepth(depth: number): void {
    path = path.slice(0, depth)
    flapAt = null
    cursor = 0
    renderLevel(true)
  }

  function activate(i: number): void {
    const node = current[i]
    if (!node) return
    cursor = i
    if (node.children.length > 0) {
      path = [...path, i]
      flapAt = null
      cursor = 0
      renderLevel(true)
      return
    }
    if (node.payload === 'none') return
    if (flapAt === i) closeFlap()
    else {
      flapAt = i
      fillFlap(node)
    }
  }

  function readSelf(): void {
    if (!here || here.payload === 'none') return
    if (flapAt === -1) {
      closeFlap()
      return
    }
    flapAt = -1
    fillFlap(here)
    readBtn?.setAttribute('aria-expanded', 'true')
  }

  function markOpen(i: number | null): void {
    cards?.querySelectorAll<HTMLElement>('.sn-verso-card').forEach(card => {
      const on = i !== null && Number(card.dataset.i) === i
      if (on) card.dataset.open = '1'
      else delete card.dataset.open
      if (card.hasAttribute('aria-expanded')) card.setAttribute('aria-expanded', on ? 'true' : 'false')
    })
  }

  function stopMedia(): void {
    flap?.querySelectorAll('video, audio').forEach(node => {
      if (!(node instanceof HTMLMediaElement)) return
      node.pause()
      node.removeAttribute('src')
      node.load()
    })
  }

  function closeFlap(): void {
    flapAt = null
    stopMedia()
    if (flap) {
      flap.dataset.on = '0'
      flap.replaceChildren()
    }
    markOpen(null)
    readBtn?.setAttribute('aria-expanded', 'false')
  }

  function readPlain(n: PMNode): { text: string; more: boolean } {
    let text = ''
    let more = false
    n.descendants(ch => {
      if (text.length >= CAP) {
        more = true
        return false
      }
      const room = CAP - text.length
      if (ch.isText && ch.text) {
        if (ch.text.length > room) {
          text += ch.text.slice(0, room)
          more = true
        } else text += ch.text
      } else if (ch.type.name === 'hardBreak') text += '\n'
      else if (ch.type.name === 'inlineEquation') {
        const tex = String(ch.attrs.tex ?? '')
        text += tex.length > room ? tex.slice(0, room) : tex
      }
      return text.length < CAP
    })
    return { text, more }
  }

  function appendText(inner: HTMLElement, text: string, more: boolean, code: boolean): void {
    const body = el(code ? 'pre' : 'div', code ? 'sn-verso-body sn-verso-code' : 'sn-verso-body')
    body.textContent = text
    inner.appendChild(body)
    if (more) inner.appendChild(el('p', 'sn-verso-more', '只显示开头，定位到正文能看全'))
  }

  function fillTable(inner: HTMLElement, table: PMNode): void {
    const wrap = el('div', 'sn-verso-body')
    const grid = document.createElement('table')
    grid.className = 'sn-verso-table'
    let rows = 0
    let more = false
    table.forEach(row => {
      if (row.type.name !== 'table_row') return
      if (rows >= 24) {
        more = true
        return
      }
      const tr = document.createElement('tr')
      row.forEach(cell => {
        const td = document.createElement(cell.type.name === 'table_header' ? 'th' : 'td')
        const text = cell.textContent.replace(/\s+/g, ' ').trim()
        td.textContent = text.length > 80 ? `${text.slice(0, 79)}…` : text
        tr.appendChild(td)
      })
      grid.appendChild(tr)
      rows += 1
    })
    wrap.appendChild(grid)
    inner.appendChild(wrap)
    if (more) inner.appendChild(el('p', 'sn-verso-more', '后面还有，定位到正文能看全'))
  }

  function fillMedia(inner: HTMLElement, node: MapNode, pm: PMNode | null): void {
    const blob = String(pm?.attrs.blobId ?? node.ref)
    if (!blob) {
      inner.appendChild(el('div', 'sn-verso-body', '没有媒体'))
      return
    }
    const body = el('div', 'sn-verso-body')
    if (node.payload === 'image') {
      const img = document.createElement('img')
      img.className = 'sn-verso-img'
      img.alt = ''
      img.decoding = 'async'
      img.src = blobUrl(blob)
      img.addEventListener(
        'error',
        () => {
          img.replaceWith(el('p', 'sn-verso-more', '这张图没有加载出来'))
        },
        { once: true },
      )
      body.appendChild(img)
    } else {
      const media = document.createElement(node.payload === 'video' ? 'video' : 'audio')
      media.preload = 'none'
      media.controls = true
      media.src = blobUrl(blob)
      if (media instanceof HTMLVideoElement) media.playsInline = true
      body.appendChild(media)
    }
    inner.appendChild(body)
  }

  function fillFlap(node: MapNode): void {
    if (!flap || !editor) return
    stopMedia()
    flap.replaceChildren()
    flap.dataset.on = '1'
    flap.dataset.kind = node.kind
    const inner = el('div', 'sn-verso-flap-inner')
    const pm = node.pos > 0 ? editor.state.doc.nodeAt(node.pos) : editor.state.doc
    try {
      if (node.payload !== 'none' && !pm) {
        inner.appendChild(el('div', 'sn-verso-body', '这一块已经对不上正文了'))
      } else if (pm && node.kind === 'voice') {
        const transcript = String(pm.attrs.transcript ?? '')
        const shown = transcript.length > CAP ? transcript.slice(0, CAP) : transcript
        appendText(inner, shown || '还没有转写', transcript.length > CAP, false)
      } else if (pm && node.payload === 'raw') {
        const text = String(pm.attrs.text ?? '')
        appendText(inner, text.length > CAP ? text.slice(0, CAP) : text, text.length > CAP, false)
      } else if (pm && node.payload === 'tex') {
        appendText(inner, String(pm.attrs.tex ?? '') || '空公式', false, true)
      } else if (pm && node.payload === 'code') {
        const read = readPlain(pm)
        appendText(inner, read.text || '空代码', read.more, true)
      } else if (pm && node.payload === 'table') {
        fillTable(inner, pm)
      } else if (node.payload === 'image' || node.payload === 'video' || node.payload === 'audio') {
        fillMedia(inner, node, pm)
      } else if (pm && node.payload === 'text') {
        const read = readPlain(pm)
        appendText(inner, read.text, read.more, false)
      } else inner.appendChild(el('div', 'sn-verso-body', '没有可展开的内容'))
    } catch (err) {
      reportError('editor-prosemirror', err)
      inner.appendChild(el('div', 'sn-verso-body', '这一块没能展开'))
    }
    const to = el('button', 'sn-verso-textbtn', '定位到正文')
    to.type = 'button'
    to.addEventListener('click', () => jump(node.pos))
    inner.appendChild(to)
    flap.appendChild(inner)
    markOpen(flapAt !== null && flapAt >= 0 ? flapAt : null)
  }

  function restoreFlap(node: MapNode): void {
    const target = flapAt === -1 ? node : flapAt !== null ? node.children[flapAt] : null
    if (!target || target.payload === 'none') {
      closeFlap()
      return
    }
    fillFlap(target)
  }

  function jump(pos: number): void {
    const view = editor
    closeVerso(true)
    if (!view) return
    const behavior = motionOk() ? 'smooth' : 'auto'
    if (pos <= 0) {
      scroller.scrollTo({ top: 0, behavior })
      return
    }
    const dom = view.nodeDOM(pos)
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'center', behavior })
  }

  function onKey(e: KeyboardEvent): void {
    if (phase !== 'open' || !root) return
    if (!(e.target instanceof Node) || !root.contains(e.target)) return
    const onCard = e.target instanceof HTMLElement && e.target.classList.contains('sn-verso-card')
    if (!onCard) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusIndex(cursor + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusIndex(cursor - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusIndex(current.length - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      activate(cursor)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (path.length > 0) goDepth(path.length - 1)
      else closeVerso(true, true)
    }
  }

  function onResize(): void {
    if (phase !== 'open' || !root || !fan) return
    place()
    const nodes = here?.children ?? []
    if (nodes.length === 0) return
    const col = wantColumn(nodes)
    const isCol = fan.dataset.mode === 'column'
    if (col !== isCol) renderLevel(false)
    else if (!col) layoutFan(nodes)
  }

  function build(host: HTMLElement): void {
    main = host
    host.dataset.verso = '1'
    root = el('div', 'sn-verso')
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', '结构')
    const scene = el('div', 'sn-verso-scene')
    leaf = el('div', 'sn-verso-leaf')
    leaf.setAttribute('aria-hidden', 'true')
    leaf.appendChild(el('div', 'sn-verso-leaf-front'))
    map = el('div', 'sn-verso-map')
    crumbs = el('div', 'sn-verso-crumbs')
    const board = el('div', 'sn-verso-board')
    edge = el('div', 'sn-verso-edge')
    const spine = el('div', 'sn-verso-spine')
    backBtn = el('button', 'sn-verso-back', '上一层')
    backBtn.type = 'button'
    backBtn.hidden = true
    backBtn.addEventListener('click', () => {
      if (path.length > 0) goDepth(path.length - 1)
    })
    spineTitle = el('div', 'sn-verso-spine-title')
    spineGist = el('div', 'sn-verso-spine-gist')
    const actions = el('div', 'sn-verso-spine-actions')
    readBtn = el('button', 'sn-verso-textbtn', '展开这段')
    readBtn.type = 'button'
    readBtn.hidden = true
    readBtn.addEventListener('click', () => readSelf())
    jumpBtn = el('button', 'sn-verso-textbtn', '定位到正文')
    jumpBtn.type = 'button'
    jumpBtn.addEventListener('click', () => {
      if (here) jump(here.pos)
    })
    actions.append(readBtn, jumpBtn)
    spine.append(backBtn, spineTitle, spineGist, actions)
    fan = el('div', 'sn-verso-fan')
    svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('class', 'sn-verso-links')
    svg.setAttribute('aria-hidden', 'true')
    cards = el('div', 'sn-verso-cards')
    const empty = el('p', 'sn-verso-empty', '这一层没有再往下的内容')
    fan.append(svg, cards, empty)
    flap = el('div', 'sn-verso-flap')
    board.append(edge, spine, fan, flap)
    map.append(crumbs, board)
    scene.append(leaf, map)
    root.appendChild(scene)
    root.addEventListener('keydown', onKey)
    cards.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest?.('.sn-verso-card')
      if (!(btn instanceof HTMLElement) || !cards?.contains(btn)) return
      activate(Number(btn.dataset.i))
    })
    fan.addEventListener('click', e => {
      if (e.target === fan || e.target === cards || e.target === svg) closeFlap()
    })
    host.appendChild(root)
    ro.observe(scroller)
    ro.observe(fan)
  }

  function playOpen(): void {
    if (!map) return
    if (!motionOk() || !leaf) {
      focusIndex(0)
      return
    }
    const token = ++openToken
    leaf.dataset.dir = 'open'
    let done = false
    const finish = () => {
      if (done || token !== openToken || phase !== 'open') return
      done = true
      window.clearTimeout(timer)
      if (leaf) leaf.style.display = 'none'
      if (root && !root.contains(document.activeElement)) focusIndex(0)
    }
    const timer = window.setTimeout(finish, 900)
    leaf.addEventListener('animationend', finish, { once: true })
  }

  function playClose(finish: () => void): void {
    if (!leaf || !map) {
      finish()
      return
    }
    leaf.style.display = ''
    leaf.style.transform = 'rotateY(-180deg)'
    delete leaf.dataset.dir
    void leaf.offsetWidth
    map.style.visibility = 'hidden'
    leaf.style.transform = ''
    leaf.dataset.dir = 'back'
    let done = false
    const end = () => {
      if (done) return
      done = true
      window.clearTimeout(closeTimer)
      closeTimer = 0
      finish()
    }
    closeTimer = window.setTimeout(end, 900)
    leaf.addEventListener('animationend', end, { once: true })
  }

  function teardown(): void {
    openToken += 1
    if (enterTimer) window.clearTimeout(enterTimer)
    if (closeTimer) window.clearTimeout(closeTimer)
    if (resizeRaf) cancelAnimationFrame(resizeRaf)
    enterTimer = 0
    closeTimer = 0
    resizeRaf = 0
    ro.disconnect()
    window.removeEventListener('keydown', onEscape, true)
    raiseSide(false)
    if (main) delete main.dataset.verso
    stopMedia()
    root?.remove()
    root = null
    map = null
    leaf = null
    fan = null
    cards = null
    svg = null
    crumbs = null
    edge = null
    spineTitle = null
    spineGist = null
    backBtn = null
    readBtn = null
    jumpBtn = null
    flap = null
    tree = null
    here = null
    current = []
    path = []
    flapAt = null
    main = null
  }

  function closeVerso(anim: boolean, focusBack = false): void {
    if (phase === 'closed') return
    if (phase === 'shutting') {
      if (!anim) {
        openToken += 1
        teardown()
        phase = 'closed'
        hooks.onOpenChange(false)
      }
      return
    }
    const animate = anim && motionOk() && leaf !== null
    openToken += 1
    phase = 'shutting'
    const finish = () => {
      if (phase === 'closed') return
      teardown()
      phase = 'closed'
      hooks.onOpenChange(false)
      if (focusBack) hooks.focusToggle()
    }
    if (!animate) finish()
    else playClose(finish)
  }

  function docTitle(view: EditorView): string {
    const fromDoc = String(view.state.doc.attrs.title ?? '').trim()
    if (fromDoc) return fromDoc
    // 外部文件的标题不在 doc 上，在文件名那个输入框里。
    const input = scroller.querySelector('input.sn-pm-title')
    if (input instanceof HTMLInputElement) return input.value.trim()
    return ''
  }

  function takeTree(view: EditorView): MapNode {
    try {
      return structureOf(view.state.doc, docTitle(view))
    } catch (err) {
      reportError('editor-prosemirror', err)
      return fallbackTree()
    }
  }

  /** 结构面盖住正文时，块选区和「评论此块」不该还浮在上面。 */
  function releaseSelection(view: EditorView): void {
    const sel = view.state.selection
    if (sel instanceof TextSelection && sel.empty) return
    const doc = view.state.doc
    if (doc.content.size === 0) return
    const pos = Math.max(0, Math.min(sel.from, doc.content.size))
    try {
      const next = TextSelection.near(doc.resolve(pos))
      if (!next.eq(sel)) view.dispatch(view.state.tr.setSelection(next))
    } catch (err) {
      reportError('editor-prosemirror', err)
    }
  }

  /** 焦点不在结构面上时，Esc 也要能退一层。 */
  function onEscape(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || phase !== 'open' || !root) return
    const pane = root.closest('.sn-pane')
    if (pane && !pane.classList.contains('sn-pane-on')) return
    e.preventDefault()
    e.stopPropagation()
    if (flapAt !== null) closeFlap()
    else if (path.length > 0) goDepth(path.length - 1)
    else closeVerso(true, true)
  }

  function openVerso(view: EditorView): void {
    const host = scroller.parentElement
    if (!host || phase !== 'closed') return
    releaseSelection(view)
    editor = view
    phase = 'open'
    hooks.onOpenChange(true)
    tree = takeTree(view)
    path = []
    flapAt = null
    cursor = 0
    build(host)
    place()
    raiseSide(true)
    window.addEventListener('keydown', onEscape, true)
    renderLevel(true)
    playOpen()
  }

  return {
    toggle(view) {
      editor = view
      if (phase === 'shutting') return
      if (phase === 'open') closeVerso(true)
      else openVerso(view)
    },
    sync(view) {
      editor = view
      if (phase !== 'open') return
      const savedPath = path.slice()
      const savedCursor = cursor
      const savedFlap = flapAt
      tree = takeTree(view)
      path = savedPath
      cursor = savedCursor
      flapAt = savedFlap
      renderLevel(false)
    },
    destroy() {
      closeVerso(false)
    },
  }
}
