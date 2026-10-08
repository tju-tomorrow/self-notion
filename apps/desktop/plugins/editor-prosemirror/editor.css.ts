/**
 * 这一层自己的一份样式（CONVENTIONS §6.2：不许 import 外壳的样式）。
 *
 * 分栏 / 栏头 / 版心跟 `editor-blocksuite/editor.css.ts` 那份同形状，只是**不再吃 `--affine-*`**
 * ——基座换了，那批变量跟着 BlockSuite 一起没了。颜色退回中性的兜底值。
 */
import { globalStyle } from '@vanilla-extract/css'

/** 版心宽度 —— 旧版那套居中窄栏是 BlockSuite 的 page 容器给的，换基座后要自己实现。
 *  值照 Notion 的观感（内容约占窗口宽的 6 成，两边留白明显）。 */
const PAGE_WIDTH = 700

/* ── 分栏（view.ts 的 class 名） ── */

globalStyle('.sn-pane', {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 0%',
  minWidth: 0,
  overflow: 'hidden',
})

globalStyle('.sn-pane-head', {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: '0 0 auto',
  height: 28,
  padding: '0 8px',
  fontSize: 12,
  color: 'var(--sn-muted, #8a8a8a)',
})

// 哪一栏是「当前」—— 得看得出来。
globalStyle('.sn-pane-on .sn-pane-head', { color: 'var(--sn-text, #333)' })

