/**
 * 本窗口的身份：主窗口是 `main`，多开出来的是 `win-N`（Rust `src/windows.rs`）。
 *
 * ★ 为什么要问这个：窗口之间共享 localStorage 和 Rust 进程 —— 「哪些标签开着」这类
 *   每窗口一份的状态要是都往同一个键里写，两个窗口就会互相顶掉。
 */
import { getCurrentWindow } from '@tauri-apps/api/window'

export const windowLabel: string = (() => {
  try {
    return getCurrentWindow().label
  } catch {
    // 没跑在 Tauri 里（vite 预览）：当主窗口，别让整个前端挂在这上面
    return 'main'
  }
})()

export const isMainWindow = windowLabel === 'main'
