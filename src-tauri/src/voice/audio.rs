//! 麦克风采集 + 能量 VAD 分段（D-0190）。
//!
//! 采集在 cpal 的回调里只做「混单声道、丢进缓冲」；判断说话、切段、转写全在一条 worker 线程上。
//! 静音 800ms 收一段 —— whisper 对整段长音频反而会漏字，短段 + 上一段末尾当 prompt 更准。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use serde_json::json;
use tauri::{AppHandle, Emitter, EventTarget};

use super::asr;
use crate::log;

const SILENCE_MS: f32 = 800.0;
const MAX_SEGMENT_SECS: f32 = 7.0;
const MIN_SPEECH_MS: f32 = 350.0;
const LEVEL_MS: u128 = 100;

pub struct Capture {
    pub stop: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
    pub stream: cpal::Stream,
    pub thread: JoinHandle<()>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn spawn(
    app: AppHandle,
    win: String,
    session_id: String,
    model: PathBuf,
    language: String,
) -> Result<Capture, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "没有可用的麦克风".to_string())?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("拿不到麦克风配置：{e}"))?;
    let format = supported.sample_format();
    let channels = supported.channels() as usize;
    let rate = supported.sample_rate();
    let config: StreamConfig = supported.into();

    let buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let max_samples = (rate as usize) * 120;
    let err_fn = |e: cpal::Error| log::record("voice", &format!("采集出错：{e}"));

    let stream = match format {
        SampleFormat::F32 => {
            let b = buf.clone();
            device.build_input_stream(
                config,
                move |data: &[f32], _| push(data.iter().copied(), channels, max_samples, &b),
                err_fn,
                None,
            )
        }
        SampleFormat::I16 => {
            let b = buf.clone();
            device.build_input_stream(
                config,
                move |data: &[i16], _| {
                    push(data.iter().map(|s| *s as f32 / 32768.0), channels, max_samples, &b)
                },
                err_fn,
                None,
            )
        }
        SampleFormat::U16 => {
            let b = buf.clone();
            device.build_input_stream(
                config,
                move |data: &[u16], _| {
                    push(
                        data.iter().map(|s| (*s as f32 - 32768.0) / 32768.0),
                        channels,
                        max_samples,
                        &b,
                    );
                },
                err_fn,
                None,
            )
        }
        SampleFormat::I32 => {
            let b = buf.clone();
            device.build_input_stream(
                config,
                move |data: &[i32], _| {
                    push(
                        data.iter().map(|s| *s as f32 / 2_147_483_648.0),
                        channels,
                        max_samples,
                        &b,
                    );
                },
                err_fn,
                None,
            )
        }
        SampleFormat::F64 => {
            let b = buf.clone();
            device.build_input_stream(
                config,
                move |data: &[f64], _| {
                    push(data.iter().map(|s| *s as f32), channels, max_samples, &b);
                },
                err_fn,
                None,
            )
        }
        other => return Err(format!("不支持的麦克风采样格式：{other:?}")),
    }
    .map_err(|e| format!("打不开麦克风：{e}"))?;

    stream.play().map_err(|e| format!("启动麦克风失败：{e}"))?;

    let stop = Arc::new(AtomicBool::new(false));
    let cancel = Arc::new(AtomicBool::new(false));
    let thread = {
        let app = app.clone();
        let stop = stop.clone();
        let cancel = cancel.clone();
        std::thread::spawn(move || {
            worker(&app, &win, &session_id, &model, &language, &buf, rate, &stop, &cancel);
        })
    };

    Ok(Capture { stop, cancel, stream, thread })
}

fn push<I: Iterator<Item = f32>>(
    samples: I,
    channels: usize,
    max_samples: usize,
    buf: &Arc<Mutex<Vec<f32>>>,
) {
    let ch = channels.max(1);
    let mut out = lock(buf);
    let mut acc = 0.0;
    let mut n = 0usize;
    for s in samples {
        acc += s;
        n += 1;
        if n == ch {
            out.push(acc / ch as f32);
            acc = 0.0;
            n = 0;
        }
    }
    // 转写比实时慢的时候不能让缓冲无限长（长文章一次能说几分钟）。
    if out.len() > max_samples {
        let drop = out.len() - max_samples / 2;
        out.drain(..drop);
    }
}

