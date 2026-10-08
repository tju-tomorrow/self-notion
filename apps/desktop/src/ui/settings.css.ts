/**
 * 设置页行式控件的样式（D-0070）。分两层：
 *   1. 盒子：段落、行 —— 只动间距和字体；
 *   2. 控件：滑块 / 输入框 / 按钮 —— 强调色读 `--sn-accent`（设置弹窗写的那一个）。
 *
 * ★ 表格边框用 `--affine-v2-layer-insideBorder-border`（新主题表里那一套细边），
 *   不是 v1 的 `--affine-border-color`。混用两代 token 就是「一看就不对劲」的来源。
 */
import { style } from '@vanilla-extract/css'

const ACCENT = 'var(--sn-accent, var(--affine-primary-color, #1e96eb))'
const BORDER = 'var(--affine-v2-layer-insideBorder-border, rgba(255,255,255,.09))'

export const group = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '4px 0 20px',
})

export const groupHead = style({ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 0' })

export const groupTitle = style({
  margin: 0,
  fontSize: 15,
  fontWeight: 600,
  lineHeight: '22px',
  color: 'var(--affine-v2-text-primary)',
})

export const groupDesc = style({
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-secondary)',
})

export const rows = style({ display: 'flex', flexDirection: 'column' })

/** 一行：上面一条细分隔线（第一行不画），中间是标签，右边控件。 */
export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '10px 0',
  borderTop: `1px solid ${BORDER}`,
  selectors: { '&:first-child': { borderTop: 'none' } },
})

export const rowMain = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
})

export const rowLabel = style({ fontSize: 13.5, lineHeight: '20px', color: 'var(--affine-v2-text-primary)' })

export const rowDesc = style({
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-secondary)',
})

export const rowControl = style({ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8 })

/* ────────────────────────── 滑块 ────────────────────────── */

/** 关着的滑块。开着的是 `switchOn`（同一个身子，换了底色）。 */
export const switchBase = style({
  position: 'relative',
  flex: '0 0 36px',
  width: 36,
  height: 21,
  padding: 0,
  border: 'none',
  borderRadius: 999,
  background: 'var(--affine-v2-toggle-backgroundOff, #929292)',
  cursor: 'pointer',
  transition: 'background 140ms ease',
  selectors: { '&:disabled': { opacity: 0.5, cursor: 'default' } },
})

export const switchOn = style([switchBase, { background: ACCENT }])

export const knob = style({
  position: 'absolute',
  top: 2.5,
  left: 2.5,
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: '#fff',
  boxShadow: '0 1px 2px rgba(0,0,0,.25)',
  transition: 'transform 140ms ease',
  selectors: { [`${switchOn} &`]: { transform: 'translateX(15px)' } },
})

/* ────────────────────────── 输入框 ────────────────────────── */

export const input = style({
  width: 220,
  height: 30,
  padding: '0 9px',
  fontSize: 13,
  borderRadius: 8,
  border: `1px solid ${BORDER}`,
  background: 'var(--affine-v2-layer-background-secondary, rgba(255,255,255,.04))',
  color: 'var(--affine-v2-text-primary)',
  fontFamily: 'inherit',
  outline: 'none',
  selectors: {
    '&::placeholder': { color: 'var(--affine-v2-text-placeholder, #7a7a7a)' },
    '&:focus': { borderColor: ACCENT, background: 'var(--affine-v2-layer-background-primary)' },
  },
})

export const inputMono = style({ fontFamily: 'var(--affine-font-code-family)', fontSize: 12 })

/** 下拉的外壳：箭头要绝对定位，所以多一层。宽度给这层，不给出 `<select>`。 */
export const selectWrap = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
})

export const select = style([
  input,
  {
    appearance: 'none',
    width: '100%',
    // 给箭头让出位置
    paddingRight: 24,
    cursor: 'pointer',
  },
])

/** 系统箭头被 `appearance: none` 去掉了，这一个拿两条边旋出来 —— 省一个图标依赖。 */
export const selectCaret = style({
  position: 'absolute',
  right: 10,
  width: 7,
  height: 7,
  marginTop: -3,
  borderRight: '1.5px solid var(--affine-v2-icon-secondary, #8a8a8a)',
  borderBottom: '1.5px solid var(--affine-v2-icon-secondary, #8a8a8a)',
  transform: 'rotate(45deg)',
  pointerEvents: 'none',
})

/* ────────────────────────── 按钮 ────────────────────────── */

const buttonBase = style({
  height: 30,
  padding: '0 13px',
  border: 'none',
  borderRadius: 8,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  selectors: { '&:disabled': { opacity: 0.5, cursor: 'default' } },
})

export const button = style([
  buttonBase,
  {
    background: 'var(--affine-v2-layer-background-secondary, rgba(255,255,255,.05))',
    color: 'var(--affine-v2-text-primary)',
    selectors: {
      '&:hover:not(:disabled)': { background: 'var(--affine-v2-layer-background-hoverOverlay)' },
    },
  },
])

export const buttonPrimary = style([
  buttonBase,
  {
    background: ACCENT,
    color: '#fff',
    selectors: { '&:hover:not(:disabled)': { filter: 'brightness(1.08)' } },
  },
])

export const buttonDanger = style([
  buttonBase,
  {
    background: '#e5484d',
    color: '#fff',
    selectors: { '&:hover:not(:disabled)': { filter: 'brightness(1.08)' } },
  },
])

/* ────────────────────────── 灰字 ────────────────────────── */

export const note = style({
  margin: '6px 0 0',
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--affine-v2-text-secondary)',
})

export const noteError = style({ color: 'var(--affine-v2-status-error, #e5484d)' })
export const noteOk = style({ color: 'var(--affine-v2-status-success, #44b931)' })
