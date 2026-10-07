/**
 * 设置弹窗的样式。形状抄 AFFiNE 的 `desktop/dialogs/setting/`（SettingDialog 1280×920、
 * 内层 `setting-sidebar/style.css.ts`：左栏 240 / 行 30 高 / 圆角）与
 * `component/ui/modal/styles.css.ts`（弹窗底色 overlayPanel + 圆角）。
 *
 * ★ `var(--affine-v2-*)` 大小写照抄。写错一个字母 → `var()` 落空 → 整条声明作废。
 */
import { style } from '@vanilla-extract/css'
import * as motion from '../../src/ui/motion.css'

/** 遮罩。同 search-panel：压到 0.45 黑再开毛玻璃。 */
export const scrim = style({
  position: 'fixed',
  inset: 0,
  zIndex: 900,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(0, 0, 0, 0.45)',
  backdropFilter: 'blur(4px)',
})

/** 弹窗本体。窗口小的时候靠 min() 收，不撑破屏。 */
const panelBox = style({
  position: 'relative',
  width: 'min(1080px, 92vw)',
  height: 'min(720px, 88vh)',
  display: 'flex',
  overflow: 'hidden',
  borderRadius: 14,
  background: 'var(--affine-v2-layer-background-overlayPanel)',
  color: 'var(--affine-v2-text-primary)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  boxShadow: 'var(--affine-shadow-3, 0 24px 60px rgba(0,0,0,.45))',
  // ★ 设置页的强调色（D-0070）。比 AFFiNE 那个蓝（#1e96eb）软一档，偏靛；
  //   滑块 / 主按钮 / 输入框聚焦边框都读它 —— 想换色只改这一行。
  vars: { '--sn-accent': '#5b7cfa' },
})

/** 本体 + 入场（`motion.riseIn` 在前：它那几条属性和本体不撞）。 */
export const panel = style([motion.riseIn, panelBox])

/** AFFiNE 的 `closeButton`：浮在右上角，不占一行。
 *
 * 做成圆形软按钮：默认浅底 + 细描边（让人一眼看出能点），悬停变粉 + 微转一下。
 * `:root` 那张 AFFiNE 表里没有粉色，下面这个值只用在这一处。 */
const PINK = '#ff8fb1'

export const close = style({
  position: 'absolute',
  top: 12,
  right: 12,
  zIndex: 1,
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  borderRadius: '50%',
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-icon-primary)',
  cursor: 'pointer',
  transition: 'background 120ms ease, color 120ms ease, transform 120ms ease',
  selectors: {
    '&:hover': { background: PINK, color: '#fff', transform: 'scale(1.06) rotate(8deg)' },
  },
})

/** 弹窗里那一层：左栏 + 内容区。 */
export const page = style({ flex: 1, minWidth: 0, display: 'flex', overflow: 'hidden' })

/** AFFiNE 的 `settingSlideBar`：240 宽、底色 secondary。 */
export const nav = style({
  flex: '0 0 240px',
  width: 240,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: '20px 12px 0 12px',
  overflowY: 'auto',
  background: 'var(--affine-v2-layer-background-secondary)',
  borderRight: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
})

export const navTitle = style({
  padding: '0 8px',
  fontSize: 15,
  fontWeight: 600,
  lineHeight: '22px',
  letterSpacing: '-.2px',
})

export const navList = style({ display: 'flex', flexDirection: 'column', gap: 2 })

/** AFFiNE 的 `sidebarSelectItem`：30 高 / 圆角 4 / 图标 20。选中态只叠一层底色。 */
export const navItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 30,
  flexShrink: 0,
  width: '100%',
  padding: '0 8px',
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--affine-v2-text-primary)',
  font: 'inherit',
  fontSize: 13.5,
  cursor: 'pointer',
  textAlign: 'left',
  selectors: { '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' } },
})

/** 选中：淡强调色底 + 字重抬一档 —— 比纯灰底看得出「选中的是这个」。 */
export const navItemOn = style({
  background: 'color-mix(in srgb, var(--sn-accent, #5b7cfa) 16%, transparent)',
  fontWeight: 500,
  selectors: {
    '&:hover': { background: 'color-mix(in srgb, var(--sn-accent, #5b7cfa) 22%, transparent)' },
  },
})

export const navIcon = style({
  flex: '0 0 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--affine-v2-icon-primary)',
})

export const navLabel = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

export const content = style({
  flex: 1,
  minWidth: 0,
  padding: '20px 28px 40px',
  overflowY: 'auto',
})

/** 段落标题：框架给每一段出的那一行（导航里那个名字）。 */
export const heading = style({
  margin: '4px 0 14px',
  fontSize: 17,
  fontWeight: 600,
  lineHeight: '24px',
  letterSpacing: '-.2px',
})

export const muted = style({ margin: 0, fontSize: 12, color: 'var(--affine-v2-text-secondary)' })

/** 插件列表：一行一个，行与行之间一条内描边（AFFiNE 的 `insideBorder`）。 */
export const list = style({ display: 'flex', flexDirection: 'column', marginTop: 8 })

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 0',
  selectors: { '& + &': { borderTop: '1px solid var(--affine-v2-layer-insideBorder-border)' } },
})

export const rowIcon = style({
  flex: '0 0 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--affine-v2-icon-secondary)',
})

export const rowMain = style({ flex: 1, minWidth: 0 })

export const rowName = style({ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })

export const identity = style({ display: 'flex', alignItems: 'baseline', gap: 8 })

export const state = style({ fontSize: 12, color: 'var(--affine-v2-text-secondary)' })

/** 没跑起来的插件那档状态，比正常的还淡一级。 */
export const stateOff = style({ color: 'var(--affine-v2-text-tertiary)' })

export const facts = style({
  marginTop: 2,
  fontSize: 12,
  color: 'var(--affine-v2-text-secondary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** AFFiNE 的 `switchRow` 右侧那个开关：32×18 的胶囊 + 14 的圆钮。 */
export const toggle = style({
  position: 'relative',
  flex: '0 0 32px',
  width: 32,
  height: 18,
  padding: 0,
  border: 'none',
  borderRadius: 9,
  background: 'var(--affine-v2-button-disable)',
  cursor: 'pointer',
  transition: 'background 120ms',
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 2,
      left: 2,
      width: 14,
      height: 14,
      borderRadius: '50%',
      background: 'var(--affine-v2-button-pureWhiteText)',
      transition: 'transform 120ms',
    },
    '&:disabled': { cursor: 'not-allowed', opacity: 0.4 },
    '&[aria-checked="true"]': { background: 'var(--affine-v2-button-primary)' },
    '&[aria-checked="true"]::after': { transform: 'translateX(14px)' },
  },
})

/** 行尾的次要按钮（卸载，目前是占位）。 */
export const plainButton = style({
  flexShrink: 0,
  padding: '4px 10px',
  border: '1px solid var(--affine-v2-button-innerBlackBorder)',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary)',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    '&:disabled': { color: 'var(--affine-v2-text-tertiary)', cursor: 'not-allowed' },
  },
})
