//! whisper.cpp 的薄封装：模型懒加载 + 单段转写（D-0190）。
//! 模型很大（1.6 GB），所以整个进程只留一份；换路径才重载。

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// 模型 1.6 GB，用完不能一直攥在内存里（D-0001 的低内存目标）。
const IDLE_UNLOAD: Duration = Duration::from_secs(300);

struct Cached {
    path: PathBuf,
    ctx: Arc<WhisperContext>,
    last: Instant,
}

type Cache = Mutex<Option<Cached>>;

fn cache() -> &'static Cache {
    static C: OnceLock<Cache> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 装载（或复用）模型。第一次调用会阻塞数秒 —— 调用方在自己的线程里调。
pub fn load(path: &Path) -> Result<Arc<WhisperContext>, String> {
    let mut slot = lock(cache());
    if let Some(c) = slot.as_mut() {
        if c.path == path {
            c.last = Instant::now();
            return Ok(c.ctx.clone());
        }
    }
    let mut params = WhisperContextParameters::default();
    // Metal 在 Apple Silicon 上是数量级的差别；`whisper-rs` 的 metal feature 已经把它打开。
    params.use_gpu(true);
    // 老机器 / Metal 起不来的情况退回 CPU，别让整个功能直接不可用。
    let ctx = WhisperContext::new_with_params(path, params).or_else(|_| {
        let mut cpu = WhisperContextParameters::default();
        cpu.use_gpu(false);
        WhisperContext::new_with_params(path, cpu)
    })
    .map_err(|e| format!("装载语音模型失败：{e}"))?;
    let ctx = Arc::new(ctx);
    *slot = Some(Cached { path: path.to_path_buf(), ctx: ctx.clone(), last: Instant::now() });
    drop(slot);
    start_janitor();
    Ok(ctx)
}

/// 闲够 5 分钟就把缓存丢掉。正在转写的那一份有它自己的 `Arc`，不会被回收。
fn start_janitor() {
    static J: OnceLock<()> = OnceLock::new();
    J.get_or_init(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_secs(60));
            let mut slot = lock(cache());
            let idle = slot.as_ref().is_some_and(|c| c.last.elapsed() >= IDLE_UNLOAD);
            if idle {
                *slot = None;
            }
        });
    });
}

/// 一整段 16k 单声道 f32 → 文本。
///
/// BeamSearch 比贪心慢，但中文的专有名词 / 中英混说差得很明显 —— 这个功能的存在理由就是准。
pub fn transcribe(
    ctx: &WhisperContext,
    samples: &[f32],
    language: Option<&str>,
    prompt: Option<&str>,
) -> Result<String, String> {
    if samples.is_empty() {
        return Ok(String::new());
    }
    let mut state = ctx.create_state().map_err(|e| format!("创建转写状态失败：{e}"))?;
    let mut params = FullParams::new(SamplingStrategy::BeamSearch { beam_size: 5, patience: -1.0 });
    params.set_language(language);
    params.set_no_context(true);
    if let Some(p) = prompt.filter(|p| !p.is_empty()) {
        params.set_initial_prompt(p);
    }
    params.set_n_threads(4);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);

    state
        .full(params, samples)
        .map_err(|e| format!("转写失败：{e}"))?;

    let mut text = String::new();
    for segment in state.as_iter() {
        text.push_str(&segment.to_string());
    }
    Ok(clean(&text))
}

/// 空白段 / 静音幻觉（`[BLANK_AUDIO]`、`(silence)`）不该变成草稿。
fn clean(raw: &str) -> String {
    let text = raw.trim();
    let lower = text.to_lowercase();
    if text.is_empty()
        || lower.contains("[blank_audio]")
        || lower.contains("[silence]")
        || lower.contains("(silence)")
    {
        return String::new();
    }
    text.to_string()
}
