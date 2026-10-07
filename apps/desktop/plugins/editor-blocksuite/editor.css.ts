/**
 * 编辑器这一层 BlockSuite 自己**不管**的样式：标题元素的排版、正文的版心。
 * （BlockSuite 只注册 `<doc-title>` 元素并给出内部样式，外面这几条归消费方 —— AFFiNE 前端也是自己写的。）
 */
import { globalKeyframes, globalStyle } from '@vanilla-extract/css'

// 自定义元素默认是 inline；内部靠 `margin: 0 auto` 居中，不改成 block 就居中不了。
// ★ `flex: 0 0 auto` 不能省：它在滚动容器里是个 flex 项，正文一长它会被**压缩**
//   （flex-shrink 默认 1），挤出来的字就跟正文叠在一起 —— 用户看到的「正文滑到标题上」。
globalStyle('doc-title', { display: 'block', width: '100%', flex: '0 0 auto' })

// 编辑区配色向 Notion 收一档（D-0056）：正文别那么白、占位符别那么暗。只动暗色，浅色走主题默认。
globalStyle('[data-theme="dark"] .affine-page-viewport', {
  vars: {
    '--affine-text-primary-color': '#d4d4d4',
    '--affine-placeholder-color': '#7f7f7f',
  },
})

// 段落占位符不走 `--affine-placeholder-color`，走 `--affine-black-30`（暗色=白 30%），比正文暗一截。
globalStyle('[data-theme="dark"] .affine-paragraph-placeholder', { color: 'rgba(255, 255, 255, 0.45)' })

// BlockSuite 给占位符写了 `max-width: 100%` + `overflow-x: hidden` + `text-overflow: ellipsis`，
// 三件套凑齐就会咬掉尾巴（实测只显示到「唤起命…」），而它本来只需要 119px。
// 它是 absolute 的，放开宽度不影响正文排版（D-0061）。
// ★ 只放开 `overflow-x` 不管用：另一个轴还是 hidden 时，`visible` 会被算成 `auto`，
//   照样是裁切盒，`text-overflow: ellipsis` 照样咬尾巴（用户：「这个为啥要收缩」）。
//   所以两个轴一起放开，再把 `text-overflow` 明确写成 `clip`。
// ★★ 选择器必须带上 `.affine-page-viewport` 而不是光写 `.affine-paragraph-placeholder`：
//   上游那条也是**一个 class**，同级时看谁排在后面，而它的样式是运行时注入的、排在我们之后
//   —— 光写一个 class 会**整条输掉**（用户：「不要省略字」时截图里还是「唤起命…」）。
//   这和下面 doc-title 那条是同一个坑（那边是「带上 doc-title 一起写才盖得住」）。
globalStyle('.affine-page-viewport .affine-paragraph-placeholder', {
  maxWidth: 'none',
  overflow: 'visible',
  textOverflow: 'clip',
  // ★ 字号写死，**不跟 `--affine-font-base` 缩**（用户：「呼出这段字始终保持一个可见的大小
  //   最好不要增大缩小」）。它是提示不是内容：正文调到 24px 时它跟着长，就变成一行大标题了。
  fontSize: 16,
})

/* ────────────────────────── 自绘插入点（D-0076） ────────────────────────── */

// 自绘的那个**画上了**才让原生让位（`caret.ts` 写 `html[data-caret-on]`）—— 两个都画是两条
// 光标，但自绘那条万一没落上（选择器 / 尺寸 / 层叠），用户还得有系统那个。
// `caret-color` 是继承属性，落在 viewport 上整棵编辑区（含标题、代码块、表格格子）都吃得到。
globalStyle('html[data-caret-on] .affine-page-viewport', { caretColor: 'transparent' })

// 形状选「系统默认」时没有自绘的，改的是原生光标自己的颜色 —— 和上一条互斥。没设颜色时
// 落到 `auto`（等于初始值），一点变化都没有。
globalStyle('html:not([data-caret-on]) .affine-page-viewport', {
  caretColor: 'var(--sn-caret-color, auto)',
})

