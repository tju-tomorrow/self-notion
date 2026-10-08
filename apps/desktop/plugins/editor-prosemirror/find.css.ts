/**
 * 查找面板 + 命中高亮。
 *
 * ★ 面板是独立浮层（portal 到 body），不吃外壳样式。配色沿用旧 `find-panel` 的 `--affine-*`
 *   token、都带兜底值 —— 万一那批变量不在了也不至于变成透明字。
 */
import { globalStyle, style } from '@vanilla-extract/css'

export const panel = style({
  position: 'fixed',
  top: 56,
  right: 24,
  zIndex: 2000,
  width: 340,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 10,
  borderRadius: 10,
  background: 'var(--affine-v2-layer-background-primary, #fff)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border, rgba(0,0,0,.1))',
  boxShadow: 'var(--affine-menu-shadow, 0 8px 24px rgba(0,0,0,.18))',
  color: 'var(--affine-v2-text-primary, #222)',
  fontFamily: 'var(--affine-font-family, inherit)',
  fontSize: 13,
})

export const row = style({ display: 'flex', alignItems: 'center', gap: 6 })

export const input = style({
  flex: 1,
  minWidth: 0,
  height: 28,
  padding: '0 8px',
  border: '1px solid var(--affine-v2-layer-insideBorder-border, rgba(0,0,0,.12))',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
})

export const count = style({
  minWidth: 48,
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--affine-v2-text-tertiary, #999)',
})

export const btn = style({
  height: 26,
  padding: '0 8px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--affine-v2-text-secondary, #666)',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
})

export const note = style({ fontSize: 12, color: 'var(--affine-v2-text-tertiary, #999)' })

/* ── 命中高亮：decoration 挂上去的两个类（`find.ts` 里只写类名，不 import 这份样式） ── */

globalStyle('.sn-find-hit', {
  backgroundColor: 'var(--affine-find-highlight, rgba(255, 214, 0, .38))',
  borderRadius: 2,
})

// 当前这一处要压过其它命中，一眼能分出来。
globalStyle('.sn-find-active', {
  backgroundColor: 'var(--affine-find-highlight-active, rgba(255, 146, 0, .55))',
  borderRadius: 2,
})
