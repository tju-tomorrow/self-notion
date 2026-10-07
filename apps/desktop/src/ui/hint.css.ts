/**
 * 悬停提示的皮。配色走浮层那一套 token（和菜单、⌘K 同一个语义层，见 `doc-menu.css.ts`）。
 *
 * ★ 不用浏览器自带的 `title`：那个要停够一秒才冒出来，样式也改不动。自己画一个，
 *   出来的时机和长相都在手上 —— 全仓的悬停提示都走这一份。
 */
import { style } from '@vanilla-extract/css'

export const wrap = style({ position: 'relative', display: 'inline-flex' })

export const tip = style({
  position: 'absolute',
  // 提示都挂在**顶栏那一行**上，往右对齐就不会顶出窗口右缘。
  top: 'calc(100% + 6px)',
  right: 0,
  zIndex: 40,
  padding: '4px 8px',
  borderRadius: 6,
  fontSize: 12,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  background: 'var(--affine-v2-layer-background-primary)',
  border: '0.5px solid var(--affine-v2-layer-insideBorder-border)',
  boxShadow: 'var(--affine-menu-shadow)',
  color: 'var(--affine-v2-text-primary)',
  opacity: 0,
  transition: 'opacity 120ms ease-out',
  selectors: { [`${wrap}:hover > &`]: { opacity: 1 } },
})
