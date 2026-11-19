/**
 * 编辑器里要的几个小图标 —— 内联 SVG，**不引图标库**。
 *
 * ★ 这个插件一直不依赖 `@blocksuite/icons`（那是外壳在用）；斜杠菜单当年用字符画（`H1` / `▤`），
 *   到了按钮和元信息这行就不能再糊了 —— 画成 24 格、`currentColor`，颜色跟着文字走。
 */
const NS = 'http://www.w3.org/2000/svg'

function icon(size: number, paths: readonly string[]): SVGSVGElement {
  const el = document.createElementNS(NS, 'svg')
  el.setAttribute('viewBox', '0 0 24 24')
  el.setAttribute('width', String(size))
  el.setAttribute('height', String(size))
  el.setAttribute('fill', 'none')
  el.setAttribute('stroke', 'currentColor')
  el.setAttribute('stroke-width', '1.7')
  el.setAttribute('stroke-linecap', 'round')
  el.setAttribute('stroke-linejoin', 'round')
  el.setAttribute('aria-hidden', 'true')
  for (const d of paths) {
    const p = document.createElementNS(NS, 'path')
    p.setAttribute('d', d)
    el.appendChild(p)
  }
  return el
}

/** 大纲：三行，每行一个点。 */
export function listIcon(size = 14): SVGSVGElement {
  return icon(size, ['M9 6h11M9 12h11M9 18h11', 'M4.5 6h.01M4.5 12h.01M4.5 18h.01'])
}

/** 锚点：书签。 */
export function bookmarkIcon(size = 14): SVGSVGElement {
  return icon(size, ['M7 3.5h10v17l-5-3.6-5 3.6z'])
}

/** 创建时间。 */
export function calendarIcon(size = 14): SVGSVGElement {
  return icon(size, [
    'M4 8.5h16',
    'M8 4v3M16 4v3',
    'M6 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  ])
}

/** 反向链接。 */
export function linkIcon(size = 14): SVGSVGElement {
  return icon(size, [
    'M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ])
}

/** 字数。 */
export function pageIcon(size = 14): SVGSVGElement {
  return icon(size, [
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
    'M14 3v5h5',
  ])
}
