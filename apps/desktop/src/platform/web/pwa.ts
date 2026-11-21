/** PWA 壳：Service Worker + 持久化存储（被系统清掉不是致命，但能要就要）。 */
import { reportError } from '../../kernel/errors'

export function installPwa(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => reportError('pwa', err))
    // 桌面端更新后，新的 Service Worker 接管时自动重载一次 —— 不用再教用户
    // “划掉后台 / 删图标重装”。本地库在 IndexedDB 里，重载不丢数据。
    let once = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (once) return
      once = true
      // 给编辑器一点时间把攒着的改动落库（D-0199），别在打字途中把人刷掉。
      window.dispatchEvent(new CustomEvent('sn:before-update'))
      window.setTimeout(() => location.reload(), 1200)
    })
  }
  // iOS 15+ / Chrome 支持。拒绝也无所谓 —— 桌面还有一份。
  void navigator.storage?.persist?.().catch(() => {})
}
