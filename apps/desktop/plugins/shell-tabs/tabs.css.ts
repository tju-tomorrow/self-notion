/**
 * 标签条样式。数值照 AFFiNE 的 `app-tabs-header/views/styles.css.ts`：
 * 标签 26 高 / 圆角 4 / 最宽 200，底色与字色各走自己那对 token
 * （`tab/tabBackground/*`、`tab/fontColor/*`）；激活态**不是换底色**，是加一圈内描边。
 *
 * ★ token 名的大小写照抄。写错一个字母 → `var()` 落空 → 整条声明作废。
 */
import { style } from '@vanilla-extract/css'

// `-webkit-app-region` 不是标准 CSS，csstype 里没有 → 摊开写，绕开对象字面量的多余属性检查。
// 顶栏整条是拖拽区（`shell/app-shell.tsx`）；标签条这一格**必须 no-drag**，
// 否则标签点不动、也拖不了（经典坑）。
const NO_DRAG = { WebkitAppRegion: 'no-drag' }

/** 占满顶栏中间那一格。 */
export const bar = style({
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  ...NO_DRAG,
})

/** 标签多了横向滚，不把顶栏撑开。 */
export const strip = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  // 顶栏只有 40px，横向滚动条会把标签顶歪 —— 藏掉，靠滚轮/触控板横滑。
  scrollbarWidth: 'none',
})

export const tab = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 26,
  minWidth: 120,
  maxWidth: 200,
  padding: '0 4px 0 8px',
  borderRadius: 4,
  fontSize: 12,
  whiteSpace: 'nowrap',
  background: 'var(--affine-v2-tab-tabBackground-default)',
  color: 'var(--affine-v2-tab-fontColor-default)',
  cursor: 'default',
  userSelect: 'none',
  selectors: { '&:hover': { color: 'var(--affine-v2-text-primary)' } },
})

/** 当前激活的标签 —— AFFiNE 用一圈内描边，而不是把底色拉开。 */
export const tabActive = style({
  background: 'var(--affine-v2-tab-tabBackground-active)',
  boxShadow: '0 0 0 1px var(--affine-v2-button-innerBlackBorder)',
  color: 'var(--affine-v2-text-primary)',
})

/** 拖拽时悬停的落点提示。 */
export const tabOver = style({
  boxShadow: 'inset 0 0 0 2px var(--affine-primary-color)',
})

export const label = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
})

/** 标签左侧那颗图标（文档 emoji 或 PageIcon）—— AFFiNE 的 `labelIcon`，宽度固定免得文字跳。 */
export const tabIcon = style({
  flex: '0 0 16px',
  width: 16,
  height: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  color: 'var(--affine-v2-tab-iconColor-default)',
})

/** 标签右侧的空白 —— 「+」贴着最后一个标签，不是顶到最右。 */
export const spacer = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
})

/** 「+」开新标签。外壳那颗 `iconButton` 插件里 import 不到，照抄一份。 */
export const addTab = style({
  flex: '0 0 28px',
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

/** 关：只在**激活或悬停**的那一枚上浮出来，跟 AFFiNE 一样（常显会让一排标签很吵）。 */
export const close = style({
  flex: '0 0 16px',
  width: 16,
  height: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  padding: 0,
  borderRadius: 3,
  cursor: 'pointer',
  opacity: 0.55,
  selectors: {
    [`${tab}:hover &, ${tabActive} &`]: { opacity: 1 },
    '&:hover': {
      background: 'var(--affine-v2-layer-background-hoverOverlay)',
      color: 'var(--affine-v2-icon-primary)',
    },
  },
})

/** 标签上的小菜单（右键 / 双击）。坐标由 JS 给 —— portal 到 body，`position: fixed`。 */
export const menu = style({
  position: 'fixed',
  zIndex: 30,
  minWidth: 160,
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
  padding: '0 8px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 14,
  textAlign: 'left',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})
