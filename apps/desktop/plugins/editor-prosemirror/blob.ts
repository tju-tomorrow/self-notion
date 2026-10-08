/**
 * 往库里存图片 / 附件。**只做存** —— 取图走 `self-notion://blob/<id>`（浏览器自己 fetch，
 * 见 `lib.rs` 的协议处理），这一层不掺和。
 *
 * ★ 为什么不 import `plugins/blob/`：插件之间不许 import 内部文件（CONVENTIONS §6.2）——
 *   旧编辑器也是自己 `rpc.call('blob:put')` 的。这一层跟 `doc-meta.ts` 一样，是个无依赖的口子，
 *   由 `index.ts` 在装载时接上真正的 rpc。
 */
export type PutBlob = (file: Blob) => Promise<string>

let put: PutBlob | undefined

export function setPutBlob(fn: PutBlob): void {
  put = fn
}

/** 存一份字节，回 blob id（Rust 按内容 sha256 去重，同一个文件不会存两遍）。 */
export async function putBlob(file: Blob): Promise<string> {
  if (!put) throw new Error('blob 上传还没接上 —— 要先 await ctx.editor.ready()')
  return put(file)
}
