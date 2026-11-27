/**
 * 这一层自己的一份样式（CONVENTIONS §6.2：不许 import 外壳的样式）。
 *
 * 分栏 / 栏头 / 版心跟 `editor-blocksuite/editor.css.ts` 那份同形状，只是**不再吃 `--affine-*`**
 * ——基座换了，那批变量跟着 BlockSuite 一起没了。颜色退回中性的兜底值。
 */
import { globalKeyframes, globalStyle } from '@vanilla-extract/css'

/** 版心宽度 —— 旧版那套居中窄栏是 BlockSuite 的 page 容器给的，换基座后要自己实现。
 *  值照 Notion 的观感再收窄一档（640px ≈ 40 个汉字一行，跟「20–35 字」的阅读舒适区间更近）。
 *  ★ 640 / 100% 由 `shell-doc-header/fonts.ts` 写在 `<html>` 上（⋯ 菜单的「全宽」）——
 *    这里写死 640 的话那个开关就成了死旋钮。 */
const PAGE_WIDTH = 'var(--sn-editor-width, 640px)'

/**
 * 版心宽度。★ 窗口（或分栏后的单栏）窄的时候**别等于整栏宽** —— 那样正文会顶到边上，
 * 看起来「没有居中」。留出两侧各 24，窄屏也还是居中的样子（用户：「小界面的时候也尽量中吧」）。
 */
const COLUMN = `min(${PAGE_WIDTH}, calc(100% - 48px))`

// 手机正文留白：底部多让出一截，免得末尾内容被底部导航 / 「＋」浮标压住。
const MOBILE_BODY = '36px 0 calc(96px + env(safe-area-inset-bottom))'

/** 文档字体：单篇覆盖 ?? 文档默认（两个值都由 `shell-doc-header/fonts.ts` 写在 `<html>` 上）。
 *  兜底写成跟主题同一个字体栈 —— 那个插件被停掉时变量为空，整条声明会废掉。 */
const DOC_FONT =
  "var(--sn-font-over, 'Inter','PingFang SC','Hiragino Sans GB',system-ui,sans-serif)"

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

// 正文与右侧那一列并排（`view.ts` 的骨架）。
globalStyle('.sn-pane-main', {
  display: 'flex',
  flex: '1 1 auto',
  minHeight: 0,
  minWidth: 0,
})

// 编辑器（或「这一栏还空着」那句话）挂在这儿。
// 顶部留白要给够：Notion 的标题离顶栏很深，贴着顶栏就显不出「一页」的样子。
globalStyle('.sn-pane-body', {
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 0,
  overflow: 'auto',
  padding: '60px 0 24px',
  transition: 'background-color 150ms ease-out',
  '@media': { '(max-width: 720px)': { padding: MOBILE_BODY } },
})
globalStyle('html[data-mobile="1"] .sn-pane-body', { padding: MOBILE_BODY })

// ── 正文纸面：底色 + 磨砂（D-0074） ──
// `--sn-paper` / `--sn-paper-alpha` 由 `appearance` 插件写在 `<html>` 上（`paper.ts`），这里只管**消费**。
// ★ 换基座时漏了这一条 —— 设置页那两行（纸面颜色 / 磨砂）就成了拧不动的旋钮（2026-10-08 用户报的）。
// ★ 暗色那档兜底跟外壳同一个值（Notion 画布色，D-0171）；选择器带 `html` 是为了压过上面 `:root` 那条。
globalStyle(':root', {
  vars: { '--sn-paper-default': 'var(--affine-v2-layer-background-primary)' },
})

globalStyle('html[data-theme="dark"]', { vars: { '--sn-paper-default': '#191919' } })

globalStyle('.sn-pane-body', {
  // 两条都取不到（插件被停 / 没改过设置）就是主题自己那一档、完全不透。
  background:
    'color-mix(in srgb, var(--sn-paper, var(--sn-paper-default)) calc(var(--sn-paper-alpha, 100) * 1%), transparent)',
})

/* ── 回收站提示条（正文照常显示，顶上这一条给恢复） ── */

