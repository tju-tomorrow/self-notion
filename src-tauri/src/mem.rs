//! 内存监控（D-0088）：菜单栏一个数字 + 明细接口。
//!
//! **为什么不能只报自己**：编辑器和 Y.Doc 跑在 **WKWebView 的 WebContent 进程**里，
//! 那是另一个进程。只报我们自己（SQLite + 网络那点），数字是假的。
//!
//! **为什么不能靠父子关系认领它**：`ps` 显示那些 XPC 服务（WebContent / GPU / Networking）
//! 的 ppid 是 **1（launchd）** —— 它们不是我们的儿子，`proc_listchildpids` 一个也列不到。
//! 真正的归属在 `responsibility_get_pid_responsible_for_pid()`（Activity Monitor 的
//! 「责任进程」）里：那个进程在替谁干活。
//!
//! **那个符号用 dlsym 动态取，不静态声明** —— 它不在 libc crate 的绑定里，静态链接一旦
//! 哪天符号没了就是**启动即崩**。取不到就把 `certain` 标成 false，界面自己说清楚。
//!
//! 口径：`ri_phys_footprint`（活动监视器那一栏），不是 `ri_resident_size`。

use std::sync::{Mutex, OnceLock};
use tauri::menu::{Menu, MenuItem, MenuItemBuilder};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::Wry;

const TRAY_ID: &str = "mem";

/// `PROC_ALL_PIDS` —— libc 的绑定里没有，`<libproc.h>` 里是 1。
const PROC_ALL_PIDS: u32 = 1;

#[derive(serde::Serialize)]
pub struct ProcMem {
    pub pid: i32,
    pub name: String,
    pub bytes: u64,
}

#[derive(serde::Serialize)]
pub struct MemSnap {
    /// 我们进程 + 认领到的 WebKit 进程。
    pub total: u64,
    pub own: u64,
    pub webkit: u64,
    /// false = 没拿到 responsibility API，WebKit 那组是**按进程名**归的，可能混了别的 app 的。
    pub certain: bool,
    pub procs: Vec<ProcMem>,
}

/* ────────────────────────── 读进程内存 ────────────────────────── */

/// 某进程的物理内存。进程没了 / 没权限就是 None，不报错。
fn footprint(pid: i32) -> Option<u64> {
    let mut info = std::mem::MaybeUninit::<libc::rusage_info_v2>::zeroed();
    let rc = unsafe {
        // `rusage_info_t` 在绑定里是 `*mut c_void`，所以这里要让一层指针的形状对上 ——
        // 内核是往我们这块内存里写，不是写一个指针出来。
        libc::proc_pid_rusage(pid, libc::RUSAGE_INFO_V2, info.as_mut_ptr().cast())
    };
    if rc != 0 {
        return None;
    }
    Some(unsafe { info.assume_init() }.ri_phys_footprint)
}

fn all_pids() -> Vec<i32> {
    unsafe {
        let size = std::mem::size_of::<i32>();
        // 先问一次要多少字节；进程数可能在两次调用之间又涨了，所以多留一截，免得被截断。
        let bytes = libc::proc_listpids(PROC_ALL_PIDS, 0, std::ptr::null_mut(), 0);
        if bytes <= 0 {
            return Vec::new();
        }
        let mut buf = vec![0i32; bytes as usize / size + 128];
        let written = libc::proc_listpids(
            PROC_ALL_PIDS,
            0,
            buf.as_mut_ptr().cast(),
            (buf.len() * size) as i32,
        );
        if written <= 0 {
            return Vec::new();
        }
        buf.truncate(written as usize / size);
        buf.retain(|p| *p > 0);
        buf
    }
}

fn path_of(pid: i32) -> Option<String> {
    let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let n = unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
    if n <= 0 {
        return None;
    }
    buf.truncate(n as usize);
    String::from_utf8(buf).ok()
}

/// `responsibility_get_pid_responsible_for_pid` —— 见文件头。取不到返回 None（只查一次）。
fn responsible_fn() -> Option<extern "C" fn(i32) -> i32> {
    static SYM: OnceLock<Option<extern "C" fn(i32) -> i32>> = OnceLock::new();
    *SYM.get_or_init(|| unsafe {
        // 用字节串而不是 `c"…"`：那个字面量要 Rust 1.77 + edition 2021，这里少一个前提。
        let name = b"responsibility_get_pid_responsible_for_pid\0";
        let p = libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr().cast());
        if p.is_null() {
            None
        } else {
            Some(std::mem::transmute::<*mut std::ffi::c_void, extern "C" fn(i32) -> i32>(p))
        }
    })
}

