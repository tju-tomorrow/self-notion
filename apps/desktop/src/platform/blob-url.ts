/**
 * blob 的渲染 URL。**持久化仍是 `self-notion://blob/<id>`** —— 那是文档 JSON 和 markdown
 * 投影里认的格式，跨端不变。只有「喂给 `<img>` / `fetch` 的那一下」在网页端换成同源 `/blob/<id>`。
 */
import { isWeb } from './env'

export const BLOB_PREFIX = 'self-notion://blob/'
export const DOC_PREFIX = 'self-notion://doc/'

export function blobUrl(id: string): string {
  return isWeb ? `/blob/${id}` : BLOB_PREFIX + id
}

export function blobIdFrom(src: string): string | null {
  if (src.startsWith(BLOB_PREFIX)) return src.slice(BLOB_PREFIX.length)
  if (src.startsWith('/blob/')) return src.slice('/blob/'.length)
  return null
}