globalStyle('.sn-trash-banner', {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  maxWidth: COLUMN,
  margin: '0 auto 16px',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'color-mix(in srgb, #e5a00d 16%, transparent)',
  fontSize: 13,
  color: 'var(--sn-text, #333)',
})

globalStyle('.sn-trash-banner button', {
  flex: '0 0 auto',
  padding: '2px 10px',
  border: '1px solid color-mix(in srgb, #e5a00d 45%, transparent)',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
})

// 大纲那一列。★ 收起时宽度是 **0**、只剩右上角那颗按钮浮着（`outline.css.ts` 给的定位）——
//   「常驻」和「不占地方」不冲突就靠这一条。
globalStyle('.sn-pane-side', { position: 'relative', flex: '0 0 auto', width: 0 })

globalStyle('.sn-pane-side[data-on="1"]', {
  width: 240,
  overflowY: 'auto',
  borderLeft: '1px solid var(--sn-line, rgba(0, 0, 0, .08))',
  // 手机上这一列改由 outline.css.ts 变成底部 sheet，桌面这一列照旧。
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
  maxWidth: COLUMN,
  // 下面紧跟着那行元信息（创建时间 · 字数），所以这里的下边距收窄。
  margin: '0 auto 6px',
  paddingTop: 0,
  paddingBottom: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  font: 'inherit',
  fontFamily: DOC_FONT,
  // ⌘± / 设置页的字号缩放（`--sn-font-scale`）—— 40 是缩放前的基准。
  fontSize: 'calc(34px * var(--sn-font-scale, 1))',
  fontWeight: 700,
  lineHeight: 1.2,
  color: 'inherit',
})

// ★ 标题和正文**都从版心左缘起**，不再留 12px 内缩 —— 那 12px 让第一个字的落点比
//   元信息下面那条分隔线往右一截，空文档里看着光标「陷进去」了（用户 2026-11-02）。
//   两边绑在同一条规则里：错开一点点，看起来就是「能写字的地方跟标题对不齐」。
globalStyle(':is(.sn-pm-title, .sn-block)', { paddingLeft: 0, paddingRight: 0 })

// blockContainer 的 toDOM —— 每个块自己一条纵向留白。
globalStyle('.sn-block', { paddingTop: 2, paddingBottom: 2 })

/**
 * 高亮（`schema` 的 `highlight` mark，DOM 就是 `<mark>`）。
 *
 * ★ 这条以前**一条样式都没有** —— `data-color`（工具条那 8 个颜色）没人读，
 *   于是每个高亮都掉到浏览器默认的 `<mark>`：**纯黄 + 黑字**。深色主题下就是一块荧光板，
 *   而且这是**默认样式**里的黄，不跟主题走。用户 2026-10-09：「展示就是一个颜色的优化」。
 *
 * ★ 颜色走 `--sn-hl`（`toDOM` 写成内联自定义属性）：CSS 读不了属性值（`attr()` 只认 `content`），
 *   而 `data-color` 还得留着 —— 插件内复制粘贴靠它回读（`parseDOM` 的 `mark` 那条）。
 *   压成半透明是**故意的**：那 8 个色是浅色主题的粉彩色，深色主题下整块铺上去字就没法看了；
 *   半透明一层在明暗两边都读得出来（Notion 深色下也是这么处理的）。
 */
globalStyle('.sn-block mark', {
  background: 'color-mix(in srgb, var(--sn-hl, transparent) 45%, transparent)',
  color: 'inherit',
})

// 页内锚点（`schema` 的 `anchor` mark）：虚线下划线，跳过去时闪一下。
globalStyle('.sn-anchor', {
  textDecorationLine: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationColor: 'var(--sn-accent, #1e96eb)',
  textUnderlineOffset: 3,
})

globalKeyframes('sn-anchor-flash', {
  from: { background: 'color-mix(in srgb, var(--sn-accent, #1e96eb) 32%, transparent)' },
  to: { background: 'transparent' },
})

globalStyle('.sn-anchor-flash', { animation: 'sn-anchor-flash .9s ease-out' })

