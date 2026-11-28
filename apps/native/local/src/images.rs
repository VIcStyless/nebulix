//! Installation images from the official mirrors of each project. Versions and checksums are read from the projects'
//! own release indexes at download time, so nothing here goes stale.
use crate::download::{fetch, get_text, Check, DlError, Progress};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct Image {
    pub id: &'static str,
    pub name: &'static str,
    pub about: &'static str,
    /// rough download size, for the UI
    pub size: &'static str,
    pub archs: &'static [&'static str],
}

pub const CATALOG: &[Image] = &[
    Image { id: "alpine", name: "Alpine Linux", about: "Tiny and fast; boots in seconds. Good for servers and testing.", size: "≈ 60 MB", archs: &["x86_64", "aarch64"] },
    Image { id: "debian", name: "Debian (network installer)", about: "Stable Linux; the installer downloads what you choose.", size: "≈ 700 MB", archs: &["x86_64", "aarch64"] },
    Image { id: "ubuntu", name: "Ubuntu Desktop LTS", about: "Full desktop with apps, ready to use.", size: "≈ 6 GB", archs: &["x86_64"] },
];

pub fn images_dir() -> PathBuf { let d = nebulix_core::store::data_dir().join("images"); let _ = std::fs::create_dir_all(&d); d }

/// Resolve the current file of an image for an architecture: (url, file name, sha256).
pub fn resolve(id: &str, arch: &str) -> Result<(String, String, String), DlError> {
    match id {
        "alpine" => {
            let base = format!("https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/{arch}/");
            let y = get_text(&format!("{base}latest-releases.yaml"))?;
            // entries are separated by "-\n"; take the one with flavor: alpine-virt
            for block in y.split("\n-") {
                let get = |k: &str| block.lines().find_map(|l| l.trim().strip_prefix(&format!("{k}:")).map(|v| v.trim().trim_matches('"').to_string()));
                if get("flavor").as_deref() == Some("alpine-virt") {
                    if let (Some(f), Some(h)) = (get("iso"), get("sha256")) { return Ok((format!("{base}{f}"), f, h)); }
                }
            }
            Err(DlError::Net("Alpine release index has no virt image".into()))
        }
        "debian" => {
            let a = if arch == "aarch64" { "arm64" } else { "amd64" };
            let base = format!("https://cdimage.debian.org/debian-cd/current/{a}/iso-cd/");
            let sums = get_text(&format!("{base}SHA256SUMS"))?;
            sums.lines().filter_map(|l| l.split_once("  ")).find(|(_, f)| f.ends_with("-netinst.iso") && !f.contains("edu") && !f.contains("mac"))
                .map(|(h, f)| (format!("{base}{f}"), f.to_string(), h.to_string())).ok_or_else(|| DlError::Net("Debian index has no netinst image".into()))
        }
        "ubuntu" => {
            let base = "https://releases.ubuntu.com/noble/";
            let sums = get_text(&format!("{base}SHA256SUMS"))?;
            sums.lines().filter_map(|l| l.split_once(" *")).find(|(_, f)| f.ends_with("-desktop-amd64.iso"))
                .map(|(h, f)| (format!("{base}{f}"), f.to_string(), h.to_string())).ok_or_else(|| DlError::Net("Ubuntu index has no desktop image".into()))
        }
        _ => Err(DlError::Net("unknown image".into())),
    }
}

/// Download (or reuse) an image; returns the local path.
pub fn download(id: &str, arch: &str, progress: Progress, cancel: &Arc<AtomicBool>) -> Result<PathBuf, DlError> {
    let (url, file, sha) = resolve(id, arch)?;
    fetch(&url, &images_dir().join(file), Check::Sha256(&sha), progress, cancel)
}

/// Images already downloaded (any .iso/.img in the images folder).
pub fn local() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(images_dir()).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| matches!(p.extension().and_then(|e| e.to_str()), Some("iso" | "img"))).collect();
    v.sort();
    v
}
