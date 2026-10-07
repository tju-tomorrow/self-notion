#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // MCP 入口（D-0084）：客户端 spawn 的就是这个进程，它**不建 Tauri app、不进单实例插件**
    // —— 那两个都要窗口，而这里只要库。命中就直接进 `serve()` 并 return。
    if std::env::args().skip(1).any(|a| a == "--mcp") {
        self_notion_lib::mcp::serve();
        return;
    }
    self_notion_lib::run()
}
