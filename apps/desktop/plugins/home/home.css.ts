/**
 * 「All docs」页。数值照 AFFiNE 抄：工具栏 52（workbench/route-container.css.ts 的 header）、
 * 版心 24 / 上 12 / 下 32（all-page.css.ts）、行首图标 24 / 视图切换图标 16
 * （doc-list-item.css.ts 的 listIcon 与 view-toggle.css.ts）、
 * 列表行 42、行距 12（explorer/docs-view/docs-list.tsx 里 `Masonry` 的 gapY / groupsGap /
 * groupHeaderGapWithItems 三个都是 12）、分组标题 32 —— 后三个在 `virtual.ts` 里，因为
 * 虚拟滚动要拿它们算坐标，import 过来免得两处各写一份、改一半。（AFFiNE 的分组标题是 24，
 * 这儿加高到 32：标题跟上一组最后一行之间只有 12px 间隔，24 高看着是贴在一起的。）
 * 日期：AFFiNE 是一列 60 居中（workspace-property-types/created-updated-at.css.ts），
 * 我们两个时间并排，于是每列 100（标签定宽 24 + 值）—— 要的是两列左缘对所有行都对齐。
 * 导航 18/600（explorer/header/navigation.css.ts）。
 *
 * ★ 颜色只走 `--affine-*` / `--affine-v2-*`，大小写照抄：写错一个字母 → `var()` 落空 → 整条声明作废。
 * 按钮不继承字体，所以每个 button 都得自己写 `fontFamily: inherit`。
 */
import { style } from '@vanilla-extract/css'
import * as motion from '../../src/ui/motion.css'
import { HEAD_H, ROW_H } from './virtual'

export const page = style({
  // 底部那枚浮动工具条靠它定位
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  // 外壳的 `main` 现在透（正文纸面要吃窗口磨砂，D-0074）—— 首页不是正文，自己把底色补上，
  // 否则整个列表会浮在壁纸上。值跟外壳原来给 `main` 的那一档一模一样。
  background: 'var(--affine-v2-layer-background-primary)',
  selectors: { '[data-theme="dark"] &': { background: '#1c1c1c' } },
})

/* ── 工具栏：导航标签 + 视图切换 / Display / New doc ── */

export const header = style({
  flex: '0 0 52px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 52,
  // 24 = 版心。跟下面列表的左缘、右缘对齐，工具栏不再比内容多探出去 8px。
  padding: '0 24px',
})

export const tabs = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
})

export const tab = style({
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontFamily: 'inherit',
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 600,
  color: 'var(--affine-v2-text-secondary)',
  cursor: 'pointer',
  selectors: { '&:hover': { color: 'var(--affine-v2-text-primary)' } },
})

export const tabOn = style([tab, { color: 'var(--affine-v2-text-primary)' }])

export const actions = style({ display: 'flex', alignItems: 'center', gap: 12 })

export const viewToggle = style({ display: 'flex', alignItems: 'center', gap: 4 })

/** 行内 / 工具栏的图标按钮，24 见方（AFFiNE IconButton 的默认尺寸）。 */
export const iconBtn = style({
  width: 24,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-icon-primary)',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

/** 选中的视图 —— AFFiNE 的 viewToggleIndicator 就是压一层 hoverOverlay，不换图标色。 */
export const viewOn = style([
  iconBtn,
  { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
])

/** 已收藏的星 —— 跟 AFFiNE 的 IsFavoriteIcon 一样走 primary 色。 */
export const starOn = style([iconBtn, { color: 'var(--affine-primary-color)' }])

/** 筛选框。高度 / 圆角 / 左右内边距都跟旁边的按钮同一档，不然并排放着高低不一。 */
export const filter = style({
  height: 28,
  width: 180,
  padding: '0 12px',
  border: 'none',
  borderRadius: 8,
  background: 'var(--affine-v2-button-secondary)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  selectors: {
    '&::placeholder': { color: 'var(--affine-v2-text-tertiary)' },
  },
})

export const ghostBtn = style({
  height: 28,
  padding: '0 12px',
  border: 'none',
  borderRadius: 8,
  background: 'var(--affine-v2-button-secondary)',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-button-buttonOverHover)' } },
})

