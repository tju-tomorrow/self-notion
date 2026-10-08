//! web 版 AI 面板（D-0074）：往主窗口里叠一个**常驻**的原生子 webview，装 deepseek /
//! chatgpt 的网页版，并往它页面里注入文字。
//!
//! **常驻是硬要求**（用户 2026-10-07：「一次登录就可以，长时间保活、永久保活」）：
//! 所以面板收起是 `hide()` 不是 `close()` —— 页面和当前对话都留在内存里，再打开是原样。
//! 就算某天被系统回收，登录也还在：cookie 落在 WKWebView 的持久 data store 里（重启也在）。
//!
//! 子 webview 的 label 是 `aiweb-<窗口 label>`（见 `labels`），**不在 capabilities 的
//! `windows` 里** —— 那个外部页面拿不到任何 Tauri 权限。别人的网页不该碰我们的 IPC。

use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, webview::PageLoadEvent};
use std::sync::Mutex;

/// 面板 / 朗读两个子 webview 的 label。**带窗口前缀**：面板是**每个窗口一份** ——
/// 写死 `aiweb` 的话，第二个窗口点开面板会盖在主窗口上（多窗口 D-0019）。
fn labels(win: &str) -> (String, String) {
    (format!("aiweb-{win}"), format!("aivoice-{win}"))
}

/// 朗读那个 webview 摆哪儿。**摆窗口外而不是 `hide()`**：藏起来的 WebKit view 会把
/// 定时器和媒体一起掐掉，那样就等不到回复、也放不出声。
const VOICE_AT: (f64, f64) = (-20000.0, 0.0);
const VOICE_SIZE: (f64, f64) = (1000.0, 800.0);

/// 面板要多大、放哪儿（逻辑像素，相对窗口）。**由前端量出来**：面板那一列的位置是布局说了算，
/// Rust 这边硬编一个数字，改布局就错位。
#[derive(serde::Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(serde::Deserialize)]
pub struct ShowArgs {
    pub url: String,
    #[serde(flatten)]
    pub rect: Rect,
}

#[derive(serde::Deserialize)]
pub struct InjectArgs {
    pub text: String,
}

/// `aiweb:voice-tick` 的入参。空串 = 接着上一次往下推（见 `voice_tick`）。
#[derive(serde::Deserialize)]
pub struct VoiceArgs {
    #[serde(default)]
    pub text: String,
}

