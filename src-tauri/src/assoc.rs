//! 让 macOS 把这个 app 当 `.md` 的打开方（D-0137 / D-0138，全文见 `docs/external-md.md`）。
//!
//! 两件事：接住系统递进来的文件（`RunEvent::Opened` → 信箱 + `ui:fileOpened`），和「设为默认 Markdown 编辑器」。
//! ★ `tauri dev` 下两件都不可用 —— 没有 Info.plist，macOS 侧注册一律 `UnsupportedPlatform`
//!   （D-0050 第 4 条那条纪律：只能在 `cargo tauri build --debug --bundles app` 之后验）。

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, EventTarget, Manager};

/// 逐字等于 `contract.ts` 的 `FILE_OPENED`（跨线没有编译期检查，漂移只能靠人守）。
const EV_FILE_OPENED: &str = "ui:fileOpened";

/// 「.md」的 UTI —— 和 `tauri.conf.json` 的 `fileAssociations.contentTypes` 是同一个。
#[cfg(target_os = "macos")]
const MD_UTI: &str = "net.daringfireball.markdown";

/// `file:defaultStatus` 的返回 —— 形状照 `contract.ts` 的 `FileDefaultStatus`。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultStatus {
    pub is_default: bool,
    pub bundle_path: Option<String>,
}

/// `FILE_OPENED` 的载荷 —— 形状照 `contract.ts` 的 `FileOpenedEvent`。
#[derive(Clone, Serialize)]
struct FileOpened {
    paths: Vec<String>,
}

/// 系统递进来、前端还没取走的**绝对路径**。
/// 前端 boot 时 `file:drainOpened` 取走 —— 打开事件可能早于前端起来，光广播会丢。
static MAILBOX: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// 前端第一次 drain 过没有。**只收 boot 之前的** —— 不然运行期双击的文件会在下次启动被重开一遍。
static BOOTED: AtomicBool = AtomicBool::new(false);

/// `lib.rs` 收到 `RunEvent::Opened` 就调它。
pub fn deliver(app: &AppHandle, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    if !BOOTED.load(Ordering::Relaxed) {
        MAILBOX.lock().map_err(|e| e.to_string())?.extend(paths.clone());
    }
    let payload = FileOpened { paths };
    // 发给**聚焦的那个窗口** —— 广播会让多窗口同时开同一篇。一个都没聚焦就退回广播兜底。
    match focused_window(app) {
        Some((label, win)) => {
            // 双击一个 .md，窗口该自己到前面来（和 `lib.rs` 里 single-instance 那个回调同一件事）。
            let _ = win.unminimize();
            let _ = win.set_focus();
            app.emit_to(EventTarget::webview_window(label), EV_FILE_OPENED, payload)
                .map_err(|e| e.to_string())
        }
        None => app.emit(EV_FILE_OPENED, payload).map_err(|e| e.to_string()),
    }
}

/// 当前聚焦的那个窗口（label + 句柄）。一个都没聚焦（比如从别的 app 拖文件进来）→ `None`。
fn focused_window(app: &AppHandle) -> Option<(String, tauri::WebviewWindow)> {
    app.webview_windows()
        .into_iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
}

/// `file:drainOpened`：取走并清空（取走即清空，不能重复开）。
pub fn drain() -> Result<Vec<String>, String> {
    BOOTED.store(true, Ordering::Relaxed);
    let mut mailbox = MAILBOX.lock().map_err(|e| e.to_string())?;
    Ok(std::mem::take(&mut *mailbox))
}

/// `file:defaultStatus`。`bundlePath` 是**系统现在认的那个 app** —— 不是我们的时候要能显示出来。
#[cfg(target_os = "macos")]
pub fn status() -> Result<DefaultStatus, String> {
    let current = macos::default_md_app_path();
    let ours = macos::own_bundle_path();
    Ok(DefaultStatus {
        is_default: current.is_some() && current == ours,
        bundle_path: current,
    })
}

