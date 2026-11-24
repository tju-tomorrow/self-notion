/**
 * 侧栏样式。数值抄 AFFiNE 的 `app-sidebar/**` 与 `navigation-panel/tree/node.css.ts`。
 * ★ 写 `var(--affine-v2-*)` 大小写照抄 —— 写错一个字母整条声明作废。
 */
import { globalStyle, style } from '@vanilla-extract/css'

/** 搜索行 + 导航行。横向 6px + 外层滚动区的 8px = 原来的 14px。 */
export const head = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '10px 6px 4px',
  flex: '0 0 auto',
})

/** 搜索行 + 右边那个「新建」方按钮，一行。 */
export const quickRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
})

/** AFFiNE 的 `QuickSearchInput`：30 高 / 圆角 4 / 左边距 8 / 图标 20。 */
export const search = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 'var(--sn-search-h, 30px)',
  '@media': { '(max-width: 720px)': { height: 40 } },
  padding: '0 10px 0 8px',
  border: 'none',
  borderRadius: 'var(--sn-search-radius, 4px)',
  background: 'var(--sn-search-bg, transparent)',
  color: 'var(--affine-v2-text-tertiary)',
  font: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background-color 120ms ease-out, color 120ms ease-out',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const searchText = style({ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })

/** AFFiNE 的 `AddPageButton`：30×30 / 圆角 8 / 实心底。 */
export const addPage = style({
  flex: '0 0 30px',
  width: 30,
  height: 30,
  '@media': { '(max-width: 720px)': { flex: '0 0 40px', width: 40, height: 40 } },
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 'var(--sn-add-radius, 8px)',
  background: 'var(--sn-add-bg, var(--affine-v2-button-iconButtonSolid))',
  color: 'var(--affine-v2-icon-primary)',
  cursor: 'pointer',
  selectors: { '&:hover': { color: 'var(--sn-add-hover, var(--affine-primary-color))' } },
})

/** AFFiNE 的 `MenuItem`：最小 30 高 / 圆角 4 / 图标 20。 */
export const navItem = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 30,
  '@media': { '(max-width: 720px)': { minHeight: 44 } },
  width: '100%',
  padding: '0 6px',
  border: 'none',
  borderRadius: 'var(--sn-row-radius, 4px)',
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  font: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background-color 120ms ease-out, color 120ms ease-out',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

/** 当前停留的导航：默认左侧竖条 + 主色，不铺底（底色留给正在看的那篇）。
 *  Notion 把 `--sn-nav-on-bar` 收成 0、改铺一层灰。 */
export const navItemOn = style({
  color: 'var(--sn-nav-on, var(--affine-primary-color))',
  fontWeight: 500,
  background: 'var(--sn-nav-on-bg, transparent)',
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: 6,
      bottom: 6,
      width: 'var(--sn-nav-on-bar, 2px)',
      borderRadius: 1,
      background: 'var(--sn-nav-on, var(--affine-primary-color))',
    },
  },
})

// 图标 span 自带颜色，选中态要盖过去；VE 不收 `& > span` 这种后代选择器，只能走 globalStyle。
globalStyle(`${navItemOn} > span:first-child`, {
  color: 'var(--sn-nav-on, var(--affine-primary-color))',
})

/** 图标统一 20px，颜色比文字淡一档（AFFiNE 的 `icon/primary`）。 */
export const navIcon = style({
  flex: '0 0 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--affine-v2-icon-primary)',
})

export const navLabel = style({ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })

/** 整条侧栏的滚动区（导航 + 页面树共用一条滚动条）。 */
export const scroll = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '0 8px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
})

/** 页面树那一段。滚动已经提到外层，这里只管纵向排列。 */
export const tree = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
})

/** 树节点行。AFFiNE 的 `tree/node.css.ts` `itemRoot`：最小 30 / 圆角 4。 */
export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 30,
  padding: '0 6px',
  borderRadius: 'var(--sn-row-radius, 4px)',
  fontSize: 14,
  cursor: 'default',
  // 拖拽的插入线是绝对定位在这一行上的。
  position: 'relative',
  transition: 'background-color 120ms ease-out',
  selectors: {
    '&:hover': { background: 'var(--affine-hover-color)' },
  },
})

/** 选中的那一行（正在看的那篇）。 */
export const rowOn = style({ background: 'var(--affine-hover-color)' })

/** 折叠三角。没有子节点时留同样宽的空位，标题才不会一级一级错开。 */
export const twisty = style({
  flex: '0 0 16px',
  width: 16,
  height: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--affine-v2-text-tertiary)',
  cursor: 'pointer',
})

/** 收起时箭头指右。裸箭头（不是 AFFiNE 那个方框里的箭头）—— 截图里那个方框太抢眼。 */
export const twistyClosed = style({
  transform: 'rotate(-90deg)',
})

export const docIcon = style({
  flex: '0 0 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--affine-v2-icon-primary)',
  fontSize: 15,
})

export const label = style({ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })

/** 行尾那几个动作按钮（收藏 / 移入回收站 / 恢复 / 删除）。平时藏着，悬停才露 ——
 *  这是 AFFiNE 的做法，也免得每一行都挂两个 ✕ 让侧栏看着很吵。 */
export const act = style({
  flex: '0 0 20px',
  width: 20,
  height: 20,
  display: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-icon-secondary)',
  cursor: 'pointer',
  selectors: {
    [`${row}:hover &`]: { display: 'flex' },
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)', color: 'var(--affine-v2-icon-primary)' },
  },
  // 触屏没有 hover：行尾动作必须常显，否则手机上根本删不了 / 恢复不了。
  '@media': { '(hover: none)': { display: 'flex', flex: '0 0 28px', width: 28, height: 28 } },
})

