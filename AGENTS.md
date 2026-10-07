# AGENTS.md

改动这个仓库的硬规则。跟 `CLAUDE.md` 冲突时以本文件为准。

## 1. 注释要少

只写一句话说**为什么**，不写"怎么做"、不写教程、不逐行解释。多数函数不需要注释。

- ✗ 一大段设计说明、决策复述、历史沿革
- ✓ `// 红绿灯的位置，什么都别放` / `// 拿不到就降级`
- 决策理由写进 `docs/decision-log.md`，代码里最多留一句并指向它。

## 2. 不写 `*.test.ts`

删掉，也不要新建。**用打印来验证。**

- 要确认某段逻辑对不对 → 在入口打一行 `console.log` / `eprintln!`，跑一次，看输出。
- 不要引 vitest / 测试框架；`pnpm verify` 里没有测试这一步。
- Rust 侧同理：不写 `#[cfg(test)]`，用 `eprintln!`。

## 3. 出错只有一个地方可看

**所有**能拦住你跑起来的错误都必须落进同一个文件：

```
<app data>/errors.log          # 绝对路径在启动时打到终端：[self-notion] 错误日志：…
```

- Rust：`log::record("模块", &err)`。panic 也自动进去。
- 前端：`installErrorSink()` 已接管 `window.onerror` / `unhandledrejection`；
  自己catch到的错误调 `reportError('模块', err)`。
- 前端界面右上角会浮出最后几条，不用开 DevTools。
- 一行看全部：`pnpm logs`

**不要**往 `console.log` 里丢错误、也不要只 `alert`。
