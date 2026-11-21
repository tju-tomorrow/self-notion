/**
 * 行内格式工具栏的样式（`inline-toolbar.ts` 建的那几个 DOM）。
 *
 * 配色口径照同目录的 `editor.css.ts`：`--sn-*` 带兜底值，**不吃 `--affine-*`**（基座换了那批变量没了）。
 */
import { globalStyle } from '@vanilla-extract/css'
import type { GlobalStyleRule } from '@vanilla-extract/css'

/** 外壳的 mobile 判定含 UA，移动规则得同时写 data 标记和窄屏 media 两份。 */
function mobile(selector: string, rule: GlobalStyleRule): void {
  globalStyle(`html[data-mobile="1"] ${selector}`, rule)
  globalStyle(selector, { '@media': { '(max-width: 720px)': rule } } as unknown as GlobalStyleRule)
}

const BG = 'var(--sn-panel, #ffffff)'
const LINE = 'var(--sn-line, rgba(0, 0, 0, .1))'
const TEXT = 'var(--sn-text, #2b2b2b)'
const HOVER = 'var(--sn-hover, rgba(0, 0, 0, .06))'
const ACCENT = 'var(--sn-accent, #1e96eb)'
const SHADOW = '0 6px 24px rgba(0, 0, 0, .16)'

globalStyle('.sn-itb', {
  position: 'fixed',
  zIndex: 70,
  display: 'none',
  alignItems: 'center',
  gap: 2,
  padding: 3,
  border: `0.5px solid ${LINE}`,
  borderRadius: 8,
  background: BG,
  boxShadow: SHADOW,
  fontFamily: 'inherit',
  userSelect: 'none',
})

globalStyle('.sn-itb.sn-itb-on', { display: 'flex' })

// 按钮这一层：桌面照旧单行；手机上可横滚，色板/菜单挂在 root 上不吃这个裁切。
globalStyle('.sn-itb-strip', {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  minWidth: 0,
})

globalStyle('.sn-itb-btn', {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: TEXT,
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
})

globalStyle('.sn-itb-btn:hover', { background: HOVER })
globalStyle('.sn-itb-btn[data-active="true"]', { background: HOVER, color: ACCENT })

globalStyle('.sn-itb-b', { fontWeight: 700 })
globalStyle('.sn-itb-i', { fontStyle: 'italic' })
globalStyle('.sn-itb-u', { textDecoration: 'underline' })
globalStyle('.sn-itb-s', { textDecoration: 'line-through' })
globalStyle('.sn-itb-code', { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 })

globalStyle('.sn-itb-icon svg', { display: 'block' })

globalStyle('.sn-itb-color', { flexDirection: 'column', fontWeight: 600 })

globalStyle('.sn-itb-bar', {
  width: 14,
  height: 3,
  marginTop: 1,
  borderRadius: 2,
  background: 'currentColor',
})

globalStyle('.sn-itb-sep', { width: 1, height: 18, margin: '0 2px', background: LINE })

globalStyle('.sn-itb-turn', {
  width: 'auto',
  padding: '0 8px',
  gap: 4,
  fontSize: 13,
})

globalStyle('.sn-itb-chev', { fontSize: 9, opacity: 0.7 })

globalStyle('.sn-itb-menu', {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: 0,
  display: 'none',
  flexDirection: 'column',
  minWidth: 132,
  padding: 4,
  border: `0.5px solid ${LINE}`,
  borderRadius: 8,
  background: BG,
  boxShadow: SHADOW,
})

globalStyle('.sn-itb-menu[data-open="true"]', { display: 'flex' })

globalStyle('.sn-itb-menu button', {
  height: 28,
  padding: '0 8px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: TEXT,
  font: 'inherit',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
})

globalStyle('.sn-itb-menu button:hover', { background: HOVER })
globalStyle('.sn-itb-menu button[data-on="true"]', { color: ACCENT })

// 色板 / 链接输入都从工具条下沿展开（相对 root 绝对定位）。
globalStyle('.sn-itb-palette', {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  width: 156,
  padding: 6,
  border: `0.5px solid ${LINE}`,
  borderRadius: 8,
  background: BG,
  boxShadow: SHADOW,
})

globalStyle('.sn-itb-swatch', {
  width: 20,
  height: 20,
  padding: 0,
  border: `1px solid ${LINE}`,
  borderRadius: 4,
  cursor: 'pointer',
})

globalStyle('.sn-itb-swatch[data-on="true"]', { outline: `2px solid ${ACCENT}`, outlineOffset: 1 })

// 空色 = 清除，画一道红斜杠。
globalStyle('.sn-itb-swatch-none', {
  background: `linear-gradient(45deg, transparent 44%, #e03e3e 44%, #e03e3e 56%, transparent 56%)`,
})

globalStyle('.sn-itb-linkrow', {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
})

globalStyle('.sn-itb-input', {
  width: 220,
  height: 30,
  padding: '0 8px',
  border: `1px solid ${LINE}`,
  borderRadius: 8,
  background: BG,
  color: TEXT,
  font: 'inherit',
  fontSize: 13,
  outline: 'none',
  boxShadow: SHADOW,
})

globalStyle('.sn-itb-input:focus', { borderColor: ACCENT })

// 手机：整条不超屏宽；横滚只落在 strip 上，root 不裁切绝对定位的色板/菜单。
mobile('.sn-itb', { maxWidth: 'calc(100vw - 8px)' })
mobile('.sn-itb-strip', {
  overflowX: 'auto',
  overscrollBehaviorX: 'contain',
  touchAction: 'pan-x',
})
mobile('.sn-itb-btn', {
  width: 36,
  minWidth: 36,
  height: 36,
  fontSize: 15,
  flexShrink: 0,
})
mobile('.sn-itb-turn', { width: 'auto' })
mobile('.sn-itb-sep', { height: 22, flexShrink: 0 })
mobile('.sn-itb-swatch', { width: 28, height: 28 })
