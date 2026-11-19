//! 复制图片到系统剪贴板（块菜单「复制图片」）。
//!
//! ★ 为什么不走前端：WKWebView 的 `execCommand('copy')` 只把它自己那份剪贴板视图填上，
//!   到别的应用里粘出来是空的。要写**系统那一个**，只能走 AppKit 的 NSPasteboard。
//! ★ 用 `msg_send!` 直连（跟 `dock.rs` 一样）—— tauri 本来就把 AppKit 链进来了，不新增依赖。

use objc2::runtime::AnyObject;
use objc2::{class, msg_send};

/// 把一组图片字节（png / jpeg / tiff…）写进系统剪贴板。
pub fn copy_image(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("图片是空的".into());
    }
    unsafe {
        let data: *mut AnyObject =
            msg_send![class!(NSData), dataWithBytes: bytes.as_ptr(), length: bytes.len()];
        let allocated: *mut AnyObject = msg_send![class!(NSImage), alloc];
        let image: *mut AnyObject = msg_send![allocated, initWithData: data];
        if image.is_null() {
            return Err("NSImage 解不开这组字节".into());
        }
        let board: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
        let _: isize = msg_send![board, clearContents];
        let objects: *mut AnyObject = msg_send![class!(NSArray), arrayWithObject: image];
        let ok: bool = msg_send![board, writeObjects: objects];
        if !ok {
            return Err("NSPasteboard 拒绝写入".into());
        }
    }
    Ok(())
}
