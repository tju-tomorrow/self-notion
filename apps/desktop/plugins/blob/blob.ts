/**
 * 图片 / 附件的**落库前端**（D-0027）—— 纯逻辑，不碰 DOM，方便单测。
 *
 * 只做一件事：把一份 `Blob` 变成库里的一个 blob，回一个**稳定 URL**。
 *   字节 → base64（线格式，D-0047）→ `blob:put`（Rust 按内容 sha256 去重）→ `blob:getUrl`
 *
 * 渲染走 `self-notion://blob/<id>`（`blob:getUrl` 回的），**字节不进 JS 堆** —— 大图不占内存。
 */
import type { RpcService } from '../../src/kernel/contract'

export interface StoredBlob {
  id: string
  /** 稳定 URL：`self-notion://blob/<id>`，由 `blob:getUrl` 给 */
  url: string
  mime: string
  size: number
  /** 库里本来就有这份内容 —— 这次白传了 */
  dedup: boolean
  isImage: boolean
}

/** `blob:put` 的返回（`store::blob::BlobMeta`，camelCase）。 */
interface BlobMeta {
  id: string
  mime: string
  size: number
  dedup: boolean
}

// `String.fromCharCode(...bytes)` 一个字节一个参数，整块 1 MB 喂进去会**爆栈**
// （引擎的参数上限约 6.5 万）。按块切，块大小稳稳低于任何引擎上限 —— 同 plugin-storage。
const CHUNK = 0x8000 // 32768

export function bytesToBase64(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    raw += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(raw)
}

/** 存一份 blob，回稳定 URL。同图两次调用 Rust 侧天然 dedup（id 就是内容 sha）。 */
export async function putBlob(rpc: RpcService, blob: Blob): Promise<StoredBlob> {
  const mime = blob.type || 'application/octet-stream'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const meta = await rpc.call<BlobMeta>('blob:put', { bytes: bytesToBase64(bytes), mime })
  const url = await rpc.call<string>('blob:getUrl', { id: meta.id })
  return {
    id: meta.id,
    url,
    mime: meta.mime,
    size: meta.size,
    dedup: meta.dedup,
    isImage: meta.mime.startsWith('image/'),
  }
}