/// `file:setDefault` —— `NSWorkspace.setDefaultApplication(at:toOpen:completion:)`，macOS 12+。
/// 系统自己会弹确认框（需要用户同意时它在回调前异步问），所以这里不自己再问一遍。
#[cfg(target_os = "macos")]
pub fn set_default() -> Result<(), String> {
    macos::set_default_md_app()
}

/// 非 macOS 没有「某个扩展名的默认应用」这个概念 —— 如实报错，不假装成功。
#[cfg(not(target_os = "macos"))]
pub fn status() -> Result<DefaultStatus, String> {
    Err("只有 macOS 有「.md 的默认应用」这个概念".into())
}

#[cfg(not(target_os = "macos"))]
pub fn set_default() -> Result<(), String> {
    Err("只有 macOS 有「.md 的默认应用」这个概念".into())
}

/// AppKit 那一半。用裸 `objc2`（`dock.rs` 的路子）而不是 `objc2-app-kit`：
/// 那两个按**内容类型**查/设默认的方法带 `UTType` 参数，而 `UTType` 在
/// `objc2-uniform-type-identifiers` 里 —— 它不在 `Cargo.lock` 里，加进来就是一次新增编译。
/// 按 UTI 字符串运行时取 `UTType`，等于零新增依赖。
#[cfg(target_os = "macos")]
mod macos {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    use std::ptr;

    // AppKit 不保证替我们加载 UniformTypeIdentifiers（`UTType` 只是个前向声明），显式拉一下。
    #[link(name = "UniformTypeIdentifiers", kind = "framework")]
    extern "C" {}

    /// `net.daringfireball.markdown` 的 `UTType`。拿不到就是系统不认这个 UTI。
    fn markdown_uttype() -> Result<*mut AnyObject, String> {
        let cls = AnyClass::get(c"UTType").ok_or("UTType 类没加载（UniformTypeIdentifiers 不在）")?;
        let identifier = NSString::from_str(super::MD_UTI);
        let ut: *mut AnyObject = unsafe { msg_send![cls, typeWithIdentifier: &*identifier] };
        if ut.is_null() {
            return Err(format!("系统不认 UTI {}", super::MD_UTI));
        }
        Ok(ut)
    }

    /// `NSURL.path`。不是 file URL / 取不到就是 `None`。
    fn url_path(url: *mut AnyObject) -> Option<String> {
        if url.is_null() {
            return None;
        }
        let path: *mut AnyObject = unsafe { msg_send![url, path] };
        if path.is_null() {
            return None;
        }
        Some(unsafe { (&*(path as *const NSString)).to_string() })
    }

    fn workspace() -> *mut AnyObject {
        unsafe { msg_send![class!(NSWorkspace), sharedWorkspace] }
    }

    /// 我们自己的 bundle URL —— 打包后是 `.app`，dev 下是 `target/debug/self-notion`。
    fn own_bundle_url() -> *mut AnyObject {
        unsafe {
            let bundle: *mut AnyObject = msg_send![class!(NSBundle), mainBundle];
            if bundle.is_null() {
                return ptr::null_mut();
            }
            msg_send![bundle, bundleURL]
        }
    }

    pub fn own_bundle_path() -> Option<String> {
        url_path(own_bundle_url())
    }

    /// 系统现在给 `.md` 用的那个 app 的路径（用户自己的覆盖优先）。
    pub fn default_md_app_path() -> Option<String> {
        let ut = markdown_uttype().ok()?;
        let url: *mut AnyObject = unsafe { msg_send![workspace(), URLForApplicationToOpenContentType: ut] };
        url_path(url)
    }

    pub fn set_default_md_app() -> Result<(), String> {
        let ut = markdown_uttype()?;
        let app_url = own_bundle_url();
        if app_url.is_null() {
            return Err("拿不到自己的 bundle URL".into());
        }
        // completion 传 nil（Apple 文档：可选）—— 需要用户同意时系统自己弹框，我们不重复问。
        let _: () = unsafe {
            msg_send![
                workspace(),
                setDefaultApplicationAtURL: app_url,
                toOpenContentType: ut,
                completionHandler: ptr::null_mut::<AnyObject>()
            ]
        };
        Ok(())
    }
}
