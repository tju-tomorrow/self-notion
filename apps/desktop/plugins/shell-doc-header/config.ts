/**
 * 字体目录。**key 与字体栈只有这一份** —— 设置页（全局 / 文章默认 / 代码）、页面 ⋯ 菜单
 * （单篇覆盖）、往 `<html>` 上注入变量的 `fonts.ts`，三处都读它。
 *
 * ── 三个层级（后者盖前者）────────────────────────────────────────────────────
 *   全局字体     `ui.font`          界面 + 正文的底（`--affine-font-family`）
 *   文章默认字体 `editor.font`     编辑器正文与标题；没设就跟着全局
 *   单篇覆盖     `doc.font.<id>`    这一篇自己；没设就跟着文章默认
 * 值存 `ctx.settings`（Rust 的 meta 表），所以单篇覆盖也跟着库走，换台机器打开还在。
 * 落地上只有 `<html>` 上的 `font-family` 与四个变量（见 `fonts.ts`），那头级联在 `editor.css.ts`。
 *
 * ── 字体包在哪 ──────────────────────────────────────────────────────────────
 * `public/fonts/`（`scripts/fonts.mjs` 抓来的，@font-face 在 `public/fonts/fonts.css`）。
 * 带 `note` 的那几个是自带包，其余是系统字体 —— 名字写错不会报错，只会静默回退，
 * 所以只列这台机器上确实有的。
 */
export const UI_FONT_KEY = 'ui.font'/** 沿用旧 key：上一版存的 `default` / `serif` / `mono` 还在各家机器上，映射见 `LEGACY`。 */
export const DOC_FONT_KEY = 'editor.font'
export const CODE_FONT_KEY = 'editor.codeFont'
export const docFontKey = (id: string) => `doc.font.${id}`

/**
 * 正文字号缩放（D-0070）：`Cmd/Ctrl + =` / `-` / `0` 改的就是它，存 `ctx.settings`。
 * 值是一个倍数（字符串，settings 只收字符串），写在 <html> 的 `--sn-font-scale` 上，
 * 由 `editor.css.ts` 的 `--affine-font-base: calc(16px * var(--sn-font-scale, 1))` 读走。
 *
 * 不直接存 px：主题里段落/列表/标题都是「在 base 上加多少」的算法，存倍率才能一起缩。
 */
export const FONT_SCALE_KEY = 'ui.fontScale'

/**
 * 页面级的两个开关（D-0076），照抄 Notion ⋯ 菜单里那两行。都是**单篇**的，
 * 和单篇字体住一个抽屉（⋯ 菜单），落地同样在 `fonts.ts` 的两个 `<html>` 变量上。
 *
 *   `doc.small.<id>`  小字号 —— 这一篇整体再缩一档（和全局字号**叠乘**）
 *   `doc.wide.<id>`   全宽   —— 版心从 720 铺满
 *
 * 存布尔：`ctx.settings` 走 JSON（`plugin-settings` 的 `encode/decode`），布尔原样来回。
 */
export const docSmallKey = (id: string) => `doc.small.${id}`
export const docWideKey = (id: string) => `doc.wide.${id}`

/** 小字号缩多少。Notion 那档是正文 16 → 14（0.875），照抄。 */
export const SMALL_TEXT_RATIO = 0.875

/** 版心宽度。默认 720；`editor.ts` 里那个 `var()` 的兜底必须和这里一致。 */
export const EDITOR_WIDTH_DEFAULT = '720px'
export const EDITOR_WIDTH_WIDE = '100%'

/** 每一步 ×1.1 / ÷1.1，夹在 0.8～2 之间（再小没法看，再大一行放不下几个字）。 */
export const FONT_SCALES: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2]
export const FONT_SCALE_DEFAULT = 1

export type FontGroup = 'zh' | 'en' | 'code'

export interface FontEntry {
  id: string
  /** 显示名。字体名不翻译：中文名给中文体，拉丁名给拉丁体，混着看反而好认。 */
  name: string
  /** 右边那行小字：原名 / 出处。 */
  note: string
  stack: string
  group: FontGroup
}

/** 兜底的那个。取不到 key（旧值、手改过的库）一律退回它，别把 `var()` 写空。 */
export const DEFAULT_FONT = 'default'
export const DEFAULT_CODE_FONT = 'code-plex'

// ★ 用 **PingFang SC** 而不是 'Heiti SC'：中文的粗体在这两个字体上差得很远 ——
//   Heiti SC 只有一个 Medium（比正文重一点点，「加粗不明显」就是这么来的），
//   PingFang SC 自带 Regular / Medium / **Semibold / Bold** 四个字面，加粗一眼看得出来。
//   它也是 macOS 现在的系统中文默认字体。
const SYSTEM_CJK = "'PingFang SC','Hiragino Sans GB',system-ui,sans-serif"
// 代码栈的尾巴：中文还是要能显示，但拉丁部分不许掉到比例字体上
const CODE_CJK = "'PingFang SC','Hiragino Sans GB',ui-monospace,monospace"

