//! GitHub **Git Data API** 客户端（D-0026 第 1 条：blob → tree(base_tree) → commit → ref）。
//!
//! 只做备份需要的这几个动作。★ **所有 HTTP 都过 `super::http::send`** —— 换客户端只改那一个函数。
//! 这里只负责「拼 URL / 带头 / 认状态码」，不碰业务。

use super::http;
use crate::commands::{ApiError, ApiResult};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};

/// 分支的现状。三种，**不能只用一个 `Option` 表示** —— 空库和「分支名配错了」要走不同的
/// 补救动作（空库得用 Contents API 造首个 commit，缺分支只要建 ref）。
pub enum Head {
    /// 分支在 → `(commit sha, tree sha)`
    At(String, String),
    /// 仓库里**一个 commit 都没有**（GitHub 回 409）
    Empty,
    /// 仓库有 commit，但没有这个分支（GitHub 回 404）
    NoBranch,
}

pub struct Github {
    repo: String,
    branch: String,
    token: String,
}

impl Github {
    pub fn new(repo: &str, branch: &str, token: &str) -> Self {
        Self { repo: repo.to_string(), branch: branch.to_string(), token: token.to_string() }
    }

    fn url(&self, path: &str) -> String {
        format!("https://api.github.com/repos/{}{}", self.repo, path)
    }

    fn headers(&self) -> Vec<(String, String)> {
        vec![
            ("Authorization".into(), format!("Bearer {}", self.token)),
            ("Accept".into(), "application/vnd.github+json".into()),
            ("X-GitHub-Api-Version".into(), "2022-11-28".into()),
            // GitHub 强制要 User-Agent，缺了直接 403
            ("User-Agent".into(), "self-notion-backup".into()),
            ("Content-Type".into(), "application/json".into()),
        ]
    }

    /// 发 JSON，2xx 就把 body 反序列化成 `T`。
    fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> ApiResult<T> {
        let resp = self.round(method, path, body)?;
        serde_json::from_slice(&resp)
            .map_err(|e| ApiError::new("backup_decode", e.to_string()))
    }

    /// 发 JSON 但**不关心响应体**（PATCH ref 之类）。
    fn send_ok(&self, method: &str, path: &str, body: Option<Value>) -> ApiResult<()> {
        self.round(method, path, body).map(|_| ())
    }

    /// 用户级接口（`/user`、`/user/repos`）：URL 不带 `/repos/{repo}` 前缀，是绝对的。
    fn send_root<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> ApiResult<T> {
        let url = format!("https://api.github.com{path}");
        let resp = self.round_url(method, &url, body)?;
        serde_json::from_slice(&resp)
            .map_err(|e| ApiError::new("backup_decode", e.to_string()))
    }

    fn round(&self, method: &str, path: &str, body: Option<Value>) -> ApiResult<Vec<u8>> {
        self.round_url(method, &self.url(path), body)
    }

    /// 「用绝对 URL 发」的那一半 —— 仓库作用域和用户级共用同一份 headers / 状态码翻译。
    fn round_url(&self, method: &str, url: &str, body: Option<Value>) -> ApiResult<Vec<u8>> {
        let bytes = body.map(|b| b.to_string().into_bytes());
        let resp = http::send(method, url, &self.headers(), bytes)
            .map_err(|e| ApiError::new("backup_http", e))?;
        if (200..300).contains(&resp.status) {
            Ok(resp.body)
        } else {
            Err(github_err(resp.status, &resp.body))
        }
    }

    /// 分支头。空库 / 缺分支都**不是错误**，由调用方决定怎么补。
    pub fn head(&self) -> ApiResult<Head> {
        #[derive(Deserialize)]
        struct Sha {
            sha: String,
        }
        #[derive(Deserialize)]
        struct Ref {
            object: Sha,
        }
        #[derive(Deserialize)]
        struct Commit {
            tree: Sha,
        }

        match self.send::<Ref>("GET", &format!("/git/ref/heads/{}", self.branch), None) {
            Ok(r) => {
                let commit: Commit =
                    self.send("GET", &format!("/git/commits/{}", r.object.sha), None)?;
                Ok(Head::At(r.object.sha, commit.tree.sha))
            }
            // ★ 空仓库回的是 **409 "Git Repository is empty."**，不是 404 —— 新建的库首次推送
            //   就撞这个，而且**不止这一处**：blobs / trees / commits 全都 409。见 `bootstrap_empty`。
            Err(e) if e.code == "backup_conflict" => Ok(Head::Empty),
            Err(e) if e.code == "backup_not_found" => Ok(Head::NoBranch),
            Err(e) => Err(e),
        }
    }

    /// 空库引导：Git Data API 在一个 commit 都没有的仓库上**全线 409**，只能用 Contents API
    /// 落一个文件，把首个 commit 造出来（`POST /git/refs` 也不行 —— 没有 commit 可以指）。
    /// 不传 `branch`：让 GitHub 用它自己的默认分支，空库时那个分支也不存在，由这次调用创建。
    pub fn bootstrap_empty(&self) -> ApiResult<()> {
        const README: &str = "# 备份仓库\n\n\
这个仓库由 self-notion 自动备份。笔记在 `md/` 下，一篇一个 Markdown 文件。\n\n\
**别手改 `md/` 里的文件** —— 下次备份会覆盖它。这个 README 是首次备份时落的，用来把仓库\n\
初始化出来（GitHub 的 Git Data API 在空仓库上不可用）。\n";
        self.send_ok(
            "PUT",
            "/contents/README.md",
            Some(json!({
                "message": "backup: 初始化仓库（self-notion 首次备份）",
                "content": B64.encode(README.as_bytes()),
            })),
        )
    }

