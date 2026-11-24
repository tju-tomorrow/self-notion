/**
 * Claude 网页那套：奶油底、选中是一粒暖灰胶囊、主按钮近黑、大标题用 Anthropic Serif。
 * 只在 `data-sn-theme="claude"` 上生效。
 */
import type { Seeds } from './types'

const on = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

const SANS = '"Anthropic Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif'
const SERIF = '"Anthropic Serif","Songti SC","Noto Serif SC",Georgia,serif'
const MONO = '"Anthropic Mono",ui-monospace,"SFMono-Regular",Menlo,monospace'

const INK = '#1c1b19'
const CREAM = '#faf9f5'
const SAGE = '#e8e6dc'
const WASH = '#f3f1ea'

export function claudeVars(seeds: Seeds): Record<string, string> {
  const { text, canvas } = seeds
  return {
    '--affine-font-family': SANS,
    '--sn-font-doc': SANS,
    '--sn-font-over': SANS,
    '--affine-font-code-family': MONO,
    '--affine-font-mono-family': MONO,

    '--affine-v2-text-secondary': '#5e5d59',
    '--affine-text-secondary-color': '#5e5d59',
    '--affine-v2-text-tertiary': '#8a887f',
    '--affine-v2-text-placeholder': '#8a887f',
    '--affine-v2-icon-primary': '#3f3e3a',
    '--affine-v2-icon-secondary': '#6f6d66',
    '--affine-v2-icon-tertiary': '#9a978e',
    '--affine-icon-color': '#3f3e3a',

    '--affine-v2-layer-background-hoverOverlay': WASH,
    '--affine-v2-layer-background-hover': SAGE,
    '--affine-hover-color': WASH,
    '--affine-primary-color-04': WASH,
    '--affine-link-color': '#3266ad',

    '--affine-v2-button-primary': INK,
    '--affine-v2-button-secondary': WASH,
    '--affine-v2-button-iconButtonSolid': 'transparent',
    '--affine-v2-button-emptyIconBackground': WASH,
    '--affine-v2-button-buttonOverHover': SAGE,
    '--affine-v2-button-pureWhiteText': CREAM,

    '--affine-v2-layer-background-codeBlock': '#f4f3ee',
    '--affine-v2-tab-tabBackground-default': 'transparent',
    '--affine-v2-tab-tabBackground-active': '#ffffff',
    '--affine-v2-tab-iconColor-default': '#6f6d66',
    '--affine-v2-tab-fontColor-default': '#5e5d59',

    '--affine-shadow-2': `0 1px 2px ${on(INK, 5)}, 0 8px 24px ${on(INK, 6)}`,
    '--affine-shadow-3': `0 12px 32px ${on(INK, 10)}`,
    '--affine-menu-shadow': `0 8px 28px ${on(INK, 10)}, 0 0 0 1px ${on(INK, 6)}`,
    '--affine-popover-shadow': `0 8px 28px ${on(INK, 10)}`,
    '--affine-overlay-shadow': `0 8px 24px ${on(INK, 8)}`,

    '--sn-text': text,
    '--sn-muted': '#5e5d59',
    '--sn-line': '#e6e4dc',
    '--sn-hover': WASH,
    '--sn-nav-on': text,
    '--sn-nav-on-bg': SAGE,
    '--sn-nav-on-bar': '0px',
    '--sn-search-bg': '#ffffff',
    '--sn-search-radius': '12px',
    '--sn-search-h': '36px',
    '--sn-add-bg': 'transparent',
    '--sn-add-radius': '10px',
    '--sn-add-hover': text,
    '--sn-row-radius': '10px',
    '--sn-tab-ring': on(INK, 8),
    '--sn-canvas': canvas,
  }
}

export const CLAUDE_CSS = `
html[data-sn-theme="claude"] {
  font-family: ${SANS} !important;
  --affine-font-family: ${SANS} !important;
  --sn-font-doc: ${SANS} !important;
  --sn-font-over: ${SANS} !important;
  --affine-font-code-family: ${MONO} !important;
  --affine-font-mono-family: ${MONO} !important;
  -webkit-font-smoothing: antialiased;
  color: ${INK};
  scrollbar-color: #d4d1c7 transparent;
}

html[data-sn-theme="claude"] [data-sn-shell] {
  display: grid;
  grid-template-columns: var(--shell-sidebar-w, 260px) minmax(0, 1fr);
  grid-template-rows: 40px minmax(0, 1fr);
  background: ${CREAM};
}
html[data-sn-theme="claude"] [data-sn-shell][data-collapsed="1"] {
  grid-template-columns: 0px minmax(0, 1fr);
}
html[data-sn-theme="claude"] [data-sn-shell] > header {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  background: ${CREAM};
  border: none;
}
html[data-sn-theme="claude"] [data-sn-shell] > header > div:first-child {
  flex: 0 0 auto;
  width: auto;
  padding-left: 4px;
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
  background: ${CREAM} !important;
  border-right: none;
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
  background: ${CREAM};
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
  background: ${WASH};
  border-radius: 6px;
  color: #8a887f;
  font-family: ${SANS};
}

html[data-sn-theme="claude"] main > div > div:first-child {
  border-bottom-color: transparent;
  background-color: ${CREAM};
}
html[data-sn-theme="claude"] main > div > div:only-child,
html[data-sn-theme="claude"] .sn-pane-body {
  background-color: ${CREAM};
  background-image: none;
}

html[data-sn-theme="claude"] .sn-display {
  font-family: ${SERIF};
  font-size: 28px;
  font-weight: 460;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
html[data-sn-theme="claude"] .sn-pm-title {
  font-family: ${SERIF};
  font-size: calc(36px * var(--sn-font-scale, 1));
  font-weight: 460;
  letter-spacing: -0.025em;
  line-height: 1.2;
  color: ${INK};
}
html[data-sn-theme="claude"] .ProseMirror {
  font-family: ${SANS};
  line-height: 1.65;
  color: ${INK};
}
html[data-sn-theme="claude"] .ProseMirror :is(h1, h2, h3) {
  font-family: ${SERIF};
  font-weight: 500;
  letter-spacing: -0.02em;
  color: ${INK};
}
html[data-sn-theme="claude"] .ProseMirror a {
  color: #3266ad;
  text-underline-offset: 3px;
}
html[data-sn-theme="claude"] .sn-codeblock,
html[data-sn-theme="claude"] .sn-code {
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #e6e4dc;
}
html[data-sn-theme="claude"] ::selection {
  background: #e4dcc8;
}

html[data-sn-theme="claude"] .sn-btn {
  border-radius: 999px;
  height: 32px;
  padding: 0 14px;
  font-weight: 500;
}
html[data-sn-theme="claude"] .sn-btn-primary {
  background: ${INK};
  color: ${CREAM};
}
html[data-sn-theme="claude"] .sn-btn-primary:hover:not(:disabled) {
  filter: brightness(1.15);
}
html[data-sn-theme="claude"] input,
html[data-sn-theme="claude"] textarea,
html[data-sn-theme="claude"] select {
  border-radius: 12px;
}
html[data-sn-theme="claude"] :where(button, a, input, textarea, select):focus-visible {
  outline-color: #c4bfb0;
}
html[data-sn-theme="claude"] [role="menu"],
html[data-sn-theme="claude"] [role="dialog"] {
  border-radius: 16px;
  background: #ffffff;
}
`