export const FONTS: readonly FontEntry[] = [
  // ── 英文（含兜底那一条）──
  { id: DEFAULT_FONT, name: '默认', note: 'Inter · 系统字体', group: 'en', stack: `'Inter',${SYSTEM_CJK}` },
  { id: 'en-lora', name: 'Lora', note: '衬线 · 自带', group: 'en', stack: "'Lora',Georgia,'Songti SC',serif" },
  {
    id: 'en-source-serif',
    name: 'Source Serif',
    note: '衬线 · 主题自带',
    group: 'en',
    stack: "'Source Serif 4',Georgia,'Noto Serif SC',serif",
  },
  { id: 'en-hand', name: 'Kalam', note: '手写 · 主题自带', group: 'en', stack: "'Kalam','Bradley Hand',cursive" },

  // ── 中文 ──
  { id: 'zh-wenkai', name: '霞鹜文楷', note: 'LXGW WenKai · 自带', group: 'zh', stack: `'LXGW WenKai',${SYSTEM_CJK}` },
  { id: 'zh-happy', name: '站酷快乐体', note: 'ZCOOL KuaiLe · 自带', group: 'zh', stack: `'ZCOOL KuaiLe',${SYSTEM_CJK}` },
  {
    id: 'zh-serif',
    name: '思源宋体',
    note: 'Noto Serif SC · 自带',
    group: 'zh',
    stack: "'Noto Serif SC','Songti SC','STSong',serif",
  },
  { id: 'zh-song', name: '宋体', note: 'Songti SC · 系统', group: 'zh', stack: "'Songti SC','STSong',serif" },
  { id: 'zh-hei', name: '黑体', note: 'Heiti SC · 系统', group: 'zh', stack: `'Heiti SC',${SYSTEM_CJK}` },

  // ── 代码 ──
  { id: 'code-jetbrains', name: 'JetBrains Mono', note: '自带', group: 'code', stack: `'JetBrains Mono',${CODE_CJK}` },
  { id: 'code-fira', name: 'Fira Code', note: '连字 · 自带', group: 'code', stack: `'Fira Code','JetBrains Mono',${CODE_CJK}` },
  {
    id: 'code-nerd',
    name: 'Nerd Font',
    note: '本机装的 · 图标字形',
    group: 'code',
    stack: `'JetBrainsMono Nerd Font','FiraCode Nerd Font','JetBrains Mono',${CODE_CJK}`,
  },
  { id: DEFAULT_CODE_FONT, name: 'IBM Plex Mono', note: '主题自带', group: 'code', stack: `'IBM Plex Mono',${CODE_CJK}` },
  { id: 'code-source', name: 'Source Code Pro', note: '主题自带', group: 'code', stack: `'Source Code Pro',${CODE_CJK}` },
  { id: 'code-space', name: 'Space Mono', note: '主题自带', group: 'code', stack: `'Space Mono',${CODE_CJK}` },
]

export const GROUPS: readonly FontGroup[] = ['zh', 'en', 'code']

/** 每组预览那行字 —— 中文看笔形，英文看连字，代码看对齐。 */
export const PREVIEW: Readonly<Record<FontGroup, string>> = {
  zh: '永远相信美好的事情即将发生',
  en: 'The quick brown fox jumps over the lazy dog',
  code: 'const answer = 42 // 注释 => a !== b',
}

/** 上一版的三个 id。用户库里存着，映射到现在的目录上，升级不丢选择。 */
const LEGACY: Readonly<Record<string, string>> = {
  default: DEFAULT_FONT,
  serif: 'en-source-serif',
  mono: 'code-source',
}

const BY_ID = new Map(FONTS.map((f) => [f.id, f]))

/** 取不到的 id（旧值、手改过的库、存成 null 的「跟随」）一律退回默认，
 *  别把 `var()` 写空 —— 写空是静默回退，看着像没生效。 */
export function entryOf(id: string | null | undefined): FontEntry {
  const hit = typeof id === 'string' ? (BY_ID.get(id) ?? BY_ID.get(LEGACY[id] ?? '')) : undefined
  return hit ?? BY_ID.get(DEFAULT_FONT)!
}

export function familyOf(id: string | null | undefined): string {
  return entryOf(id).stack
}

export function codeFamilyOf(id: string | null | undefined): string {
  const entry = entryOf(id)
  return entry.group === 'code' ? entry.stack : entryOf(DEFAULT_CODE_FONT).stack
}

export function groupOf(group: FontGroup): FontEntry[] {
  return FONTS.filter((f) => f.group === group)
}