/// 显示面板并摆到 `rect`。已经建过就不重建。
pub fn show(app: &tauri::AppHandle, win: &str, a: ShowArgs) -> Result<(), String> {
    if a.rect.w < 1.0 || a.rect.h < 1.0 {
        return Err("面板尺寸是 0".into());
    }
    let (label, _) = labels(win);
    let url: tauri::Url = a.url.parse().map_err(|e| format!("url 不合法：{e}"))?;
    let pos = LogicalPosition::new(a.rect.x, a.rect.y);
    let size = LogicalSize::new(a.rect.w, a.rect.h);

    match app.get_webview(&label) {
        Some(wv) => {
            // ★ 只有**换了站点**才导航。同一个站点再导航一次会把当前对话冲掉 ——
            //   比对 host 不比对整个 URL：SPA 会自己改 path，整串比会一直判成"变了"。
            let same_site = wv
                .url()
                .ok()
                .map(|cur| cur.host_str() == url.host_str())
                .unwrap_or(false);
            if !same_site {
                wv.navigate(url).map_err(|e| e.to_string())?;
            }
            wv.set_position(pos).map_err(|e| e.to_string())?;
            wv.set_size(size).map_err(|e| e.to_string())?;
            wv.show().map_err(|e| e.to_string())?;
        }
        None => {
            let window = app.get_window(win).ok_or("那个窗口不见了")?;
            window
                .add_child(
                    WebviewBuilder::new(label, WebviewUrl::External(url)),
                    pos,
                    size,
                )
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// 收起面板 —— **只是看不见，不销毁**。登录和当前对话都留着（见文件头）。
pub fn hide(app: &tauri::AppHandle, win: &str) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&labels(win).0) {
        wv.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 真销毁。下一次 `show` 会重新建一个（重新加载 + 回到登录态，cookie 仍在）。给「重载」用。
pub fn close(app: &tauri::AppHandle, win: &str) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&labels(win).0) {
        let _ = wv.close();
    }
    Ok(())
}

/// 把页面里像输入框的东西列出来，回给那个窗口（`aiweb:probe`）。排错用。
pub fn probe(app: &tauri::AppHandle, win: &str) -> Result<(), String> {
    eval(app, win, &labels(win).0, PROBE_JS, "aiweb:probe")
}

/// 朗读**一步一步**推进（`aiweb:voice-tick`）：`text` 非空 = 这一轮开始（送进去并回车），
/// 空 = 继续推进上一轮（等回复 → 点朗读 → 再点一次是停）。
///
/// 为什么拆成多次：wry 的 `eval_with_callback` **不等 Promise**，等待只能靠前端定时再来一次。
pub fn voice_tick(app: &tauri::AppHandle, win: &str, text: &str) -> Result<(), String> {
    let voice = labels(win).1;
    ensure_voice(app, win, &voice)?;
    // 页面还没就绪：这一拍**不 eval**（丢了就没回执），只回一句「还在加载」—— 前端接着等。
    if !VOICE_READY.lock().map(|s| s.contains(&voice)).unwrap_or(false) {
        return emit_step(app, win, serde_json::json!({ "stage": "booting" }));
    }
    let lit = serde_json::to_string(text).map_err(|e| e.to_string())?;
    eval(app, win, &voice, &VOICE_JS.replace("__TEXT__", &lit), "aiweb:voice")
}

/// 自己发一条朗读回执（不经过页面）。形状和 `VOICE_JS` 的返回一致 —— 前端只有一套解析。
/// ★ 页面那条路（`eval_with_callback`）回的是**字符串**（wry 把结果 JSON 化成字符串），
///   这里也得发字符串 —— 发一个对象过去，前端 `JSON.parse(对象)` 当场 bad-json。
fn emit_step(app: &tauri::AppHandle, win: &str, step: serde_json::Value) -> Result<(), String> {
    app.emit_to(
        tauri::EventTarget::webview_window(win),
        "aiweb:voice",
        step.to_string(),
    )
    .map_err(|e| e.to_string())
}

/// 页面**就绪了没**，按 label 记（每个窗口一个朗读 view）。没就绪就别 eval —— wry 在页面
/// 加载完成前丢掉的 eval，回调**永远不会来**，前端那边看到的就是「没收到回执」
/// （用户 2026-10-07 那次就是：朗读那个 view 是点的时候才建的，页面还在加载，头几拍全白打）。
static VOICE_READY: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn ensure_voice(app: &tauri::AppHandle, win: &str, voice: &str) -> Result<(), String> {
    if app.get_webview(voice).is_some() {
        return Ok(());
    }
    let url: tauri::Url = VOICE_URL.parse().map_err(|e| format!("url 不合法：{e}"))?;
    let window = app.get_window(win).ok_or("那个窗口不见了")?;
    if let Ok(mut set) = VOICE_READY.lock() {
        set.retain(|l| l != voice);
    }
    let ready = voice.to_string();
    window
        .add_child(
            WebviewBuilder::new(voice, WebviewUrl::External(url)).on_page_load(
                move |_wv, payload| {
                    if matches!(payload.event(), PageLoadEvent::Finished) {
                        if let Ok(mut set) = VOICE_READY.lock() {
                            if !set.contains(&ready) {
                                set.push(ready.clone());
                            }
                        }
                    }
                },
            ),
            LogicalPosition::new(VOICE_AT.0, VOICE_AT.1),
            LogicalSize::new(VOICE_SIZE.0, VOICE_SIZE.1),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 把朗读那个页面**摆出来给人看**（面板那一列）。用户：「弹出那个页面也可以 让我盯着看」。
pub fn voice_show(app: &tauri::AppHandle, win: &str, r: Rect) -> Result<(), String> {
    if r.w < 1.0 || r.h < 1.0 {
        return Err("面板尺寸是 0".into());
    }
    let voice = labels(win).1;
    ensure_voice(app, win, &voice)?;
    let wv = app.get_webview(&voice).ok_or("朗读那个 webview 没建起来")?;
    wv.set_position(LogicalPosition::new(r.x, r.y)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(r.w, r.h)).map_err(|e| e.to_string())?;
    wv.show().map_err(|e| e.to_string())
}

/// 收起来：**挪回窗口外，不是 `hide()`**（用户：「关闭不丢声音」）。
/// 藏起来的 WebKit view 会把定时器和媒体一起掉（文件头那句）—— 挪走它照旧在放。
pub fn voice_hide(app: &tauri::AppHandle, win: &str) -> Result<(), String> {
    let Some(wv) = app.get_webview(&labels(win).1) else {
        return Ok(());
    };
    wv.set_position(LogicalPosition::new(VOICE_AT.0, VOICE_AT.1)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(VOICE_SIZE.0, VOICE_SIZE.1)).map_err(|e| e.to_string())?;
    Ok(())
}

/// 朗读走哪家。暂时只有 deepseek —— 它的回复下面那颗朗读按钮是我们唯一能用的 TTS。
const VOICE_URL: &str = "https://chat.deepseek.com/";

/// 往输入框塞一段字（**不发送**，用户自己按回车）。回 `aiweb:inject`，
/// 里面说清用的是哪条选择器、还是压根没找到 —— 前端据此决定要不要退到剪贴板。
pub fn inject(app: &tauri::AppHandle, win: &str, text: &str) -> Result<(), String> {
    // 用 serde_json 生成合法的 JS 字符串字面量，省得手写转义把中文 / 引号搞坏。
    let lit = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into());
    eval(app, win, &labels(win).0, &INJECT_JS.replace("__TEXT__", &lit), "aiweb:inject")
}

/// 求值结果（wry 已经把返回值 JSON 化了）原样转给**发起那次调用的窗口**。
/// 异常在 macOS 上会被吞掉，所以脚本自己把成败包成对象返回，别依赖抛错。
fn eval(
    app: &tauri::AppHandle,
    win: &str,
    label: &str,
    js: &str,
    event: &'static str,
) -> Result<(), String> {
    let wv = app.get_webview(label).ok_or("面板还没开")?;
    let app = app.clone();
    let win = win.to_string();
    wv.eval_with_callback(js, move |result| {
        let _ = app.emit_to(tauri::EventTarget::webview_window(win.clone()), event, result);
    })
    .map_err(|e| e.to_string())
}

const PROBE_JS: &str = r#"(function () {
  function sel(el) {
    var cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + cls;
  }
  function vis(el) {
    var r = el.getBoundingClientRect();
    return (r.width > 0 || r.height > 0) && !el.disabled;
  }
  var out = { url: location.href, title: document.title, textareas: [], editables: [] };
  var tas = document.querySelectorAll('textarea');
  for (var i = 0; i < tas.length; i++) {
    out.textareas.push({ sel: sel(tas[i]), visible: vis(tas[i]),
      ph: tas[i].placeholder || tas[i].getAttribute('data-placeholder') || '' });
  }
  var ces = document.querySelectorAll('[contenteditable="true"],[contenteditable=""]');
  for (var j = 0; j < ces.length; j++) {
    out.editables.push({ sel: sel(ces[j]), visible: vis(ces[j]),
      ph: ces[j].getAttribute('data-placeholder') || ces[j].getAttribute('aria-label') || '' });
  }
  return out;
})()"#;

