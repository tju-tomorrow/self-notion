/**
 * 复制页面时的名字：`标题 (1)`、`标题 (2)`、`标题 (3)…` —— 只在**同一个父级**里数，
 * 取已有的最大编号 + 1（Notion 的规矩）。
 */
export function nextCopyTitle(
  base: string,
  parentId: string | null,
  docs: readonly { title: string; parentId: string | null }[],
): string {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${escaped} \\((\\d+)\\)$`)
  let max = 0
  for (const doc of docs) {
    if (doc.parentId !== parentId) continue
    const hit = re.exec(doc.title)
    if (hit) max = Math.max(max, Number(hit[1]))
  }
  return `${base} (${max + 1})`
}

/** 标题有两份：`documents.title` 和正文 JSON 的 `doc.attrs.title`。改就一起改。 */
export function retitleDocJson(content: string, title: string): string {
  try {
    const json = JSON.parse(content) as { attrs?: Record<string, unknown> }
    if (typeof json !== 'object' || json === null) return content
    json.attrs = { ...json.attrs, title }
    return JSON.stringify(json)
  } catch {
    return content
  }
}
