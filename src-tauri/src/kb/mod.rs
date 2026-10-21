//! 知识库（D-0181…D-0189）：策展人 + 图谱 + 语义层。
//!
//! ★ **检索层不在这个模块里**。grep / FTS5 / 虚拟目录一个字都不改 —— 这儿只做
//!   「给已有检索多几个目录、多几条工具」（D-0188）。
//!
//! 分工：`curator` 后台整理 + 建议 · `graph` 实体与派生边 · `embed` 向量（BYO endpoint）
//! · `tools` 工具目录 + 分派（MCP 与内置 agent **共用这一份**）。
//! 表读写全在 `store::kb`。设计见 `docs/kb.md`。



pub mod curator;
pub mod embed;
pub mod graph;
pub mod tools;