// 画在 body 上的 fixed 层（`caret.ts` 挂的），位置/高度由 JS 每帧写内联样式。
// 这里只管形状、颜色、闪。没选形状时 `data-shape` 是 default → 没有宽度 → 永远 display:none。
globalStyle('.sn-caret', {
  position: 'fixed',
  zIndex: 30,
  display: 'none',
  top: 0,
  left: 0,
  pointerEvents: 'none',
  borderRadius: 1,
  // 兜底色：`--affine-primary-color` 取不到时整条声明会作废 → 光标变成透明的，看不见。
  background: 'var(--sn-caret-color, var(--affine-primary-color, #1e96eb))',
  animation: 'sn-caret-blink 1.06s linear infinite',
})

globalStyle('.sn-caret[data-on="1"]', { display: 'block' })

// 打字的那几下不闪（原生光标也是这个行为）—— 停手 500ms 后 `caret.ts` 把这个属性摘掉。
globalStyle('.sn-caret[data-typing="1"]', { animation: 'none', opacity: '1' })

// 形状挂在元素自己身上（`caret.ts` 每帧对一次），不再靠 `html[data-caret]` 那层中间商。
globalStyle('.sn-caret[data-shape="bar"]', { width: '1px' })
// 方块：**半角字符宽**（0.5em），不跟着下一个字变 —— 中文英文下都是同一个大小。
// `minWidth` 是保险：0.5em 万一算成 0（字号没继承到），至少还看得见一个方块。
globalStyle('.sn-caret[data-shape="block"]', { width: '0.5em', minWidth: 4 })

globalKeyframes('sn-caret-blink', {
  '0%, 50%': { opacity: '1' },
  '50.01%, 100%': { opacity: '0' },
})

/* ────────────────────────── 图片的「灯罩」（D-0070） ────────────────────────── */

// 圆角 + 一层软阴影，让它像一张摆上去的照片而不是一块贴在纸上的色块。
// 上游只给内层的 `<img>` 写了 `width/height: 100%`，圆角和阴影得自己加。
globalStyle('affine-page-image .resizable-img img', {
  borderRadius: 12,
  boxShadow: '0 1px 2px rgba(0, 0, 0, .14), 0 8px 22px rgba(0, 0, 0, .18)',
})

// 占位符在组件里硬编码成英文 `Title` + `opacity: .5`，且它那条与原来写的权重同级、排在后面
// —— 带上 `doc-title` 一起写才盖得住（D-0056）。ShadowlessElement = 无 shadow root，全局选择器进得去。
//
// ★ 它**不跟正文的占位符共用一个颜色**（D-0078）。D-0056 调的是**段落**占位符（16px 常规字重），
//   而标题占位符是 **40px / 700** —— 同一档灰落在这么大一块粗字上就是「一大片灰」，
//   空页面第一眼看到的是它、不是一张白纸。所以标题占位符自己一档：更淡，而且**不加粗**
//   （它是提示，不是内容）。
globalStyle('doc-title .doc-title-container-empty::before', {
  // 占位符文字走变量（由 `shell-doc-header/fonts.ts` 按当前语言写）—— 写死在这里，
  // 英文界面下也会冒出一个中文的「标题」。
  content: 'var(--sn-title-placeholder, "标题")',
  color: 'rgba(0, 0, 0, .28)',
  fontWeight: 400,
  opacity: 1,
})

globalStyle('[data-theme="dark"] doc-title .doc-title-container-empty::before', {
  color: 'rgba(255, 255, 255, .32)',
})

