//! 关掉 macOS 那套「自动检查」。
//!
//! 这个 app 里的文本**一律当源码看**（markdown / 代码 / 文件名），弯引号、句首自动大写、
//! 拼写替换全是破坏（用户 2026-10-09）。
//!
//! 前端已经给每个输入框设了 `spellcheck` / `autocorrect` / `autocapitalize`（`main.tsx`），
//! 但**弯引号它管不着** —— 那是 WebKit 自己的偏好，HTML 属性到不了那一层。
//! WebKit 的 `WebPreferences` 在构造时读 `NSUserDefaults` 上这几个 `Web*` 键当默认值，
//! 读的就是 UI 进程（= 我们这个 app）的 domain。所以**建 webview 之前**压下去，全窗口生效。
//!
//! 副作用：网页版 AI 面板那个子 webview 也一起关了。那边是别人的网页，本来就轮不到
//! 系统去改用户打的字，这样正好。
//!
//! 只对 macOS 编译；裸 `objc2` + `msg_send`（`dock.rs` 的路子，不为了几个 setter 引新 crate）。

/// 键名是 WebKit 的历史约定 —— `WebPreferences` 的 `automatic*` 一族初始化时读的就是它们。
/// 名字带 `Web` 前缀，写错了**不会报错，只会静默不生效**，改这里要照着 WebKit 源码对。
const KEYS: [&str; 6] = [
    "WebAutomaticQuoteSubstitutionEnabled",
    "WebAutomaticDashSubstitutionEnabled",
    "WebAutomaticTextReplacementEnabled",
    "WebAutomaticSpellingCorrectionEnabled",
    "WebContinuousSpellCheckingEnabled",
    "WebGrammarCheckingEnabled",
];

/// 压掉系统那套自动替换。**必须在任何 webview 建起来之前调**（`run()` 的最开头）——
/// 建完之后再改，已经构造好的那份 preferences 不会回头看。
pub fn disarm() {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;

    unsafe {
        let defaults: *mut AnyObject = msg_send![class!(NSUserDefaults), standardUserDefaults];
        if defaults.is_null() {
            return;
        }
        for key in KEYS {
            let k = NSString::from_str(key);
            let _: () = msg_send![defaults, setBool: false, forKey: &*k];
        }
    }
}