// 注入：**按顺序试选择器、跳过不可见的**（业界标准做法，见 D-0074 的调研）。
// ChatGPT 的输入框是 `#prompt-textarea`（一个 contenteditable 的 div），DeepSeek 是 textarea。
// React / ProseMirror 都是受控的：textarea 必须走原生 setter + 派发 input，
// contenteditable 必须走 execCommand('insertText')，直接改 innerText 它们读不到。
const INJECT_JS: &str = r#"(function (text) {
  var sels = ['#prompt-textarea', 'textarea[placeholder]', 'textarea', '[contenteditable="true"]'];

  function usable(el) {
    if (!el || el.disabled) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  function put(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
      return;
    }
    // contenteditable：全选现有内容再 insertText，等于替换 —— 不然会追加到上次的草稿后面。
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text);
    el.focus();
  }

  for (var i = 0; i < sels.length; i++) {
    var nodes = document.querySelectorAll(sels[i]);
    for (var j = 0; j < nodes.length; j++) {
      if (!usable(nodes[j])) continue;
      try {
        put(nodes[j]);
        return { ok: true, how: sels[i] };
      } catch (e) {
        return { ok: false, how: sels[i], err: String(e) };
      }
    }
  }
  return { ok: false, how: 'none' };
})(__TEXT__)"#;

// ────────────────────────────── 朗读那一步的脚本（D-0081） ──────────────────────────────

