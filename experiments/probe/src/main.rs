//! 最小 Tauri 壳：CSP 与自定义协议实测。
//! CSP 与 src-tauri/tauri.conf.json 逐字一致。

use tauri::http::Response;

#[tauri::command(rename = "probe:echo")]
fn probe_echo() -> String {
    "echo-ok".to_string()
}

#[tauri::command]
fn report(payload: String) {
    println!("\n===== PROBE RESULT BEGIN =====");
    println!("{payload}");
    println!("===== PROBE RESULT END =====\n");
    std::process::exit(0);
}

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("self-notion", |_ctx, req| {
            println!("[rust] self-notion:// hit: {}", req.uri());
            Response::builder()
                .header("Content-Type", "image/png")
                .header("Access-Control-Allow-Origin", "*")
                .body(include_bytes!("pixel.png").to_vec())
                .unwrap()
        })
        .invoke_handler(tauri::generate_handler![report, probe_echo])
        .run(tauri::generate_context!())
        .expect("error running csp-probe");
}