// 真上过高亮才要圆角与内边距 —— 空色（工具条那格「无」/ 粘贴来的裸 `<mark>`）就等于没上。
globalStyle('.sn-block mark[data-color]:not([data-color=""])', {
  borderRadius: 3,
  padding: '0 2px',
})

/* ── 标题下那行：创建时间 · 字数（`page-meta.ts`） ── */

// 版心跟标题同宽同内边距 —— 差一点，这行就跟标题的左缘对不齐（跟上面 `:is(.sn-pm-title, .sn-block)`
// 是同一个道理：能写字的地方和标题必须从同一个左缘开始）。
globalStyle('.sn-page-meta', {
  position: 'relative',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  boxSizing: 'border-box',
  maxWidth: COLUMN,
  margin: '0 auto 26px',
  fontSize: 12,
  color: 'var(--sn-muted, #8a8a8a)',
})

// 元信息下面那条分隔线。★ 用 `::after` 不再建一个元素：它天生跟这一行同宽同版心，
//   也少一个要记着摘的节点。
globalStyle('.sn-page-meta::after', {
  content: "''",
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: -14,
  height: 1,
  background: 'var(--sn-line, rgba(0, 0, 0, .1))',
})

// 取不到创建时间（`doc:list` 还没回来）就整块收掉，不留一个空日历。
globalStyle('.sn-page-meta [data-on="0"]', { display: 'none' })

globalStyle('.sn-meta-learn', {
  position: 'relative',
  marginLeft: 'auto',
})

globalStyle('.sn-meta-learn-chip', {
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  fontSize: 12,
  color: 'inherit',
  cursor: 'pointer',
  padding: '0 4px',
  borderRadius: 4,
  lineHeight: '20px',
})

globalStyle('.sn-meta-learn-chip[data-on="1"]', {
  color: 'var(--affine-v2-text-primary)',
  background: 'var(--affine-v2-button-secondary)',
})

globalStyle('.sn-meta-learn-pop', {
  display: 'none',
  position: 'absolute',
  zIndex: 5,
  top: 'calc(100% + 8px)',
  right: 0,
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
  padding: '8px 10px',
  border: '1px solid var(--affine-border-color, rgba(0, 0, 0, .1))',
  borderRadius: 'var(--affine-popover-radius, 8px)',
  background: 'var(--affine-background-overlay-panel-color, #fff)',
  boxShadow: 'var(--affine-popover-shadow, 0 4px 16px rgba(0, 0, 0, .16))',
  color: 'var(--affine-text-primary-color, #333)',
  whiteSpace: 'nowrap',
})

globalStyle('.sn-meta-learn[data-open="1"] .sn-meta-learn-pop', { display: 'flex' })

globalStyle('.sn-meta-fam', { display: 'flex', alignItems: 'center', gap: 2 })

globalStyle('.sn-fam', {
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  fontSize: 12,
  color: 'inherit',
  cursor: 'pointer',
  padding: '0 4px',
  borderRadius: 4,
  lineHeight: '20px',
})

globalStyle('.sn-fam[data-on="1"]', {
  color: 'var(--affine-v2-text-primary)',
  background: 'var(--affine-v2-button-secondary)',
})

globalStyle(':is(.sn-meta-time, .sn-meta-words, .sn-backlinks-head)', {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
})

globalStyle('.sn-meta-sep', { opacity: 0.5 })

// ★ 浏览器给 `p` / `h1-h3` / `blockquote` / `pre` 都带默认 margin（`h1` 是 1em ≈ 32px）——
//   不清掉，块与块之间就凭空多出一大截。这是「两个块距离太大」的根因。
//   纵向节奏改由下面那几条显式给（段落 14px、标题上 28 下 8 上下浮动）。
globalStyle('.ProseMirror :is(p, h1, h2, h3, blockquote, pre, ul, ol)', { margin: 0 })

globalStyle('.ProseMirror blockquote', {
  margin: '10px 0',
  padding: '6px 12px',
  borderLeft: '3px solid var(--sn-accent, #1e96eb)',
  background: 'color-mix(in srgb, var(--sn-accent, #1e96eb) 6%, transparent)',
  borderRadius: '0 4px 4px 0',
})

