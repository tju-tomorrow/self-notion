/**
 * Notion 深色（D-0194）。种子只定六色，悬停不跟强调色走 —— Notion 的选中是一层白，不是蓝条。
 * 布局差（侧栏通到窗口顶）写在 `NOTION_CSS`，只在 `data-sn-theme="notion"` 时生效。
 */
import type { Seeds } from './types'

const on = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`
const blend = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`

/** 盖掉 `expand` 里那套「悬停 = 强调色」。关系仍跟种子走，调画布 / 字色整页跟着变。 */
export function notionVars(seeds: Seeds): Record<string, string> {
  const { canvas, text, border } = seeds
  const textSec = blend(text, 62, canvas)
  const textTer = blend(text, 46, canvas)
  const icon = blend(text, 58, canvas)
  const wash = on(text, 6)
  const pill = on(text, 8)

  return {
    '--affine-v2-text-primary': text,
    '--affine-text-primary-color': text,
    '--affine-v2-text-secondary': textSec,
    '--affine-text-secondary-color': textSec,
    '--affine-v2-text-tertiary': textTer,
    '--affine-v2-text-placeholder': textTer,
    '--affine-text-disable-color': blend(text, 28, canvas),

    '--affine-v2-icon-primary': icon,
    '--affine-v2-icon-secondary': blend(text, 42, canvas),
    '--affine-v2-icon-tertiary': blend(text, 32, canvas),
    '--affine-icon-color': icon,
    '--affine-icon-secondary': blend(text, 42, canvas),

    '--affine-v2-layer-background-hoverOverlay': wash,
    '--affine-v2-layer-background-hover': pill,
    '--affine-hover-color': pill,
    '--affine-primary-color-04': wash,

    // 深色 Notion 的链接蓝，比按钮那支饱和蓝灰一档。
    '--affine-link-color': '#529cca',

    '--affine-border-color': border,
    '--affine-v2-layer-insideBorder-border': border,
    '--affine-v2-layer-insideBorder-blackBorder': on(text, 5),
    '--affine-v2-layer-insideBorder-whiteBorder': on(text, 5),

    '--affine-v2-button-secondary': wash,
    '--affine-v2-button-iconButtonSolid': 'transparent',
    '--affine-v2-button-emptyIconBackground': wash,
    '--affine-v2-button-buttonOverHover': on(text, 10),

    '--affine-v2-tab-tabBackground-default': wash,
    '--affine-v2-tab-tabBackground-active': on(text, 12),
    '--affine-v2-tab-iconColor-default': icon,
    '--affine-v2-tab-fontColor-default': textSec,

    '--affine-shadow-2': `0 4px 16px ${on('#000', 40)}`,
    '--affine-shadow-3': `0 12px 32px ${on('#000', 48)}`,
    '--affine-menu-shadow': `0 8px 24px ${on('#000', 36)}, 0 0 0 0.5px ${on(text, 10)}`,
    '--affine-popover-shadow': `0 8px 28px ${on('#000', 42)}`,
    '--affine-overlay-shadow': `0 8px 24px ${on('#000', 40)}`,

    '--sn-text': text,
    '--sn-muted': textSec,
    '--sn-line': border,
    '--sn-hover': wash,

    '--sn-nav-on': text,
    '--sn-nav-on-bg': pill,
    '--sn-nav-on-bar': '0px',
    '--sn-search-bg': wash,
    '--sn-search-radius': '6px',
    '--sn-search-h': '28px',
    '--sn-add-bg': 'transparent',
    '--sn-add-radius': '6px',
    '--sn-add-hover': text,
    '--sn-row-radius': '6px',
    '--sn-tab-ring': on(text, 18),
  }
}

/**
 * 变量到不了的差：侧栏通顶、标题 40、正文按 81% 白、子页面不加粗。
 * 选择器都挂在 `data-sn-theme="notion"` 上，卸掉主题这些规则一起走。
 */