/// `…/com.apple.WebKit.WebContent` → `WebContent`。
fn short_name(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).replace("com.apple.WebKit.", "")
}

pub fn snapshot() -> MemSnap {
    let me = std::process::id() as i32;
    let own = footprint(me).unwrap_or(0);
    let certain = responsible_fn().is_some();

    let mut procs = Vec::new();
    let mut webkit = 0u64;
    for pid in all_pids() {
        if pid == me {
            continue;
        }
        let Some(path) = path_of(pid) else { continue };
        // 只要 WebKit 那几个（WebContent / GPU / Networking）。别的进程不是这个应用的账。
        if !path.contains("/WebKit.") {
            continue;
        }
        match responsible_fn() {
            Some(f) if f(pid) != me => continue,
            // 拿不到归属：只能按名字归堆，`certain=false` 已经把这件事说出去了。
            _ => {}
        }
        let bytes = footprint(pid).unwrap_or(0);
        webkit += bytes;
        procs.push(ProcMem { pid, name: short_name(&path), bytes });
    }
    // 大的在前 —— 一眼看到是谁在吃内存。
    procs.sort_by_key(|p| std::cmp::Reverse(p.bytes));

    MemSnap { total: own + webkit, own, webkit, certain, procs }
}

/* ────────────────────────── 菜单栏那一个数字 ────────────────────────── */

struct Tray {
    tray: TrayIcon<Wry>,
    /// 固定四行：总计 / 主进程 / WebKit / 文档。**行数固定** —— 重建菜单会把正开着的菜单关掉。
    rows: Vec<MenuItem<Wry>>,
}

fn slot() -> &'static Mutex<Option<Tray>> {
    static S: OnceLock<Mutex<Option<Tray>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

/// 开/关菜单栏。关掉就是把 `Tray` 丢掉 —— `TrayIcon` 的 Drop 会把图标摘了。
pub fn set_tray(app: &tauri::AppHandle, on: bool) -> Result<(), String> {
    let mut guard = slot().lock().map_err(|_| "托盘锁坏了")?;
    if !on {
        *guard = None;
        return Ok(());
    }
    if guard.is_some() {
        return Ok(());
    }

    let labels = ["总计", "主进程", "WebKit", "文档"];
    let rows = labels
        .iter()
        .map(|text| {
            // 全是只读信息，禁掉点击（`enabled(false)`）—— 点一下什么都不发生比点了没反应好。
            MenuItemBuilder::with_id(format!("mem:{text}"), *text)
                .enabled(false)
                .build(app)
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
        rows.iter().map(|r| r as &dyn tauri::menu::IsMenuItem<Wry>).collect();
    let menu = Menu::with_items(app, &refs).map_err(|e| e.to_string())?;

    let icon = app.default_window_icon().ok_or("没有默认图标")?.clone();
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        // 左键直接出菜单（macOS 习惯）。标题那个数字本身就在栏上，不用点。
        .show_menu_on_left_click(true)
        .build(app)
        .map_err(|e| e.to_string())?;

    *guard = Some(Tray { tray, rows });
    Ok(())
}

/// 把最新的数字推上去：`title` 是栏上那一串，`rows` 是菜单四行。
pub fn render(title: &str, rows: &[String]) -> Result<(), String> {
    let guard = slot().lock().map_err(|_| "托盘锁坏了")?;
    let Some(state) = guard.as_ref() else {
        // 关着的时候前端还在推 —— 不是错，只是没有接收方。
        return Ok(());
    };
    state.tray.set_title(Some(title)).map_err(|e| e.to_string())?;
    for (item, text) in state.rows.iter().zip(rows) {
        item.set_text(text).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/* ────────────────────────── 入口 ────────────────────────── */

#[derive(serde::Deserialize)]
pub struct RenderArgs {
    pub title: String,
    #[serde(default)]
    pub rows: Vec<String>,
}

pub fn dispatch(method: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    match method {
        "mem:snapshot" => serde_json::to_value(snapshot()).map_err(|e| e.to_string()),
        "mem:render" => {
            let a: RenderArgs = serde_json::from_value(args).map_err(|e| e.to_string())?;
            render(&a.title, &a.rows)?;
            Ok(serde_json::Value::Null)
        }
        other => Err(format!("不认识的 mem 方法：{other}")),
    }
}
