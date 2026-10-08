/**
 * mermaid 的渲染壳 —— 只给 `code-block.ts` 的 mermaid 分支用，别的块跟它无关。
 *
 * 三条纪律：
 *   1. `import()` 懒加载。mermaid 压缩后 500KB+，文档里没有 mermaid 块就一个字节都不许拉。
 *   2. **只吐 SVG 字符串，不碰任何 DOM**。写不写、写到哪儿由调用方定 —— 这样「旧渲染盖掉新渲染」
 *      的竞态，调用方一个 token 就掐死了（见 `code-block.ts` 的 `draw`）。
 *   3. 明暗读 `<html data-theme>`：那个属性是 `src/theme/tokens.ts` 写的，跟着它就有两档配色。
 */
type Mermaid = typeof import('mermaid')['default']

let scheme: 'light' | 'dark' = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
const watchers = new Set<() => void>()

/** `index.ts` 订着 `ctx.theme.onChange` 推过来；没推也有兜底（上面的初值）。 */
export function setScheme(next: 'light' | 'dark'): void {
  if (next === scheme) return
  scheme = next
  for (const cb of watchers) cb()
}

export function onSchemeChange(cb: () => void): () => void {
  watchers.add(cb)
  return () => watchers.delete(cb)
}

let engine: Promise<Mermaid> | null = null

function load(): Promise<Mermaid> {
  engine ??= import('mermaid').then((m) => m.default)
  return engine
}

let seq = 0

/**
 * 渲染一段 mermaid 源码。语法错就 reject（调用方决定怎么显示），顺带把 mermaid 留下的临时节点收干净。
 *
 * ★ 语法错**在这里不报全局**：打字打到一半（`fla`）本来就不是图，是常态、不是异常 ——
 *   往 `errors.log` 和右上角红条上送，等于把正在写的那半句话变成一场事故。
 *   调用方在那张图的位置就地显示（`code-block.ts` 的 `figure`），错照旧 reject 出去（用户 2026-10-09）。
 */
export async function renderSvg(text: string): Promise<string> {
  const mermaid = await load()
  // theme 每次重设：`initialize` 是全局的，切了明暗不重设就还是上一档的配色。
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: scheme === 'dark' ? 'dark' : 'default',
    fontFamily: 'inherit',
    themeVariables: { background: 'transparent' },
  })

  const id = `sn-mermaid-${++seq}`
  try {
    const { svg } = await mermaid.render(id, text)
    return svg
  } finally {
    // mermaid 渲染失败会往 body 里留一个同 id 的探针节点，不清会越攒越多（成功那条路它是自己收的）。
    document.getElementById(id)?.remove()
  }
}
