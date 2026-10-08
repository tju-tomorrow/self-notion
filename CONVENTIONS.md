# 规范

> Phase 0 的冻结产物。**并行施工时这份文件是法律** —— 每个 subagent 的 prompt 里都带上它。
> 架构依据：`docs/architecture.md`。施工流程：`docs/execution-plan.md`。

---

## 一、命名与提交

| 项 | 规定 |
| --- | --- |
| 前端文件 | kebab-case（`doc-tree.tsx`、`use-tabs.ts`）|
| Rust command | 一律 `ns:method` 命名空间形式（`doc:apply`、`backup:now`）|
| 插件目录 | `plugins/<name>/`，`<name>` 用 kebab-case，npm 包名 `self-notion-plugin-<name>` |
| 提交 | `<type>(<scope>): <subject>` + **必填 body 说明为什么**，**无 trailer**（见全局规范）|

## 二、语言

- TypeScript **`strict`**，**禁止 `any`**（要逃生就 `unknown` + 类型守卫）
- Rust 2021，`cargo clippy -D warnings`
- 包管理 **pnpm**（workspace 协议要兼容 blocksuite 的 `workspace:*`）

## 三、渲染

- React 19，**只用核心 API** —— 不碰实验特性。理由：最后一天可能要 alias 换 Preact（D-0037）
- 组件：函数组件 + `*.css.ts`（vanilla-extract），主题 token 从 `ctx.theme` 拿，**不直接 import CSS 变量**
- 状态：**不引第三方状态库**。Rust 是唯一真相源，前端是薄缓存，用 `useSyncExternalStore`；跨窗口靠 Tauri 事件
- 命名冲突：编辑器（Lit）那一块的边界**只跨一次**，`useEffect` 里挂上 Lit 元素即可，**不要引桥接库**

## 四、数据流

- 编辑时前端持有活的 `Y.Doc`；debounce **300ms** + 窗口失焦 + **每 30s 心跳** → `doc:apply` 回 Rust
- **Y.Doc 全保活**；**编辑器视图只保活最近 3 个**（D-0039）
- 侧栏预览 / 搜索预览 / 阅读模式走 **只读渲染器**，**不许挂编辑器**（D-0035）
- SQLite 开 **WAL**；`meta.schema_version` + migration 函数表

## 五、契约

- 前后端类型的**唯一来源是 `apps/desktop/src/kernel/contract.ts`**（TS 定，Rust 对上）。
  命令是**一个通用入口** `api({ method, args })`，`method` 是运行时字符串 —— **跨线没有编译期检查**，
  漂移由 `cargo test` 守（D-0049 推翻了原 tauri-specta 方案）。
- Rust command 一律 `Result<T, ApiError>`，`ApiError = { code, message }`
- 编辑器—存储契约 `ctx.docs` **只有三个方法**：`load` / `save` / `delete`。**加第四个之前先问一句为什么**（D-0035）

## 六、插件（最重要的一节）

每个插件必须遵守：

1. **只写自己目录里的文件。** 要碰别人的 → 停下来报告
2. **只通过 `ctx` 拿能力**，不许 import 别的插件的内部文件
   → 标准：**卸掉任何一个插件，应用照常跑**
3. **逆函数是显式纪律**：每加一个 `ctx.xxx.register()`，**必须同时写出它的 `unregister()`**（D-0033）
4. **依赖走 `inject` 声明**，不许手动探测
5. **第三方插件必须是单文件 ESM，禁止任何形式的 import**（相对 / bare / 绝对 https 全都必死）—— 它跑在 **module Worker** 里，**没有 DOM、摸不到 `window.__TAURI_INTERNALS__`**，特权调用只能 postMessage 给宿主代理（D-0044）
6. **每个 UI 槽包一层 ErrorBoundary** —— 插件抛错只降级那个槽 + 一条通知
7. **不许新增第三方依赖**，需要就报告
8. **验收自带两条**：装载能用 + **卸载后应用不崩**

**Cordis 的两条硬纪律**（D-0045，都是从 rc.10 实测出来的破口）：

9. **不许在 disposer 里注册新的 effect 或挂新插件** —— UNLOADING 期间注册的 effect 会被**永久泄漏**（已复现）
10. **不许往 PENDING fiber 上挂东西** —— 挂在 PENDING fiber 上的 disposable **永不回收**（已复现）

> 另外两条配套：**有顺序依赖的清理必须塞进同一个 `ctx.effect()` 里 yield**（顶层 async disposer 是**并发**的）；**内核必须做一次 `settled` 全 ACTIVE 扫描**，因为 `inject` 等待**没有超时**，依赖永不出现会**静默 PENDING、永不报错**。
> 还有：**`ctx.dispose()` 不存在** —— 卸载只走 `fiber.dispose()`（幂等）。**`ctx.plugin(() => import(...))` 是陷阱** —— 不抛错但异步变 `FAILED`。

## 七、验收命令

```sh
pnpm verify     # tsc --noEmit && oxlint && vitest run && cargo clippy
```

外加两条**只在合并到主干前跑**的：

- **路径无关性测试**：随机装卸插件 N 次，最终状态快照**逐字节一致**（D-0033）
- **拔插件测试**：逐个卸掉插件，应用每次都能起来

## 八、测试

- 前端 vitest，Rust `cargo test`
- **不追求覆盖率**。只给"非平凡逻辑"留一个能跑的检查：分支、循环、解析、钱/安全路径
- 简单到一眼看穿的，不写测试

## 九、注释

- 解释**为什么**，不解释**是什么**
- 刻意的简化标 `ponytail:`，并写清**天花板和升级路径**
  例：`// ponytail: 全量重建索引，几千篇以上再换增量`

## 十、明文禁止

- ❌ 为"以后可能要"而写的抽象：只有一个实现的接口、只有一个产品的工厂、永不改变的配置项
- ❌ `= undefined` 的桩（必须是可调用的空实现 `function X() {}`；CSS 模块例外）
- ❌ 在别人的插件目录里动东西
- ❌ 改 `ctx` 上已冻结的服务签名（要改 → 停下来报告，回 Phase 0）
- ❌ 手写前后端重复类型
