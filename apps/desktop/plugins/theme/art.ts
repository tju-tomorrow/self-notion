/**
 * 主题的背景图。**一处，不是多处贴图**（用户 2026-10-08：
 * 「直接不要多处贴图 就要一个背景 就像 vscode 有一个 background 扩展一样」）。
 *
 * 三条规矩（都是这几轮反馈换来的）：
 *   1. **铺满**（`cover`）→ 没有边 → 不需要羽化。用户那句「不能虚化掉他的图片痕迹」就是
 *      冲羽化来的：羽化是我给"局部贴图"打的补丁，铺满之后补丁可以扔了。
 *   2. **只在字后面**（`background-image`）→ 结构上不可能遮住字（D-0157）。
 *   3. **浓度可调**：CSS 的背景图没有自己的 `opacity`，所以在它上面压一层**画布色的半透明**，
 *      浓度就是「图透出多少」。跟 VS Code 那个扩展的 `opacity` 是同一件事，只是从另一头拧
 *      （它默认 0.1，也就是很淡的一层底）。
 */
import type { BgPos, BgSize, Seeds, Theme } from './types'

const uri = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
const blend = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`

/**
 * 默认背景：一幅夜空（远处一团光晕 + 星 + 月）。
 *
 * ★ **一幅画，不是几个贴图**：所以它内部怎么摆都是"背景的一部分"，
 *   用户换成自己的图时整幅替换 —— 没有"那几个装饰要不要跟着换"这种问题。
 * ★ 猫删了（用户 2026-10-08：「那个猫的 svg 给我删掉」）—— 背景是背景，不放具体角色。
 * ★ 星星用**固定种子**的伪随机撒，所以每次生成一模一样（不然每次装载都换一片天）。
 */
function scene(s: Seeds): string {
  const glow = blend(s.accent, 30, s.surface)
  const star = blend(s.text, 88, s.accent)
  const moon = blend(s.accent, 46, s.text)

  let seed = 20261008
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const stars = Array.from({ length: 44 }, () => {
    const x = (rnd() * 1600).toFixed(0)
    const y = (rnd() * 640).toFixed(0)
    const r = (1 + rnd() * 2.3).toFixed(1)
    const o = (0.2 + rnd() * 0.5).toFixed(2)
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${star}" opacity="${o}"/>`
  }).join('')

  return uri(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs><radialGradient id="glow" cx="76%" cy="18%" r="54%">
<stop offset="0" stop-color="${glow}" stop-opacity=".5"/>
<stop offset="1" stop-color="${glow}" stop-opacity="0"/>
</radialGradient></defs>
<rect width="1600" height="1000" fill="url(#glow)"/>
${stars}
<g opacity=".5">
<path d="M1294 152 A 96 96 0 1 0 1294 352 A 74 74 0 1 1 1294 152 Z" fill="${moon}"/>
</g>
</svg>`)
}

/** 浓度范围：0 = 看不见背景，100 = 图原样。默认 20（跟 VS Code 那个扩展的淡底一个量级）。 */
export const BG_STRENGTH_DEFAULT = 20
export const BG_STRENGTH_MIN = 0
export const BG_STRENGTH_MAX = 100

const clamp = (n: number) => Math.min(BG_STRENGTH_MAX, Math.max(BG_STRENGTH_MIN, n))

/**
 * 附在 `<html>` 上的那张表。**跟主题无关**（图、浓度都是数据），所以换主题不用重写它。
 *
 * ★ 一条 `background-color` + 一条"两层背景"（压暗层 + 图），两处（页面容器 / 正文纸面）。
 *   浮层、`z-index`、`pointer-events`、羽化 —— 一个都没有了。
 * ★ 页面容器那条是 `:only-child`：文档视图里 `main > div > div:first-child` 是 **44px 高的页头**，
 *   插图写上去会被裁在那一条里（D-0160 踩过）。
 */
export const DECOR_CSS = `
/* 画布底色：四个页面把暗色底写成了字面量 #1c1c1c，变量到不了（docs/theme.md §3.1）。
   特异性本来够（html[data-sn-theme] main>div>div:first-child = 0,2,3 压过 [data-theme=dark] .hash = 0,2,0），
   加 !important 是防这个链条以后变长 —— 失配的样子是「整页还是黑的」，太难发现。
   ★ 走长写 background-color：背景图在另一条规则里，简写会把 background-image 一起重置掉。 */
html[data-sn-theme] main > div > div:first-child { background-color: var(--sn-canvas) !important }

/* 一处背景，铺满、居中。第一层是「画布色的半透明」= 浓度（--sn-bg-dim），压在图上。
   ★ 只写这几条长写：.sn-pane-body 原来的底色简写是 appearance 的纸面（磨砂滑块靠它），别动它。 */
html[data-sn-theme] main > div > div:only-child,
html[data-sn-theme] .sn-pane-body {
  background-image:
    linear-gradient(color-mix(in srgb, var(--sn-canvas) calc(var(--sn-bg-dim, 80) * 1%), transparent),
                    color-mix(in srgb, var(--sn-canvas) calc(var(--sn-bg-dim, 80) * 1%), transparent)),
    var(--sn-art-bg);
  background-size: auto, var(--sn-bg-size, cover);
  background-position: center, var(--sn-bg-pos, 50% 0%);
  background-repeat: no-repeat;
}

/* 侧栏的透度**跟正文纸面那根滑块同一个来源**（--sn-paper-alpha，appearance 写的）——
   两块玻璃各拧各的，看起来就是「没同步」（用户 2026-10-08）。取不到时用 88%，
   跟 paper.ts 的 PAPER_ALPHA_DEFAULT 一档，所以默认长相不变。 */
html[data-sn-theme] aside {
  background: color-mix(in srgb, var(--sn-sidebar) calc(var(--sn-paper-alpha, 88) * 1%), transparent)
}
`

/** 尺寸选项 → CSS `background-size`。`stretch` 会拉伸（给"就是想要它铺满"的人留一条）。 */
const SIZE_CSS: Readonly<Record<BgSize, string>> = {
  cover: 'cover',
  contain: 'contain',
  original: 'auto',
  stretch: '100% 100%',
}

/** 位置默认**顶部居中**：竖构图的角色图，脸在顶上（用户 2026-10-08：「看不到脸了」）。 */
export const BG_POS_DEFAULT: BgPos = { x: 50, y: 0 }

/**
 * 背景变量。
 *
 * `--sn-bg-dim` 是**压暗**（0..100，越大图越淡），用户看到的「浓度」是它的反面 ——
 * 存的是浓度，算出来给 CSS 的是压暗，只在这里换一次头。
 */
export function artVars(
  seeds: Seeds,
  theme: Pick<Theme, 'background' | 'bgStrength' | 'bgSize' | 'bgPos'>,
): Record<string, string> {
  const pct = clamp(theme.bgStrength ?? BG_STRENGTH_DEFAULT)
  const pos = theme.bgPos ?? BG_POS_DEFAULT
  return {
    '--sn-art-bg': theme.background ?? scene(seeds),
    '--sn-bg-dim': String(100 - pct),
    '--sn-bg-size': SIZE_CSS[theme.bgSize ?? 'cover'],
    '--sn-bg-pos': `${pos.x}% ${pos.y}%`,
  }
}
