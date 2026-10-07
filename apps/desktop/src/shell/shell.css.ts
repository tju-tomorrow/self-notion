/**
 * 外壳的布局与间距。尺寸抄 AFFiNE：顶栏 40 / 标签 26 / 侧栏 248 / 导航行 30 / 分组标题 20 / 缩进 20 每级。
 *
 * ★ v2 token 的**大小写保留**（`layer/insideBorder/border` → `--affine-v2-layer-insideBorder-border`）。
 *   写错一个字母 → `var()` 落空 → **整条声明作废**（不是回退初值）。
 */
import { globalStyle, style } from '@vanilla-extract/css'

/** ★ 红绿灯的位置不在这儿定，在 `src-tauri/tauri.conf.json` 的 `trafficLightPosition`
 *  （x=9 / y=13.5）。macOS 默认把它们摆在距顶 9px，比这条 40px 顶栏的中心线高 4.5px，
 *  于是折叠图标看着比红绿灯低一格；把红绿灯挪到 20 那条线上，两边才对得齐。 */
export const TITLEBAR_H = 40
/** 侧栏宽度：默认值。真值是 CSS 变量 `--shell-sidebar-w`（`AppShell` 拖拽时改它）——
 *  顶栏左侧那格和侧栏**必须同宽**，标签条才从侧栏右缘起，所以两者都读同一个变量。 */
export const SIDEBAR_W = 248
export const TRAFFIC_LIGHTS_W = 70

/** 拖到头就不再缩/撑。 */
export const SIDEBAR_MIN_W = 200
export const SIDEBAR_MAX_W = 480

const sidebarWidth = `var(--shell-sidebar-w, ${SIDEBAR_W}px)`

// `-webkit-app-region` 不在 csstype 里，摊开写绕开多余属性检查
const DRAG = { WebkitAppRegion: 'drag' }
const NO_DRAG = { WebkitAppRegion: 'no-drag' }

// ★ 这是磨砂的**开关**：Tauri 的 `transparent: true` 只给了个洞，露不露得出 vibrancy 全看页面透不透。
globalStyle('html, body, #root', {
  height: '100%',
  margin: 0,
  background: 'transparent',
  // ★ 文档本身不许滚、也不许橡胶回弹（用户：「上下滑为什么整个窗口都在上下抖动」）。
  //   少了这两条，滚轮落在「不可滚」的地方（标题那条）时，回弹会传给整个文档视图。
  overflow: 'hidden',
  overscrollBehavior: 'none',
})
globalStyle('*, *::before, *::after', { boxSizing: 'border-box' })

// 系统开了「减弱动态效果」就把动画全关掉（入场、光标闪烁、宠物弹跳都在里面）。
// 用 `!important` 是因为各家把自己的动画写在各自的规则里，不压住就会漏一个。
globalStyle('*, *::before, *::after', {
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationDuration: '0.01ms !important',
      animationIterationCount: '1 !important',
      transitionDuration: '0.01ms !important',
    },
  },
})

// 键盘焦点。默认样式被各处的 `border: none` 吃掉，Tab 一遍找不到自己在哪。
// 只给交互元素加，别碰 contenteditable（编辑器自己管光标）。
globalStyle(
  ':where(button, a, input, textarea, select, [role="switch"], [tabindex]):focus-visible',
  {
    outline: '2px solid var(--affine-primary-color, #1e96eb)',
    outlineOffset: '1px',
  },
)

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
  colorScheme: 'var(--affine-theme-mode)',
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  // 界面字体跟着「全局字体」走（那个值由 shell-doc-header 写在 <html> 上）；取不到时
  // 退回字面量，别让整条声明废掉。
  fontFamily: 'var(--affine-font-family, Inter, "PingFang SC", system-ui, sans-serif)',
  fontSize: 14,
  lineHeight: 1.5,
})

export const titlebar = style({
  flex: `0 0 ${TITLEBAR_H}px`,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: TITLEBAR_H,
  paddingRight: 8,
  background: 'transparent',
  ...DRAG,
})

/** 和侧栏等宽的一格，标签条才能从侧栏右缘起。红绿灯压在这儿。 */
export const headerLeft = style({
  flex: `0 0 ${sidebarWidth}`,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  paddingLeft: TRAFFIC_LIGHTS_W + 8,
  alignSelf: 'stretch',
  ...NO_DRAG,
})

/** 侧栏折叠后，这格不再占满侧栏宽 —— 只包住那颗开关按钮，标签条跟着往左挪。 */
export const headerLeftCollapsed = style({
  flex: '0 0 auto',
  paddingRight: 8,
})

/** `minWidth: 0` 必须有，否则标签多了撑破顶栏而不是滚动 */
export const titlebarCenter = style({  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  ...NO_DRAG,
})