#[allow(clippy::too_many_arguments)]
fn worker(
    app: &AppHandle,
    win: &str,
    session_id: &str,
    model: &Path,
    language: &str,
    buf: &Arc<Mutex<Vec<f32>>>,
    rate: u32,
    stop: &AtomicBool,
    cancel: &AtomicBool,
) {
    emit(app, win, "voice:loading", json!({ "sessionId": session_id }));
    let ctx = match asr::load(model) {
        Ok(ctx) => ctx,
        Err(message) => {
            log::record("voice", &message);
            emit(app, win, "voice:error", json!({ "sessionId": session_id, "message": message }));
            super::finish(win, session_id);
            return;
        }
    };
    // 装载模型要几秒，这期间用户可能已经按了停止。
    if stop.load(Ordering::Relaxed) {
        emit(app, win, "voice:done", json!({ "sessionId": session_id, "text": "" }));
        super::finish(win, session_id);
        return;
    }
    emit(app, win, "voice:started", json!({ "sessionId": session_id }));

    let frame_len = ((rate as f32 * 0.03) as usize).max(1);
    let frame_ms = frame_len as f32 * 1000.0 / rate as f32;
    let lang = match language {
        "zh" => Some("zh"),
        "en" => Some("en"),
        _ => None,
    };

    let mut segment: Vec<f32> = Vec::new();
    let mut committed = String::new();
    let mut prompt = String::new();
    let mut speech_ms = 0.0f32;
    let mut silence_ms = 0.0f32;
    let mut noise = 0.006f32;
    let mut warmup = 0.0f32;
    let mut level = 0.0f32;
    let mut last_level = Instant::now();

    loop {
        if cancel.load(Ordering::Relaxed) {
            super::finish(win, session_id);
            return;
        }

        let drained = {
            let mut b = lock(buf);
            std::mem::take(&mut *b)
        };
        if drained.is_empty() {
            level *= 0.85;
        }
        for frame in drained.chunks(frame_len) {
            let rms = (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt();
            level = level * 0.6 + rms * 0.4;

            // 开头几百毫秒只量本底噪声，不判说话 —— 否则安静房间会被固定阈值判成一直在说。
            warmup += frame_ms;
            if warmup <= 300.0 {
                noise = noise * 0.8 + rms * 0.2;
                continue;
            }

            let threshold = (noise * 2.8).clamp(0.006, 0.04);
            // 已经开始说话就用更低的门限，免得句子中间的轻声把一段切成两段。
            let speech = if speech_ms > 0.0 { rms > threshold * 0.55 } else { rms > threshold };
            if !speech && speech_ms == 0.0 {
                noise = noise * 0.95 + rms * 0.05;
            }

            if speech {
                speech_ms += frame_ms;
                silence_ms = 0.0;
            } else if speech_ms > 0.0 {
                silence_ms += frame_ms;
            }
            if speech_ms > 0.0 {
                segment.extend_from_slice(frame);
            }

            let long_enough = segment.len() as f32 / rate as f32 >= MAX_SEGMENT_SECS;
            let paused = silence_ms >= SILENCE_MS && speech_ms >= MIN_SPEECH_MS;
            // 一声短响（咳嗽 / 碰麦）凑不够语音长度，后面全是静音 —— 丢掉，别攒到 7 秒去喂模型。
            let noise_only = silence_ms >= SILENCE_MS && speech_ms < MIN_SPEECH_MS;
            if (long_enough && speech_ms > 0.0) || paused {
                let keep = if paused { trim_silence(&segment, silence_ms, rate) } else { segment.len() };
                flush(
                    app, win, session_id, &ctx, &segment[..keep], rate, lang, &prompt, &mut committed,
                );
                prompt = tail(&committed);
                segment.clear();
                speech_ms = 0.0;
                silence_ms = 0.0;
            } else if noise_only {
                segment.clear();
                speech_ms = 0.0;
                silence_ms = 0.0;
            }
        }

        if last_level.elapsed().as_millis() >= LEVEL_MS {
            last_level = Instant::now();
            emit(
                app,
                win,
                "voice:level",
                json!({ "sessionId": session_id, "level": level.min(1.0) }),
            );
        }

        if stop.load(Ordering::Relaxed) {
            if speech_ms >= MIN_SPEECH_MS && !segment.is_empty() {
                let keep = trim_silence(&segment, silence_ms, rate);
                flush(app, win, session_id, &ctx, &segment[..keep], rate, lang, &prompt, &mut committed);
            }
            emit(app, win, "voice:done", json!({ "sessionId": session_id, "text": committed }));
            super::finish(win, session_id);
            return;
        }

        std::thread::sleep(Duration::from_millis(40));
    }
}

#[allow(clippy::too_many_arguments)]
fn flush(
    app: &AppHandle,
    win: &str,
    session_id: &str,
    ctx: &whisper_rs::WhisperContext,
    segment: &[f32],
    rate: u32,
    language: Option<&str>,
    prompt: &str,
    committed: &mut String,
) {
    if segment.len() < 1600 {
        return;
    }
    let samples = resample_to_16k(segment, rate);
    let text = match asr::transcribe(ctx, &samples, language, Some(prompt)) {
        Ok(t) => t,
        Err(message) => {
            log::record("voice", &message);
            return;
        }
    };
    if text.is_empty() {
        return;
    }
    if !committed.is_empty() && needs_space(committed, &text) {
        committed.push(' ');
    }
    committed.push_str(&text);
    emit(app, win, "voice:partial", json!({ "sessionId": session_id, "text": committed }));
}

/// 段尾那截静音只留 400ms：whisper 在长静音上容易吐「谢谢观看」之类的幻觉。
fn trim_silence(segment: &[f32], silence_ms: f32, rate: u32) -> usize {
    let cut = (silence_ms.min(400.0) / 1000.0 * rate as f32) as usize;
    segment.len().saturating_sub(cut)
}

/// 上一段的末尾当下一段的 prompt —— 人名 / 术语在段间才不会翻成同音字。
fn tail(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let start = chars.len().saturating_sub(120);
    chars[start..].iter().collect()
}

/// 中文不加空格；两边都是拉丁字母 / 数字时才补一个。
fn needs_space(left: &str, right: &str) -> bool {
    let a = left.chars().last();
    let b = right.chars().next();
    matches!((a, b), (Some(a), Some(b)) if a.is_ascii_alphanumeric() && b.is_ascii_alphanumeric())
}

/// 线性插值就够：语音识别对重采样精度不敏感，缺的是模型本身。
fn resample_to_16k(input: &[f32], from_rate: u32) -> Vec<f32> {
    if from_rate == 16_000 || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / 16_000.0;
    let out_len = (input.len() as f64 / ratio) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let i0 = pos.floor() as usize;
        let i1 = (i0 + 1).min(input.len() - 1);
        let frac = (pos - i0 as f64) as f32;
        out.push(input[i0] * (1.0 - frac) + input[i1] * frac);
    }
    out
}

fn emit(app: &AppHandle, win: &str, event: &str, payload: serde_json::Value) {
    let _ = app.emit_to(EventTarget::webview_window(win), event, payload);
}
