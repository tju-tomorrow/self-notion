/**
 * 前端错误也往 `<app data>/errors.log` 写（跟 Rust 同一个文件），并在右上角浮出来。
 *
 * 为什么要浮出来：Shell 起不来的时候 DevTools 未必开着，得有一眼能看见的地方。
 * 浮层用原生 DOM 直接挂到 body，不走 React —— 出错时 React 树本身就是可疑对象。
 */
const MAX_SHOWN = 5
const shown: string[] = []

/** 自己 catch 到的错误从这儿报。 */
export function reportError(source: string, err: unknown): void {
  record(source, describeThrown(err))
}

/**
 * 抛出来的东西 → 一行能看的字。
 *
 * ★ 对象**必须** `JSON.stringify`，不能 `String()` —— 我们自己的 `ApiError` 是
 *   `{code, message}`，`String()` 出来是 `[object Object]`，日志里等于什么都没写
 *   （实测：`boot:ready 失败：[object Object]`，真正的 message 就在对象里）。
 */
export function describeThrown(err: unknown): string {
  if (err instanceof Error) return `${err.message}\n${err.stack ?? ''}`
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/**
 * 只写日志、**不弹红框** —— 给「不是错误但得能查到」的事用（块什么时候来/没的这类）。
 * `reportError` 会往右上角浮一层，拿它当调试打印机不合适。
 */
export function reportNote(source: string, message: string): void {
  console.info(`[${source}]`, message)
  void import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke('api', { req: { method: 'log:error', args: { source, message } } }),
    )
    .catch(() => {})
}

function record(source: string, message: string): void {
  console.error(`[${source}]`, message)
  // 日志文件是权威；桥断了也不能让报错本身再炸一次。
  void import('@tauri-apps/api/core')
    .then(({ invoke }) =>
      invoke('api', { req: { method: 'log:error', args: { source, message } } }),
    )
    .catch(() => {})
  show(`${source}: ${message}`)
}

function show(line: string): void {
  shown.push(line)
  if (shown.length > MAX_SHOWN) shown.shift()

  let box = document.getElementById('sn-errors')
  if (!box) {
    box = document.createElement('div')
    box.id = 'sn-errors'
    box.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'z-index:2147483647', 'max-width:46ch',
      'max-height:50vh', 'overflow:auto', 'padding:8px 10px', 'border-radius:6px',
      'background:rgba(160,20,20,.94)', 'color:#fff', 'font:11px/1.45 ui-monospace,monospace',
      'white-space:pre-wrap', 'pointer-events:auto',
    ].join(';')
    box.addEventListener('click', () => box?.remove())
    document.body.appendChild(box)
  }
  box.textContent = shown.join('\n\n')
}

/** 在 `main()` 最开头调一次。 */
export function installErrorSink(): void {
  window.addEventListener('error', (e) => {
    // 带上调用栈 —— 光一句 `Service [X] not found` 是查不出谁在要它的。
    const where = e.error instanceof Error && e.error.stack ? `\n${e.error.stack}` : ''
    record('window', `${e.message}${where}`)
  })
  window.addEventListener('unhandledrejection', (e) => reportError('promise', e.reason))
}
