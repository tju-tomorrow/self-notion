//! 多窗口（D-0019：一窗多标签 + 侧栏；多窗口 = 再开一窗，共享同一个 Rust 进程）。
//!
//! ★ 新窗口**照抄主窗口那份配置**（`tauri.conf.json` 里 label 是 `main` 的那一条）——
//!   毛玻璃、无边框标题栏、红绿灯位置都在里面。手写第二份迟早和第一份漂开，
//!   那种「改了一处忘了另一处」的毛病正是要避免的。

use tauri::menu::{
    IsMenuItem, Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::utils::config::WebviewUrl;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, WebviewWindowBuilder};

/// 菜单里「新窗口」那一条的 id。
const NEW_WINDOW: &str = "new-window";

/// 菜单点了「新窗口」→ 发给**前台那个窗口**的前端。为什么不在这儿直接把窗口建出来：
/// 「现在是哪一篇」只有前端知道，而新窗口该停在**同一页**（Notion 的行为）。
pub const EV_NEW_WINDOW: &str = "ui:new-window";

/// 「这篇的字节换过了」。前端 `doc-source.ts` 听它。
pub const EV_DOC_UPDATE: &str = "doc:update";

/// 新窗口起在哪一篇。**Rust 写、`main.tsx` 读**，两边只有这一个约定。
fn doc_hash(id: &str) -> String {
    format!("#doc={id}")
}

/// 开一个新窗口。`doc` 非空时它带着 `#doc=<id>` 起来，前端装载完直接开这篇。
pub fn open(app: &AppHandle, doc: Option<&str>) -> Result<String, String> {
    let mut cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .ok_or("tauri.conf.json 里没有 main 那份窗口配置")?;
    cfg.label = free_label(app);
    // 照旧藏到第一帧画完（`reveal` 去露）—— 不然会先闪一个空的毛玻璃窗。
    cfg.visible = false;
    if let Some(id) = doc {
        cfg.url = WebviewUrl::App(format!("index.html{}", doc_hash(id)).into());
    }
    let label = cfg.label.clone();
    WebviewWindowBuilder::from_config(app, &cfg)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}

/// 没被占用的 label：`win-2` / `win-3` …。关掉再开不会撞上还开着的那个。
fn free_label(app: &AppHandle) -> String {
    (2u32..)
        .map(|n| format!("win-{n}"))
        .find(|l| app.get_webview_window(l).is_none())
        .unwrap_or_else(|| "win".into())
}

/// 应用菜单：Tauri 默认那套 + `File ▸ New Window`（⌘⇧N）。
pub fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;

    // ★ Edit 那格**重造**，不摆 Undo / Redo。
    //
    // 默认那份带 `PredefinedMenuItem::undo` / `redo`（`tauri/src/menu/menu.rs` 里那两行），
    // 它们在 macOS 上是原生菜单项、自带 ⌘Z / ⇧⌘Z 的键等价 —— 而 **AppKit 先处理菜单的键等价、
    // 再往下传给 responder**，那两下就永远到不了 DOM：BlockSuite 的 `Mod-z`
    // （page-root 的 `PageKeyboardManager`）一次都不触发，表现就是「⌘Z 按了没反应」。
    // 而且系统预定义那两项动的是 **webview 自己的撤销栈**，对这套自管历史的编辑器是空操作。
    //
    // Edit 里其余几项留着：它们虽然也吃按键，但剪贴板那几个的原生实现本来就会派发 DOM 的
    // `copy` / `paste` / `cut`，编辑器那条路照跑（⌘V 就是这么进去的）。
    if let Some(edit) = submenu(&menu, "Edit") {
        for item in edit.items()? {
            edit.remove(&item)?;
        }
        let (cut, copy, paste, all) = (
            PredefinedMenuItem::cut(app, None)?,
            PredefinedMenuItem::copy(app, None)?,
            PredefinedMenuItem::paste(app, None)?,
            PredefinedMenuItem::select_all(app, None)?,
        );
        let rows: Vec<&dyn IsMenuItem<R>> = vec![&cut, &copy, &paste, &all];
        edit.append_items(&rows)?;
    }

    let item = MenuItemBuilder::with_id(NEW_WINDOW, "New Window")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;
    // File 那格默认只有「关闭窗口」，这里补上「新窗口」再把关闭留着。
    let file = SubmenuBuilder::new(app, "File")
        .item(&item)
        .separator()
        .close_window()
        .build()?;
    // macOS 第一格永远是应用自己那格（关于 / 隐藏 / 退出），所以插在它后面。
    menu.insert(&file, 1)?;
    // 把「窗口」那格登记成 NSApp 的 windowsMenu —— 系统才会自动把开着的窗口列进去。
    if let Some(w) = submenu(&menu, "Window") {
        let _ = w.set_as_windows_menu_for_nsapp();
    }
    Ok(menu)
}

/** 按标题找一格子菜单。认标题不认位置 —— 位置随系统版本变。 */
fn submenu<R: Runtime>(menu: &Menu<R>, title: &str) -> Option<Submenu<R>> {
    menu.items().ok()?.into_iter().find_map(|i| match i {
        MenuItemKind::Submenu(s) if s.text().ok().as_deref() == Some(title) => Some(s),
        _ => None,
    })
}

/// 菜单事件。只有「新窗口」这一条是我们的（其余是系统预定义项，muda 自己处理）。
pub fn on_menu(app: &AppHandle, id: &str) {
    if id != NEW_WINDOW {
        return;
    }
    new_window_requested(app);
}

/// 有人要一个新窗口：菜单栏那条和 Dock 那条（`dock.rs`）都走这儿。
///
/// 有前台窗口 → 交给**它的前端**（新窗口才会停在同一页）；一个窗口都没有（全关掉了）
/// 就直接开一个空白的 —— 不然点了没反应。
pub fn new_window_requested(app: &AppHandle) {
    match app.get_focused_window() {
        Some(w) => {
            let _ = app.emit_to(
                EventTarget::webview_window(w.label().to_string()),
                EV_NEW_WINDOW,
                (),
            );
        }
        None => {
            if let Err(err) = open(app, None) {
                crate::log::record("window", &err);
            }
        }
    }
}

/// 这篇的字节变了（`docs/architecture.md` 第七节）：告诉**别的**窗口去重读。
///
/// 只传 id、不传正文：写入点在 Rust（`docs::apply` 已经把库里的 content 覆盖了），
/// 别的窗口 `doc:open` 拿到的就是库里那份。省一次传输，而且「谁是权威」只有一个答案。
pub fn relay_doc(app: &AppHandle, from: Option<&str>, doc_id: &str) {
    for label in app.webview_windows().keys() {
        if Some(label.as_str()) == from {
            continue;
        }
        let _ = app.emit_to(EventTarget::webview_window(label.clone()), EV_DOC_UPDATE, doc_id);
    }
}
