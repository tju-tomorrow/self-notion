/**
 * `vfs_read` 读到的 markdown 里，图片只剩 `self-notion://blob/<id>`。
 * 内置助手要把字节一起发给模型，所以在这里把引用换成 `[图片 N]` 并按顺序收集图片。
 */
import type { Context } from 'cordis'
import type { AiImage } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'

const REF = /!?\[[^\]\n]*\]\(self-notion:\/\/blob\/([0-9a-f]+)\)/g
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_IMAGE_BYTES = 2_500_000
const MAX_TOTAL_BYTES = 8_000_000
const MAX_IMAGES = 8

interface BlobInfo {
  id: string
  mime: string
  size: number
}

export interface ReadWithImages {
  text: string
  images: AiImage[]
}

export async function readWithImages(ctx: Context, text: string): Promise<ReadWithImages> {
  const matches = [...text.matchAll(REF)]
  if (!matches.length) return { text, images: [] }

  const images: AiImage[] = []
  const seen = new Map<string, number>()
  let total = 0
  let out = ''
  let last = 0

  for (const match of matches) {
    const at = match.index ?? 0
    out += text.slice(last, at)
    last = at + match[0].length
    out += await markerFor(match[1] ?? '')
  }
  out += text.slice(last)
  return { text: out, images }

  async function markerFor(id: string): Promise<string> {
    // 同一张图出现两次只发一份，标记指向第一次的编号。
    const seenAt = seen.get(id)
    if (seenAt !== undefined) return `[图片 ${seenAt}]`

    let info: BlobInfo | null
    try {
      info = await ctx.rpc.call<BlobInfo | null>('blob:meta', { id })
    } catch (err) {
      reportError('tools', err)
      return `[图片读取失败 ${id}]`
    }
    if (!info) return `[附件缺失 ${id}]`
    if (!IMAGE_MIMES.has(info.mime)) return `[附件 ${info.mime} ${size(info.size)}]`
    if (info.size > MAX_IMAGE_BYTES) return `[图片过大 ${info.mime} ${size(info.size)}]`
    if (images.length >= MAX_IMAGES || total + info.size > MAX_TOTAL_BYTES) {
      return '[图片超出单次上限]'
    }

    try {
      const image = await load(id)
      seen.set(id, images.length + 1)
      images.push(image)
      total += info.size
      return `[图片 ${images.length}]`
    } catch (err) {
      reportError('tools', err)
      return `[图片读取失败 ${id}]`
    }
  }
}

async function load(id: string): Promise<AiImage> {
  const res = await fetch(`self-notion://blob/${id}`)
  if (!res.ok) throw new Error(`blob ${res.status}`)
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
  return { mime, data: base64(new Uint8Array(await res.arrayBuffer())) }
}

/** `btoa` 收字符串；一次展开几十 MB 的数组会爆栈，所以分块。 */
function base64(bytes: Uint8Array): string {
  const chunk = 0x8000
  let out = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(out)
}

function size(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
}