/** 已收藏：星常亮，不用悬停才知道这篇在收藏里。 */
export const actOn = style({
  display: 'flex',
  color: 'var(--affine-primary-color)',
})

export const input = style({
  flex: 1,
  minWidth: 0,
  fontSize: 14,
  padding: '0 2px',
  border: '1px solid var(--affine-primary-color)',
  borderRadius: 3,
  background: 'var(--affine-v2-layer-background-primary)',
  color: 'var(--affine-v2-text-primary)',
  font: 'inherit',
})

export const note = style({ margin: '4px 8px', fontSize: 12, color: 'var(--affine-v2-text-tertiary)' })
export const error = style({ margin: '4px 8px', fontSize: 12, color: 'var(--affine-error-color)' })

/** 拖拽重排的落点：在这行上沿压一条线，提示「插到它前面」。 */
/**
 * 落点插入线：一条横线 + 左端一个小圆点，**缩进到它将来所在的层级** —— 这是树拖拽的老规矩
 * （Notion / AFFiNE / Finder 都这么画）：线越深 = 落得越深，小圆点就是插入位置那一眼。
 * 位置（left / top / bottom）由行内样式算，因为深度是运行时的事。
 */
export const dropLine = style({
  position: 'absolute',
  right: 8,
  height: 2,
  borderRadius: 1,
  background: 'var(--affine-primary-color)',
  pointerEvents: 'none',
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      left: -3,
      top: -2,
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'var(--affine-primary-color)',
    },
  },
})

/** 拖拽落点那一行：整行高亮。比 hover 重一档 —— 光靠 hover 那个色看不出来「要落在这儿」。 */
export const rowDropOn = style({
  background: 'var(--affine-v2-layer-background-secondary)',
})

/** 「松手：成为子页面，并进入这一页」—— 拖到中间时贴在行尾。 */
export const dropHint = style({
  marginLeft: 'auto',
  flex: '0 0 auto',
  fontSize: 11,
  color: 'var(--affine-primary-color)',
  whiteSpace: 'nowrap',
})

/* ── 分组（可滚区那四段）—— 数值照 AFFiNE 的 `CategoryDivider` + `NavigationPanelEmptySection`。 ── */

/** 分组头：20 高 / 12px / tertiary 色，悬停出底色。 */
export const sectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 20,
  padding: '0 6px',
  borderRadius: 'var(--sn-row-radius, 4px)',
  fontSize: 12,
  lineHeight: '20px',
  fontWeight: 500,
  color: 'var(--affine-v2-text-tertiary)',
  userSelect: 'none',
  cursor: 'pointer',
  transition: 'background-color 120ms ease-out, color 120ms ease-out',
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    // 悬在右边的「+」上时别把整条也点亮。
    '&:hover:has(button:hover)': { background: 'transparent' },
  },
})

export const sectionLabel = style({ display: 'flex', alignItems: 'center', gap: 2 })

/** 折叠箭头：展开时朝下（转 90°），收起时朝右。 */
export const sectionTwisty = style({
  color: 'var(--affine-v2-icon-tertiary)',
  transform: 'translateY(1px) rotate(90deg)',
  transition: 'transform 0.2s',
})

export const sectionTwistyOff = style([
  sectionTwisty,
  { transform: 'translateY(1px) rotate(0deg)' },
])

/** 分组头右侧那颗「+」，平时藏着，悬停才露。 */
export const sectionActions = style({
  display: 'flex',
  gap: 8,
  opacity: 0,
  '@media': { '(hover: none)': { opacity: 1, pointerEvents: 'auto' } },
  // 透明但还是能点 —— 不关掉的话，点标题行右端（想折叠）会静默新建一篇。
  pointerEvents: 'none',
  selectors: { [`${sectionHeader}:hover &`]: { opacity: 1, pointerEvents: 'auto' } },
})

export const sectionAdd = style({
  width: 20,
  height: 20,
  '@media': { '(hover: none)': { width: 28, height: 28 } },
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-icon-secondary)',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
      color: 'var(--affine-v2-icon-primary)',
    },
  },
})

export const sectionBody = style({
  paddingTop: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
})

/** 空态：36 的圆底图标 + 一行灰字，居中。 */
export const emptyBox = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: '12px 0',
})

export const emptyIcon = style({
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  background: 'var(--affine-v2-button-emptyIconBackground)',
  color: 'var(--affine-v2-icon-secondary)',
})

export const emptyText = style({
  fontSize: 12,
  lineHeight: '22px',
  textAlign: 'center',
  color: 'var(--affine-v2-text-tertiary)',
  userSelect: 'none',
})

// 搜索行右侧的快捷键。默认不画 —— Notion 主题的附加表把它打开。
globalStyle('.sn-kbd', { display: 'none' })

// UA 判成 mobile 但宽度 >720（iPad 竖屏 / 手机横屏）：@media 够不着，命中区与常显动作靠属性补齐。
globalStyle(`html[data-mobile="1"] .${search}`, { height: 40 })
globalStyle(`html[data-mobile="1"] .${addPage}`, { flex: '0 0 40px', width: 40, height: 40 })
globalStyle(`html[data-mobile="1"] .${navItem}`, { minHeight: 44 })
globalStyle(`html[data-mobile="1"] .${act}`, { display: 'flex', flex: '0 0 28px', width: 28, height: 28 })
globalStyle(`html[data-mobile="1"] .${sectionActions}`, { opacity: 1, pointerEvents: 'auto' })
globalStyle(`html[data-mobile="1"] .${sectionAdd}`, { width: 28, height: 28 })