// 标题与正文之间 BlockSuite 留 38px（上 38 / 下 38 对称），加上段落自己的 10px margin，
// 两行字之间空出 58px 的墨迹间距 —— Notion 那份约 31px。下面收到 12px，只动下边（D-0061）。
// 选择器带上 `doc-title`：内联 `<style>` 与这里的注入顺序不定，多一个层级保证赢。
// 上面留白不动 —— 顶栏到标题的距离没参照物，少一个变量。
//
// ★ 字号/行高**也跟着 `--sn-font-scale` 缩**（D-0078）：上游写死 `font-size: 40px` /
//   `line-height: 50px`，而 h1–h6 和正文都跟着缩放 —— 只它不跟，正文一放大标题就不动了，
//   比例反过来（同 `--affine-font-h-*` 那条的理由）。顺带「小字号」也就一起作用于它。
globalStyle('doc-title .doc-title-container', {
  paddingBottom: '12px',
  fontSize: 'calc(40px * var(--sn-font-scale, 1))',
  lineHeight: 'calc(50px * var(--sn-font-scale, 1))',
})

// 标题在上、正文在下，**两块在同一个滚动区里一起滚**（D-0099 改回这个形状）。
globalStyle('editor-host', { display: 'block', flex: '1 0 auto' })

// `@container viewport` 那几条窄屏规则要它才生效（AFFiNE 也这么设）。
globalStyle('.affine-page-viewport', {
  containerType: 'inline-size',
  outline: 'none',
})

// ★ 字体的级联在这条上落地：编辑器整棵子树读 `--affine-font-family`，
//   而它在这一层被重绑到「单篇覆盖 ?? 文章默认」（两个值都由 `shell-doc-header/fonts.ts`
//   写在 <html> 上），全局字体就这样被文档级盖掉。
//   后面的字面量是兜底：那个插件被停掉时变量为空，按 var() 的规矩整条声明会废掉，
//   不如自己给一份和主题同一个值的字体栈。兜底里的名字别写空。
globalStyle('.affine-page-viewport', {
  vars: {
    '--affine-font-family':
      "var(--sn-font-over, 'Inter','PingFang SC','Hiragino Sans GB',system-ui,sans-serif)",
    // ★ 正文字号（D-0070）。BlockSuite 的段落/列表都读 `--affine-font-base`，
    //   主题里它写的是 15px（AFFiNE 的尺寸），用户要 Notion 那档 16px。
    //   乘一个全局缩放（`--sn-font-scale`，由 shell-doc-header 写、Cmd/Ctrl ± 改）——
    //   改这一条就能调字号，不用逐块去覆盖。
    '--affine-font-base': 'calc(16px * var(--sn-font-scale, 1))',
    // 标题档位。主题里那套 h1..h6 是 28 / 26 / 24 / 22 / 20 / 18 —— 一级和二级只差 2px，
    // 摆在一起像一样大（用户：「字体大小比例更协调一点 就是对比」）。换成 Notion 那档间距，
    // 并且**一起跟着缩放** —— 否则正文调大了、标题不动，比例又反过来了。
    '--affine-font-h-1': 'calc(30px * var(--sn-font-scale, 1))',
    '--affine-font-h-2': 'calc(24px * var(--sn-font-scale, 1))',
    '--affine-font-h-3': 'calc(20px * var(--sn-font-scale, 1))',
    '--affine-font-h-4': 'calc(18px * var(--sn-font-scale, 1))',
    '--affine-font-h-5': 'calc(16px * var(--sn-font-scale, 1))',
    '--affine-font-h-6': 'calc(15px * var(--sn-font-scale, 1))',
  },
  // `font-family` 本身也要重写：`fonts.ts` 把全局字体写在了 <html> 上，不重写的话
  // 没自己声明 font-family 的那些块会**继承 html 的**，而不是文档字体。
  fontFamily: 'var(--affine-font-family)',
})

// 代码块的连字。BlockSuite 自己写了 `.affine-code-block-container .inline-editor {
// font-family: var(--affine-font-code-family); font-variant-ligatures: none }` —— 它把连字
// 关掉了，所以 Fira Code 的 `=>` / `!==` 不会连。选择器比它多一层 `.affine-page-viewport`
// 才赢得稳（两者的 `inline-editor` 属于不同层，不能指望注入顺序）。
globalStyle('.affine-page-viewport .affine-code-block-container .inline-editor', {
  fontVariantLigatures: 'contextual',
})

