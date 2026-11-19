/**
 * 代码配色的两处落点：编辑器里的代码块（`.sn-codeblock`）和设置页卡片里的预览（`.ct-sample`）。
 * 同一套 `data-code-theme` 选择器，预览卡片把属性挂在自己身上，所以画廊里能同时看到六种颜色。
 */
import { globalStyle, style } from '@vanilla-extract/css'
import { THEMES } from './themes'

const ACCENT = 'var(--sn-accent, var(--affine-primary-color, #1e96eb))'
const BORDER = 'var(--affine-v2-layer-insideBorder-border, rgba(255,255,255,.09))'

const KINDS = [
  'com',
  'kw',
  'str',
  'num',
  'fn',
  'type',
  'var',
  'tag',
  'attr',
  'op',
  'meta',
  'builtin',
  'lit',
  'add',
  'del',
] as const

for (const theme of THEMES) {
  const real = `html[data-code-theme="${theme.id}"]`
  const preview = `[data-code-theme="${theme.id}"]`

  globalStyle(`${real} .sn-codeblock`, {
    background: theme.bg,
    borderColor: theme.border,
    color: theme.text,
  })
  globalStyle(`${preview} .ct-sample`, { background: theme.bg, color: theme.text })

  for (const kind of KINDS) {
    globalStyle(`${real} .sn-code-text .hl-${kind}, ${preview} .ct-sample .hl-${kind}`, {
      color: theme[kind],
    })
  }
  globalStyle(`${real} .sn-code-text .hl-com, ${preview} .ct-sample .hl-com`, {
    fontStyle: 'italic',
  })
}

export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))',
  gap: 12,
  width: '100%',
})

export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  background: 'var(--affine-v2-layer-background-secondary)',
  color: 'var(--affine-v2-text-primary)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': { borderColor: ACCENT },
  },
})

export const on = style({
  outline: `2px solid ${ACCENT}`,
  outlineOffset: 1,
})

export const name = style({
  fontSize: 13,
  fontWeight: 600,
})

export const sample = style({
  margin: 0,
  padding: '8px 9px',
  borderRadius: 6,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: 'pre',
  overflow: 'hidden',
})
