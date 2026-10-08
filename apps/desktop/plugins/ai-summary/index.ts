/**
 * 每篇笔记的一句话 / 一段话总结 + 实体（D-0042 的第一个消费者，见 `docs/ai.md`）。
 *
 * 三件事：
 *   1. 顶栏动作区里一颗按钮（`doc.header.actions`，落在 ☆ 左边）—— 有总结就显示那句话；
 *   2. 点开的浮层里是完整的一段话 + 实体 + 「重新总结」；
 *   3. 设置页一段 —— 填 baseUrl / model / key（BYO endpoint）。
 *
 * ★ 联网、key、**存盘**全在 Rust（`src-tauri/src/ai/` + `doc_summary` 表）。插件只经 `ctx.rpc`
 *   调 `ai:summary` / `ai:summarize` 两条，所以**不声明 `net`**（D-0032 / D-0042），
 *   也不在本地留一份缓存（两处各存一份就会漂）。
 * ★ 「当前是哪一篇」在这里订阅、状态放模块级 —— 组件的挂载晚于 `OPEN_DOC`。
 */
import { createElement } from 'react'
import type { Context } from 'cordis'
import { CLOSE_ALL, OPEN_DOC, SHOW_LIST, type OpenDocEvent } from '../../src/kernel/contract'
import { reportError } from '../../src/kernel/errors'
import { AiSection, SummaryEntry } from './view'
import { getSummaryState, setSummaryState, type StoredSummary } from './state'

export const name = 'ai-summary'

// rpc：三条 ai:* 命令；slot：顶栏那一格和设置页那一段。
export const inject = ['rpc', 'editor', 'slot', 'i18n']

/** 切到一篇文档：换掉盯着的 id，然后把盘上那份读回来。 */
function enterDoc(ctx: Context, id: string): void {
  setSummaryState({ docId: id, open: false, busy: false, error: '', data: null })
  void ctx.rpc
    .call<StoredSummary>('ai:summary', { id })
    .then((stored) => {
      // 中途切走了就别再写状态。
      if (getSummaryState().docId !== id) return
      setSummaryState({ data: stored })
    })
    .catch((err: unknown) => reportError('ai-summary', err))
}

/** 离开文档（回首页 / 切列表）。浮层和按钮都不该留着。 */
function leaveDoc(): void {
  setSummaryState({ docId: null, open: false, busy: false, error: '', data: null })
}

/** 点按钮：开 / 关浮层。 */
function toggle(): void {
  const st = getSummaryState()
  if (st.docId === null) return
  setSummaryState({ open: !st.open, error: '' })
}

function close(): void {
  if (getSummaryState().open) setSummaryState({ open: false })
}

/**
 * 找模型要一份新的，Rust 那边顺手存盘。
 *
 * ★ 把**活文档**的正文一并递过去（D-0110）：用户正文里刚敲的字还没落库，库里的投影是
 *   上一拍的副本 —— 总结要的是他眼前这篇。拿不到（没打开过）就递 null，Rust 回库读。
 */
async function summarize(ctx: Context): Promise<void> {
  const st = getSummaryState()
  if (st.docId === null || st.busy) return
  const id = st.docId
  setSummaryState({ busy: true, error: '' })
  try {
    const made = await ctx.rpc.call<StoredSummary>('ai:summarize', {
      id,
      text: ctx.editor.text(id),
    })
    if (getSummaryState().docId !== id) return
    setSummaryState({ data: made, busy: false })
  } catch (err) {
    if (getSummaryState().docId === id) setSummaryState({ busy: false, error: text(err) })
    // 「还没配」「没正文」是用户自己能解决的状态，不是故障 —— 不往 errors.log 里丢噪声。
    const msg = text(err)
    if (!msg.includes('ai_not_configured') && !msg.includes('ai_empty')) reportError('ai-summary', err)
  }
}

function text(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function apply(ctx: Context) {
  ctx.on(OPEN_DOC, ({ id }: OpenDocEvent) => enterDoc(ctx, id))
  ctx.on(CLOSE_ALL, leaveDoc)
  ctx.on(SHOW_LIST, leaveDoc)

  ctx.effect(() =>
    ctx.slot.register('doc.header.actions', () =>
      createElement(SummaryEntry, {
        ctx,
        onToggle: toggle,
        onGenerate: () => void summarize(ctx),
        onClose: close,
      }),
    ),
  )

  const section = () => createElement(AiSection, { ctx })
  ;(section as { label?: string }).label = ctx.i18n.t('ai.title')
  ;(section as { group?: string }).group = 'integration'
  ctx.effect(() => ctx.slot.register('settings.section', section))
}
