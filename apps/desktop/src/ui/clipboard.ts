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
