//! The official Android Emulator on this computer (Windows, macOS, Linux), in its own native window with GPU and
//! hardware acceleration. Packages come from Google's SDK repository index (same files Android Studio uses), checked
//! against Google's SHA-1. AOSP "default" system images (no Google Play). Using them means accepting the Android SDK
//! License Agreement: https://developer.android.com/studio/terms — the UI asks before downloading.
use crate::download::{fetch, get_text, unzip, Check, DlError, Progress};
use crate::qemu::no_window;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

const REPO: &str = "https://dl.google.com/android/repository/";
const SYSIMG: &str = "https://dl.google.com/android/repository/sys-img/android/";
pub const LICENSE_URL: &str = "https://developer.android.com/studio/terms";

/// Android versions offered (API level, name).
pub const VERSIONS: &[(u32, &str)] = &[(36, "Android 16"), (35, "Android 15"), (34, "Android 14"), (33, "Android 13"), (31, "Android 12"), (30, "Android 11"), (29, "Android 10")];

#[derive(Debug, thiserror::Error)]
pub enum DroidError {
    #[error("{0}")]
    Dl(#[from] DlError),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Bad(String),
}

fn host_os() -> &'static str { if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "macosx" } else { "linux" } }
fn host_arch() -> &'static str { if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" } }
/// System image ABI that runs at native speed on this CPU.
pub fn abi() -> &'static str { if cfg!(target_arch = "aarch64") { "arm64-v8a" } else { "x86_64" } }
fn exe(n: &str) -> String { if cfg!(windows) { format!("{n}.exe") } else { n.to_string() } }

pub fn home() -> PathBuf { let d = nebulix_core::store::data_dir().join("android"); let _ = fs::create_dir_all(d.join("avd")); d }
/// SDK folder. `NEBULIX_ANDROID_SDK` points at an existing SDK (e.g. Android Studio's) to reuse its packages.
pub fn sdk() -> PathBuf { std::env::var_os("NEBULIX_ANDROID_SDK").map(PathBuf::from).unwrap_or_else(|| home().join("sdk")) }
fn emulator_bin() -> PathBuf { sdk().join("emulator").join(exe("emulator")) }
fn adb_bin() -> PathBuf { sdk().join("platform-tools").join(exe("adb")) }
fn image_dir(api: u32) -> PathBuf { sdk().join("system-images").join(format!("android-{api}")).join("default").join(abi()) }

#[derive(Clone, Debug)]
pub struct Status { pub emulator: bool, pub adb: bool, pub images: Vec<u32>, pub accel: Option<String> }

pub fn status() -> Status {
    let images = VERSIONS.iter().map(|v| v.0).filter(|a| image_dir(*a).join("system.img").is_file()).collect();
    Status { emulator: emulator_bin().is_file(), adb: adb_bin().is_file(), images, accel: None }
}

/// Ask the emulator whether hardware acceleration works here (KVM / WHPX / AEHD / HVF), with its own explanation.
pub fn accel_check() -> (bool, String) {
    if !emulator_bin().is_file() { return (false, String::new()); }
    let mut c = Command::new(emulator_bin());
    c.arg("-accel-check").env("ANDROID_SDK_ROOT", sdk()).stdout(Stdio::piped()).stderr(Stdio::piped());
    no_window(&mut c);
    match c.output() {
        Ok(o) => { let t = String::from_utf8_lossy(&o.stdout).to_string() + &String::from_utf8_lossy(&o.stderr); let ok = o.status.success() || t.contains("is installed and usable"); (ok, t.lines().filter(|l| !l.trim().is_empty() && l.trim() != "accel:" && !l.starts_with("accel")).collect::<Vec<_>>().join(" ").trim().to_string()) }
        Err(e) => (false, e.to_string()),
    }
}

// ---------- installing packages from Google's index ----------
struct Archive { url: String, sha1: String }

fn el<'a>(n: roxmltree::Node<'a, 'a>, name: &str) -> Option<roxmltree::Node<'a, 'a>> { n.children().find(|c| c.tag_name().name() == name) }
fn text(n: Option<roxmltree::Node>) -> String { n.and_then(|x| x.text()).unwrap_or("").trim().to_string() }

fn pick_archive(pkg: roxmltree::Node) -> Option<Archive> {
    let arcs = el(pkg, "archives")?;
    let mut best: Option<Archive> = None;
    for a in arcs.children().filter(|c| c.tag_name().name() == "archive") {
        let os = text(el(a, "host-os")); let arch = text(el(a, "host-arch"));
        if !os.is_empty() && os != host_os() { continue; }
        if !arch.is_empty() && arch != host_arch() { continue; }
        let comp = el(a, "complete")?;
        let ar = Archive { url: text(el(comp, "url")), sha1: text(el(comp, "checksum")) };
        if ar.url.is_empty() { continue; }
        let exact = !arch.is_empty() || os.is_empty();
        if best.is_none() || exact { best = Some(ar); if exact { break; } }
    }
    best
}

fn find_pkg(xml: &str, path: &str, stable_only: bool) -> Option<Archive> {
    let doc = roxmltree::Document::parse(xml).ok()?;
    // the stable channel's id (usually "channel-0")
    let stable = doc.descendants().find(|n| n.tag_name().name() == "channel" && n.text().map(str::trim) == Some("stable")).and_then(|n| n.attribute("id")).unwrap_or("channel-0").to_string();
    let mut found = None;
    for p in doc.descendants().filter(|n| n.tag_name().name() == "remotePackage" && n.attribute("path") == Some(path)) {
        if stable_only {
            let ch = el(p, "channelRef").and_then(|c| c.attribute("ref")).unwrap_or(&stable);
            if ch != stable { continue; }
        }
        if let Some(a) = pick_archive(p) { found = Some(a); break; }
    }
    found
}

/// Install the emulator, adb and the system image for `api` (skips parts already present).
pub fn install(api: u32, progress: Progress, step: &(dyn Fn(&str) + Sync), cancel: &Arc<AtomicBool>) -> Result<(), DroidError> {
    if !VERSIONS.iter().any(|v| v.0 == api) { return Err(DroidError::Bad("Unknown Android version".into())); }
    let dl = home().join("downloads");
    let root = sdk();
    fs::create_dir_all(&root)?;
    if !emulator_bin().is_file() || !adb_bin().is_file() {
        step("Reading Google's SDK index");
        let repo = get_text(&format!("{REPO}repository2-3.xml"))?;
        for (path, what) in [("emulator", "Android Emulator"), ("platform-tools", "Android platform tools (adb)")] {
            let present = if path == "emulator" { emulator_bin().is_file() } else { adb_bin().is_file() };
            if present { continue; }
            let a = find_pkg(&repo, path, true).ok_or_else(|| DroidError::Bad(format!("{what} is not available for this computer")))?;
            step(what);
            let z = fetch(&format!("{REPO}{}", a.url), &dl.join(&a.url), if a.sha1.len() == 40 { Check::Sha1(&a.sha1) } else { Check::None }, progress, cancel)?;
            step("Unpacking");
            unzip(&z, &root)?;
            let _ = fs::remove_file(z);
        }
    }
    if !image_dir(api).join("system.img").is_file() {
        step("Reading Google's system image index");
        let idx = get_text(&format!("{SYSIMG}sys-img2-3.xml"))?;
        let a = find_pkg(&idx, &format!("system-images;android-{api};default;{}", abi()), false)
            .ok_or_else(|| DroidError::Bad(format!("There is no {} image of this Android version for this computer", abi())))?;
        step("Android system image");
        let z = fetch(&format!("{SYSIMG}{}", a.url), &dl.join(&a.url), if a.sha1.len() == 40 { Check::Sha1(&a.sha1) } else { Check::None }, progress, cancel)?;
        step("Unpacking");
        let parent = image_dir(api).parent().unwrap().to_path_buf();
        fs::create_dir_all(&parent)?;
        unzip(&z, &parent)?; // the zip holds an "<abi>/" folder
        let _ = fs::remove_file(z);
    }
    Ok(())
}

/// What `install` would download for `api`: (package, url). Used by the UI to show sizes and by tests.
pub fn plan(api: u32) -> Result<Vec<(String, String)>, DroidError> {
    let repo = get_text(&format!("{REPO}repository2-3.xml"))?;
    let idx = get_text(&format!("{SYSIMG}sys-img2-3.xml"))?;
    let mut v = vec![];
    for p in ["emulator", "platform-tools"] { let a = find_pkg(&repo, p, true).ok_or_else(|| DroidError::Bad(format!("{p} not found")))?; v.push((p.to_string(), format!("{REPO}{}", a.url))); }
    let path = format!("system-images;android-{api};default;{}", abi());
    let a = find_pkg(&idx, &path, false).ok_or_else(|| DroidError::Bad(format!("{path} not found")))?;
    v.push((path, format!("{SYSIMG}{}", a.url)));
    Ok(v)
}

// ---------- virtual devices ----------
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub api: u32,
    /// "phone" | "tablet" | "foldable" | "tv"
    pub profile: String,
    pub cpus: u32,
    pub ram_mb: u32,
    pub storage_gb: u32,
    pub created: u64,
}

