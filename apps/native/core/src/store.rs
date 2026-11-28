//! Where the app keeps secrets and settings.
//!  * Secrets (session cookie, E2EE identity record): the OS credential store on desktop — Windows Credential Manager,
//!    macOS Keychain, Secret Service (GNOME Keyring / KWallet) on Linux. If the store is unavailable (e.g. a Linux
//!    session without Secret Service) they fall back to a file only the user can read. On Android and iOS the app's
//!    private sandbox directory is used (other apps cannot read it).
//!  * Settings: a JSON file in the per-user config directory.
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
const SERVICE: &str = "dev.nebulix.native";

/// Base data directory. Mobile builds set it from the platform at startup (see `set_data_dir`).
static DATA_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn set_data_dir(p: PathBuf) { let _ = DATA_DIR.set(p); }

pub fn data_dir() -> PathBuf {
    let d = DATA_DIR.get_or_init(|| match std::env::var_os("NEBULIX_DATA_DIR") { // tests and portable installs
        Some(p) => PathBuf::from(p),
        None => dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Nebulix"),
    }).clone();
    let _ = fs::create_dir_all(&d);
    d
}

fn secret_file(key: &str) -> PathBuf {
    let d = data_dir().join("secure");
    let _ = fs::create_dir_all(&d);
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; let _ = fs::set_permissions(&d, fs::Permissions::from_mode(0o700)); }
    d.join(format!("{}.secret", key.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_', "_")))
}

fn write_private(path: &PathBuf, data: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data)?;
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?; }
    fs::rename(tmp, path)
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
fn os_store(key: &str) -> Option<keyring::Entry> {
    if std::env::var_os("NEBULIX_NO_KEYRING").is_some() { return None; } // tests and portable installs
    keyring::Entry::new(SERVICE, key).ok()
}

/// Save a secret. `None` deletes it.
pub fn put_secret(key: &str, val: Option<&str>) {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if let Some(e) = os_store(key) {
        match val {
            Some(v) => if e.set_password(v).is_ok() { let _ = fs::remove_file(secret_file(key)); return; },
            None => { let _ = e.delete_credential(); } // and remove any file fallback below
        }
    }
    let f = secret_file(key);
    match val { Some(v) => { let _ = write_private(&f, v); } None => { let _ = fs::remove_file(f); } }
}

pub fn get_secret(key: &str) -> Option<String> {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    if let Some(e) = os_store(key) { if let Ok(v) = e.get_password() { return Some(v); } }
    fs::read_to_string(secret_file(key)).ok()
}

// ---------- settings ----------
fn settings_path() -> PathBuf { data_dir().join("settings.json") }

pub fn settings() -> Value {
    fs::read_to_string(settings_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| serde_json::json!({}))
}
pub fn setting(k: &str) -> Option<Value> { settings().get(k).cloned() }
pub fn set_setting(k: &str, v: Value) {
    let mut s = settings();
    if let Value::Object(m) = &mut s { if v.is_null() { m.remove(k); } else { m.insert(k.to_string(), v); } }
    let _ = write_private(&settings_path(), &serde_json::to_string_pretty(&s).unwrap());
}

/// Per-server key so a test server and production never mix sessions.
pub fn account_key(server: &str, what: &str) -> String {
    let h: String = server.bytes().fold(0u64, |a, b| a.wrapping_mul(131).wrapping_add(b as u64)).to_string();
    format!("{what}-{h}")
}