/* ────────────────────────── 每个块的 ⠿ 拖动手柄（D-0117） ────────────────────────── */

// 悬停块时浮在它左边那颗手柄。位置由 JS 写 `transform`（量的是块的屏幕矩形）。
globalStyle('.sn-block-handle', {
  position: 'fixed',
  // 位置全靠 `transform`（合成层），这两个只占位。
  left: 0,
  top: 0,
  willChange: 'transform',
  display: 'none',
  width: 20,
  height: 22,
  gridTemplateColumns: 'repeat(2, 2px)',
  gap: 2,
  placeContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-icon-color)',
  cursor: 'grab',
  zIndex: 40,
})

globalStyle('.sn-block-handle[data-on="1"]', { display: 'grid' })
globalStyle('.sn-block-handle[data-dragging="1"]', { cursor: 'grabbing' })
globalStyle('.sn-block-handle:hover', { background: 'var(--affine-hover-color)' })
// 六个点就是 Notion 那个 ⠿。
globalStyle('.sn-block-handle > span', {
  width: 2,
  height: 2,
  borderRadius: '50%',
  background: 'currentColor',
})

// 跟着光标的拖影（一个块名小卡片）。不接鼠标 —— 不然 `elementFromPoint` 量到的是它。
globalStyle('.sn-block-drag-ghost', {
  position: 'fixed',
  left: 0,
  top: 0,
  willChange: 'transform',
  display: 'none',
  pointerEvents: 'none',
  maxWidth: 240,
  padding: '4px 8px',
  borderRadius: 6,
  fontSize: 12,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-text-primary-color)',
  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.28)',
  zIndex: 41,
})

// 落点线：跟着光标的块上缘 / 下缘那一条。
globalStyle('.sn-block-drop-line', {
  position: 'fixed',
  left: 0,
  top: 0,
  willChange: 'transform',
  display: 'none',
  pointerEvents: 'none',
  height: 2,
  borderRadius: 1,
  background: 'var(--affine-primary-color)',
  zIndex: 41,
})

// 上游那颗手柄我们自己重画了一份 —— 它的影子树从外面盖不住，只能把宿主元素收起来。
globalStyle('affine-drag-handle-widget', { display: 'none' })

/* ────────────────────────── 右侧目录刻度条（D-0070） ────────────────────────── */

// 元素由 `editor.ts` 的 `mountEditor` 挂到编辑区的容器上（`viewport` 的兄弟）。
// ★ 几何得我们自己给：AFFiNE 的 `OutlineViewer` 只写了内部那套（刻度 20x2、悬停浮层 0→200px），
//   外层怎么摆、多大，在 AFFiNE 里是**前端 App** 用 CSS 给的（跟 `<doc-title>` 同一个分工）。
//   没有 `paddingLeft` 的话这个盒子宽度是 0 —— 刻度是绝对定位的、不撑括号，
//   于是鼠标永远碰不到它，悬停面板一辈子出不来。
globalStyle('.sn-outline-rail', {
  position: 'absolute',
  top: 0,
  // 让出右缘那一条：viewport 自己的滚动条在那里，刻度条盖上去就连滚动条都拖不到。
  right: 12,
  height: '100%',
  paddingLeft: 12,
  zIndex: 2,
  // 整块不接鼠标（正文右缘、滚动条都能正常用），只有刻度本身可交互。
  pointerEvents: 'none',
})

globalStyle('.sn-outline-rail > *', { pointerEvents: 'auto' })

// 悬停面板朝**左**长：右缘钉住，宽度从 0 长到 200px。
globalStyle('.sn-outline-rail .outline-viewer-panel', { flexDirection: 'column' })

// 上游那一行是英文的「Table of Contents」——中文界面里串味，而且目录自己已经列得很清楚了。
globalStyle('.sn-outline-rail .outline-viewer-header', { display: 'none' })

/* ────────────────────────── 正文纸面：底色 + 磨砂（D-0074） ────────────────────────── */