    pub fn create_blob(&self, bytes: &[u8]) -> ApiResult<String> {
        #[derive(Deserialize)]
        struct Blob {
            sha: String,
        }
        let b: Blob = self.send(
            "POST",
            "/git/blobs",
            Some(json!({ "content": B64.encode(bytes), "encoding": "base64" })),
        )?;
        Ok(b.sha)
    }

    /// 带 `base_tree` 建树：没列进去的路径**原样继承**，所以只传变动的那几个（增量）。
    pub fn create_tree(&self, base: Option<&str>, entries: Vec<Value>) -> ApiResult<String> {
        #[derive(Deserialize)]
        struct Tree {
            sha: String,
        }
        let mut body = json!({ "tree": entries });
        if let Some(b) = base {
            body["base_tree"] = json!(b);
        }
        let t: Tree = self.send("POST", "/git/trees", Some(body))?;
        Ok(t.sha)
    }

    pub fn create_commit(&self, message: &str, tree: &str, parents: &[String]) -> ApiResult<String> {
        #[derive(Deserialize)]
        struct Commit {
            sha: String,
        }
        let c: Commit = self.send(
            "POST",
            "/git/commits",
            Some(json!({ "message": message, "tree": tree, "parents": parents })),
        )?;
        Ok(c.sha)
    }

    /// 空仓库的首个 commit：把分支建出来。
    pub fn create_ref(&self, sha: &str) -> ApiResult<()> {
        self.send_ok(
            "POST",
            "/git/refs",
            Some(json!({ "ref": format!("refs/heads/{}", self.branch), "sha": sha })),
        )
    }

    pub fn update_ref(&self, sha: &str) -> ApiResult<()> {
        self.send_ok(
            "PATCH",
            &format!("/git/refs/heads/{}", self.branch),
            Some(json!({ "sha": sha })),
        )
    }

    /// 一棵树里全部 blob：`(path, sha)`。递归拉，一次拿全。
    pub fn tree_blobs(&self, tree_sha: &str) -> ApiResult<Vec<(String, String)>> {
        #[derive(Deserialize)]
        struct Tree {
            tree: Vec<Entry>,
        }
        #[derive(Deserialize)]
        struct Entry {
            path: String,
            #[serde(rename = "type")]
            kind: String,
            sha: String,
        }
        let t: Tree =
            self.send("GET", &format!("/git/trees/{}?recursive=1", tree_sha), None)?;
        // ponytail: 一次拉全。GitHub 上限 100k 条 / 7 MB，几千篇的库撞不到；撞到再分页。
        Ok(t.tree
            .into_iter()
            .filter(|e| e.kind == "blob")
            .map(|e| (e.path, e.sha))
            .collect())
    }

    pub fn blob(&self, sha: &str) -> ApiResult<Vec<u8>> {
        #[derive(Deserialize)]
        struct Blob {
            content: String,
            encoding: String,
        }
        let b: Blob = self.send("GET", &format!("/git/blobs/{}", sha), None)?;
        if b.encoding == "base64" {
            // GitHub 会把 base64 按 60 列折行，解码前先把换行去掉
            B64.decode(b.content.replace('\n', "").as_bytes())
                .map_err(|e| ApiError::new("backup_decode", e.to_string()))
        } else {
            Ok(b.content.into_bytes())
        }
    }

    /// 用户级：当前 token 是哪个账号 → `(login, name)`。`name` 可能是 null，回落空串。
    pub fn user(&self) -> ApiResult<(String, String)> {
        #[derive(Deserialize)]
        struct User {
            login: String,
            name: Option<String>,
        }
        let u: User = self.send_root("GET", "/user", None)?;
        Ok((u.login, u.name.unwrap_or_default()))
    }

    /// 用户名下（affiliation=owner）的仓库，按最近更新排。返回已经驼峰化的 JSON。
    pub fn repos(&self) -> ApiResult<Vec<Value>> {
        #[derive(Deserialize)]
        struct Repo {
            full_name: String,
            private: bool,
            default_branch: String,
            updated_at: String,
            description: Option<String>,
        }
        let rs: Vec<Repo> = self.send_root(
            "GET",
            "/user/repos?per_page=100&sort=updated&affiliation=owner",
            None,
        )?;
        Ok(rs
            .into_iter()
            .map(|r| {
                json!({
                    "fullName": r.full_name,
                    "private": r.private,
                    "defaultBranch": r.default_branch,
                    "updatedAt": r.updated_at,
                    "description": r.description.unwrap_or_default(),
                })
            })
            .collect())
    }

    /// 建私有空仓库 → 回 `owner/name`。
    pub fn create_repo(&self, name: &str) -> ApiResult<String> {
        #[derive(Deserialize)]
        struct Repo {
            full_name: String,
        }
        let r: Repo = self.send_root(
            "POST",
            "/user/repos",
            Some(json!({ "name": name, "private": true, "auto_init": false })),
        )?;
        Ok(r.full_name)
    }
}

/// 把 GitHub 的状态码翻成我们的 `ApiError`。body 截前 500 字符塞进 message（够定位了）。
///
/// ponytail: 没解析 GitHub 的结构化错误体（`{message, documentation_url}`）。等设置页要
/// 「token 权限不够，去点这个链接」这种引导时，再解那个 JSON，而不是现在猜一个格式。
fn github_err(status: u16, body: &[u8]) -> ApiError {
    let msg: String = String::from_utf8_lossy(body).chars().take(500).collect();
    let code = match status {
        401 | 403 => "backup_auth",
        404 => "backup_not_found",
        409 => "backup_conflict",
        422 => "backup_invalid",
        _ => "backup_http",
    };
    ApiError::new(code, format!("GitHub {status}: {msg}"))
}
