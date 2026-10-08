import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin'

// 抄 blocksuite/playground/vite.config.ts 的形状（侦察一）：只留 vanilla-extract + wasm。
// 不要 define / istanbul / hmr-plugin / clearSiteData —— 那些是 playground 自己的调试装置。
//
// ★ 插件目录原来在仓库根，所以要 `@plugins` 别名 + `server.fs.allow` 两处特判。
//   D-0048 把它搬进 `apps/desktop/plugins/` 之后，两处都删了 —— 它们本来就是在补
//   「代码在 Vite root 外面」这个洞，洞没了补丁就该走。
export default defineConfig({
  plugins: [react(), vanillaExtractPlugin()],
  // ★ BlockSuite 发到 npm 的是**源码**（D-0046），里面用了 `override accessor x = true`
  //   （ES2022 的 auto-accessor）。Vite 的 esbuild 默认 `target: 'esnext'` —— 原样放行，
  //   而 Rollup 的解析器不认 `accessor`，`vite build` 直接 parse 失败。
  //   es2022 就够了：esbuild 在 es2022 下照样把它降级成私有字段 + getter/setter（语义等价），
  //   而 `accessor` 之外还留着 top-level await。
  //   ★ 不能再往低压（es2021）—— 那会把 `shell/__probe.tsx` 这类顶层 await 判死：
  //   "Top-level await is not available in the configured target environment"。
  esbuild: { target: 'es2022' },
  // ★ BlockSuite 是**源码包**：`.css.ts` 必须过 vanilla-extract 的 transform。
  //   默认 Vite 会把 `@blocksuite/affine/*` 当依赖丢进 esbuild 预打包 —— 那条路
  //   不走任何 Vite 插件，于是 `style()` 抛 "Styles were unable to be assigned to a file"。
  //   排除掉，让它们走正常源码管线（代价是 dev 首次加载慢，几千个模块）。
  optimizeDeps: {
    exclude: ['@blocksuite/affine'],
    // 排除之后 Vite 不再爬它们的依赖树，于是 CJS 的**传递依赖**没人做 CJS→ESM interop ——
    // 浏览器里报 `does not provide an export named 'default'`。
    // `父 > 子` 是 Vite 的写法：从父包的上下文解析子依赖，所以不必把它们装到 apps/desktop。
    include: [
      '@blocksuite/affine > lodash.ismatch',
      '@blocksuite/affine > bind-event-listener',
      '@blocksuite/affine > bytes',
      '@blocksuite/affine > lz-string',
      '@blocksuite/affine > @emoji-mart/data',
      '@blocksuite/affine > pako',
      '@blocksuite/affine > extend',
      '@blocksuite/affine > escape-string-regexp',
      '@blocksuite/affine > deepmerge',
      '@blocksuite/affine > source-map-js',
      '@blocksuite/affine > js-tokens',
      '@blocksuite/affine > debug',
      '@blocksuite/affine > ms',
    ],
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
})
