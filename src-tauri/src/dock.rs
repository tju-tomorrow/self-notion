//! Dock 图标的右键菜单 —— Notion 的人就是在**那儿**找「新窗口」的。
//!
//! AppKit 只认 delegate 的 `applicationDockMenu:`（没有第二个入口），而 Tauri 的 delegate
//! 是 Rust 侧的类、不实现它 —— 于是只能在运行时往那个类上补两个方法：
//! `applicationDockMenu:` 回我们这份菜单，`selfNotionNewWindow:` 是那条菜单项的动作。
//!
//! ★ **不能换 delegate**（自己 setDelegate 一个）—— 换了整套应用菜单（复制 / 粘贴 / 退出
//!   那些）就一起没了。补方法不动别人。

use std::ffi::CStr;
use std::mem;
use std::sync::OnceLock;

use objc2::ffi::class_addMethod;
use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{class, msg_send, sel};
use objc2_foundation::NSString;
use tauri::AppHandle;

/// 菜单项的 action 是个裸函数指针，捕获不了环境 —— 句柄从这儿拿。
static APP: OnceLock<AppHandle> = OnceLock::new();

/// 建好的那份菜单。`applicationDockMenu:` **每显示一次就被问一次**，别每次新造一个。
static MENU: OnceLock<usize> = OnceLock::new();

/// 装上。`setup` 里调（主线程，且 Tauri 的 delegate 已经挂上）。
pub fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    unsafe {
        let nsapp: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![nsapp, delegate];
        if delegate.is_null() {
            crate::log::record("dock", "NSApp 还没挂 delegate，Dock 菜单没装上");
            return;
        }
        let cls: *mut AnyClass = msg_send![delegate, class];
        // 这是 AppDelegate 类自己的实例方法，参数是 sender，所以类型串是 `@` 开头：
        // 冒号后依次是 self / _cmd / sender。
        let menu_imp: unsafe extern "C-unwind" fn(*mut AnyObject, Sel) -> *mut AnyObject = dock_menu;
        let act_imp: unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) = new_window;
        add_method(cls, sel!(applicationDockMenu:), menu_imp as *const (), c"@@:@");
        add_method(cls, sel!(selfNotionNewWindow:), act_imp as *const (), c"v@:@");
    }
}

/// `class_addMethod` 要的是 `Imp`（`fn()`），我们的函数有参数 —— 只能转一道。
unsafe fn add_method(cls: *mut AnyClass, sel: Sel, f: *const (), types: &CStr) {
    let imp: Imp = mem::transmute(f);
    class_addMethod(cls, sel, imp, types.as_ptr());
}

/// `applicationDockMenu:` —— 回我们那份菜单。
unsafe extern "C-unwind" fn dock_menu(this: *mut AnyObject, _cmd: Sel) -> *mut AnyObject {
    *MENU.get_or_init(|| build_menu(this) as usize) as *mut AnyObject
}

/// `selfNotionNewWindow:` —— 点「新窗口」。
unsafe extern "C-unwind" fn new_window(_this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) {
    if let Some(app) = APP.get() {
        crate::windows::new_window_requested(app);
    }
}

unsafe fn build_menu(target: *mut AnyObject) -> *mut AnyObject {
    let menu: *mut AnyObject = msg_send![class!(NSMenu), new];
    let title = NSString::from_str("新窗口");
    let none = NSString::from_str("");
    let item: *mut AnyObject = msg_send![class!(NSMenuItem), alloc];
    let item: *mut AnyObject = msg_send![
        item,
        initWithTitle: &*title,
        action: sel!(selfNotionNewWindow:),
        keyEquivalent: &*none
    ];
    // ★ target 必须写上：不写就走 responder chain，而那条链在我们这个方法上找不到实现。
    let _: () = msg_send![item, setTarget: target];
    let _: () = msg_send![menu, addItem: item];
    menu
}
