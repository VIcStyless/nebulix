//! Verified downloads with progress, and ZIP extraction (used for Android SDK packages and VM images).
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, thiserror::Error)]
pub enum DlError {
    #[error("download failed: {0}")]
    Net(String),
    #[error("the file is damaged (checksum does not match)")]
    Checksum,
    #[error("cancelled")]
    Cancelled,
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("could not unpack: {0}")]
    Zip(String),
}

#[derive(Clone, Copy, Debug)]
pub enum Check<'a> {
    Sha1(&'a str),
    Sha256(&'a str),
    None,
}

/// Progress callback: (bytes done, total bytes or 0 when unknown).
pub type Progress<'a> = &'a (dyn Fn(u64, u64) + Sync);

pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder().user_agent(nebulix_core::api::user_agent()).build().into()
}

pub fn get_text(url: &str) -> Result<String, DlError> {
    let mut r = agent().get(url).call().map_err(|e| DlError::Net(e.to_string()))?;
    r.body_mut().with_config().limit(32 << 20).read_to_string().map_err(|e| DlError::Net(e.to_string()))
}

/// Download `url` to `dest` (via a .part file), verifying the checksum. Reuses a complete file that already matches.
pub fn fetch(url: &str, dest: &Path, check: Check, progress: Progress, cancel: &Arc<AtomicBool>) -> Result<PathBuf, DlError> {
    if dest.exists() && verify(dest, check)? { return Ok(dest.to_path_buf()); }
    if let Some(p) = dest.parent() { fs::create_dir_all(p)?; }
    let part = dest.with_extension("part");
    let mut resp = agent().get(url).call().map_err(|e| DlError::Net(e.to_string()))?;
    if !resp.status().is_success() { return Err(DlError::Net(format!("HTTP {}", resp.status().as_u16()))); }
    let total = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0u64);
    let mut rd = resp.body_mut().with_config().limit(u64::MAX).reader();
    let mut out = File::create(&part)?;
    let (mut s1, mut s256) = (Sha1::new(), Sha256::new());
    let mut buf = vec![0u8; 1 << 16];
    let mut done = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) { drop(out); let _ = fs::remove_file(&part); return Err(DlError::Cancelled); }
        let n = rd.read(&mut buf).map_err(|e| DlError::Net(e.to_string()))?;
        if n == 0 { break; }
        out.write_all(&buf[..n])?;
        match check { Check::Sha1(_) => s1.update(&buf[..n]), Check::Sha256(_) => s256.update(&buf[..n]), Check::None => {} }
        done += n as u64;
        progress(done, total);
    }
    out.sync_all()?;
    drop(out);
    let ok = match check {
        Check::Sha1(h) => hex(&s1.finalize()) == h.to_ascii_lowercase(),
        Check::Sha256(h) => hex(&s256.finalize()) == h.to_ascii_lowercase(),
        Check::None => true,
    };
    if !ok { let _ = fs::remove_file(&part); return Err(DlError::Checksum); }
    fs::rename(&part, dest)?;
    Ok(dest.to_path_buf())
}

pub fn verify(path: &Path, check: Check) -> Result<bool, DlError> {
    let mut f = File::open(path)?;
    let mut buf = vec![0u8; 1 << 16];
    match check {
        Check::None => Ok(true),
        Check::Sha1(h) => { let mut s = Sha1::new(); loop { let n = f.read(&mut buf)?; if n == 0 { break; } s.update(&buf[..n]); } Ok(hex(&s.finalize()) == h.to_ascii_lowercase()) }
        Check::Sha256(h) => { let mut s = Sha256::new(); loop { let n = f.read(&mut buf)?; if n == 0 { break; } s.update(&buf[..n]); } Ok(hex(&s.finalize()) == h.to_ascii_lowercase()) }
    }
}

/// Unzip into `dest`, refusing paths that escape it, and keeping the executable bit on Unix.
pub fn unzip(zip_path: &Path, dest: &Path) -> Result<(), DlError> {
    let mut z = zip::ZipArchive::new(File::open(zip_path)?).map_err(|e| DlError::Zip(e.to_string()))?;
    fs::create_dir_all(dest)?;
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|e| DlError::Zip(e.to_string()))?;
        let Some(rel) = e.enclosed_name() else { continue };
        let out = dest.join(rel);
        if e.is_dir() { fs::create_dir_all(&out)?; continue; }
        if let Some(p) = out.parent() { fs::create_dir_all(p)?; }
        #[cfg(unix)]
        if let Some(mode) = e.unix_mode() {
            if mode & 0o170000 == 0o120000 { // symlink: the target is the file content
                let mut t = String::new(); e.read_to_string(&mut t)?;
                let _ = fs::remove_file(&out); std::os::unix::fs::symlink(t, &out)?; continue;
            }
        }
        let mut f = File::create(&out)?;
        std::io::copy(&mut e, &mut f)?;
        #[cfg(unix)]
        if let Some(mode) = e.unix_mode() { use std::os::unix::fs::PermissionsExt; let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode & 0o777)); }
    }
    Ok(())
}

pub fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{:02x}", x)).collect() }
