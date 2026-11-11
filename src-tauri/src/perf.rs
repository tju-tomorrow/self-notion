//! 卡死监控：`<app data>/perf.log`（JSONL）。
//!
//! 主线程卡住时前端定时器不响、Rust 同步命令也不返回 —— 所以判定放在**独立线程**里：
//! 前端每 2s 报一次心跳，这里 1s 查一次；心跳断了就当场落盘（用户可能直接强退）。
//! 写盘只在这一个线程，`beat` / RPC 计时只碰内存，绝不让监控自己卡住主线程。

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

const TICK_MS: u64 = 1_000;
const FREEZE_MS: u64 = 6_000;
const STARTUP_GRACE_MS: u64 = 8_000;
const FOCUS_GRACE_MS: u64 = 6_000;
const SAMPLE_MS: u64 = 10_000;
const PROGRESS_MS: u64 = 30_000;
const SLOW_RPC_MS: u64 = 300;
const JANK_MS: u64 = 1_000;
const JANK_GAP_MS: u64 = 10_000;
const STALL_MS: u64 = 3_000;
const BEAT_TTL_MS: u64 = 600_000;
const ROTATE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone)]
struct Beat {
    /// `CLOCK_UPTIME_RAW` 毫秒 —— 睡眠不往前走，睡醒不会被当成卡死。
    at: u64,
    payload: Value,
}

struct Frozen {
    win: String,
    since: u64,
    progress_at: u64,
}

struct Shared {
    beats: HashMap<String, Beat>,
    focus: Option<String>,
    focus_since: u64,
    frozen: Option<Frozen>,
    pending_jank: Option<(String, Value)>,
    started: u64,
}

#[derive(Default)]
struct InFlight {
    win: String,
    method: String,
    at: Option<Instant>,
}

struct SlowRpc {
    win: String,
    method: String,
    ms: u64,
}

static SHARED: OnceLock<Mutex<Shared>> = OnceLock::new();
static INFLIGHT: OnceLock<Mutex<InFlight>> = OnceLock::new();
static NOTES: OnceLock<mpsc::SyncSender<SlowRpc>> = OnceLock::new();
static STARTED: OnceLock<()> = OnceLock::new();

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn clock_ms(clock: libc::clockid_t) -> u64 {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(clock, &mut ts) };
    ts.tv_sec as u64 * 1_000 + ts.tv_nsec as u64 / 1_000_000
}

fn uptime() -> u64 {
    clock_ms(libc::CLOCK_UPTIME_RAW)
}

fn with_shared<T>(f: impl FnOnce(&mut Shared) -> T) -> Option<T> {
    let m = SHARED.get()?;
    let mut g = m.lock().ok()?;
    Some(f(&mut g))
}

/// 写盘线程的唯一出口。轮换只在这里发生，所以不需要跨线程协调。
struct Writer {
    path: PathBuf,
    file: Option<File>,
    bytes: u64,
    err_at: u64,
}

impl Writer {
    fn new(path: PathBuf) -> Self {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let mut w = Writer { path, file: None, bytes: 0, err_at: 0 };
        w.open();
        w
    }

    fn open(&mut self) {
        match OpenOptions::new().create(true).append(true).open(&self.path) {
            Ok(f) => {
                self.bytes = f.metadata().map(|m| m.len()).unwrap_or(0);
                self.file = Some(f);
            }
            Err(e) => {
                self.file = None;
                self.fail(&e.to_string());
            }
        }
    }

    fn fail(&mut self, msg: &str) {
        let now = uptime();
        if now.saturating_sub(self.err_at) < 60_000 {
            return;
        }
        self.err_at = now;
        crate::log::record("perf", &format!("{}：{msg}", self.path.display()));
    }

    fn line(&mut self, v: Value) {
        let mut s = v.to_string();
        s.push('\n');
        let len = s.len() as u64;
        if self.bytes + len > ROTATE_BYTES {
            self.file = None;
            let _ = fs::rename(&self.path, self.path.with_file_name("perf.log.1"));
            self.bytes = 0;
        }
        if self.file.is_none() {
            self.open();
        }
        let Some(f) = self.file.as_mut() else { return };
        match f.write_all(s.as_bytes()) {
            Ok(()) => self.bytes += len,
            Err(e) => {
                self.file = None;
                self.fail(&e.to_string());
            }
        }
    }
}

