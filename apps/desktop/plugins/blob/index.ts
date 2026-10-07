/**
 * 图片 / 附件 blob 的**前端**（D-0027）。
 *
 * 只做前端该做的：
 *   1. 三种来源（粘贴 / 拖拽 / 文件选择）→ `blob:put`（字节 base64 走 `ctx.rpc`，Rust 按 sha 去重）
 *   2. **零等待**：拿到 File 立刻 `URL.createObjectURL` 画出来，落库成功再换成稳定 URL
 *   3. 非图片附件也能存，只是不渲染成 `<img>`
 *
 * **不做**：注册 `self-notion://` 协议（那是 `lib.rs` 的活，S1 在做）；块类型（Stage 2 的 A）。
 */
import type { Context } from 'cordis'

export const name = 'blob'

// 唯一硬依赖是 rpc。slot / i18n 由组合根（main.tsx）无条件提供，不必 inject
// （同 editor-blocksuite —— 它也用 ctx.slot 而不 inject）。
export const inject = ['rpc']

/** 顶栏那颗入口按钮撤了（顶栏不放图标）—— 板子暂时没有 UI 入口，`BlobBoard` 留在
 *  `./board.ts` 里。落库那条路（`putBlob`）不受影响，等「图片 / 附件」块类型落地再挂回去。 */
export function apply(_ctx: Context) {}

// 落库逻辑导出，供测试与（未来的）块类型复用。
export { bytesToBase64, putBlob, type StoredBlob } from './blob'
