/** 同一个前端跑在两种壳里：Tauri 桌面（默认）和手机网页（`vite build --mode web`）。 */
export const isWeb = import.meta.env.MODE === 'web'

/** 网页端还是不是 Tauri —— 有些地方要的是「有没有原生能力」，不是「是不是 web 模式」。 */
export const hasTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