globalStyle('.ProseMirror hr', {
  height: 1,
  border: 'none',
  margin: '16px 0',
  background: 'var(--sn-line, rgba(0, 0, 0, .1))',
})

// 分割线整块可点（点一下弹块菜单）—— 1px 的线本身太难指。
globalStyle('.ProseMirror .sn-block:has(> hr)', { cursor: 'pointer' })

// 段与段：每侧 5 + `.sn-block` 自身的 2 = 14px。视觉分块靠它，不是靠行距。
globalStyle('.sn-block > p', { margin: '5px 0' })

// 列表：标记挂在左边凹槽里，正文整体右移一格（换成列表后文字要看得出来挪了）。
// 序号来自 `plugins/list-number.ts` 的 `data-num`，不是 CSS counter —— 断开的列表要重新从 1 数。
globalStyle(':is(.sn-bulleted, .sn-numbered)', {
  position: 'relative',
  margin: '3px 0',
  paddingLeft: '1.5em',
})

globalStyle('.sn-bulleted::before', {
  content: '"•"',
  position: 'absolute',
  left: 0,
  width: '1.5em',
  textAlign: 'center',
  lineHeight: 'inherit',
})

// Tab 缩出来的层级靠标记区分（Notion 同款）：二级空心圆、三级往后方块。
// 只认 `.sn-block > .sn-group` 这条链 —— 分栏里的 `sn-group` 不算缩进，不然栏内第一条也是二级。
globalStyle('.sn-block > .sn-group > .sn-block > .sn-bulleted::before', {
  content: '"◦"',
})

globalStyle('.sn-block > .sn-group > .sn-block > .sn-group > .sn-block > .sn-bulleted::before', {
  content: '"▪"',
})

globalStyle('.sn-numbered::before', {
  content: 'attr(data-num) "."',
  position: 'absolute',
  left: 0,
  lineHeight: 'inherit',
  fontVariantNumeric: 'tabular-nums',
})

// 块级字色 / 背景色（`⋮⋮` 菜单）：只画在这块自己的内容上，嵌套子块不跟着变。
globalStyle('.sn-block[data-color]:not([data-color=""]) > :first-child', {
  color: 'var(--sn-block-color, inherit)',
})

globalStyle('.sn-block[data-bg]:not([data-bg=""]) > :first-child', {
  backgroundColor: 'var(--sn-block-bg, transparent)',
  borderRadius: 3,
})

// 空段落上的提示（`plugins/block-hint.ts` 挂的装饰）。绝对定位，别把光标挤到字后面去。
globalStyle('.sn-block-hint', { position: 'relative' })

globalStyle('.sn-block-hint::before', {
  content: 'attr(data-hint)',
  position: 'absolute',
  left: 0,
  top: 0,
  color: 'var(--sn-muted, #8a8a8a)',
  pointerEvents: 'none',
  userSelect: 'none',
})

// 标题：字号 / 行高 / 上下留白都显式给 —— 浏览器默认的 h1-h3 只有粗细和字号，
// margin 又被上面清成 0，标题会直接贴在上一段屁股上。
const HEADINGS = [
  { tag: 'h1', size: 1.875, top: 1, bottom: 0.4 },
  { tag: 'h2', size: 1.35, top: 1.1, bottom: 0.4 },
  { tag: 'h3', size: 1.25, top: 1.4, bottom: 0.5 },
] as const
for (const h of HEADINGS) {
  globalStyle(`.ProseMirror ${h.tag}`, {
    fontSize: `${h.size}em`,
    fontWeight: 600,
    lineHeight: 1.3,
    margin: `${h.top}em 0 ${h.bottom}em`,
  })
}

