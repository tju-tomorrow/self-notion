//! 局域网 TLS 证书（D-0198）。
//!
//! 手机要离线就必须有 Service Worker，而 Service Worker 只认安全上下文 —— 所以纯局域网
//! 也得是 HTTPS。这里生成一张**自签、同时是 CA 和服务器证书**的证书，手机上装一次根证书即可。
//!
//! ★ 为什么只生成一次：iOS 信任的是**这张证书本身**。每次启动重签（ECDSA 签名带随机数）
//!   就算密钥不变，字节也不一样，手机的信任就失效了。所以证书落盘复用；只有文件缺失 /
//!   损坏才重签 —— 重签之后手机上要重新装一遍。
//! ★ SAN 里放 `<主机名>.local` + `*.local`：DHCP 换 IP 不影响，手机始终用 Bonjour 名字连。

use std::net::{IpAddr, UdpSocket};
use std::path::Path;

use rcgen::{CertificateParams, ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose};

pub struct Tls {
    pub cert_pem: Vec<u8>,
    pub key_pem: Vec<u8>,
}

/// 读盘上那张证书；没有就生成。`dir` = app data。
pub fn ensure(dir: &Path) -> Result<Tls, String> {
    let cert_path = dir.join("sync-cert.pem");
    let key_path = dir.join("sync-key.pem");

    if let (Ok(cert), Ok(key)) = (std::fs::read(&cert_path), std::fs::read(&key_path)) {
        if !cert.is_empty() && !key.is_empty() {
            return Ok(Tls { cert_pem: cert, key_pem: key });
        }
    }

    let params = params()?;
    let key = KeyPair::generate().map_err(|e| format!("生成私钥失败：{e}"))?;
    let cert = params.self_signed(&key).map_err(|e| format!("签证书失败：{e}"))?;
    let cert_pem = cert.pem().into_bytes();
    let key_pem = key.serialize_pem().into_bytes();

    std::fs::write(&cert_path, &cert_pem).map_err(|e| format!("写证书失败：{e}"))?;
    std::fs::write(&key_path, &key_pem).map_err(|e| format!("写私钥失败：{e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(Tls { cert_pem, key_pem })
}

fn params() -> Result<CertificateParams, String> {
    let host = hostname();
    let mut names = vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "*.local".to_string(),
    ];
    if !host.is_empty() {
        names.push(host.clone());
        names.push(format!("{host}.local"));
    }
    if let Some(ip) = lan_ip() {
        names.push(ip.to_string());
    }

    let mut p = CertificateParams::new(names).map_err(|e| format!("证书 SAN 非法：{e}"))?;
    p.distinguished_name.push(rcgen::DnType::CommonName, "self-notion local");
    p.is_ca = IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    p.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyEncipherment,
        KeyUsagePurpose::KeyCertSign,
    ];
    p.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    Ok(p)
}

pub fn hostname() -> String {
    // macOS 上 `gethostname` 可能直接回 IP（这台机器就是 192.168.124.3），
    // 而 Bonjour 的名字在 `scutil --get LocalHostName` 里。
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("scutil")
            .args(["--get", "LocalHostName"])
            .output()
        {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !s.is_empty() {
                    return s.trim_end_matches(".local").to_string();
                }
            }
        }
    }
    let mut buf = [0u8; 256];
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
    if rc != 0 {
        return String::new();
    }
    let s = std::ffi::CStr::from_bytes_until_nul(&buf)
        .map(|c| c.to_string_lossy().into_owned())
        .unwrap_or_default();
    s.trim_end_matches(".local").trim().to_string()
}

/// 出网路由上那张网卡的地址。不发包（UDP connect 只定路由）。
fn lan_ip() -> Option<IpAddr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    s.local_addr().ok().map(|a| a.ip())
}
