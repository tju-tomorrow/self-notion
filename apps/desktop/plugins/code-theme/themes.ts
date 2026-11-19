/**
 * 六套代码配色。**底色也归主题**（不只换字的颜色）—— 换一套就该像换了一张纸，
 * 一眼认出来，才记得住。键名和 `editor-prosemirror/plugins/code-highlight.ts` 的 `hl-*` 对齐。
 */
export interface CodeTheme {
  id: string
  /** i18n 词条。 */
  key: string
  bg: string
  text: string
  border: string
  com: string
  kw: string
  str: string
  num: string
  fn: string
  type: string
  var: string
  tag: string
  attr: string
  op: string
  meta: string
  builtin: string
  lit: string
  add: string
  del: string
}

export const THEMES: readonly CodeTheme[] = [
  {
    id: 'vivid',
    key: 'codeTheme.vivid',
    bg: '#0b1020',
    text: '#d7e2ff',
    border: '#26314d',
    com: '#5b6b8c',
    kw: '#ff79c6',
    str: '#7ee787',
    num: '#ffd166',
    fn: '#82aaff',
    type: '#c792ea',
    var: '#a5d6ff',
    tag: '#ff9e64',
    attr: '#9cdcfe',
    op: '#89ddff',
    meta: '#ffcb6b',
    builtin: '#f78c6c',
    lit: '#ff79c6',
    add: '#7ee787',
    del: '#ff6b81',
  },
  {
    id: 'notion',
    key: 'codeTheme.notion',
    bg: '#f7f6f3',
    text: '#37352f',
    border: '#e9e7e2',
    com: '#9b9a97',
    kw: '#0550ae',
    str: '#0a7d33',
    num: '#b35900',
    fn: '#7c3aed',
    type: '#b35900',
    var: '#d6336c',
    tag: '#116329',
    attr: '#0969da',
    op: '#57606a',
    meta: '#9b9a97',
    builtin: '#7c3aed',
    lit: '#b35900',
    add: '#0a7d33',
    del: '#d1242f',
  },
  {
    id: 'monokai',
    key: 'codeTheme.monokai',
    bg: '#272822',
    text: '#f8f8f2',
    border: '#3e3d32',
    com: '#75715e',
    kw: '#f92672',
    str: '#e6db74',
    num: '#ae81ff',
    fn: '#a6e22e',
    type: '#66d9ef',
    var: '#fd971f',
    tag: '#f92672',
    attr: '#a6e22e',
    op: '#f92672',
    meta: '#75715e',
    builtin: '#66d9ef',
    lit: '#ae81ff',
    add: '#a6e22e',
    del: '#f92672',
  },
  {
    id: 'solarized',
    key: 'codeTheme.solarized',
    bg: '#002b36',
    text: '#93a1a1',
    border: '#0b4450',
    com: '#586e75',
    kw: '#859900',
    str: '#2aa198',
    num: '#d33682',
    fn: '#268bd2',
    type: '#b58900',
    var: '#b58900',
    tag: '#268bd2',
    attr: '#93a1a1',
    op: '#859900',
    meta: '#cb4b16',
    builtin: '#2aa198',
    lit: '#d33682',
    add: '#859900',
    del: '#dc322f',
  },
  {
    id: 'github',
    key: 'codeTheme.github',
    bg: '#f6f8fa',
    text: '#24292f',
    border: '#d0d7de',
    com: '#6e7781',
    kw: '#cf222e',
    str: '#0a3069',
    num: '#0550ae',
    fn: '#8250df',
    type: '#953800',
    var: '#953800',
    tag: '#116329',
    attr: '#0550ae',
    op: '#cf222e',
    meta: '#6e7781',
    builtin: '#0550ae',
    lit: '#0550ae',
    add: '#116329',
    del: '#cf222e',
  },
  {
    id: 'onedark',
    key: 'codeTheme.onedark',
    bg: '#282c34',
    text: '#abb2bf',
    border: '#3b4048',
    com: '#5c6370',
    kw: '#c678dd',
    str: '#98c379',
    num: '#d19a66',
    fn: '#61afef',
    type: '#e5c07b',
    var: '#e06c75',
    tag: '#e06c75',
    attr: '#d19a66',
    op: '#56b6c2',
    meta: '#e5c07b',
    builtin: '#56b6c2',
    lit: '#d19a66',
    add: '#98c379',
    del: '#e06c75',
  },
]

export const DEFAULT_THEME = 'vivid'

export const ACTIVE_KEY = 'codeTheme.active'

/** 键里可能存着旧值 / 垃圾，认不出就回默认。 */
export function themeId(raw: unknown): string {
  return typeof raw === 'string' && THEMES.some((t) => t.id === raw) ? raw : DEFAULT_THEME
}