// 版心：居中的窄栏。ProseMirror 自己在根上放 `.ProseMirror`；框线由外面那圈负责，这儿别再加一个。
// 字号 / 行高按 Notion 那套再放松一档（正文 16 / 行高 1.7，标题 40）—— 1.5 是 WCAG 的下限，
// 长文里偏挤；ADHD 阅读更吃「行与行分得开」。
globalStyle('.ProseMirror', {
  maxWidth: COLUMN,
  margin: '0 auto',
  fontFamily: DOC_FONT,
  fontSize: 'calc(16px * var(--sn-font-scale, 1))',
  lineHeight: 1.7,
  transition: 'color 150ms ease-out',
  color: 'color-mix(in srgb, var(--sn-text, #333) var(--sn-body-ink, 93%), #000)',
  outline: 'none',
})

// 嵌套往里缩一格：缩的是**块里面那一层** `blockGroup`（`.sn-block > .sn-group`），不是所有。
// ★ 必须带 `.sn-block >` —— 文档最外面那层也是 `.sn-group`（`doc > blockGroup > blockContainer`），
//   不限定的话**每个块都会被推右 24**，而标题不在 `blockGroup` 里 → 标题跟正文永远对不齐。
// ★ 24 跟 `block-handle.ts` 的 `INDENT` 是同一个数，改要一起改（线要正落在缩到的地方）。
globalStyle('.sn-block > .sn-group', { paddingLeft: 24 })

/* ── 页头（封面 + 图标） ── */

globalStyle('.sn-page-head', { maxWidth: COLUMN, margin: '0 auto' })

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
/**
 * 「添加」只在没封面时露（那时封面条是 0 高，按钮得自己浮在标题上方）。
 * ★ `bottom: 0` **不是** `-24`：`-24` 是"往下 24px"，而封面条是 0 高 —— 那颗按钮于是**压在标题头上**，
 *   而且 `opacity: 0` 照样吃点击（隐形 ≠ 点不着），用户点标题点到的就是它
 *   （2026-10-08：「点未命名还是不让我点啊」，三次才揪出来）。
 *   `bottom: 0` 让它落在纸面顶部那 60px 留白里 —— 在标题**上方**，跟标题不抢点击。
 */
globalStyle('.sn-cover[data-on="0"] .sn-cover-add', { bottom: 0, opacity: 0 })
globalStyle('.sn-cover[data-on="0"]:hover .sn-cover-add', { opacity: 1 })
globalStyle('.sn-cover[data-on="0"] .sn-cover-del', { display: 'none' })
globalStyle('.sn-cover[data-on="1"] .sn-cover-add', { display: 'none' })

globalStyle('.sn-page-icon', { fontSize: 48, lineHeight: 1 })
globalStyle('.sn-page-icon[data-on="0"]', { display: 'none' })

/* ── 反向链接：跟创建时间、字数同一行；名单浮在上面，不占正文 ── */

globalStyle('.sn-backlinks', {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
})

globalStyle('.sn-backlinks-head', {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
})

globalStyle('.sn-backlinks-pop', {
  display: 'none',
  position: 'absolute',
  zIndex: 5,
  top: 'calc(100% + 8px)',
  left: 0,
  minWidth: 180,
  maxWidth: 280,
  padding: 4,
  border: '1px solid var(--affine-border-color, rgba(0, 0, 0, .1))',
  borderRadius: 'var(--affine-popover-radius, 8px)',
  background: 'var(--affine-background-overlay-panel-color, #fff)',
  boxShadow: 'var(--affine-popover-shadow, 0 4px 16px rgba(0, 0, 0, .16))',
  color: 'var(--affine-text-primary-color, #333)',
})
globalStyle('.sn-backlinks[data-open="1"] .sn-backlinks-pop', { display: 'block' })

globalStyle('.sn-backlinks-item', {
  display: 'block',
  width: '100%',
  padding: '5px 8px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
})
globalStyle('.sn-backlinks-item:hover', { background: 'var(--affine-hover-color, rgba(127, 127, 127, .12))' })

/** 正在念的那一句。decoration，不进文档。 */
globalStyle('.sn-read-now', {
  background: 'color-mix(in srgb, var(--sn-accent, #1e96eb) 32%, transparent)',
  borderRadius: 2,
})
