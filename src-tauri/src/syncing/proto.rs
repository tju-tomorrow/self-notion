//! 同步接口的线上形状（docs/mobile-web-sync.md §4）。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushBody {
    #[serde(default)]
    #[allow(dead_code)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub docs: Vec<PushDoc>,
    #[serde(default)]
    pub sources: Vec<PushSource>,
    #[serde(default)]
    pub comments: Vec<PushComment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushComment {
    pub id: String,
    /// put / delete
    #[serde(default = "put")]
    pub mode: String,
    #[serde(default)]
    pub doc_id: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub anchor: String,
    #[serde(default)]
    pub block_id: Option<String>,
    #[serde(default)]
    pub quote: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub resolved: bool,
    #[serde(default)]
    pub created_at: Option<i64>,
    /// 最后写入者胜的判据；0 = 没带，按现在算。
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentPushResult {
    pub id: String,
    pub status: &'static str,
    pub comment: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushSource {
    pub id: String,
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushDoc {
    pub id: String,
    /// put / trash / restore / hardDelete
    #[serde(default = "put")]
    pub mode: String,
    #[serde(default)]
    pub base_rev: i64,
    /// 客户端上次同步时那份正文 —— 三方合并的 base。
    pub base_content: Option<String>,
    pub content: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub md: String,
    pub parent_id: Option<String>,
    pub icon: Option<String>,
    pub sort_order: Option<f64>,
    pub is_favorite: Option<bool>,
    pub pinned_at: Option<i64>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub deleted_at: Option<i64>,
    pub tags: Option<Vec<String>>,
}

fn put() -> String {
    "put".into()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub id: String,
    pub status: &'static str,
    pub rev: i64,
    pub content: Option<String>,
    pub md: Option<String>,
    pub meta: Option<serde_json::Value>,
}

impl PushResult {
    pub fn accepted(
        id: &str,
        rev: i64,
        content: Option<String>,
        md: Option<String>,
        meta: Option<serde_json::Value>,
    ) -> Self {
        Self { id: id.into(), status: "accepted", rev, content, md, meta }
    }

    pub fn merged(
        id: &str,
        rev: i64,
        content: Option<String>,
        md: Option<String>,
        meta: Option<serde_json::Value>,
    ) -> Self {
        Self { id: id.into(), status: "merged", rev, content, md, meta }
    }

    pub fn conflict(
        id: &str,
        rev: i64,
        content: Option<String>,
        md: Option<String>,
        meta: Option<serde_json::Value>,
    ) -> Self {
        Self { id: id.into(), status: "conflict", rev, content, md, meta }
    }

    pub fn deleted(id: &str) -> Self {
        Self { id: id.into(), status: "deleted", rev: 0, content: None, md: None, meta: None }
    }
}

#[derive(Debug, Default, Deserialize)]
pub struct ChangesQuery {
    pub since: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairBody {
    pub code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBody {
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub message: String,
}
