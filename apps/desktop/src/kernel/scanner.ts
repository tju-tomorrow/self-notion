/**
 * 插件扫描器 —— **目录即插件**，没有任何集中的注册表文件（D-0031）。
 * 加一个功能 = 加一个 `plugins/<name>/index.ts`。
 */
import type { Context, Fiber, Plugin } from 'cordis'
import { load, settled } from './registry'

// 编译期展开成 import()，自带代码分割。
// 相对路径而不是别名：插件目录在 `apps/desktop/plugins/`（D-0048 从仓库根搬进来了），
// 就在 Vite root 底下，不需要 alias 也不需要 `server.fs.allow`。
// ★ 换基座（D-0129）：旧编辑器插件留着当参考，但**不再装载** —— 两个插件都 provide('editor')
//   会撞。负模式把它挡在外面，目录原地不动（P1 用完 caret / find-panel 那几个再删）。
const modules = import.meta.glob([
  '../../plugins/*/index.ts',
  '!../../plugins/editor-blocksuite/index.ts',
])

/** 发现并装载 `plugins/` 下的全部插件，然后做一次 settled 扫描。id = 目录名。 */
export async function boot(ctx: Context): Promise<Map<string, Fiber>> {
  const loaded = new Map<string, Fiber>()

  await Promise.all(
    Object.entries(modules).map(async ([path, importModule]) => {
      const parts = path.split('/')
      const id = parts[parts.length - 2] ?? path
      // ★ 先 await import() 再把模块交进去。`ctx.plugin(() => import(...))` 是个陷阱：
      //   不抛错，但异步变 FAILED（D-0045）。
      loaded.set(id, load(ctx, (await importModule()) as Plugin))
    }),
  )

  await settled(ctx)
  return loaded
}