pub const PROFILES: &[(&str, &str, u32, u32, u32)] = &[("phone", "Phone (1080×2400)", 1080, 2400, 420), ("tablet", "Tablet (2560×1600)", 2560, 1600, 320), ("foldable", "Foldable (1840×2208)", 1840, 2208, 420), ("small", "Small phone (720×1280)", 720, 1280, 320)];

fn avd_home() -> PathBuf { home().join("avd") }
fn meta(id: &str) -> PathBuf { avd_home().join(format!("{id}.avd")).join("nebulix.json") }

fn env(c: &mut Command) -> &mut Command {
    c.env("ANDROID_SDK_ROOT", sdk()).env("ANDROID_HOME", sdk()).env("ANDROID_AVD_HOME", avd_home()).env("ANDROID_EMULATOR_HOME", home())
}

pub fn devices() -> Vec<Device> {
    let mut v: Vec<Device> = fs::read_dir(avd_home()).into_iter().flatten().flatten().filter_map(|e| fs::read_to_string(e.path().join("nebulix.json")).ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect();
    v.sort_by_key(|d| std::cmp::Reverse(d.created));
    v
}

pub fn create(mut d: Device) -> Result<Device, DroidError> {
    if d.name.trim().is_empty() || d.name.chars().count() > 40 { return Err(DroidError::Bad("Give the device a name (1-40 characters)".into())); }
    if !image_dir(d.api).join("system.img").is_file() { return Err(DroidError::Bad("Download this Android version first".into())); }
    let pr = PROFILES.iter().find(|p| p.0 == d.profile).ok_or_else(|| DroidError::Bad("Unknown device type".into()))?;
    d.cpus = d.cpus.clamp(1, 8); d.ram_mb = d.ram_mb.clamp(1024, 16384); d.storage_gb = d.storage_gb.clamp(2, 128);
    d.created = crate::qemu::now_ms(); d.id = format!("nbx{}", d.created);
    let dir = avd_home().join(format!("{}.avd", d.id));
    fs::create_dir_all(&dir)?;
    fs::write(avd_home().join(format!("{}.ini", d.id)), format!("avd.ini.encoding=UTF-8\npath={}\ntarget=android-{}\n", dir.display(), d.api))?;
    let arch = if abi() == "arm64-v8a" { "arm64" } else { "x86_64" };
    let cfg = [
        format!("AvdId={}", d.id), format!("avd.ini.displayname={}", d.name), format!("abi.type={}", abi()), format!("hw.cpu.arch={arch}"),
        format!("hw.cpu.ncore={}", d.cpus), format!("hw.ramSize={}", d.ram_mb), format!("disk.dataPartition.size={}G", d.storage_gb),
        format!("hw.lcd.width={}", pr.2), format!("hw.lcd.height={}", pr.3), format!("hw.lcd.density={}", pr.4),
        "hw.keyboard=yes".into(), "hw.gpu.enabled=yes".into(), "hw.gpu.mode=auto".into(), "hw.gps=yes".into(), "hw.audioInput=yes".into(), "hw.audioOutput=yes".into(),
        "hw.sensors.orientation=yes".into(), "hw.accelerometer=yes".into(), "hw.camera.back=emulated".into(), "hw.camera.front=emulated".into(),
        "showDeviceFrame=no".into(), format!("image.sysdir.1=system-images/android-{}/default/{}/", d.api, abi()), "tag.id=default".into(), "PlayStore.enabled=false".into(), "fastboot.forceColdBoot=no".into(), String::new(),
    ].join("\n");
    fs::write(dir.join("config.ini"), cfg)?;
    fs::write(meta(&d.id), serde_json::to_string_pretty(&d).unwrap())?;
    Ok(d)
}

pub fn delete(id: &str) -> Result<(), DroidError> {
    if !id.starts_with("nbx") || id.contains(['/', '\\', '.']) { return Err(DroidError::Bad("bad id".into())); }
    if serial_of(id).is_some() { return Err(DroidError::Bad("Stop the device first".into())); }
    let _ = fs::remove_file(avd_home().join(format!("{id}.ini")));
    fs::remove_dir_all(avd_home().join(format!("{id}.avd")))?;
    Ok(())
}

/// Start in a native window. `cold` ignores the quick-boot snapshot.
pub fn start(id: &str, cold: bool) -> Result<(), DroidError> {
    if serial_of(id).is_some() { return Err(DroidError::Bad("This device is already running".into())); }
    if !emulator_bin().is_file() { return Err(DroidError::Bad("Install the Android Emulator first".into())); }
    let log = fs::File::create(home().join(format!("{id}.log")))?;
    let mut c = Command::new(emulator_bin());
    env(&mut c).args(["-avd", id, "-accel", "on", "-gpu", "auto", "-no-metrics"]);
    if cold { c.arg("-no-snapshot-load"); }
    if std::env::var_os("NEBULIX_EMU_HEADLESS").is_some() { c.args(["-no-window", "-no-audio"]); } // tests
    c.stdin(Stdio::null()).stdout(log.try_clone()?).stderr(log);
    no_window(&mut c);
    let mut child = c.spawn()?;
    std::thread::sleep(std::time::Duration::from_millis(1500));
    if let Ok(Some(st)) = child.try_wait() {
        let l = fs::read_to_string(home().join(format!("{id}.log"))).unwrap_or_default();
        return Err(DroidError::Bad(format!("The emulator stopped ({st}): {}", l.lines().rev().find(|x| x.contains("ERROR") || x.contains("FATAL")).unwrap_or("see the log"))));
    }
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(())
}

fn adb(args: &[&str]) -> Result<String, DroidError> {
    let mut c = Command::new(adb_bin());
    env(&mut c).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    no_window(&mut c);
    let o = c.output()?;
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    if !o.status.success() { return Err(DroidError::Bad(format!("{}{}", out, String::from_utf8_lossy(&o.stderr)).trim().to_string())); }
    Ok(out)
}

/// Running emulators: (serial, AVD id).
pub fn running() -> Vec<(String, String)> {
    if !adb_bin().is_file() { return vec![]; }
    let Ok(out) = adb(&["devices"]) else { return vec![] };
    out.lines().skip(1).filter_map(|l| l.split_whitespace().next()).filter(|s| s.starts_with("emulator-"))
        .filter_map(|s| adb(&["-s", s, "emu", "avd", "name"]).ok().map(|n| (s.to_string(), n.lines().next().unwrap_or("").trim().to_string()))).collect()
}
pub fn serial_of(id: &str) -> Option<String> { running().into_iter().find(|(_, n)| n == id).map(|(s, _)| s) }
fn serial(id: &str) -> Result<String, DroidError> { serial_of(id).ok_or_else(|| DroidError::Bad("This device is not running".into())) }

/// true once Android has finished booting.
pub fn booted(id: &str) -> bool { serial_of(id).and_then(|s| adb(&["-s", &s, "shell", "getprop", "sys.boot_completed"]).ok()).map(|v| v.trim() == "1").unwrap_or(false) }
pub fn stop(id: &str) -> Result<(), DroidError> { adb(&["-s", &serial(id)?, "emu", "kill"]).map(|_| ()) }
pub fn install_apk(id: &str, apk: &Path) -> Result<String, DroidError> {
    if apk.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("apk")) != Some(true) { return Err(DroidError::Bad("Choose an .apk file".into())); }
    adb(&["-s", &serial(id)?, "install", "-r", "-g", &apk.display().to_string()]).map(|o| o.lines().last().unwrap_or("").to_string())
}
/// Copy a file into the device's Download folder.
pub fn push_file(id: &str, f: &Path) -> Result<(), DroidError> {
    let name = f.file_name().and_then(|n| n.to_str()).ok_or_else(|| DroidError::Bad("bad file".into()))?;
    let s = serial(id)?;
    // right after boot the shared storage is still being mounted and refuses writes for a few seconds
    let mut last = None;
    for _ in 0..15 {
        match adb(&["-s", &s, "push", &f.display().to_string(), &format!("/sdcard/Download/{name}")]) {
            Ok(_) => return Ok(()),
            Err(DroidError::Bad(e)) if e.contains("not permitted") || e.contains("No such file") || e.contains("Read-only") => { last = Some(e); std::thread::sleep(std::time::Duration::from_secs(2)); }
            Err(e) => return Err(e),
        }
    }
    Err(DroidError::Bad(last.unwrap_or_else(|| "Could not copy the file".into())))
}
pub fn screenshot(id: &str, dest: &Path) -> Result<(), DroidError> {
    let s = serial(id)?;
    let mut c = Command::new(adb_bin());
    env(&mut c).args(["-s", &s, "exec-out", "screencap", "-p"]).stdout(Stdio::piped()).stderr(Stdio::null());
    no_window(&mut c);
    let o = c.output()?;
    if !o.status.success() || o.stdout.len() < 8 || &o.stdout[1..4] != b"PNG" { return Err(DroidError::Bad("Could not take the screenshot".into())); }
    fs::write(dest, o.stdout)?;
    Ok(())
}
/// Third-party apps installed on the device.
pub fn apps(id: &str) -> Result<Vec<String>, DroidError> {
    Ok(adb(&["-s", &serial(id)?, "shell", "pm", "list", "packages", "-3"])?.lines().filter_map(|l| l.strip_prefix("package:")).map(|s| s.trim().to_string()).collect())
}
pub fn uninstall(id: &str, pkg: &str) -> Result<(), DroidError> {
    if !pkg.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_') { return Err(DroidError::Bad("bad package".into())); }
    adb(&["-s", &serial(id)?, "uninstall", pkg]).map(|_| ())
}
/// Rotate, set GPS, etc. through the emulator console (`adb emu …`).
pub fn rotate(id: &str) -> Result<(), DroidError> { adb(&["-s", &serial(id)?, "emu", "rotate"]).map(|_| ()) }
pub fn set_location(id: &str, lat: f64, lon: f64) -> Result<(), DroidError> {
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) { return Err(DroidError::Bad("Invalid coordinates".into())); }
    adb(&["-s", &serial(id)?, "emu", "geo", "fix", &lon.to_string(), &lat.to_string()]).map(|_| ())
}
