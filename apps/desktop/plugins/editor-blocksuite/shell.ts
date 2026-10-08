/**
 * 编辑器要往外说的几句话。**单独一个文件**是为了避免循环 import：
 * 块组件（`blocks/*.ts`）要用它，而 `editor.ts` 要 import 那些块。
 *
 * 这一层不认识 `ctx`，接线在 `index.ts`。
 */
import type { DocMeta } from '../../src/kernel/contract'

export interface ShellHooks {
  /** 打开一篇文档（点了正文里的页面链接 / 面包屑里的祖先）。 */
  openDoc(docId: string): void
  /** 正文里新建了一篇子页面：落库，并挂在 `parentId` 下面。 */
  createChildDoc(docId: string, parentId: string | null): Promise<void>
  /** 从顶层往下数到这篇文档自己（面包屑用）。库里的 `parent_id` 才是真相。 */
  trail(docId: string): Promise<{ id: string; title: string }[]>
  /** **全库**（不含回收站、已按 `sort_order` 排好）。一次拿回来干三件事：
   *  正文里那几行子页面对齐它（D-0091）、全库登记进工作区（D-0094）、
   *  当前这篇的名字照它写回大标题。★ 正文里那行 `@链接` 渲染时查的是工作区，
   *  而库里的 `doc:list` 才是真相 —— 所以这里是全库，不是「这一篇的孩子」。 */
  library(): Promise<DocMeta[]>
  /** 点了正文里的评论高亮：把评论面板叫到那一条上（D-0067）。 */
  openComment(commentId: string): void
  /** 工具栏上那颗「评论」点了（选中的是一段文字）。文字那段的编号由 `readTextSelection` 给，
   *  这一层不碰 —— 交给评论插件去建锚点（D-0079）。 */
  commentSelection?(at: { blockId: string; index: number; length: number; quote: string }): void
  /** 工具栏上那颗「问 AI」点了。 */
  askSelection?(text: string): void
  /** 一篇文档落完库了 —— 顶栏拿它显示一句「已保存」。 */
  saved?(docId: string): void
  /** 这篇的**名字**（正文顶上那个大标题）变了 —— 侧栏/标签条/顶栏都该跟着改（D-0073）。 */
  renamed?(docId: string): void
}

export let shell: ShellHooks | undefined

export function connectShell(hooks: ShellHooks): void {
  shell = hooks
}
