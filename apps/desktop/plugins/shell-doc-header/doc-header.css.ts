/**
 * 文档页顶栏 + ⋯ 菜单的样式。数值对齐 AFFiNE 的 doc-header（44 高、圆角 4/6、行 30）。
 * ★ 写 `var(--affine-*)` / `var(--affine-v2-*)` 大小写照抄 —— 写错一个字母整条声明作废。
 */
import { style } from '@vanilla-extract/css'

/** 顶栏的内容格。高度和底下那道线由**外壳**出（`shell.css.ts` 的 `docHeader`）——
 *  这一格只负责自己占满，好让同一行里还能并排塞别的插件的按钮（评论那颗）。 */
export const bar = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px',
})

export const crumbs = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  overflow: 'hidden',
})

export const crumb = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  maxWidth: 200,
  height: 26,
  padding: '0 6px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

/** 当前这一篇 —— 字重压一档，颜色提一档。 */
export const crumbOn = style({ color: 'var(--affine-v2-text-primary)', fontWeight: 500 })

export const crumbIcon = style({
  flex: '0 0 14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--affine-v2-icon-primary)',
})

export const crumbLabel = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })

export const sep = style({ color: 'var(--affine-v2-text-tertiary)', fontSize: 12, userSelect: 'none' })

export const actions = style({ display: 'flex', alignItems: 'center', gap: 4 })

/** 顶栏那句「已保存于 14:32」—— 比说明文字还淡一档，不抢注意。 */
export const saved = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginRight: 6,
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
  userSelect: 'none',
})

/** 那个勾单独上色 —— 整句绿会太吵，勾绿一下就够（照用户给的图）。 */
export const savedCheck = style({ display: 'flex', color: '#2da44e' })

export const iconButton = style({
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

/** ⋯ 按钮与它的浮层同一层壳 —— 「点外面关」的判定挂在它上面，点按钮才不会先把自己关掉。 */
export const anchor = style({ position: 'relative', display: 'flex', alignItems: 'center' })

export const menu = style({
  position: 'absolute',
  top: 34,
  right: 0,
  zIndex: 30,
  width: 264,
  maxHeight: 420,
  overflowY: 'auto',
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  borderRadius: 8,
  background: 'var(--affine-v2-layer-background-primary)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  boxShadow: 'var(--affine-menu-shadow)',
})

export const menuLabel = style({ padding: '4px 8px 2px', fontSize: 12, color: 'var(--affine-v2-text-tertiary)' })

/** 字体选择器见文件末尾 —— 这一块跟顶栏无关，是设置页和 ⋯ 菜单共用的。 */

export const item = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 30,
  padding: '0 8px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

/** 子页（字体 / 移动到）顶部那条返回：跟菜单项同高，底下一道细分隔线。 */
export const backRow = style([
  item,
  {
    gap: 4,
    color: 'var(--affine-v2-text-secondary)',
    borderBottom: '1px solid var(--affine-v2-layer-insideBorder-border)',
    borderRadius: 0,
    marginBottom: 4,
  },
])

export const itemIcon = style({
  flex: '0 0 18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--affine-v2-icon-primary)',
})

export const itemLabel = style({ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })

/** 开关那一行的右端（小字号 / 全宽，D-0076）。**这一行是 div 不是 button** ——
 *  `Switch` 自己就是个 button，嵌在 button 里是非法 HTML。 */
export const itemSwitch = style({ flex: '0 0 auto', marginLeft: 'auto', display: 'flex' })

/** 右侧那点小字（当前字体名、移动目标）。 */
export const itemHint = style({
  flex: '0 0 auto',
  marginLeft: 'auto',
  maxWidth: 112,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

/* ────────────────────────── 字体选择器 ────────────────────────── */

/** ⋯ 菜单那一屏：面板本身滚动，这一层再扣一档，免得字体列表把动作全顶出去。 */
export const fontPanel = style({ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 296, overflowY: 'auto' })

export const picker = style({ display: 'flex', flexDirection: 'column', gap: 4 })

/** 分组小标题（中文 / 英文 / 代码）。 */
export const pickGroup = style({ padding: '6px 2px 2px', fontSize: 11, color: 'var(--affine-v2-text-tertiary)' })

/** 设置页：卡片铺开，窄了自动换列。 */
export const pickGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
  gap: 6,
})

/** ⋯ 菜单 264 宽，一行一个。 */
export const pickGridCompact = style({ display: 'flex', flexDirection: 'column', gap: 1 })

/** 「跟随上一层」那一行：名字在左，跟到谁在右（两种排布下都长这样）。 */
export const pickFollow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 34,
  padding: '0 10px',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

export const pickFollowNote = style({
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'right',
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary)',
})

/** 两种排布共用的外壳（行 / 卡片只差一两笔）。 */
const PICK_BASE = {
  display: 'flex',
  alignItems: 'center',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
} as const

/** 紧凑行：名字在左，字样在右。 */
export const pickRow = style({ ...PICK_BASE, gap: 8, height: 30, padding: '0 8px' })

/** 卡片：上面一行字样，下面名字 + 出处。 */
export const pickCard = style({
  ...PICK_BASE,
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 6,
  padding: '8px 10px',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  textAlign: 'left',
})

/** 选中的那一个：描边提一档 + 浅底 + 一个勾。 */
export const pickOn = style({
  borderColor: 'var(--affine-primary-color)',
  background: 'var(--affine-v2-layer-background-secondary)',
})

export const pickName = style({
  flex: '0 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--affine-v2-text-primary)',
})

/** 用该字体渲染的那行字 —— 卡片上撑满，紧凑行里贴右。 */
export const pickSample = style({
  flex: '0 0 auto',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 14,
  lineHeight: '20px',
  color: 'var(--affine-v2-text-primary)',
})

export const pickFoot = style({ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 })

export const pickNote = style({
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 11,
  color: 'var(--affine-v2-text-tertiary)',
})

export const pickCheck = style({ flex: '0 0 14px', display: 'flex', color: 'var(--affine-primary-color)' })

/* ────────────────────────── 图标选择器（⋯ 菜单里那一屏） ────────────────────────── */

export const iconGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(6, 1fr)',
  gap: 2,
  padding: 4,
})

export const iconCell = style({
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

/* ────────────────────────── 设置页那一段 ────────────────────────── */

export const section = style({ display: 'flex', flexDirection: 'column', gap: 22 })
export const block = style({ display: 'flex', flexDirection: 'column', gap: 8 })

export const blockTitle = style({ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--affine-v2-text-primary)' })

export const hint = style({ margin: 0, fontSize: 13, color: 'var(--affine-v2-text-secondary)' })
