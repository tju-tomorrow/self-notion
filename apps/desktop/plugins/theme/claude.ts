/**
 * Claude 网页那套。界面是 Anthropic Sans，正文和标题是 Anthropic Serif。
 * 中文不在那两套里：正文跟标题一样走宋体，别掉回苹方黑体。
 * 浅色 / 黑夜共用这段 CSS，颜色从种子来。
 */
import type { Seeds } from './types'

const on = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`
const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`

const SANS = '"Anthropic Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif'
const SERIF = '"Anthropic Serif","Songti SC","Noto Serif SC",Georgia,serif'
const MONO = '"Anthropic Mono",ui-monospace,"SFMono-Regular",Menlo,monospace'

/** claude.ai 黑夜：暖炭，不是冷黑。 */
export const CLAUDE_DARK: Seeds = {
  canvas: '#262624',
  sidebar: '#262624',
  surface: '#30302e',
  accent: '#faf9f5',
  text: '#faf9f5',
  border: '#3d3d3a',
}

function darkCanvas(hex: string): boolean {
  const h = hex.replace('#', '')
  if (h.length !== 6) return false
  const n = Number.parseInt(h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return r * 0.299 + g * 0.587 + b * 0.114 < 140
}

export function claudeVars(seeds: Seeds): Record<string, string> {
  const { text, canvas, surface } = seeds
  const dark = darkCanvas(canvas)
  const chip = mix(text, 10, canvas)
  const wash = mix(text, 6, canvas)
  const muted = mix(text, 62, canvas)
  const quiet = mix(text, 42, canvas)

  return {
    '--affine-font-family': SANS,
    '--sn-font-doc': SERIF,
    '--sn-font-over': SERIF,
    '--affine-font-code-family': MONO,
    '--affine-font-mono-family': MONO,

    '--affine-v2-text-secondary': muted,
    '--affine-text-secondary-color': muted,
    '--affine-v2-text-tertiary': quiet,
    '--affine-v2-text-placeholder': quiet,
    '--affine-v2-icon-primary': mix(text, 82, canvas),
    '--affine-v2-icon-secondary': muted,
    '--affine-v2-icon-tertiary': quiet,
    '--affine-icon-color': mix(text, 82, canvas),

    '--affine-v2-layer-background-hoverOverlay': wash,
    '--affine-v2-layer-background-hover': chip,
    '--affine-hover-color': wash,
    '--affine-primary-color-04': wash,
    '--affine-link-color': dark ? '#9ec0f0' : '#3266ad',

    '--affine-v2-button-primary': text,
    '--affine-v2-button-secondary': wash,
    '--affine-v2-button-iconButtonSolid': 'transparent',
    '--affine-v2-button-emptyIconBackground': wash,
    '--affine-v2-button-buttonOverHover': chip,
    '--affine-v2-button-pureWhiteText': canvas,

    '--affine-v2-layer-background-codeBlock': surface,
    '--affine-v2-tab-tabBackground-default': 'transparent',
    '--affine-v2-tab-tabBackground-active': surface,
    '--affine-v2-tab-iconColor-default': muted,
    '--affine-v2-tab-fontColor-default': muted,

    '--affine-shadow-2': `0 1px 2px ${on(text, 6)}, 0 8px 24px ${on(text, 8)}`,
    '--affine-shadow-3': `0 12px 32px ${on(text, 12)}`,
    '--affine-menu-shadow': `0 8px 28px ${on(text, 12)}, 0 0 0 1px ${on(text, 8)}`,
    '--affine-popover-shadow': `0 8px 28px ${on(text, 12)}`,
    '--affine-overlay-shadow': `0 8px 24px ${on(text, 10)}`,

    '--sn-text': text,
    '--sn-muted': muted,
    '--sn-line': mix(text, 14, canvas),
    '--sn-hover': wash,
    '--sn-nav-on': text,
    '--sn-nav-on-bg': chip,
    '--sn-nav-on-bar': '0px',
    '--sn-search-bg': surface,
    '--sn-search-radius': '12px',
    '--sn-search-h': '36px',
    '--sn-add-bg': 'transparent',
    '--sn-add-radius': '10px',
    '--sn-add-hover': text,
    '--sn-row-radius': '10px',
    '--sn-tab-ring': on(text, 10),
    '--sn-canvas': canvas,
    '--sn-panel': surface,
  }
}

export const CLAUDE_CSS = `
html[data-sn-theme="claude"] {
  font-family: ${SANS} !important;
  --affine-font-family: ${SANS} !important;
  --sn-font-doc: ${SERIF} !important;
  --sn-font-over: ${SERIF} !important;
  --affine-font-code-family: ${MONO} !important;
  --affine-font-mono-family: ${MONO} !important;
  -webkit-font-smoothing: antialiased;
  color: var(--sn-text);
  scrollbar-color: color-mix(in srgb, var(--sn-text) 28%, transparent) transparent;
}

html[data-sn-theme="claude"] [data-sn-shell] {
  display: grid;
  grid-template-columns: var(--shell-sidebar-w, 260px) minmax(0, 1fr);
  grid-template-rows: 40px minmax(0, 1fr);
  background: var(--sn-canvas);
  transition: grid-template-columns 180ms cubic-bezier(0.22, 0.61, 0.36, 1), background-color 150ms ease-out;
}
html[data-sn-theme="claude"] [data-sn-shell][data-resizing] {
  transition: none;
}
html[data-sn-theme="claude"] [data-sn-shell][data-collapsed="1"] {
  grid-template-columns: 0px minmax(0, 1fr);
}
html[data-sn-theme="claude"] [data-sn-shell] > header {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  background: var(--sn-canvas);
  border: none;
}
html[data-sn-theme="claude"] [data-sn-shell] > header > div:first-child {
  flex: 0 0 auto;
  width: auto;
  padding-left: 4px;
  transition: padding-left 180ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
html[data-sn-theme="claude"] [data-sn-shell][data-collapsed="1"] > header > div:first-child {
  padding-left: 78px;
}
html[data-sn-theme="claude"] [data-sn-shell] > header button {
  border-radius: 999px;
}
html[data-sn-theme="claude"] [data-sn-shell] > div:nth-child(2) {
  display: contents;
}
html[data-sn-theme="claude"] [data-sn-shell] aside {
  grid-column: 1;
  grid-row: 1 / span 2;
  width: auto;
  min-width: 0;
  min-height: 0;
  padding-top: 36px;
  background: var(--sn-canvas) !important;
  border-right: none;
}
html[data-sn-theme="claude"] [data-sn-shell] aside [data-sn-drag] {
  display: block;
}
html[data-sn-theme="claude"] [data-sn-shell][data-collapsed="1"] aside {
  padding: 0;
  border: none;
}
html[data-sn-theme="claude"] [data-sn-shell] main {
  grid-column: 2;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
  background: var(--sn-canvas);
}

html[data-sn-theme="claude"] [data-sn-shell][data-mobile="1"] {
  display: flex;
  flex-direction: column;
  grid-template-columns: none;
  grid-template-rows: none;
}
html[data-sn-theme="claude"] [data-sn-shell][data-mobile="1"] > header,
html[data-sn-theme="claude"] [data-sn-shell][data-mobile="1"] aside,
html[data-sn-theme="claude"] [data-sn-shell][data-mobile="1"] main,
html[data-sn-theme="claude"] [data-sn-shell][data-mobile="1"] > nav {
  grid-column: auto;
  grid-row: auto;
}
html[data-sn-theme="claude"] [data-sn-shell][data-mobile="1"] > header > div:first-child,
html[data-sn-theme="claude"] [data-sn-shell][data-mobile="1"][data-collapsed="1"] > header > div:first-child {
  padding-left: 6px !important;
}
html[data-sn-theme="claude"] [data-sn-shell][data-mobile="1"] > div:nth-child(2) {
  display: flex;
  flex: 1 1 0%;
  min-height: 0;
}
html[data-sn-theme="claude"] [data-sn-shell][data-mobile="1"] aside {
  padding-top: env(safe-area-inset-top, 0px);
}
html[data-sn-theme="claude"] [data-sn-shell][data-mobile="1"] main {
  flex: 1 1 0%;
  min-height: 0;
}

html[data-sn-theme="claude"] aside button {
  border-radius: 10px;
}
html[data-sn-theme="claude"] .sn-kbd {
  border: none;
  background: var(--sn-hover);
  border-radius: 6px;
  color: var(--sn-muted);
  font-family: ${SANS};
}

html[data-sn-theme="claude"] main > div > div:first-child {
  border-bottom-color: transparent;
  background-color: var(--sn-canvas);
}
html[data-sn-theme="claude"] main > div > div:only-child,
html[data-sn-theme="claude"] .sn-pane-body {
  background-color: var(--sn-canvas);
  background-image: none;
}

html[data-sn-theme="claude"] .sn-display,
html[data-sn-theme="claude"] .sn-pm-title,
html[data-sn-theme="claude"] .ProseMirror,
html[data-sn-theme="claude"] .ProseMirror :is(h1, h2, h3) {
  font-family: ${SERIF};
  color: var(--sn-text);
}
html[data-sn-theme="claude"] .sn-display {
  font-size: 28px;
  font-weight: 460;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
html[data-sn-theme="claude"] .sn-pm-title {
  font-size: calc(36px * var(--sn-font-scale, 1));
  font-weight: 460;
  letter-spacing: -0.025em;
  line-height: 1.2;
}
html[data-sn-theme="claude"] .ProseMirror {
  font-weight: 400;
  line-height: 1.75;
}
html[data-sn-theme="claude"] .ProseMirror :is(h1, h2, h3) {
  font-weight: 500;
  letter-spacing: -0.02em;
}
html[data-sn-theme="claude"] .ProseMirror :is(strong, b) {
  font-weight: 650;
}
html[data-sn-theme="claude"] .ProseMirror a {
  color: var(--affine-link-color);
  text-underline-offset: 3px;
}
html[data-sn-theme="claude"] .sn-code-text,
html[data-sn-theme="claude"] .sn-inline-code {
  font-family: ${MONO};
}
html[data-sn-theme="claude"] .sn-codeblock,
html[data-sn-theme="claude"] .sn-code {
  border-radius: 12px;
}
html[data-sn-theme="claude"] ::selection {
  background: color-mix(in srgb, var(--sn-text) 18%, var(--sn-canvas));
}

html[data-sn-theme="claude"] .sn-btn {
  border-radius: 999px;
  height: 32px;
  padding: 0 14px;
  font-weight: 500;
}
html[data-sn-theme="claude"] .sn-btn-primary {
  background: var(--sn-text);
  color: var(--sn-canvas);
}
html[data-sn-theme="claude"] .sn-btn-primary:hover:not(:disabled) {
  filter: brightness(1.12);
}
html[data-sn-theme="claude"] input,
html[data-sn-theme="claude"] textarea,
html[data-sn-theme="claude"] select {
  border-radius: 12px;
}
html[data-sn-theme="claude"] :where(button, a, input, textarea, select):focus-visible {
  outline-color: color-mix(in srgb, var(--sn-text) 35%, transparent);
}
html[data-sn-theme="claude"] [role="menu"],
html[data-sn-theme="claude"] [role="dialog"] {
  border-radius: 16px;
  background: var(--sn-panel);
}
`