globalStyle('.sn-pane-title', {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

globalStyle('.sn-pane-close', {
  flex: '0 0 auto',
  width: 20,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
})

// 编辑器（或「这一栏还空着」那句话）挂在这儿。
// 顶部留白要给够：Notion 的标题离顶栏很深，贴着顶栏就显不出「一页」的样子。
globalStyle('.sn-pane-body', {
  flex: '1 1 auto',
  minHeight: 0,
  overflow: 'auto',
  padding: '60px 0 24px',
})

globalStyle('.sn-pane-empty', {
  margin: 0,
  padding: '24px 12px',
  fontSize: 14,
  color: 'var(--sn-muted, #8a8a8a)',
})

// 分隔条：6px 的抓手，中间 2px 的线。线在正中间 —— 贴着左边画会看起来像左栏的边框。
globalStyle('.sn-split', {
  flex: '0 0 6px',
  cursor: 'col-resize',
  position: 'relative',
  touchAction: 'none',
})

globalStyle('.sn-split::after', {
  content: '""',
  position: 'absolute',
  left: 2,
  top: 0,
  bottom: 0,
  width: 2,
  borderRadius: 1,
  background: 'var(--sn-line, rgba(0, 0, 0, .08))',
})

globalStyle('.sn-split:hover::after', { background: 'var(--sn-accent, #1e96eb)' })

/* ── 正文（editor.ts 建的 DOM） ── */

// 标题是 doc 的 attr（架构 §3.3），P0 画成一个输入框。
globalStyle('.sn-pm-title', {
  display: 'block',
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: PAGE_WIDTH,
  margin: '0 auto 16px',
  paddingTop: 0,
  paddingBottom: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  font: 'inherit',
  fontSize: 40,
  fontWeight: 700,
  lineHeight: 1.2,
  color: 'inherit',
})

// ★ 标题和正文的**左右**内边距绑在同一条规则里 —— 这俩错开一点点，
//   看起来就是「能写字的地方跟标题对不齐」。分开写迟早会有一边被覆盖掉。
globalStyle(':is(.sn-pm-title, .sn-block)', { paddingLeft: 12, paddingRight: 12 })

// blockContainer 的 toDOM —— 每个块自己一条纵向留白。
globalStyle('.sn-block', { paddingTop: 2, paddingBottom: 2 })

// ★ 浏览器给 `p` / `h1-h3` / `blockquote` / `pre` 都带默认 margin（`h1` 是 1em ≈ 32px）——
//   不清掉，块与块之间就凭空多出一大截。这是「两个块距离太大」的根因。
globalStyle('.ProseMirror :is(p, h1, h2, h3, blockquote, pre, ul, ol)', { margin: 0 })

// 版心：居中的窄栏。ProseMirror 自己在根上放 `.ProseMirror`；框线由外面那圈负责，这儿别再加一个。
// 字号 / 行高按 Notion 那套（正文 16 / 行高 1.5，标题 40）—— 不设的话正文会用浏览器的 16px 默认值，
// 跟 40px 的标题一比就散架了。
globalStyle('.ProseMirror', {
  maxWidth: PAGE_WIDTH,
  margin: '0 auto',
  fontSize: 16,
  lineHeight: 1.5,
  outline: 'none',
})

// 嵌套往里缩一格：缩的是**块里面那一层** `blockGroup`（`.sn-block > .sn-group`），不是所有。
// ★ 必须带 `.sn-block >` —— 文档最外面那层也是 `.sn-group`（`doc > blockGroup > blockContainer`），
//   不限定的话**每个块都会被推右 24**，而标题不在 `blockGroup` 里 → 标题跟正文永远对不齐。
// ★ 24 跟 `block-handle.ts` 的 `INDENT` 是同一个数，改要一起改（线要正落在缩到的地方）。
globalStyle('.sn-block > .sn-group', { paddingLeft: 24 })

/* ── 页头（封面 + 图标） ── */

globalStyle('.sn-page-head', { maxWidth: PAGE_WIDTH, margin: '0 auto' })

globalStyle('.sn-cover', { position: 'relative', height: 180 })
// 没封面时整块收掉 —— 不占地方，hover 才出「添加封面」。
globalStyle('.sn-cover[data-on="0"]', { height: 0 })

globalStyle('.sn-cover-img', { display: 'block', width: '100%', height: '100%', objectFit: 'cover' })
globalStyle('.sn-cover[data-on="0"] .sn-cover-img', { display: 'none' })

globalStyle('.sn-cover-btn', {
  position: 'absolute',
  right: 12,
  bottom: 8,
  padding: '2px 8px',
  border: 'none',
  borderRadius: 4,
  background: 'rgba(0, 0, 0, .55)',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
  opacity: 0,
})
globalStyle('.sn-cover:hover .sn-cover-btn', { opacity: 1 })
// 「添加」只在没封面时露（那时封面条是 0 高，按钮得自己浮在标题上方）。
globalStyle('.sn-cover[data-on="0"] .sn-cover-add', { bottom: -24, opacity: 0 })
globalStyle('.sn-cover[data-on="0"]:hover .sn-cover-add', { opacity: 1 })
globalStyle('.sn-cover[data-on="0"] .sn-cover-del', { display: 'none' })
globalStyle('.sn-cover[data-on="1"] .sn-cover-add', { display: 'none' })

globalStyle('.sn-page-icon', { padding: '0 12px', fontSize: 48, lineHeight: 1 })
globalStyle('.sn-page-icon[data-on="0"]', { display: 'none' })

/* ── 反向链接（正文之后，现算） ── */

globalStyle('.sn-backlinks', { maxWidth: PAGE_WIDTH, margin: '32px auto 0', padding: '0 12px' })
// 没人提到这一篇 → 整块收掉（别在每篇空文档底下挂一句「暂无」）。
globalStyle('.sn-backlinks[data-on="0"]', { display: 'none' })

globalStyle('.sn-backlinks-head', {
  marginBottom: 6,
  fontSize: 12,
  color: 'var(--sn-muted, #8a8a8a)',
})

globalStyle('.sn-backlinks-item', {
  display: 'block',
  width: '100%',
  padding: '3px 6px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  fontSize: 14,
  textAlign: 'left',
  cursor: 'pointer',
})
globalStyle('.sn-backlinks-item:hover', { background: 'rgba(127, 127, 127, .12)' })
