/**
 * 需要交互的那几个块的 NodeView（架构 §7 的 `nodes/`）—— 装配时交给 `EditorView` 的 `nodeViews`。
 *
 * 键是 schema 里的**节点名**（冻在 `schema/index.ts`，不许改名），只覆盖「基础 DOM 不够用」的那几个：
 * `todoItem` 的勾选框 · `toggle` 的折叠箭头 · `image` 的实际渲染 · `codeBlock` 的语言选择器 ·
 * P2 的公式 / 媒体 / 附件 / 目录 / 分栏 / 子页面卡片 / @提及 / 面包屑 / P3 的同步块 / 模板按钮。
 * 其余块走 schema 的 `toDOM` 就够了。
 */
import type { NodeViewConstructor } from 'prosemirror-view'

import { breadcrumbView } from './breadcrumb'
import { codeBlockView } from './code-block'
import { columnListView, columnView } from './column'
import { equationView, inlineEquationView } from './equation'
import { imageView } from './image'
import { audioView, fileView, videoView } from './media'
import { mentionView } from './mention'
import { subpageView } from './subpage'
import { syncedBlockView } from './synced-block'
import { tableOfContentsView } from './table-of-contents'
import { templateButtonView } from './template-button'
import { toggleView } from './toggle'
import { todoItemView } from './todo-item'
// 样式靠副作用注册（vanilla-extract 的 globalStyle）—— 引一次就行。
import './nodes.css'
// KaTeX 的排版靠它自己的样式表（字体度量那套）——不打进来公式会散架。
import 'katex/dist/katex.min.css'

export const nodeViews: Record<string, NodeViewConstructor> = {
  todoItem: todoItemView,
  toggle: toggleView,
  image: imageView,
  codeBlock: codeBlockView,
  equation: equationView,
  inlineEquation: inlineEquationView,
  video: videoView,
  audio: audioView,
  file: fileView,
  tableOfContents: tableOfContentsView,
  columnList: columnListView,
  column: columnView,
  subpage: subpageView,
  mention: mentionView,
  breadcrumb: breadcrumbView,
  syncedBlock: syncedBlockView,
  templateButton: templateButtonView,
}
