/**
 * 把选定的字体包抓进 `apps/desktop/public/fonts/`。跑一次就够，产物跟着仓库走 —— 应用不联网。
 * 想换字体：改下面那几张表，重跑，再对齐 `public/fonts/fonts.css` 里的 @font-face。
 *
 * 两种来源：
 *   · Google Fonts 的 CSS2 接口 —— 它按 unicode-range 把中文字体切成一百来片，
 *     CSS 里那一堆 gstatic 链接就是全部，逐条抓下来、改成相对路径即可（用到哪片才下哪片）。
 *   · fontsource 的 npm 包 —— 拉丁字体一个权重一个文件，直接取 latin 子集。
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts')

// Google 只给 woff2 —— 现代 UA 才拿得到 woff2 那条分支（默认 UA 给 ttf）
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res
}

/** 一批任务，最多 8 条同时在飞 —— 一次 120 个请求会被对端掐。 */
async function pool(items, worker, width = 8) {
  const queue = [...items]
  const run = async () => {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) await worker(job)
  }
  await Promise.all(Array.from({ length: width }, run))
}

/** 一个字体目录：css + files/ 下的分片。 */
async function writeFont(dir, css, urls) {
  const files = join(OUT, dir, 'files')
  await mkdir(files, { recursive: true })
  let out = css
  await pool([...new Set(urls)], async (url) => {
    const name = new URL(url).pathname.split('/').pop()
    const bytes = Buffer.from(await (await get(url)).arrayBuffer())
    await writeFile(join(files, name), bytes)
    out = out.replaceAll(url, `./files/${name}`)
  })
  await writeFile(join(OUT, dir, `${dir}.css`), out)
}

/** Google Fonts 那一份。`family` 用 API 的写法（`ZCOOL+KuaiLe`）。 */
async function googleFont(dir, family) {
  const css = await (await get(`https://fonts.googleapis.com/css2?family=${family}&display=swap`)).text()
  const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1])
  if (!urls.length) throw new Error(`${family}: CSS 里没有 woff2 链接`)
  await writeFont(dir, css.replace(/\/\*[^*]*\*\/\s*/g, ''), urls)
  console.log(`${dir}: ${urls.length} 片`)
}

/** fontsource 的拉丁子集。 */
async function latinFont(dir, pkg, version, weigths) {
  await mkdir(join(OUT, dir), { recursive: true })
  await pool(weigths, async (w) => {
    const name = `${dir}-latin-${w}-normal.woff2`
    const url = `https://cdn.jsdelivr.net/npm/${pkg}@${version}/files/${name}`
    await writeFile(join(OUT, dir, name), Buffer.from(await (await get(url)).arrayBuffer()))
  })
  console.log(`${dir}: ${weigths.length} 个权重`)
}

/** 霞鹜文楷有自己的包，CSS 就摆在包里（97 条 @font-face），照抄它的分片名。 */
async function lxgw() {
  const dir = 'lxgw-wenkai'
  const base = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0'
  const css = await (await get(`${base}/lxgwwenkai-regular.css`)).text()
  const files = [...new Set(css.matchAll(/files\/[a-z0-9.-]+\.woff2/g))].map((m) => m[0])
  await mkdir(join(OUT, dir, 'files'), { recursive: true })
  let out = css
  await pool(files, async (f) => {
    const name = f.split('/').pop()
    await writeFile(join(OUT, dir, 'files', name), Buffer.from(await (await get(`${base}/${f}`)).arrayBuffer()))
    out = out.replaceAll(`./${f}`, `./files/${name}`)
  })
  await writeFile(join(OUT, dir, `${dir}.css`), out)
  console.log(`${dir}: ${files.length} 片`)
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

// 中文：霞鹜文楷（楷体）+ 站酷快乐体（可爱展示体）+ 思源宋体（正经宋体）
await lxgw()
await googleFont('zcool-kuaile', 'ZCOOL+KuaiLe')
await googleFont('noto-serif-sc', 'Noto+Serif+SC')

// 英文：Lora（衬线）
await latinFont('lora', '@fontsource/lora', '5.2.8', [400, 500, 600, 700])

// 代码：JetBrains Mono + Fira Code
await latinFont('jetbrains-mono', '@fontsource/jetbrains-mono', '5.2.7', [400, 500, 700])
await latinFont('fira-code', '@fontsource/fira-code', '5.2.7', [400, 500, 700])