// 纸面就铺在编辑器这个宿主元素上 —— 它正好等于「正文」：顶栏和右侧评论栏都不是它。
// 外壳的 `main` 因此是透的，透到窗口那层磨砂（`tauri.conf.json` 的 windowEffects）。
globalStyle(':root', {
  vars: { '--sn-paper-default': 'var(--affine-v2-layer-background-primary)' },
})

// 暗色的兜底跟外壳原来给 `main` 的那一档一致（#1c1c1c，D-0056）。
// ★ 选择器带 `html` 是为了压过上面 `:root` 那条 —— 两者同级的话就得赌注入顺序。
globalStyle('html[data-theme="dark"]', {
  vars: { '--sn-paper-default': '#1c1c1c' },
})

// `--sn-paper` / `--sn-paper-alpha` 由 `appearance` 插件写在 `<html>` 上；两条都取不到时
// （插件被停 / 没改过设置）就是主题自己那一档、完全不透 —— 跟改动前一个样。
globalStyle('affine-editor-host', {
  background:
    'color-mix(in srgb, var(--sn-paper, var(--sn-paper-default)) calc(var(--sn-paper-alpha, 100) * 1%), transparent)',
})

// ★ 编辑器这块**不吐东西出去**：代码块那条工具条（floating-ui 定位，`placement: 'top'`）
//   在代码块滚到顶上时会飘到编辑器框外、盖在顶栗那一行上（用户：「有时候这个 plain text
//   code 块飘上来了」「超出他应该活动的区域了」）。两道保险：
//     1. `overflow: hidden` 裁掉向上溢出的那一面（下面就是窗口底，左右自有窄屏规则管）；
//     2. `z-index: 0` 让这块**自己成一个层**—— BlockSuite 给浮层写的那个
//        `--affine-z-index-popover` 本来就注解着「stacking-context(editor-host)」，
//        而宿主不成为层它就跑到外壳那一层去比大小，结果盖过顶栗。
globalStyle('affine-editor-host', { overflow: 'hidden', zIndex: 0 })

/* ────────────────────────── 并排分栏（D-0118） ────────────────────────── */

// 一排栏横着铺；每栏自己是一列（栏头 + 编辑器）。宿主那一层的 `display:flex` 由
// `view.ts` 写在行内样式上 —— 它同时管着 `flex: 1 1 auto`，拆两处写迟早对不上。
globalStyle('.sn-pane', {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  position: 'relative',
})

// 栏头只在多栏时出现（`display` 由 `view.ts` 控制）。一行小字：左边页名，右边关掉这一栏。
globalStyle('.sn-pane-head', {
  flex: '0 0 auto',
  height: 28,
  display: 'flex',
  alignItems: 'center',
  paddingLeft: 12,
  paddingRight: 4,
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

// 哪一栏是「当前」—— 新打开的文档落进它，所以得看得出来。
globalStyle('.sn-pane-on .sn-pane-head', { color: 'var(--affine-v2-text-primary)' })

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

globalStyle('.sn-pane-close:hover', { background: 'var(--affine-v2-layer-background-hover)' })

// 编辑器（或「这一栏还空着」那句话）挂在这儿；右侧目录刻度条也绝对定位在这块里。
globalStyle('.sn-pane-body', { flex: '1 1 auto', minHeight: 0, position: 'relative' })

globalStyle('.sn-pane-empty', {
  margin: 0,
  padding: '24px 12px',
  fontSize: 14,
  color: 'var(--affine-v2-text-tertiary)',
})

// 分隔条：6px 的抓手，中间 2px 的线。线在正中间 —— 贴着左边画会看起来像左栏的边框。
globalStyle('.sn-split', {
  flex: '0 0 6px',
  cursor: 'col-resize',
  position: 'relative',
  // 拖动时不要触发惯性滚动 / 原生拖放
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
  background: 'var(--affine-v2-layer-inside)',
})

globalStyle('.sn-split:hover::after', { background: 'var(--affine-primary-color)' })