/** 「+ 新建文档」那颗蓝的。
 *  ★ `display: flex` + `alignItems: center` 不能省：里面是**一个图标 + 一行字**，
 *    不给 flex 的话图标按**行内基线**排 —— svg 的盒子比字高，行盒就往上长出去，
 *    基线跟着被压低，于是字看着比按钮中线矮半个字（用户：「这个对齐」）。
 *    图标和字之间那个 JSX 里的空格也不要了，间距由 `gap` 管（空格宽度看字体，飘）。 */
export const newDocBtn = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 28,
  padding: '0 12px',
  border: 'none',
  borderRadius: 8,
  background: 'var(--affine-v2-button-primary)',
  color: 'var(--affine-v2-button-pureWhiteText)',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-primary-color)' } },
})

/* ── 列表 ── */

/** 列表那一整块。**入场只放一次**：这层是常驻的，改完名字重取一遍数据只是里头换行，
 *  动画不会重放（重放的话每改一个字整个列表都闪一下）。 */
export const body = style([
  motion.fadeIn,
  { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
])

export const scroll = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '12px 24px 32px',
})

/** 底部那条浮动工具条飘在列表上头：给它留出一条道，免得最后一行被盖住。 */
export const scrollPicked = style({ paddingBottom: 76 })

/**
 * 列表的虚拟滚动画布：高度由 JS 给（`layout()` 算的总高），每条按 `top` 绝对定位。
 * 间隔不是 CSS 的 rowGap 而是**加进 `top` 里**的（见 `virtual.ts`）—— 这样窗口才知道
 * 每条的准确位置，不用去量元素。
 */
export const window = style({
  position: 'relative',
})

export const slot = style({
  position: 'absolute',
  left: 0,
  right: 0,
})

/** 分组标题：左边名字，右边篇数。高度和 `virtual.HEAD_H` 必须一致。 */
export const groupHead = style({
  height: HEAD_H,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 4px',
})

/** 左边那根小竖条：分组的锚点。高度跟着字号走，不要做成一根粗柱子。 */
export const groupBar = style({
  flex: '0 0 3px',
  width: 3,
  height: 14,
  borderRadius: 2,
  background: 'linear-gradient(180deg, var(--affine-primary-color), var(--affine-primary-color-04))',
})

/** 分组标题：比行标题（14 / primary）小一号，但给足 600 —— 它是标题不是内容。 */
export const groupLabel = style({
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 600,
  color: 'var(--affine-v2-text-primary)',
})

/** 篇数：一枚小胶囊，跟名字拉开档次（原来是一串灰数字，混在满屏正文数字里认不出来）。 */
export const groupCount = style({
  height: 18,
  padding: '0 7px',
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 999,
  background: 'var(--affine-primary-color-04)',
  color: 'var(--affine-primary-color)',
  fontSize: 11,
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
})

/** 右边拖到头的细线：把分组标题变成一条真正的分隔，而不是一句孤零零的灰字。 */
export const groupRule = style({
  flex: 1,
  height: 1,
  marginLeft: 4,
  background: 'linear-gradient(90deg, var(--affine-v2-layer-insideBorder-border), transparent)',
})

/** 选中 ≥1 篇时底部那枚浮动工具条 —— 入口不占工具栏的位。
 *  里外两层：外层只管水平居中（`translateX` 交给它），内层才能上 `motion.riseIn`
 *  （那条动画收尾写的是 `transform: none`，直接写在一层上会把居中干掉）。 */
export const picker = style({
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 24,
  zIndex: 15,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
})

export const pickerBar = style([
  motion.riseIn,
  {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px 6px 16px',
    borderRadius: 999,
    background: 'var(--affine-v2-layer-background-primary)',
    border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
    boxShadow: 'var(--affine-menu-shadow)',
    pointerEvents: 'auto',
  },
])

/** 浮动条里那句「已选 N 篇」。 */
export const selectCount = style({
  marginRight: 4,
  fontSize: 14,
  lineHeight: '22px',
  fontWeight: 600,
  color: 'var(--affine-v2-text-primary)',
  fontVariantNumeric: 'tabular-nums',
})