// 一次调用推进一步，状态挂在页面的 `window.__selfNotionVoice` 上（每次 eval 都是新的作用域，
// 只有 window 上的东西留得住）。返回的那个对象由前端解析 —— 见 `plugins/ai-web/voice.ts`。
//
// 找「朗读」按钮这件事**没有写死的选择器**：DeepSeek 的 class 是哈希的，一改就废。
// 先按 aria-label / title / svg 里的名字找，找不到就把**所有候选**回传，前端记进 errors.log，
// 下一次照着真实 DOM 调匹配规则。这是这类「借别人的网页当后端」唯一站得住的写法。
const VOICE_JS: &str = r#"(function (text) {
  var S = window.__selfNotionVoice;
  if (!S) {
    S = window.__selfNotionVoice = { stage: 'idle', n: 0, prev: '', stable: 0, want: '' };
  }

  function shown(el) {
    if (!el || el.disabled) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  // 助手回复的根。DeepSeek 是 `.ds-markdown`，ChatGPT 是 data-message-author-role。
  function answers() {
    return document.querySelectorAll('.ds-markdown, [data-message-author-role="assistant"]');
  }

  function lastAnswer() {
    var a = answers();
    return a.length ? a[a.length - 1] : null;
  }

  function composer() {
    var sels = ['textarea[placeholder]', 'textarea', '#prompt-textarea', '[contenteditable="true"]'];
    for (var i = 0; i < sels.length; i++) {
      var ns = document.querySelectorAll(sels[i]);
      for (var j = 0; j < ns.length; j++) if (shown(ns[j])) return ns[j];
    }
    return null;
  }

  // React 受控组件：textarea 必须走原生 setter + input 事件，contenteditable 走 insertText。
  function put(el, s) {
    if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') {
      el.focus();
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, s);
      return;
    }
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, s);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  }

  // 发送键。点那颗发送按钮要认图标，回车不用 —— 两家的 composer 都吃 Enter。
  function enter(el) {
    el.focus();
    var k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', k));
    el.dispatchEvent(new KeyboardEvent('keyup', k));
  }

  function labelOf(el) {
    var use = el.querySelector('use');
    var href = use ? (use.getAttribute('xlink:href') || use.getAttribute('href') || '') : '';
    return [
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.getAttribute('data-testid') || '',
      href,
      typeof el.className === 'string' ? el.className : '',
    ].join(' ');
  }

  function stillWriting() {
    var bs = document.querySelectorAll('button, div[role="button"]');
    for (var i = 0; i < bs.length; i++) {
      var a = (bs[i].getAttribute('aria-label') || '') + ' ' + (bs[i].getAttribute('title') || '');
      if (shown(bs[i]) && /停止|stop generating|interrupt/i.test(a)) return true;
    }
    return false;
  }

  var READ = /朗读|阅读|播放|停止|read aloud|listen|speak|speaker|volume|audio|voice|sound/i;
  // 「就是那颗」的长相：先认这几个字，认不到才退到上面那个大网。
  var STRICT = /朗读|read aloud|listen|speak/i;
  // 候选元素。**不只 button**：那颗按钮的 `aria-label` 可能挂在一个 span / svg / 没 role 的 div 上
  // （用户 2026-10-07 给的原话：「aria-label="朗读"」）—— 只查 button 会整页看不见它。
  var CAND = 'button, [role="button"], [aria-label], [title], [class*="icon"], svg';

  function scan(scope) {
    var out = [];
    var bs = scope.querySelectorAll(CAND);
    for (var i = 0; i < bs.length; i++) {
      var el = bs[i];
      if (!shown(el)) continue;
      var hay = labelOf(el);
      out.push({ tag: el.tagName.toLowerCase(), hay: hay.slice(0, 160), hit: READ.test(hay) });
    }
    return out;
  }

  // 朗读按钮**未必在正文块里**，多半是它旁边那条动作条上的兄弟 —— 所以往上爬几层再找。
  // 爬到顶都没有就**全页兜底**（`wide`，只给「开读」用）：取最后一个可见的
  // （最新的那条回复的动作条排在最后），其中又优先取字面就是「朗读」的那种
  // （全页那个「停止生成」不该被当成朗读按钮）。
  // ★ 「停读」不许用兜底（`wide = false`）：不然会点到别条消息的朗读按钮上，变成又开一段。
  function findRead(el, wide) {
    var scope = el;
    for (var up = 0; up < 8 && scope; up++) {
      var bs = scope.querySelectorAll(CAND);
      for (var i = 0; i < bs.length; i++) {
        if (shown(bs[i]) && READ.test(labelOf(bs[i]))) return bs[i];
      }
      scope = scope.parentElement;
    }
    if (!wide) return null;
    var all = document.querySelectorAll(CAND);
    var loose = null;
    var strict = null;
    for (var k = 0; k < all.length; k++) {
      if (!shown(all[k])) continue;
      var hay = labelOf(all[k]);
      if (!READ.test(hay)) continue;
      loose = all[k];
      if (STRICT.test(hay)) strict = all[k];
    }
    return strict || loose || hiddenRead();
  }

  // 最后一层：动作条是 **hover 才显形**的时候（display:none 的 rect 是 0，上面全筛掉了）。
  // 忽略可见性，但**只认字面就是「朗读」**的那种 —— 藏着的「停止生成」不能被当成它。
  function hiddenRead() {
    var all = document.querySelectorAll(CAND);
    var hit = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].disabled) continue;
      if (STRICT.test(labelOf(all[i]))) hit = all[i];
    }
    return hit;
  }

  // 命中的可能是个裹在里面的图标 —— 真能点的往往是它外面那层。
  function clickIt(el) {
    var t = (el.closest && el.closest('button, [role="button"]')) || el;
    t.click();
  }

  // 藏起来 / hover 才显形的「停止」—— 只认这个字面，别把藏着的「朗读」当成停。
  function hiddenStop() {
    var all = document.querySelectorAll(CAND);
    var hit = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].disabled) continue;
      if (/停止|stop/i.test(labelOf(all[i]))) hit = all[i];
    }
    return hit;
  }

  // ── 声音本身的状态（D-0112）────────────────────────────────────────────────
  // 那颗「停止」按钮会随着页面自己重渲染消失（用户 2026-10-07：「其实是播放状态 但是页面已经
  // 还原了 没有停止按钮」）—— 所以**别把按钮当真相**，直接问页面：还有没有东西在响。
  function playing() {
    var ms = document.querySelectorAll('audio, video');
    for (var i = 0; i < ms.length; i++) {
      if (!ms[i].paused && !ms[i].ended && ms[i].currentTime > 0) return true;
    }
    try {
      if (window.speechSynthesis && window.speechSynthesis.speaking) return true;
    } catch (e) {}
    return false;
  }

  // 按钮没了就**直接捏声音**。
  function forceStop() {
    var ms = document.querySelectorAll('audio, video');
    for (var i = 0; i < ms.length; i++) {
      try {
        ms[i].pause();
        ms[i].currentTime = 0;
      } catch (e) {}
    }
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) {}
  }

  /** 每条回执都带上「现在还在响吗」—— 前端那颗按钮据此回到「朗读这篇」。 */
  function out(o) {
    o.playing = playing();
    return o;
  }

  // ── 送一段字进去（这一轮的起点）──────────────────────────────────────────────
  if (text) {
    var box = composer();
    if (!box) {
      S.stage = 'fail';
      return out({ stage: 'fail', why: 'no-input', url: location.href, title: document.title });
    }
    put(box, text);
    enter(box);
    S.want = text;
    S.n = answers().length;
    S.prev = '';
    S.stable = 0;
    S.stage = 'wait';
    return out({ stage: 'sent', n: S.n });
  }

  // ── 之后每一次调用往下推一格 ─────────────────────────────────────────────────
  if (S.stage === 'idle' || S.stage === 'fail') return out({ stage: S.stage });
  if (S.stage === 'done') {
    // 已经读上了：再点一次那颗按钮就是停（它这会儿叫「停止」）。
    // ★ 按钮找不着**不等于没在放** —— 页面一重渲染那条动作条就没了。那就直接捏声音。
    var stop = lastAnswer() ? findRead(lastAnswer(), false) : null;
    if (!stop) stop = hiddenStop();
    if (stop) clickIt(stop);
    else forceStop();
    S.stage = 'idle';
    return out({ stage: 'stopped' });
  }

  if (S.stage === 'wait') {
    var rs = answers();
    if (rs.length <= S.n) return out({ stage: 'waiting', n: rs.length });
    if (stillWriting()) {
      S.prev = '';
      S.stable = 0;
      return out({ stage: 'generating' });
    }
    // 连续两次一模一样才算写完 —— 光看「停止生成」没了会拿到半截。
    var t = rs[rs.length - 1].innerText || '';
    if (t.length > 0 && t === S.prev) S.stable++;
    else {
      S.prev = t;
      S.stable = 0;
    }
    if (S.stable < 2) return out({ stage: 'waiting', stable: S.stable, len: t.length });
    S.stage = 'click';
    return out({ stage: 'ready', len: t.length, same: t.trim() === S.want.trim() });
  }

  if (S.stage === 'click') {
    var last = lastAnswer();
    if (!last) return out({ stage: 'fail', why: 'no-answer' });
    var btn = findRead(last, true);
    if (!btn) {
      S.stage = 'fail';
      return out({ stage: 'fail', why: 'no-button', buttons: scan(last.parentElement || last).slice(0, 30) });
    }
    clickIt(btn);
    S.stage = 'done';
    return out({ stage: 'clicked', how: labelOf(btn).slice(0, 120) });
  }

  return out({ stage: S.stage });
})(__TEXT__)"#;
