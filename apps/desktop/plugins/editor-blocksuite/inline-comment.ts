/**
 * 行内评论：正文 delta 上的锚点 + 读选区 + 点高亮的出口。
 *
 * ★ 锚点是**一个固定属性键** `comment`，值 = 逗号拼的评论 id 列表 —— 不是上游那种一个 id
 *   一个键：0.22.4 的 `normalizeAttributes` 按 schema strip 掉未知键，动态键根本写不进去
 *   （不报错，只是没效果）。理由和代价见 `docs/comment.md` §三。
 * ★ 所以打 / 擦标记都按 delta **分段**求并集再逐段写：整段一把写会盖掉同一段里别的评论 id。
 *
 * 这一层不认识 `ctx`，也不认识评论插件 —— 点高亮要说什么出去，由 `shell.openComment` 转。
 */
import { ViewExtensionProvider, type ViewExtensionContext } from '@blocksuite/affine/ext-loader'
import { DefaultInlineManagerExtension } from '@blocksuite/affine/inlines/preset'
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types'
import { BlockSelection, ShadowlessElement, StdIdentifier, TextSelection, type BlockStdScope } from '@blocksuite/affine/std'
import { InlineManager, InlineSpecExtension, InlineSpecIdentifier, type InlineSpecs } from '@blocksuite/affine/std/inline'
import { baseTextAttributes, type BlockModel, type DeltaInsert, type Store } from '@blocksuite/affine/store'
import { css, html } from 'lit'
import { property } from 'lit/decorators.js'

import type { BlockAnchorInfo, CommentState, TextAnchorInfo } from '../../src/kernel/contract'
import { reportError, reportNote } from '../../src/kernel/errors'
import { withoutHistory } from './history'
import { shell } from './shell'

const ATTR = 'comment'

/** 库里那条评论解决没有 —— 高亮只给未解决的。评论插件每次列表变化推一次。 */
let states = new Map<string, boolean>()
let revealed: string | null = null
const listeners = new Set<() => void>()

function idsOf(raw: unknown): string[] {
  return typeof raw === 'string' && raw ? raw.split(',') : []
}

export function setCommentStates(list: readonly CommentState[]): void {
  states = new Map(list.map((s) => [s.id, s.resolved]))
  for (const cb of listeners) cb()
}

