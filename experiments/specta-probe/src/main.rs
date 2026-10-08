//! tauri-specta 实测：Result<T, ApiError> 的 TS 形状。
use serde::{Deserialize, Serialize};
use specta::Type;
use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};

/// 契约里的 ApiError = { code, message }
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DocMeta {
    pub id: String,
    pub title: String,
    pub tags: Vec<String>,
}

#[tauri::command]
#[specta::specta]
fn doc_get(id: String) -> Result<DocMeta, ApiError> {
    if id.is_empty() {
        return Err(ApiError { code: "not_found".into(), message: "empty".into() });
    }
    Ok(DocMeta { id, title: "t".into(), tags: vec![] })
}

#[tauri::command]
#[specta::specta]
fn doc_count() -> u32 {
    0
}

/// CONVENTIONS §一：Rust command 一律 ns:method 形式（`doc:apply`）。
#[tauri::command(rename = "doc:apply")]
#[specta::specta]
fn doc_apply(id: String, patch_json: String) -> Result<u32, ApiError> {
    let _ = (id, patch_json);
    Ok(1)
}

fn main() {
    let out = std::env::args().nth(1).expect("usage: specta-probe <out.ts>");
    let builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![doc_get, doc_count, doc_apply]);
    builder.export(Typescript::default(), &out).expect("export failed");
    println!("EXPORT OK -> {out}");
}
