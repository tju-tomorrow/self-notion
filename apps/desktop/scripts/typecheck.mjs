/**
 * tsc 会把 BlockSuite 的 `.ts` 源码一起检查（它发布的就是源码，D-0046），
 * 它自己的几百条报错不是我们的、也拦不住运行 —— Vite 只转译、不做类型检查。
 * 所以只看非 node_modules 的报错，**我们的代码有任何一条就失败**。
 */
import { spawnSync } from 'node:child_process'

const tsc = spawnSync('node_modules/.bin/tsc', ['--noEmit'], { encoding: 'utf8' })
const out = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`

if (tsc.error) {
  console.error(`tsc 起不来：${tsc.error.message}`)
  process.exit(1)
}

const ours = out.split('\n').filter((l) => l.includes('error TS') && !l.includes('node_modules'))
if (ours.length) {
  console.error(ours.join('\n'))
  process.exit(1)
}
console.log('tsc: 我们的代码 0 条类型错误')
