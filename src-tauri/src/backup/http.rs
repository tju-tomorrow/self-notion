//! ★ **唯一的 HTTP 出口。** 全仓库的网络调用（备份、内置 AI）都从这一个函数过：
//! 输入 url + headers + body，输出 status + body，别的什么都不做。
//! 换 HTTP 客户端 = 只改这一个文件（D-0026 的「纯 HTTP」落点）。
//!
//! ── 关于依赖 ─────────────────────────────────────────────────────────────────
//! `reqwest` 在 `Cargo.toml` 里是 `default-features = false` + `["blocking", "native-tls"]`
//! （GitHub API 只有 HTTPS，必须显式给一个 TLS 后端）。`blocking`：命令分派是**同步**的，
//! 用阻塞客户端就不用自己搭 tokio runtime。

use std::error::Error as _;
use std::io::Read;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

/// 一次 HTTP 往返的结果。**只有** status 和 body —— 要什么解析由调用方来。
pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
    pub headers: Vec<(String, String)>,
}

const ATTEMPTS: u32 = 3;
const TIMEOUT: Duration = Duration::from_secs(30);

/// ★ **全局一个 Client。** 原来每次调用新建一个 blocking Client —— 那等于每次起一个后台
/// runtime + 一条线程 + 一个空连接池，几百个 blob 的备份会把这堆东西攒成几百份。
/// 备份是串行的，一个 Client 足够（连接池复用，少一轮 TLS 握手）。
fn client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(TIMEOUT)
            .build()
            .expect("HTTP client 建不起来（TLS 后端初始化失败）")
    })
}

/// reqwest 的 `Display` 只有一句「error sending request for url (...)」—— **真正的原因在
/// `source()` 里**（连接被重置 / TLS / 超时）。原来只取 `to_string()`，于是日志里永远只有
/// 那句废话，谁也判断不了是不是网络。这里把整条链拼出来。
fn chain(e: &reqwest::Error) -> String {
    let mut out = e.to_string();
    let mut src = e.source();
    while let Some(s) = src {
        out.push_str(" ← ");
        out.push_str(&s.to_string());
        src = s.source();
    }
    out
}

/// 唯一的 HTTP 出口。`headers` 里给足（Authorization / Accept / User-Agent…），
/// `body` 给 `None` 就是没体（GET / PATCH 不带）。
///
/// 传输层失败（连不上 / 被重置 / 超时）**重试** `ATTEMPTS` 次，退避 300ms、900ms。
/// GitHub 偶发地掐连接，一次就放弃会让整次备份白跑。**只重试传输层** —— HTTP 状态码
/// （4xx / 5xx）原样返回给调用方，那不是「没发出去」。
///
/// ponytail: 幂等性靠调用方保证。备份那几个 POST（blobs / trees / commits）同内容重复发
/// 没有副作用（blob 按内容去重，tree / commit 是新建对象）。等要发**不幂等**的东西时，
/// 得先给这条加一个「要不要重试」的开关。
pub fn send(
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: Option<Vec<u8>>,
) -> Result<Response, String> {
    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("bad method {method}: {e}"))?;

    let mut last = String::new();
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            thread::sleep(Duration::from_millis(300 * 3u64.pow(attempt - 1)));
        }
        let mut req = client().request(m.clone(), url);
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(b) = &body {
            req = req.body(b.clone());
        }

        match req.send() {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let headers = collect_headers(&resp);
                let body = resp.bytes().map_err(|e| chain(&e))?.to_vec();
                return Ok(Response { status, body, headers });
            }
            Err(e) => last = chain(&e),
        }
    }
    Err(format!("发了 {ATTEMPTS} 次都没发出去：{last}"))
}

const QUICK_MAX_BYTES: u64 = 4 * 1024 * 1024;

fn quick(no_redirect: bool) -> &'static reqwest::blocking::Client {
    static FOLLOW: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    static PLAIN: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    let cell = if no_redirect { &PLAIN } else { &FOLLOW };
    cell.get_or_init(|| {
        let mut builder = reqwest::blocking::Client::builder().timeout(Duration::from_secs(6));
        if no_redirect {
            builder = builder.redirect(reqwest::redirect::Policy::none());
        }
        builder.build().expect("HTTP client 建不起来（TLS 后端初始化失败）")
    })
}

fn quick_call(
    client: &reqwest::blocking::Client,
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: Option<Vec<u8>>,
) -> Result<Response, String> {
    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|e| format!("bad method {method}: {e}"))?;
    let mut req = client.request(m, url);
    for (k, v) in headers {
        req = req.header(k.as_str(), v.as_str());
    }
    if let Some(b) = &body {
        req = req.body(b.clone());
    }
    let resp = req.send().map_err(|e| chain(&e))?;
    let status = resp.status().as_u16();
    let headers = collect_headers(&resp);
    // 搜索 / 读网页打的是外面的站点，回包大小不该无上限地往内存里灌。
    let mut body = Vec::new();
    resp.take(QUICK_MAX_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|e| e.to_string())?;
    if body.len() as u64 > QUICK_MAX_BYTES {
        return Err("回包太大（超过 4MB）".to_string());
    }
    Ok(Response { status, body, headers })
}

/// 短超时、不重试的一次往返。联网搜索要在几个公共实例之间轮着试，
/// 一个死站不能把整轮拖成 `send` 的 3 次 × 30 秒。
pub fn send_quick(
    method: &str,
    url: &str,
    headers: &[(String, String)],
    body: Option<Vec<u8>>,
) -> Result<Response, String> {
    quick_call(quick(false), method, url, headers, body)
}

/// 不自动跟随跳转 —— `web_read` 要自己检查每一跳，别被 302 带去内网。
pub fn send_quick_plain(
    method: &str,
    url: &str,
    headers: &[(String, String)],
) -> Result<Response, String> {
    quick_call(quick(true), method, url, headers, None)
}

fn collect_headers(resp: &reqwest::blocking::Response) -> Vec<(String, String)> {
    resp.headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect()
}