/** 危险动作（批量删除）：红底白字，高度跟 `ghostBtn` / `newDocBtn` 同一档。 */
export const dangerBtn = style({
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 12px',
  border: 'none',
  borderRadius: 8,
  background: 'var(--affine-error-color)',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
})

export const row = style({
  position: 'relative',
  height: ROW_H,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 4px',
  borderRadius: 4,
  cursor: 'pointer',
  transition: 'background-color 120ms ease-out',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const rowIcon = style({
  flex: '0 0 24px',
  width: 24,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // emoji 图标按字号画，不给就跟正文一样大（AFFiNE 的 `listIcon` 也是 24）
  fontSize: 24,
  color: 'var(--affine-v2-icon-primary)',
})

export const rowBrief = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
})

export const rowTitle = style({
  fontSize: 14,
  lineHeight: '22px',
  fontWeight: 500,
  color: 'var(--affine-v2-text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** 工具栏左边那行标题（原来放 tab，现在放当前分组名）。 */
export const headTitle = style({
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 600,
  color: 'var(--affine-v2-text-primary)',
})

/** 时间列。`marginLeft` 是留给长标题的：没有它，标题省略号会直接顶到「更新」上。
 *  值与值的定宽（`rowDateValue`）保证两列的左右缘对所有行都是一条直线 —— 不然每行
 *  的「7小时前 / 昨天」长短不一，滚动时右边这几列会一直左右抽动。 */
export const rowDates = style({
  display: 'flex',
  alignItems: 'center',
  gap: 20,
  marginLeft: 16,
  flexShrink: 0,
})

/** 一对时间：图标 + 「更新 / 创建」+ 数值 —— 光两个数摆在那儿看不出谁是谁。 */
export const rowDate = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  lineHeight: '20px',
  color: 'var(--affine-v2-text-secondary)',
  whiteSpace: 'nowrap',
})

/** 图标比字大半号，但颜色压到 tertiary，只当个记号用，不去跟数值抢注意力。 */
export const rowDateIcon = style({ flexShrink: 0, color: 'var(--affine-v2-text-tertiary)' })

export const rowDateLabel = style({ color: 'var(--affine-v2-text-tertiary)' })

/** 等宽数字：时间这列全是「7小时前 / 12小时前 / 昨天」，等宽之后每行都一条线。 */
export const rowDateValue = style({
  width: 56,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
})

/* ── 网格视图（grid / masonry 共用） ── */

export const grid = style({
  flexShrink: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 24,
})

export const card = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 16,
  borderRadius: 12,
  background: 'var(--affine-v2-layer-background-secondary)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  cursor: 'pointer',
  // 网格 / 瀑布流**不虚拟化**（列表那一档虚拟化了，这两个没有）：几百篇的时候整页都是卡片。
  // 屏幕外的卡片交给浏览器跳过布局与绘制，量过一次之后它自己记着真实高度（`auto`）。
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 128px',
  selectors: {
    '&:hover': { borderColor: 'var(--affine-v2-layer-insideBorder-primaryBorder)' },
  },
})

export const cardHead = style({ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 })

/** 行 / 卡片左侧那一格：勾的**点击区** —— 24 见方，不是那 16 的小方框（用户：「点不到」）。
 *  勾和图标共用这一格：悬停或已勾上时勾出来、图标让位（`iconYield`），
 *  所以行不因为悬停而左右抽动。
 *  ★ 必须写在 `row` / `card` / `cardHead` **后面** —— 选择器里引用了它们的类名，
 *    写前面在模块求值时就炸。 */
export const checkHit = style({
  position: 'absolute',
  top: '50%',
  marginTop: -12,
  width: 24,
  height: 24,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  cursor: 'pointer',
  opacity: 0,
  transition: 'opacity 120ms ease-out',
  selectors: {
    // 行的内边距 4 —— 勾正好落在图标自己那一格里
    [`${row} &`]: { left: 4 },
    // 卡片头没有内边距，勾贴在格子左缘
    [`${cardHead} &`]: { left: 0 },
    [`${row}:hover &`]: { opacity: 1 },
    [`${card}:hover &`]: { opacity: 1 },
    '&:focus-within': { opacity: 1 },
  },
})

