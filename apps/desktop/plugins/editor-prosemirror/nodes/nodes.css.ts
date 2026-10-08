/**
 * 需要交互的那几个块的样式（CONVENTIONS §6.2：不许 import 外壳的样式）。
 *
 * 跟 `editor.css.ts` 一样，**不吃 `--affine-*`** —— 基座换了，那批变量跟着 BlockSuite 一起没了。
 * 只有 `--sn-accent` 是真在用的（设置弹窗写的那一个）；其余颜色退回中性兜底值，
 * 半透明灰能在浅色 / 深色两种主题下都活着，不用再去判 `[data-theme]`。
 */
import { globalStyle } from '@vanilla-extract/css'

const ACCENT = 'var(--sn-accent, #1e96eb)'
const LINE = 'rgba(128, 128, 128, .4)'
const WASH = 'rgba(128, 128, 128, .12)'

/* ── todoItem ── */

globalStyle('.sn-todo', {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 6,
})

globalStyle('.sn-todo-box', {
  flex: '0 0 16px',
  width: 16,
  height: 16,
  // 跟正文第一行对齐：16 的方框对 20 的行高差 2px。
  marginTop: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1.5px solid ${LINE}`,
  borderRadius: 4,
  background: 'transparent',
  // 未勾上时把 ✓ 藏掉 —— 变色的是勾本身，方框边框只在勾上时才换成强调色。
  color: 'transparent',
  fontSize: 11,
  lineHeight: 1,
  cursor: 'pointer',
  userSelect: 'none',
})

globalStyle('.sn-todo[data-checked="true"] .sn-todo-box', {
  borderColor: ACCENT,
  background: ACCENT,
  color: '#fff',
})

globalStyle('.sn-todo-text', {
  flex: '1 1 auto',
  minWidth: 0,
})

globalStyle('.sn-todo[data-checked="true"] .sn-todo-text', {
  opacity: 0.5,
  textDecoration: 'line-through',
})

/* ── toggle ── */

globalStyle('.sn-toggle', {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 4,
})

globalStyle('.sn-toggle-arrow', {
  flex: '0 0 18px',
  width: 18,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  lineHeight: 1,
  opacity: 0.55,
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'transform 120ms ease-out',
})

// `▸` 转 90° 就是 `▾` —— 省一个图标资源。
globalStyle('.sn-toggle[data-open="true"] .sn-toggle-arrow', { transform: 'rotate(90deg)' })

globalStyle('.sn-toggle-text', {
  flex: '1 1 auto',
  minWidth: 0,
})

// ★ 折叠的是**兄弟节点**：children 挂在同一个 `blockContainer` 里的下一个 `blockGroup`
//   （schema 是 `blockContent blockGroup?`，blockGroup 永远紧跟内容、是最后一个孩子，架构 §2.2）。
//   只 display:none，不动 DOM 顺序 —— 父 NodeView 不许重排子节点（架构 §2.3）。
globalStyle('.sn-toggle[data-open="false"] + div', { display: 'none' })

/* ── image ── */

globalStyle('.sn-image', {
  display: 'block',
  maxWidth: '100%',
  margin: '2px 0',
  borderRadius: 4,
  outline: 'none',
  outlineOffset: 2,
})

globalStyle('.sn-image-img', {
  display: 'block',
  maxWidth: '100%',
  height: 'auto',
  borderRadius: 4,
})

globalStyle('.sn-image.ProseMirror-selectednode', { outline: `2px solid ${ACCENT}` })

// blobId 还没落上（占位 / 导入途中）—— 别给一个破图标，画一块灰底。
globalStyle('.sn-image[data-empty="true"]', {
  height: 120,
  background: WASH,
  border: `1px dashed ${LINE}`,
})

/* ── codeBlock ── */

globalStyle('.sn-codeblock', {
  position: 'relative',
  margin: '2px 0',
  borderRadius: 6,
  background: WASH,
})

// 右上角那条：语言 + （mermaid 时的）Code/Preview/Split。
globalStyle('.sn-codeblock-bar', {
  position: 'absolute',
  top: 6,
  right: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
})

globalStyle('.sn-codeblock-lang, .sn-codeblock-view', {
  maxWidth: 160,
  padding: '0 4px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  opacity: 0.5,
  cursor: 'pointer',
})

globalStyle('.sn-codeblock-lang:hover, .sn-codeblock-view:hover', { opacity: 1 })

globalStyle('.sn-codeblock[data-mermaid="false"] .sn-codeblock-view', { display: 'none' })

globalStyle('.sn-code', {
  margin: 0,
  padding: '12px 14px',
  overflowX: 'auto',
})

globalStyle('.sn-code-text', {
  display: 'block',
  outline: 'none',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.5,
})

/* ── codeBlock · mermaid（照 Notion 的三态）── */

globalStyle('.sn-codeblock[data-mermaid="true"]', {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
})

globalStyle('.sn-codeblock[data-mermaid="true"][data-view="split"]', {
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
})

globalStyle('.sn-codeblock[data-mermaid="true"][data-view="split"] .sn-code', {
  borderRight: `1px solid ${LINE}`,
})

// Preview 只是把源码区收起来 —— `contentDOM` 还在 DOM 里，切回 Code 光标没丢（契约 D8）。
globalStyle('.sn-codeblock[data-mermaid="true"][data-view="preview"] .sn-code', { display: 'none' })
globalStyle('.sn-codeblock[data-mermaid="true"][data-view="code"] .sn-mermaid', { display: 'none' })
globalStyle('.sn-codeblock[data-mermaid="false"] .sn-mermaid', { display: 'none' })

globalStyle('.sn-mermaid', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
  padding: '12px 14px',
  overflow: 'auto',
})

globalStyle('.sn-mermaid svg', { maxWidth: '100%', height: 'auto' })

globalStyle('.sn-mermaid[data-state="empty"]::after', {
  content: '"在这里写 mermaid 语法"',
  fontSize: 12,
  opacity: 0.4,
})

globalStyle('.sn-mermaid[data-state="error"]', {
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
  color: '#e5484d',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
})

/* ── equation / inlineEquation ── */

globalStyle('.sn-equation', {
  display: 'block',
  margin: '4px 0',
  padding: '6px 8px',
  borderRadius: 4,
  textAlign: 'center',
  cursor: 'text',
})

globalStyle('.sn-equation:hover', { background: WASH })

globalStyle('.sn-inline-equation', {
  display: 'inline-block',
  padding: '0 2px',
  borderRadius: 3,
  cursor: 'text',
})

globalStyle('.sn-inline-equation:hover', { background: WASH })

// 空公式给一句灰提示 —— 不然就是一个看不见的块，找不到入口。
globalStyle('.sn-equation[data-empty="true"] .sn-eq-rendered', {
  color: 'rgba(128, 128, 128, .8)',
  fontStyle: 'italic',
  fontSize: 13,
})

globalStyle('.sn-inline-equation[data-empty="true"] .sn-eq-rendered', {
  color: 'rgba(128, 128, 128, .8)',
  fontStyle: 'italic',
})

globalStyle('.sn-equation[data-editing="true"] > .sn-eq-rendered', { display: 'none' })
globalStyle('.sn-inline-equation[data-editing="true"] > .sn-eq-rendered', { display: 'none' })

globalStyle('.sn-eq-input', {
  boxSizing: 'border-box',
  width: '100%',
  padding: '2px 6px',
  border: `1px solid ${ACCENT}`,
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  outline: 'none',
})

globalStyle('.sn-inline-equation .sn-eq-input', { width: '8em' })

/* ── video / audio / file ── */

globalStyle('.sn-media', { display: 'block', margin: '4px 0' })

globalStyle('.sn-video', { display: 'block', maxWidth: '100%', borderRadius: 4 })

globalStyle('.sn-audio', { display: 'block', width: '100%' })

globalStyle('.sn-media[data-empty="true"]', {
  height: 90,
  background: WASH,
  border: `1px dashed ${LINE}`,
  borderRadius: 4,
})

// blobId 还没落上时别画一个空播放器（audio 的控件条会杵在那儿）。
globalStyle('.sn-media[data-empty="true"] > .sn-video', { display: 'none' })
globalStyle('.sn-media[data-empty="true"] > .sn-audio', { display: 'none' })

globalStyle('.sn-file[data-empty="true"] .sn-file-link', { opacity: 0.5 })

globalStyle('.sn-file', { display: 'block', margin: '4px 0' })

globalStyle('.sn-file-link', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  maxWidth: '100%',
  padding: '6px 10px',
  border: `1px solid ${LINE}`,
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
})

globalStyle('.sn-file-link:hover', { background: WASH })

globalStyle('.sn-file-icon', {
  display: 'inline-flex',
  flex: '0 0 auto',
  opacity: 0.7,
})

globalStyle('.sn-file-name', {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/* ── tableOfContents ── */

globalStyle('.sn-toc', { display: 'block', margin: '4px 0' })

globalStyle('.sn-toc-list', { display: 'flex', flexDirection: 'column', gap: 2 })

globalStyle('.sn-toc-item', {
  display: 'block',
  width: '100%',
  padding: '3px 6px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  textDecoration: 'underline',
  textDecorationColor: LINE,
  textUnderlineOffset: 3,
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

globalStyle('.sn-toc-item:hover', { background: WASH })

globalStyle('.sn-toc-item[data-level="2"]', { paddingLeft: 20 })
globalStyle('.sn-toc-item[data-level="3"]', { paddingLeft: 36 })

globalStyle('.sn-toc-empty', { color: 'rgba(128, 128, 128, .8)', fontSize: 12 })

/* ── columnList / column ── */

globalStyle('.sn-columns', { display: 'block', margin: '4px 0' })

// flex 挂在**内容容器**上：PM 把 column 的 dom 直接摆这儿，外框不参与布局就不跟它打架。
globalStyle('.sn-columns-inner', {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 16,
})

// 边界先按虚线画出来（P2 只做基础渲染）——列宽拖拽留后面。
globalStyle('.sn-column', {
  flex: '1 1 0',
  minWidth: 0,
  padding: '2px 10px',
  border: `1px dashed ${LINE}`,
  borderRadius: 4,
})

globalStyle('.sn-column-body', { minWidth: 0 })

/* ── subpage ── */

globalStyle('.sn-subpage', {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  padding: '6px 8px',
  borderRadius: 4,
  cursor: 'pointer',
})

globalStyle('.sn-subpage:hover', { background: WASH })

globalStyle('.sn-subpage-icon', {
  display: 'inline-flex',
  flex: '0 0 auto',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  fontSize: 16,
  lineHeight: 1,
  opacity: 0.9,
})

globalStyle('.sn-subpage-title', {
  flex: '1 1 auto',
  minWidth: 0,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

// 空 docId / 目标页被删 —— 灰掉，别装作这是一张正常的卡片。
globalStyle('.sn-subpage[data-empty="true"] .sn-subpage-title', {
  color: 'rgba(128, 128, 128, .85)',
  fontStyle: 'italic',
  fontWeight: 400,
})

/* ── mention ── */

globalStyle('.sn-mention', {
  display: 'inline',
  padding: '1px 4px',
  borderRadius: 3,
  background: WASH,
  color: ACCENT,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
})

globalStyle('.sn-mention:hover', { background: 'rgba(30, 150, 235, .16)' })

globalStyle('.sn-mention[data-empty="true"]', { color: 'rgba(128, 128, 128, .9)' })

/* ── rawBlock（外部文件里看不懂的整块，只读等宽）── */

globalStyle('.sn-raw', {
  margin: '2px 0',
  borderRadius: 4,
  background: WASH,
  userSelect: 'text',
  cursor: 'default',
})

globalStyle('.sn-raw > pre', {
  margin: 0,
  padding: '8px 10px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12.5,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  overflowX: 'auto',
  color: 'rgba(128, 128, 128, .95)',
})

/* ── breadcrumb ── */

globalStyle('.sn-breadcrumb', {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  padding: '2px 0',
  fontSize: 13,
  lineHeight: 1.6,
})

globalStyle('.sn-crumb', {
  maxWidth: 200,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'rgba(128, 128, 128, .95)',
  font: 'inherit',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

globalStyle('.sn-crumb:hover', { color: 'inherit', textDecoration: 'underline' })

globalStyle('.sn-crumb-me', { color: 'inherit' })

globalStyle('.sn-crumb-sep', { opacity: 0.5 })
