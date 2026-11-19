/**
 * 往剪贴板写一段字。**本仓库里只有这一条路**，不再直接调 `navigator.clipboard`。
 *
 * WKWebView 里 `navigator.clipboard.writeText` 会被直接拒 —— `errors.log` 实锤：
 * `The request is not allowed by the user agent or the platform…`（点了「拷贝链接」什么都不发生，
 * 界面上也不报）。所以先试标准那套，不行就退回 `execCommand('copy')`（WKWebView 认这个）。
 *
 * 两条都失败就抛出去，由调用方 `reportError` 收（AGENTS.md §3）。
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // 落到下面
  }
  if (execCopy(text)) return
  throw new Error('写剪贴板失败（navigator.clipboard 与 execCommand 都不让写）')
}

/**
 * 把一张图写进剪贴板（`src` 用渲染 URL，图已经在页面上加载过）。
 *
 * ★ 先走「把 `<img>` 选中 + `execCommand('copy')`」这条：WKWebView 跟写文字一样，
 *   `navigator.clipboard.write` 常被拒，而 execCommand 它认。这一步必须同步 —— 点击之后再 await，
 *   手势就没了。标准 API 当兜底（网页端 / 被拒时）。
 */
export async function copyImage(src: string): Promise<void> {
  if (!src) throw new Error('没有图片可复制')
  if (execCopyImage(src)) return
  const res = await fetch(src)
  const blob = await res.blob()
  if (typeof ClipboardItem === 'undefined') throw new Error('这个环境不支持写图片剪贴板')
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
}

function execCopyImage(src: string): boolean {
  const host = document.createElement('div')
  host.contentEditable = 'true'
  host.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
  const img = document.createElement('img')
  img.src = src
  host.appendChild(img)
  document.body.appendChild(host)
  const range = document.createRange()
  range.selectNodeContents(host)
  const sel = window.getSelection()
  const keep = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null
  sel?.removeAllRanges()
  sel?.addRange(range)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    sel?.removeAllRanges()
    if (keep && sel) sel.addRange(keep)
    host.remove()
  }
  return ok
}

/** 老办法：临时塞一个 textarea、选中、`execCommand`。选中的那一下要在同一帧里做完。 */
function execCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  return ok
}