/** 滚到某条评论的锚点并闪一下（面板里点一条评论）。锚点不在正文里就什么都不做。 */
export function revealComment(id: string): void {
  const el = document.querySelector(`inline-comment[data-ids~="${CSS.escape(id)}"]`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  revealed = id
  for (const cb of listeners) cb()
  setTimeout(() => {
    if (revealed !== id) return
    revealed = null
    for (const cb of listeners) cb()
  }, 1600)
}

/* ────────────────────────── 锚点 ────────────────────────── */

/** 一段范围落在哪些 delta 上 —— 每段的绝对偏移和它原有的 id 列表。全materialize 完再写。 */
function segments(text: { toDelta(): { insert?: string; attributes?: unknown }[] }, index: number, length: number) {
  const out: { index: number; length: number; ids: string[] }[] = []
  let offset = 0
  for (const delta of text.toDelta()) {
    const len = (delta.insert ?? '').length
    const from = Math.max(offset, index)
    const to = Math.min(offset + len, index + length)
    if (to > from) {
      out.push({ index: from, length: to - from, ids: idsOf((delta.attributes as Record<string, unknown>)?.comment) })
    }
    offset += len
  }
  return out
}

/** 给一段范围打上锚点。已经在里面的 id 跳过 —— 重复评论同一句话不该有两份。 */
export function addInlineAnchor(store: Store, blockId: string, id: string, index: number, length: number): void {
  const text = store.getModelById(blockId)?.text
  if (!text || length <= 0) return
  withoutHistory(store, () => {
    for (const seg of segments(text, index, length)) {
      if (seg.ids.includes(id)) continue
      text.yText.format(seg.index, seg.length, { [ATTR]: [...seg.ids, id].join(',') })
    }
  })
}

/** 擦掉某条评论在整篇里的锚点。返回擦了几处（0 = 它本来就不在正文里）。 */
export function removeAnchor(store: Store, id: string): number {
  let hit = 0
  for (const model of store.getAllModels()) {
    const text = model.text
    if (!text) continue
    withoutHistory(store, () => {
      for (const seg of segments(text, 0, text.length)) {
        if (!seg.ids.includes(id)) continue
        const rest = seg.ids.filter((x) => x !== id)
        text.yText.format(seg.index, seg.length, { [ATTR]: rest.length ? rest.join(',') : null })
        hit++
      }
    })
  }
  return hit
}

/* ────────────────────────── 读选区 ────────────────────────── */

/** 屏幕上的矩形 —— 浮出按钮靠它定位。取不到就给个空的。 */
function rectOf(): DOMRect {
  try {
    return window.getSelection()?.getRangeAt(0).getBoundingClientRect() ?? new DOMRect()
  } catch {
    return new DOMRect()
  }
}

function slice(text: BlockModel['text'], index: number, length: number): string {
  if (!text) return ''
  return text.toString().slice(index, index + length).trim().slice(0, 200)
}

/** 当前文字选区。光标（没选中东西）→ null。跨块时**只取第一块**那段（见 docs/comment.md）。 */
export function readTextSelection(std: BlockStdScope): TextAnchorInfo | null {
  const sel = std.selection.find(TextSelection)
  if (!sel || sel.isCollapsed()) return null
  const start = sel.start
  const model = std.store.getModelById(start.blockId)
  if (!model?.text) return null
  // `to` 为空 = 单块选区，长度在 `from.length` 上；非空时两端各是一个点，得自己相减。
  const end = sel.to === null ? null : sel.end
  const length =
    end === null
      ? start.length
      : end.blockId === start.blockId
        ? Math.max(0, end.index - start.index)
        : model.text.length - start.index
  if (length <= 0) return null
  return {
    blockId: start.blockId,
    index: start.index,
    length,
    quote: slice(model.text, start.index, length),
    rect: rectOf(),
  }
}

/** 当前块选区（点拖拽手柄选中的那块）—— 图片 / 表格这类没法选文字的东西靠它评论。 */
export function readBlockSelection(std: BlockStdScope): BlockAnchorInfo | null {
  const sel = std.selection.find(BlockSelection)
  if (!sel) return null
  const model = std.store.getModelById(sel.blockId)
  if (!model) return null
  return {
    blockId: sel.blockId,
    quote: model.text ? slice(model.text, 0, model.text.length) : '',
    rect: rectOf(),
  }
}

/* ────────────────────────── 渲染 ────────────────────────── */

class InlineCommentElement extends ShadowlessElement {
  // ShadowlessElement 把 static styles 注入到全局，所以选择器要自己带标签名（上游同一套）。
  // 底色走主题里那三个 token（亮/暗各一份，`@toeverything/theme` 的 style.css），
  // 兜底值抄的就是它们 —— 主要防主题包里哪天改名。
  static override styles = css`
    inline-comment {
      display: inline;
      cursor: pointer;
    }

    inline-comment.unresolved {
      background-color: var(--affine-v2-block-comment-highlightDefault, #1e96eb14);
      border-bottom: 2px solid var(--affine-v2-block-comment-highlightUnderline, #1e96ebb2);
    }

    inline-comment.highlighted {
      background-color: var(--affine-v2-block-comment-highlightActive, #1e96eb4d);
    }
  `

  @property({ attribute: false }) accessor ids: string[] = []
  @property({ attribute: false }) accessor text = ''
  /** 整段 delta —— 转手交给 `affine-text` 画（见 `render()` 那段注释）。 */
  @property({ attribute: false }) accessor delta: DeltaInsert<AffineTextAttributes> = {
    insert: '',
  }

  private readonly refresh = () => this.requestUpdate()
  private readonly onClick = () => {
    const live = this.ids.find((id) => !states.get(id))
    shell?.openComment(live ?? this.ids.at(-1) ?? '')
  }

  override connectedCallback() {
    super.connectedCallback()
    listeners.add(this.refresh)
    this.addEventListener('click', this.onClick)
  }

  override disconnectedCallback() {
    listeners.delete(this.refresh)
    this.removeEventListener('click', this.onClick)
    super.disconnectedCallback()
  }

  override willUpdate() {
    this.dataset.ids = this.ids.join(' ')
    this.classList.toggle('unresolved', this.ids.some((id) => !states.get(id)))
    this.classList.toggle('highlighted', revealed !== null && this.ids.includes(revealed))
  }

  override render() {
    // ★ 交回给预设那个 `<affine-text>` 画，别自己 `v-text` 重画一遍。
    //
    //   上游的 `InlineManager.getRenderer()` 是「**只跑一个**：specs 从后往前，第一个 match
    //   的 renderer 说了算」（`inline/extensions/inline-manager.ts:35`）。预设那几条
    //   （bold / italic / underline / strike / code / color）之所以叠得住，是因为它们**都**
    //   返回 `<affine-text .delta=…>` —— 那个元素一次把**所有**属性画上（`affineTextStyles`）。
    //   原来我们这条返回自己那个 `<inline-comment>` 并用 `v-text` 重画文字 → 谁在它前面
    //   匹配上都没用：粗体、斜体、下划线**全被吃掉**（用户：「点了没效果」、截图上 B/I/U
    //   是激活态而字一点变化没有）。
    //   现在只**包一层**高亮，字交回 `affine-text` 画 —— 两者都留得住。
    return html`<affine-text .delta=${this.delta}></affine-text>`
  }
}

export const CommentInlineSpecExtension = InlineSpecExtension<AffineTextAttributes>('comment', () => ({
  name: ATTR,
  // 值就是 id 列表字符串，形状和 `link` 一模一样。**不 import zod** —— 它只是 BlockSuite
  // 的传递依赖，本项目没直接依赖它，借现成那个属性 schema 最省事。
  schema: baseTextAttributes.shape.link,
  match: (delta: DeltaInsert<AffineTextAttributes>) => !!idsOf((delta.attributes as Record<string, unknown>)?.comment).length,
  renderer: ({ delta }: { delta: DeltaInsert<AffineTextAttributes> }) =>
    html`<inline-comment
      .ids=${idsOf((delta.attributes as Record<string, unknown>)?.comment)}
      .text=${delta.insert}
      .delta=${delta}
    ></inline-comment>`,
}))

export class CommentViewExtension extends ViewExtensionProvider {
  override name = 'self-comment-inline'

  override effect() {
    super.effect()
    if (!customElements.get('inline-comment')) customElements.define('inline-comment', InlineCommentElement)
  }

  override setup(context: ViewExtensionContext) {
    super.setup(context)
    context.register(CommentInlineSpecExtension)
    context.register({
      // ★ 光注册一条 spec 没用：`DefaultInlineManager` 的 spec 清单是**硬编码**的，
      //   它只 `provider.get()` 自己那张表里的 identifier —— 表外的 spec 它永远看不见
      //   （症状是标记写得进去、界面上什么都没变）。所以只能把它整个换掉，
      //   用 DI 里**实际注册过**的 spec 重建。照抄上游那张表也行，但会漂。
      setup: (di) => {
        di.override(DefaultInlineManagerExtension.identifier, (provider) => {
          // ★ latex 那两条 spec **不参与渲染**（D-0127）：它的行内节点每次渲染都会往正文里
          //   补占位控制符（`U+001C` + `U+001D`×n，见下面那段注释），按一次方向键补一个 ——
          //   全写进模型，渲染成一排方框。用户不用 latex，所以直接把它从这张表里划掉。
          //   ★ spec 本身还**注册着**：上游那张硬点名清单（`DefaultInlineManagerExtension`）
          //     要它，摘了注册会在建 manager 时抛 Missing dependency。注册归注册，不画。
          const OFF = new Set(['latex', 'latex-editor-unit'])
          const specs = ([...provider.getAll(InlineSpecIdentifier).values()] as InlineSpecs<AffineTextAttributes>[]).filter(
            (s) => !OFF.has(s.name),
          )
          // 不报的话症状是「标记写进去了、界面上没颜色」—— 那种错最难查，所以这里吵一声。
          if (!specs.some((s) => s.name === ATTR)) {
            reportError('comment', new Error('行内评论的 spec 没进 DefaultInlineManager'))
          }
          // ★★ 兜底型的 spec 排到**最前**（= 优先级最低）。
          //
          //   `getRenderer` 是「specs 从后往前扫，**第一个** match 的说了算」
          //   （`std/src/inline/extensions/inline-manager.ts:35`）。而 latex 包里有一条
          //
          //     LatexEditorUnitSpecExtension: { name: 'latex-editor-unit',
          //                                     match: () => true,            ← 匹配一切
          //                                     renderer: delta => html`<latex-editor-unit …>` }
          //
          //   —— 它匹配**任何** delta。排在后面就把每一段文字都截走、包成 latex 单元，
          //   粗体 / 斜体 / 下划线一个都画不出来（实测渲染出来就是
          //   `<v-element data-v-element><latex-editor-unit><v-text>`，而工具条上 B/I/U
          //   还是激活态 —— 用户：「点了没效果」）。
          //
          //   上游那张**硬编码**清单里没有它（所以 AFFiNE 没这毛病）；我们这份是从 DI 重建的，
          //   是个**超集**，捞进来了就得自己排：谁对「没有任何属性的一段纯文字」也 match，
          //   谁就是兜底，往后站。判据就是这个 —— 拿一段没属性的 delta 挨个问。
          const plain = { insert: 'x' } as DeltaInsert<AffineTextAttributes>
          const isFallback = (s: InlineSpecs<AffineTextAttributes>) => {
            try {
              return Boolean(s.match(plain))
            } catch {
              return false
            }
          }
          const fallbacks = specs.filter(isFallback)
          const specific = specs.filter((s) => !isFallback(s))
          // 评论那条再排到 specific 里的**最后**（最高优先）：它是包在最外面的高亮，
          // 被别的 renderer 抢先就没了；而它自己把字交回 `affine-text` 画，样式一起留得住。
          const ordered = [
            ...fallbacks,
            ...specific.filter((s) => s.name !== ATTR),
            ...specific.filter((s) => s.name === ATTR),
          ]
          reportNote(
            'comment',
            `inline specs 兜底=[${fallbacks.map((s) => s.name).join(',')}] 其余=[${specific.map((s) => s.name).join(',')}]`,
          )
          return new InlineManager(provider.get(StdIdentifier), true, ...ordered)
        })
      },
    })
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'inline-comment': InlineCommentElement
  }
}
