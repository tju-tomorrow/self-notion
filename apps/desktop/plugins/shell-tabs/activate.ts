/**
 * 让主区切到某个标签。**画布走自己的事件** —— 文档向的插件（编辑器、评论、版本历史…）
 * 不该看见 `sn:drawio:` 这种 id；漏进 `OPEN_DOC` 会被当成一篇文档去 `doc:open`。
 */
import type { Context } from 'cordis'

import { OPEN_CANVAS, OPEN_DOC, drawioTabParts } from '../../src/kernel/contract'

export function activateTab(ctx: Context, id: string): void {
  const canvas = drawioTabParts(id)
  if (canvas) ctx.emit(OPEN_CANVAS, canvas)
  else ctx.emit(OPEN_DOC, { id })
}
