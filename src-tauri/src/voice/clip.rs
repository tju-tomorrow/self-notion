//! 语音笔记的采集与转写（D-0215）。
//!
//! 跟 `audio.rs` 的实时草稿不同：这里不 VAD 分段，从按下到松开就是一段。
//! 停止时直接编码成 16k 单声道 WAV 落 blob —— 字节不过 IPC，也不进 JS 堆。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::audio::resample_to_16k;
use super::{asr, lock, model_bytes, model_path};
use crate::commands::{ApiError, ApiResult};
use crate::log;
use crate::store::blob;

/// 5 分钟。再长就不该是语音笔记了，而且 f32 缓冲会一直涨。
const MAX_SECS: f32 = 300.0;

struct Clip {
    stream: cpal::Stream,
    rate: u32,
    buf: Arc<Mutex<Vec<f32>>>,
}

/// 按窗口分开：一个窗口在录，不该掐掉另一个窗口的。
fn clips() -> &'static Mutex<HashMap<String, Clip>> {
    static C: OnceLock<Mutex<HashMap<String, Clip>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn start(win: &str) -> ApiResult<Value> {
    cancel(win);
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| ApiError::new("voice", "没有可用的麦克风"))?;
    let supported = device
        .default_input_config()
        .map_err(|e| ApiError::new("voice", format!("拿不到麦克风配置：{e}")))?;
    let format = supported.sample_format();
    let channels = supported.channels() as usize;
    let rate = supported.sample_rate();
    let config: StreamConfig = supported.into();

    let buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let max_samples = (rate as f32 * MAX_SECS) as usize;
    let err_fn = |e: cpal::Error| log::record("voice", &format!("采集出错：{e}"));
    let stream = build(&device, config, format, channels, max_samples, &buf, err_fn)
        .map_err(|e| ApiError::new("voice", e))?;
    stream
        .play()
        .map_err(|e| ApiError::new("voice", format!("启动麦克风失败：{e}")))?;

    lock(clips()).insert(win.to_string(), Clip { stream, rate, buf });
    Ok(json!({ "started": true }))
}

pub fn stop(win: &str, conn: &Connection) -> ApiResult<Value> {
    let Some(clip) = lock(clips()).remove(win) else {
        return Err(ApiError::new("voice", "当前没有正在录的音"));
    };
    let Clip { stream, rate, buf } = clip;
    drop(stream);
    let samples = std::mem::take(&mut *lock(&buf));
    if samples.is_empty() {
        return Err(ApiError::new("voice", "这段录音是空的"));
    }
    let duration = samples.len() as f32 / rate as f32;
    let wav = wav16(&resample_to_16k(&samples, rate), 16_000);
    let meta = blob::put(conn, &wav, "audio/wav")?;
    Ok(json!({ "id": meta.id, "duration": duration }))
}

pub fn cancel(win: &str) {
    if let Some(clip) = lock(clips()).remove(win) {
        drop(clip.stream);
    }
}

#[derive(Deserialize)]
struct BlobArg {
    id: String,
}

pub fn transcribe(app: Option<&AppHandle>, conn: &Connection, args: Value) -> ApiResult<Value> {
    let a: BlobArg =
        serde_json::from_value(args).map_err(|e| ApiError::new("bad_args", e.to_string()))?;
    let Some((_, bytes)) = blob::get(conn, &a.id)? else {
        return Err(ApiError::new("not_found", "找不到这段录音"));
    };
    let app = app.ok_or_else(|| ApiError::new("no_app", "这条命令需要窗口句柄"))?;
    let model = model_path(app)?;
    if model_bytes(&model) <= 1_000_000 {
        return Err(ApiError::new("model_missing", "语音模型还没下载"));
    }
    let (rate, samples) = decode_wav(&bytes).map_err(|e| ApiError::new("voice", e))?;
    let samples = resample_to_16k(&samples, rate);
    let ctx = asr::load(&model).map_err(|e| ApiError::new("voice", e))?;
    let text = asr::transcribe(&ctx, &samples, Some("zh"), None)
        .map_err(|e| ApiError::new("voice", e))?;
    Ok(json!({ "text": text }))
}

fn build(
    device: &cpal::Device,
    config: StreamConfig,
    format: SampleFormat,
    channels: usize,
    max_samples: usize,
    buf: &Arc<Mutex<Vec<f32>>>,
    err_fn: impl FnMut(cpal::Error) + Send + 'static,
) -> Result<cpal::Stream, String> {
    let stream = match format {
        SampleFormat::F32 => {
            let b = buf.clone();
            device.build_input_stream(
                config,
                move |d: &[f32], _| push(d.iter().copied(), channels, max_samples, &b),
                err_fn,
                None,
            )
        }
        SampleFormat::I16 => {
            let b = buf.clone();
            device.build_input_stream(
                config,
                move |d: &[i16], _| {
                    push(d.iter().map(|s| *s as f32 / 32768.0), channels, max_samples, &b);
                },
                err_fn,
                None,
            )
        }
        SampleFormat::U16 => {
            let b = buf.clone();
            device.build_input_stream(
                config,
                move |d: &[u16], _| {
                    push(
                        d.iter().map(|s| (*s as f32 - 32768.0) / 32768.0),
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
                move |d: &[i32], _| {
                    push(
                        d.iter().map(|s| *s as f32 / 2_147_483_648.0),
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
                move |d: &[f64], _| {
                    push(d.iter().map(|s| *s as f32), channels, max_samples, &b);
                },
                err_fn,
                None,
            )
        }
        other => return Err(format!("不支持的麦克风采样格式：{other:?}")),
    };
    stream.map_err(|e| format!("打不开麦克风：{e}"))
}

/// 混单声道。录满 5 分钟就不再往里塞 —— 宁可截断，也不偷偷丢掉开头。
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
            if out.len() < max_samples {
                out.push(acc / ch as f32);
            }
            acc = 0.0;
            n = 0;
        }
    }
}

fn wav16(samples: &[f32], rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// 只认我们自己写出来的 16-bit PCM WAV。
fn decode_wav(bytes: &[u8]) -> Result<(u32, Vec<f32>), String> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("不是 WAV 文件".into());
    }
    let mut pos = 12;
    let mut rate = 16_000u32;
    let mut channels = 1u16;
    let mut bits = 16u16;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let len = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 16 <= bytes.len() {
            channels = u16::from_le_bytes(bytes[body + 2..body + 4].try_into().unwrap()).max(1);
            rate = u32::from_le_bytes(bytes[body + 4..body + 8].try_into().unwrap());
            bits = u16::from_le_bytes(bytes[body + 14..body + 16].try_into().unwrap());
        } else if id == b"data" {
            if bits != 16 {
                return Err(format!("不支持的 WAV 位深：{bits}"));
            }
            let end = (body + len).min(bytes.len());
            let mut samples = Vec::with_capacity((end - body) / 2);
            for pair in bytes[body..end].chunks_exact(2) {
                samples.push(i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32768.0);
            }
            if channels > 1 {
                let ch = channels as usize;
                samples = samples
                    .chunks(ch)
                    .map(|one| one.iter().sum::<f32>() / one.len() as f32)
                    .collect();
            }
            return Ok((rate, samples));
        }
        pos = body + len + (len & 1);
    }
    Err("WAV 里没有 data 段".into())
}