/** 已经勾上的：鼠标移到别处也一直露着（状态不许自己消失）。
 *  写在这儿才压得住上面那条基础 `opacity: 0`（两条同权重，后写的赢）。 */
export const checkOn = style({ opacity: 1 })

/** 勾本体。★ **指针事件一律不吃**：一下点击只由行那一层（`openOrPick`）处理。
 *  两边都响应的话就是「勾上又被那一行反勾回去 + 顺手把文档打开」——用户看到的就是
 *  「一点就进入页面了」。键盘还能 Tab 过来、空格勾上（那是 `onChange`）。 */
export const check = style({
  width: 16,
  height: 16,
  margin: 0,
  pointerEvents: 'none',
  accentColor: 'var(--affine-primary-color)',
})

/** 跟勾同一格的图标：悬停时让位。 */
export const iconYield = style({
  transition: 'opacity 120ms ease-out',
  selectors: {
    [`${row}:hover &`]: { opacity: 0 },
    [`${card}:hover &`]: { opacity: 0 },
  },
})

/** 那一篇已经勾上了 —— 图标一直让着，别弹回来盖住勾。 */
export const iconGone = style({ opacity: 0 })

/** 行尾的收藏 / ⋯：默认压暗到六成，悬停才亮回来 —— 96 行排下来这两颗图标最抢眼，
 *  而它们不是这一页要读的信息。
 *  ★ 得写在 `row` / `card` 后面：选择器里引用的是它们的类名，写前面在模块求值时就炸。 */
export const rowActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  opacity: 0.6,
  transition: 'opacity 120ms ease-out',
  selectors: {
    [`${row}:hover &`]: { opacity: 1 },
    [`${card}:hover &`]: { opacity: 1 },
  },
})

export const cardTitle = style({
  flex: 1,
  minWidth: 0,
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 600,
  color: 'var(--affine-v2-text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/* ── 瀑布流（C15）：CSS 多列，卡片不许被拦腰截断 ── */

export const masonry = style({
  flexShrink: 0,
  // 不用 CSS 多列：`columnCount` 会按列填充，DOM 顺序和眼睛看到的顺序对不上
  // （左列走完才轮到中列）。网格 + `alignItems: start` 让卡片各自长高，顺序仍是行的。
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  alignItems: 'start',
  gap: 24,
  '@media': {
    '(max-width: 900px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
})

export const masonryCard = style([card, { marginBottom: 0 }])

/* ── 空态 / 错误 / 别的标签页 ── */

export const empty = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 16,
  color: 'var(--affine-v2-text-tertiary)',
})

export const emptyText = style({ margin: 0, fontSize: 14 })

export const note = style({ margin: 0, padding: 48, color: 'var(--affine-v2-text-tertiary)' })

export const error = style({ margin: 0, padding: '0 24px 8px', fontSize: 12, color: 'var(--affine-error-color)' })

/* ── 浮层（⋯ 菜单 / Display） ── */

export const popWrap = style({ position: 'relative', display: 'flex', alignItems: 'center' })

/** portal 到 body，所以坐标由 JS 给（`position: fixed`）—— 留在滚动容器里会被 overflow 裁掉。 */
export const menu = style({
  position: 'fixed',
  zIndex: 20,
  minWidth: 180,
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  borderRadius: 8,
  background: 'var(--affine-v2-layer-background-primary)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  boxShadow: 'var(--affine-menu-shadow)',
})

export const menuItem = style({
  height: 28,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const menuLabel = style({
  padding: '4px 8px 0',
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary)',
})

export const segRow = style({ display: 'flex', gap: 4, padding: '4px 4px 4px' })

export const seg = style({
  flex: 1,
  height: 24,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const segOn = style([
  seg,
  {
    color: 'var(--affine-v2-text-primary)',
    background: 'var(--affine-v2-layer-background-secondary)',
  },
])