/// 卡死现场不该把整个 errors.log 读进来 —— 只取尾巴。
fn log_tail(n: usize) -> Vec<String> {
    let path = crate::store::default_db_path().with_file_name("errors.log");
    let Ok(mut f) = File::open(&path) else { return Vec::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(32 * 1024);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_err() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = text.lines().collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    lines.iter().rev().take(n).rev().map(|s| s.to_string()).collect()
}

#[allow(deprecated)] // libc 让换 mach2 crate；为一次换算引依赖不值
fn timebase() -> (u64, u64) {
    static TB: OnceLock<(u64, u64)> = OnceLock::new();
    *TB.get_or_init(|| {
        let mut info = libc::mach_timebase_info { numer: 0, denom: 0 };
        unsafe { libc::mach_timebase_info(&mut info) };
        (info.numer as u64, (info.denom as u64).max(1))
    })
}

fn cpu_ns(pid: i32) -> Option<u64> {
    let u = crate::mem::usage(pid)?;
    let (numer, denom) = timebase();
    Some((u.user + u.system).saturating_mul(numer) / denom)
}

fn pct(delta_ns: u64, wall_ms: u64) -> f64 {
    if wall_ms == 0 {
        return 0.0;
    }
    let v = delta_ns as f64 / (wall_ms as f64 * 1_000_000.0) * 100.0;
    (v * 10.0).round() / 10.0
}

/// 自己 + 认领到的 WebKit 进程的 CPU。累计时间回退（pid 复用）按 0 算，不报负值。
fn cpu_sample(
    snap: &crate::mem::MemSnap,
    prev: &mut HashMap<i32, u64>,
    prev_at: &mut u64,
    at: u64,
) -> (f64, Vec<Value>) {
    let wall = at.saturating_sub(*prev_at);
    *prev_at = at;
    let own_pid = std::process::id() as i32;
    let pids = std::iter::once((own_pid, "self-notion".to_string(), snap.own))
        .chain(snap.procs.iter().map(|p| (p.pid, p.name.clone(), p.bytes)));
    let mut total = 0u64;
    let mut rows = Vec::new();
    for (pid, name, bytes) in pids {
        let Some(ns) = cpu_ns(pid) else { continue };
        let delta = prev.insert(pid, ns).map(|old| ns.saturating_sub(old)).unwrap_or(0);
        total += delta;
        rows.push(json!({"pid": pid, "name": name, "cpu": pct(delta, wall), "bytes": bytes}));
    }
    (pct(total, wall), rows)
}

fn inflight() -> Option<Value> {
    let m = INFLIGHT.get()?;
    let g = m.lock().ok()?;
    let at = g.at?;
    Some(json!({"win": g.win, "method": g.method, "ms": at.elapsed().as_millis() as u64}))
}

fn end_freeze(w: &mut Writer, reason: &str, resume: Option<Value>) {
    let ended = with_shared(|s| {
        let f = s.frozen.take()?;
        Some((f.win, uptime().saturating_sub(f.since)))
    });
    let Some(Some((win, duration))) = ended else { return };
    w.line(json!({
        "t": now_ms(), "kind": "freeze-end", "win": win,
        "duration_ms": duration, "reason": reason, "resume": resume,
    }));
}

enum Action {
    None,
    Begin,
    Progress,
}

fn run(path: PathBuf, rx: mpsc::Receiver<SlowRpc>) {
    let mut w = Writer::new(path);
    w.line(json!({
        "v": 1, "t": now_ms(), "kind": "boot",
        "pid": std::process::id(), "version": env!("CARGO_PKG_VERSION"),
    }));

    let mut last_mono = clock_ms(libc::CLOCK_MONOTONIC);
    let mut last_up = uptime();
    let mut next_sample = last_up + SAMPLE_MS;
    let mut last_jank = 0u64;
    let mut slow_seen: HashMap<String, u64> = HashMap::new();
    let mut prev_cpu: HashMap<i32, u64> = HashMap::new();
    let mut prev_at = last_up;

    loop {
        std::thread::sleep(Duration::from_millis(TICK_MS));
        let mono = clock_ms(libc::CLOCK_MONOTONIC);
        let up = uptime();
        let mono_gap = mono.saturating_sub(last_mono);
        let up_gap = up.saturating_sub(last_up);
        last_mono = mono;
        last_up = up;

        while let Ok(note) = rx.try_recv() {
            if up.saturating_sub(slow_seen.get(&note.method).copied().unwrap_or(0)) < 5_000 {
                continue;
            }
            slow_seen.insert(note.method.clone(), up);
            w.line(json!({
                "t": now_ms(), "kind": "slow-rpc",
                "win": note.win, "method": note.method, "ms": note.ms,
            }));
        }

        // 系统睡 / 进程被 App Nap：都没被调度，不能算卡死。
        if mono_gap > STALL_MS || up_gap > STALL_MS {
            w.line(json!({
                "t": now_ms(), "kind": "stall", "gap_ms": mono_gap,
                "uptime_gap_ms": up_gap, "sleep_ms": mono_gap.saturating_sub(up_gap),
            }));
            end_freeze(&mut w, "suspend", None);
            prev_cpu.clear();
            prev_at = up;
            with_shared(|s| s.focus_since = up);
            continue;
        }

        if up.saturating_sub(last_jank) >= JANK_GAP_MS {
            if let Some(Some((win, payload))) = with_shared(|s| s.pending_jank.take()) {
                last_jank = up;
                w.line(json!({"t": now_ms(), "kind": "jank", "win": win, "beat": payload}));
            }
        }

        let state = with_shared(|s| (s.focus.clone(), s.focus_since, s.started, s.frozen.is_some()));
        let Some((focus, focus_since, started, frozen)) = state else { continue };

        if frozen {
            let win = with_shared(|s| s.frozen.as_ref().map(|f| f.win.clone())).flatten();
            if win.as_deref() != focus.as_deref() {
                end_freeze(&mut w, "focus", None);
            }
        }

        if let Some(label) = focus {
            let stable = up.saturating_sub(started) >= STARTUP_GRACE_MS
                && up.saturating_sub(focus_since) >= FOCUS_GRACE_MS;
            if stable {
                let beat = with_shared(|s| s.beats.get(&label).cloned()).flatten();
                if let Some(beat) = beat {
                    let age = up.saturating_sub(beat.at);
                    if age > FREEZE_MS {
                        let action = with_shared(|s| match s.frozen.as_mut() {
                            None => {
                                s.frozen = Some(Frozen {
                                    win: label.clone(),
                                    since: beat.at,
                                    progress_at: up,
                                });
                                Action::Begin
                            }
                            Some(f)
                                if f.win == label
                                    && up.saturating_sub(f.progress_at) >= PROGRESS_MS =>
                            {
                                f.progress_at = up;
                                Action::Progress
                            }
                            _ => Action::None,
                        })
                        .unwrap_or(Action::None);
                        match action {
                            Action::Begin | Action::Progress => {
                                let snap = crate::mem::snapshot();
                                let (now_cpu, procs) =
                                    cpu_sample(&snap, &mut prev_cpu, &mut prev_at, up);
                                if matches!(action, Action::Begin) {
                                    w.line(json!({
                                        "t": now_ms(), "kind": "freeze-begin", "win": label,
                                        "beat_age": age, "in_flight": inflight(),
                                        "own": snap.own, "webkit": snap.webkit,
                                        "cpu": now_cpu, "procs": procs,
                                        "errors": log_tail(20), "last_beat": beat.payload,
                                    }));
                                } else {
                                    w.line(json!({
                                        "t": now_ms(), "kind": "freeze-progress", "win": label,
                                        "beat_age": age, "own": snap.own, "webkit": snap.webkit,
                                        "cpu": now_cpu,
                                    }));
                                }
                            }
                            Action::None => {}
                        }
                    } else {
                        end_freeze(&mut w, "beat", Some(beat.payload));
                    }
                }
            }
        }

        if up >= next_sample {
            next_sample = up + SAMPLE_MS;
            let snap = crate::mem::snapshot();
            let (now_cpu, procs) = cpu_sample(&snap, &mut prev_cpu, &mut prev_at, up);
            let beat = with_shared(|s| s.focus.as_ref().and_then(|f| s.beats.get(f)).cloned())
                .flatten();
            let age = beat.as_ref().map(|b| up.saturating_sub(b.at)).unwrap_or(0);
            let focus = with_shared(|s| s.focus.clone()).flatten();
            let frozen = with_shared(|s| s.frozen.is_some()).unwrap_or(false);
            w.line(json!({
                "t": now_ms(), "kind": "sample", "focus": focus, "beat_age": age,
                "own": snap.own, "webkit": snap.webkit, "cpu": now_cpu, "procs": procs,
                "frozen": frozen, "beat": beat.map(|b| b.payload),
            }));
        }
    }
}

pub fn init() {
    if STARTED.set(()).is_err() {
        return;
    }
    let path = crate::store::default_db_path().with_file_name("perf.log");
    let started = uptime();
    let _ = SHARED.set(Mutex::new(Shared {
        beats: HashMap::new(),
        focus: None,
        focus_since: started,
        frozen: None,
        pending_jank: None,
        started,
    }));
    let _ = INFLIGHT.set(Mutex::new(InFlight::default()));
    let (tx, rx) = mpsc::sync_channel(256);
    let _ = NOTES.set(tx);
    eprintln!("[self-notion] 性能日志：{}", path.display());
    std::thread::spawn(move || run(path, rx));
}

pub fn beat(win: &str, args: Value) -> Result<Value, String> {
    let now = uptime();
    let focused = args.get("focused").and_then(Value::as_bool).unwrap_or(false);
    let hidden = args.get("hidden").and_then(Value::as_bool).unwrap_or(false);
    let max_lag = args.get("maxLag").and_then(Value::as_u64).unwrap_or(0);
    with_shared(|s| {
        // 窗口被挡住时 WebKit 会把定时器节流成 1Hz —— 那不是卡死。
        if hidden {
            if s.focus.as_deref() == Some(win) {
                s.focus = None;
            }
        } else if focused && s.focus.is_none() {
            s.focus = Some(win.to_string());
            s.focus_since = now;
        }
        if max_lag >= JANK_MS {
            s.pending_jank = Some((win.to_string(), args.clone()));
        }
        s.beats.insert(win.to_string(), Beat { at: now, payload: args });
        let cutoff = now.saturating_sub(BEAT_TTL_MS);
        s.beats.retain(|_, b| b.at >= cutoff);
    });
    Ok(Value::Null)
}

pub fn set_focus(label: &str, focused: bool) {
    let now = uptime();
    with_shared(|s| {
        if focused {
            s.focus = Some(label.to_string());
            s.focus_since = now;
        } else if s.focus.as_deref() == Some(label) {
            s.focus = None;
        }
    });
}

pub fn window_gone(label: &str) {
    with_shared(|s| {
        s.beats.remove(label);
        if s.focus.as_deref() == Some(label) {
            s.focus = None;
        }
    });
}

pub fn rpc_begin(win: &str, method: &str) {
    let Some(m) = INFLIGHT.get() else { return };
    if let Ok(mut g) = m.lock() {
        g.win.clear();
        g.win.push_str(win);
        g.method.clear();
        g.method.push_str(method);
        g.at = Some(Instant::now());
    }
}

pub fn rpc_end(win: &str, method: &str, ms: u64) {
    if let Some(m) = INFLIGHT.get() {
        if let Ok(mut g) = m.lock() {
            if g.win == win && g.method == method {
                g.at = None;
            }
        }
    }
    if ms < SLOW_RPC_MS || method.starts_with("perf:") || method == "log:error" {
        return;
    }
    let Some(tx) = NOTES.get() else { return };
    let _ = tx.try_send(SlowRpc {
        win: win.to_string(),
        method: method.to_string(),
        ms,
    });
}
