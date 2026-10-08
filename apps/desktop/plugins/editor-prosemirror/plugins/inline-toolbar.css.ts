/**
 * 行内格式工具栏的样式（`inline-toolbar.ts` 建的那几个 DOM）。
 *
 * 配色口径照同目录的 `editor.css.ts`：`--sn-*` 带兜底值，**不吃 `--affine-*`**（基座换了那批变量没了）。
 */
import { globalStyle } from '@vanilla-extract/css'

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
