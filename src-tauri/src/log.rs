//! 所有错误只有一个出口：`<app data>/errors.log`，同时打到 stderr。
//!
//! 前端也往这儿写（`log:error` 命令），所以 Rust 崩 / JS 崩 / 插件崩都在同一个文件里。

use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

static LOG: OnceLock<PathBuf> = OnceLock::new();

/// `setup` 里调一次。返回日志的绝对路径，启动时打到终端让人知道去哪看。
pub fn init(app: &tauri::AppHandle) -> PathBuf {
    let path = app
        .path()
        .app_data_dir()
        .map(|d| d.join("errors.log"))
        .unwrap_or_else(|_| PathBuf::from("errors.log"));
    let _ = LOG.set(path.clone());
    eprintln!("[self-notion] 错误日志：{}", path.display());
    path
}

/// 记一条。**任何**让功能不工作的错误都该从这儿过。
pub fn record(source: &str, message: &str) {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let line = format!("[{secs}] {source}: {message}\n");
    eprint!("{line}");
    // 没 `init` 过（MCP 那个进程没有 AppHandle，D-0084）就自己算一份 —— 落在**库里那份的兄弟文件**，
    // 于是 `SELF_NOTION_DB` 指到测试库时日志也跟着走，不会把测试的错写进真 app 的 errors.log。
    let path = LOG
        .get()
        .cloned()
        .unwrap_or_else(|| crate::store::default_db_path().with_file_name("errors.log"));
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// panic 也进同一个文件 —— 它是"跑不起来"里最常见的一种。
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let where_ = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let what = info.payload().downcast_ref::<&str>().map(|s| s.to_string()).unwrap_or_else(|| {
            info.payload().downcast_ref::<String>().cloned().unwrap_or_else(|| "?".into())
        });
        record("panic", &format!("{what} @ {where_}"));
    }));
}