export const titlebarRight = style({
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  ...NO_DRAG,
})

/** 顶栏图标按钮：悬停才出底色。常驻描边会让 40px 的顶栏显脏。 */
export const iconButton = style({  flex: '0 0 28px',
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-icon-primary)',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

/** 侧栏折叠开关：顶栏那格的**右缘**（D-0070）。原来紧贴红绿灯，看着像跟红绿灯一伙的；
 *  推到侧栏这一格的右边缘，跟标签条挨着，也不挤红绿灯。 */
export const sidebarSwitch = style([iconButton, { marginLeft: 'auto' }])

export const body = style({ flex: 1, display: 'flex', minHeight: 0 })

/** 侧栏。压 25% 主色留 75% 给 vibrancy —— 压过 45% 壁纸纹理就被抹平，白瞎了磨砂。 */
export const sidebar = style({
  flex: `0 0 ${sidebarWidth}`,
  display: 'flex',
  flexDirection: 'column',
  rowGap: 4,
  paddingBottom: 8,
  overflow: 'hidden',
  // 给右缘那条抓带定位用（抓带压在 overflow: hidden 里面，不然会被裁掉）
  position: 'relative',
  background: 'color-mix(in srgb, var(--affine-v2-layer-background-primary) 25%, transparent)',
  borderRight: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
})

/** 拖拽改侧栏宽度的抓带。只有 4px 宽、贴右缘内侧：细到看不见，但够得着。
 *  `zIndex` 要压过侧栏里的滚动区，不然鼠标移到最右边根本抓不住。 */
export const resizer = style({
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: 4,
  zIndex: 2,
  cursor: 'col-resize',
  selectors: {
    '&:hover': { boxShadow: 'inset -1px 0 0 var(--affine-primary-color)' },
  },
})

/** 折叠态：宽度归零、边框收起。顶栏左边那格据此也能整块让出去。 */
export const sidebarCollapsed = style({
  flex: '0 0 0px',
  padding: 0,
  borderRight: 'none',
})

/** 主区。**这里现在不留底色** —— 底色交给两块：顶栏（`docHeader`）和正文纸面（编辑器那条）。
 *  留空是必须的：纸面要磨砂，父层不透明就只透出这块不透明的东西，透不到窗外（D-0074）。
 *  没开文档时的首页自己把底色补上（`home.css.ts` 的 `.page`）。 */
export const main = style({  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'transparent',
})

/** 主区里的**一层**：要么是「页面顶栏 + 正文」（开着文档），要么是主页。
 *  `AppShell` 按 `key` 换掉它 —— React 因此重挂，入场动画每次切换都重放一遍，
 *  换页那一下就不会「啪」地直接顶上来。 */
export const view = style({
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
})

/** 页面顶栏那一行。**壳出这一行**（高度 + 底线），插件往里面塞自己的按钮 ——
 *  所以插件不该再自带宽高底线（`shell-doc-header` 的 `.bar` 已经交出来了）。
 *  底色原本在 `main` 上，现在搬到这里：顶栏不算「纸面」，用户定的规则是正文才给出去（D-0074）。
 *  暗色比 AFFiNE 的 #141414 提一档，免得跟磨砂侧栏拉出硬边（D-0056）。 */
export const docHeader = style({
  flex: '0 0 44px',
  display: 'flex',
  alignItems: 'center',
  borderBottom: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  background: 'var(--affine-v2-layer-background-primary)',
  selectors: { '[data-theme="dark"] &': { background: '#1c1c1c' } },
  // ★ 压在编辑器**上面**。编辑器里那些浮出来的东西（代码块那条工具条是
  //   floating-ui 算的位置）在块滚到顶上时会飘到编辑器框外、盖住这一行
  //   （用户：「有时候这个 plain text code 块飘上来了」「超出他应该活动的区域了」）。
  //   这里给它一个高于默认层的层 + 不透明底色，它们就滑到这一行**底下**去。
  position: 'relative',
  zIndex: 2,
})

/** 顶栏底下那一行：正文 + 右侧评论栏。评论栏没挂时行里只有正文，跟以前一样。 */
export const docBody = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
})

// 正文是 flex:1 的那一半，孩子不给 `min-width: 0` 会被内容顶出横向滚动条。
// ★ 不能写成 `selectors: { '& > *': … }` —— vanilla-extract 只允许选择器落在 `&` 自己身上，
//   带组合子（`>`）的选择器会让 `vite build` 直接抛错；dev 里这行不那么显眼，
//   症状是**整个外壳没有样式**（侧栏和主区叠着排）。所以走 globalStyle。
globalStyle(`${docBody} > *`, { minWidth: 0 })

export const empty = style({ margin: 0, padding: 48, color: 'var(--affine-v2-text-tertiary)' })