export const NOTION_CSS = `
html[data-sn-theme="notion"] {
  -webkit-font-smoothing: antialiased;
}

html[data-sn-theme="notion"] [data-sn-shell] {
  display: grid;
  grid-template-columns: var(--shell-sidebar-w, 248px) minmax(0, 1fr);
  grid-template-rows: 40px minmax(0, 1fr);
}
html[data-sn-theme="notion"] [data-sn-shell][data-collapsed="1"] {
  grid-template-columns: 0px minmax(0, 1fr);
}
html[data-sn-theme="notion"] [data-sn-shell] > header {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  background: var(--sn-canvas);
}
html[data-sn-theme="notion"] [data-sn-shell] > header > div:first-child {
  flex: 0 0 auto;
  width: auto;
  padding-left: 4px;
}
html[data-sn-theme="notion"] [data-sn-shell][data-collapsed="1"] > header > div:first-child {
  padding-left: 78px;
}
html[data-sn-theme="notion"] [data-sn-shell] > div:nth-child(2) {
  display: contents;
}
html[data-sn-theme="notion"] [data-sn-shell] aside {
  grid-column: 1;
  grid-row: 1 / span 2;
  width: auto;
  min-width: 0;
  min-height: 0;
  padding-top: 36px;
  background: var(--sn-sidebar);
  border-right: none;
}
html[data-sn-theme="notion"] [data-sn-shell][data-collapsed="1"] aside {
  padding: 0;
  border: none;
}
html[data-sn-theme="notion"] [data-sn-shell] main {
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
}

/* 手机（D-0195）：主题那套 grid 只认 header / aside / main；底部导航是第四个
   flex/grid 孩子，会被自动摆进第一格、和标题叠在一起（真机截图里那排
   “文档 / 搜索” 跑到了最上面）。窄屏直接退回外壳的纵向 flex。 */
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"] {
  display: flex;
  flex-direction: column;
  grid-template-columns: none;
  grid-template-rows: none;
}
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"] > header {
  grid-column: auto;
  grid-row: auto;
  flex: 0 0 auto;
}
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"] > header > div:first-child,
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"][data-collapsed="1"] > header > div:first-child {
  padding-left: 6px !important;
}
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"] > div:nth-child(2) {
  display: flex;
  flex: 1 1 0%;
  min-height: 0;
}
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"] aside {
  grid-column: auto;
  grid-row: auto;
  padding-top: env(safe-area-inset-top, 0px);
}
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"] main {
  grid-column: auto;
  grid-row: auto;
  flex: 1 1 0%;
  min-height: 0;
}
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"] > nav {
  flex: 0 0 auto;
}
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"] .sn-pane-body {
  padding-top: 36px;
}
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"] .sn-pm-title {
  font-size: calc(32px * var(--sn-font-scale, 1));
}
html[data-sn-theme="notion"] [data-sn-shell][data-mobile="1"] .sn-kbd {
  display: none !important;
}

html[data-sn-theme="notion"] .sn-kbd {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  height: 18px;
  margin-left: 8px;
  padding: 0 5px;
  border: 1px solid color-mix(in srgb, var(--sn-text) 16%, transparent);
  border-radius: 4px;
  color: var(--affine-v2-text-tertiary);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}

html[data-sn-theme="notion"] main > div > div:only-child,
html[data-sn-theme="notion"] .sn-pane-body {
  background-color: var(--sn-canvas);
  background-image: none;
}
html[data-sn-theme="notion"] .sn-pane-body {
  padding-top: 80px;
}

html[data-sn-theme="notion"] .sn-pm-title {
  font-size: calc(40px * var(--sn-font-scale, 1));
  font-weight: 700;
  letter-spacing: -0.015em;
  line-height: 1.2;
  color: var(--sn-text);
}
html[data-sn-theme="notion"] .ProseMirror {
  line-height: 1.5;
  color: color-mix(in srgb, var(--sn-text) 81%, var(--sn-canvas));
}
html[data-sn-theme="notion"] .ProseMirror :is(h1, h2, h3) {
  color: var(--sn-text);
  font-weight: 600;
  letter-spacing: -0.01em;
}
html[data-sn-theme="notion"] .ProseMirror h1 { font-size: 1.875em; }
html[data-sn-theme="notion"] .ProseMirror h2 { font-size: 1.5em; }
html[data-sn-theme="notion"] .ProseMirror h3 { font-size: 1.25em; }
html[data-sn-theme="notion"] .ProseMirror blockquote {
  margin: 2px 0;
  padding: 2px 14px;
  border-left: 3px solid color-mix(in srgb, var(--sn-text) 28%, transparent);
  border-radius: 0;
  background: transparent;
  color: color-mix(in srgb, var(--sn-text) 70%, var(--sn-canvas));
}
html[data-sn-theme="notion"] .ProseMirror a {
  color: var(--affine-link-color);
  text-decoration-color: color-mix(in srgb, var(--affine-link-color) 45%, transparent);
  text-underline-offset: 3px;
}
html[data-sn-theme="notion"] ::selection {
  background: color-mix(in srgb, var(--sn-accent) 42%, transparent);
}

html[data-sn-theme="notion"] .sn-subpage {
  gap: 6px;
  padding: 3px 4px;
  border-radius: 4px;
}
html[data-sn-theme="notion"] .sn-subpage-title { font-weight: 400; }
html[data-sn-theme="notion"] .sn-subpage:hover {
  background: color-mix(in srgb, var(--sn-text) 6%, transparent);
}
html[data-sn-theme="notion"] .sn-codeblock {
  border-radius: 4px;
  background: color-mix(in srgb, var(--sn-text) 5%, var(--sn-canvas));
}
`
