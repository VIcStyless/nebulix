//! Local virtual machines with QEMU and hardware acceleration: KVM (Linux), WHPX (Windows Hypervisor Platform),
//! HVF (macOS). Each VM runs in its own native QEMU window — no streaming, so it is as fast as the machine allows.
//! Machines live in <data>/vms/<id>/ (vm.json, disk.qcow2, efivars.fd, run.json).
use crate::qmp::Qmp;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, thiserror::Error)]
pub enum VmError {
    #[error("QEMU is not installed on this computer")]
    NoQemu,
    #[error("this machine is already running")]
    Running,
    #[error("this machine is not running")]
    NotRunning,
    #[error("{0}")]
    Bad(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct VmSpec {
    pub id: String,
    pub name: String,
    /// "linux" | "windows" | "other" — picks devices the guest has drivers for
    pub os: String,
    /// "x86_64" | "aarch64"
    pub arch: String,
    pub cpus: u32,
    pub ram_mb: u32,
    pub disk_gb: u32,
    pub iso: Option<String>,
    pub boot_iso: bool,
    pub uefi: bool,
    /// forward host TCP ports to the guest: (host, guest), e.g. (2222, 22) for SSH
    #[serde(default)]
    pub ports: Vec<(u16, u16)>,
    #[serde(default)]
    pub fullscreen: bool,
    pub created: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct RunInfo { pid: u32, qmp: u16 }

#[derive(Clone, Debug, PartialEq)]
pub enum VmState { Stopped, Running, Paused }

/// What this computer can do.
#[derive(Clone, Debug)]
pub struct Host {
    pub qemu_x86: Option<PathBuf>,
    pub qemu_arm: Option<PathBuf>,
    /// best accelerator per architecture ("kvm", "whpx", "hvf" or "tcg" = software, slow)
    pub accel_x86: String,
    pub accel_arm: String,
    pub native_arch: &'static str,
    pub cpus: u32,
    pub ram_mb: u64,
    /// advice when acceleration is missing (in English; the UI translates)
    pub hint: Option<String>,
}

pub fn vms_dir() -> PathBuf { let d = nebulix_core::store::data_dir().join("vms"); let _ = fs::create_dir_all(&d); d }
fn vm_dir(id: &str) -> PathBuf { vms_dir().join(id) }

fn exe(name: &str) -> String { if cfg!(windows) { format!("{name}.exe") } else { name.to_string() } }

fn find_bin(name: &str) -> Option<PathBuf> {
    let n = exe(name);
    if let Some(p) = std::env::var_os("PATH") { for d in std::env::split_paths(&p) { let f = d.join(&n); if f.is_file() { return Some(f); } } }
    let extra: Vec<PathBuf> = if cfg!(windows) {
        vec![PathBuf::from(r"C:\Program Files\qemu"), PathBuf::from(r"C:\Program Files (x86)\qemu"), nebulix_core::store::data_dir().join("qemu")]
    } else if cfg!(target_os = "macos") {
        vec!["/opt/homebrew/bin".into(), "/usr/local/bin".into(), "/opt/local/bin".into()]
    } else {
        vec!["/usr/bin".into(), "/usr/local/bin".into(), "/usr/libexec".into()]
    };
    extra.into_iter().map(|d| d.join(&n)).find(|f| f.is_file())
}

fn accels(bin: &Path) -> Vec<String> {
    let mut c = Command::new(bin);
    c.args(["-accel", "help"]).stdout(Stdio::piped()).stderr(Stdio::null());
    no_window(&mut c);
    c.output().map(|o| String::from_utf8_lossy(&o.stdout).lines().skip(1).map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()).unwrap_or_default()
}

/// Device models this QEMU build has (distributions split some into optional modules).
fn device_models(bin: &Path) -> Vec<String> {
    let mut c = Command::new(bin);
    c.args(["-device", "help"]).stdout(Stdio::piped()).stderr(Stdio::null());
    no_window(&mut c);
    let out = c.output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    out.lines().filter_map(|l| l.trim().strip_prefix("name \"")).filter_map(|r| r.split('"').next()).map(str::to_string).collect()
}

fn pick_accel(bin: &Option<PathBuf>, guest_native: bool) -> String {
    let Some(b) = bin else { return "tcg".into() };
    if !guest_native { return "tcg".into(); } // hardware acceleration needs the guest CPU = host CPU
    let a = accels(b);
    #[cfg(target_os = "linux")]
    if a.iter().any(|x| x == "kvm") && fs::OpenOptions::new().read(true).write(true).open("/dev/kvm").is_ok() { return "kvm".into(); }
    #[cfg(windows)]
    if a.iter().any(|x| x == "whpx") { return "whpx".into(); }
    #[cfg(target_os = "macos")]
    if a.iter().any(|x| x == "hvf") { return "hvf".into(); }
    let _ = a;
    "tcg".into()
}

pub fn host() -> Host {
    let native_arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x86_64" };
    let qemu_x86 = find_bin("qemu-system-x86_64");
    let qemu_arm = find_bin("qemu-system-aarch64");
    let accel_x86 = pick_accel(&qemu_x86, native_arch == "x86_64");
    let accel_arm = pick_accel(&qemu_arm, native_arch == "aarch64");
    let best = if native_arch == "x86_64" { &accel_x86 } else { &accel_arm };
    let hint = if qemu_x86.is_none() && qemu_arm.is_none() {
        Some(if cfg!(windows) { "Install QEMU for Windows (qemu.org/download) and turn on \"Windows Hypervisor Platform\" in Windows features." }
            else if cfg!(target_os = "macos") { "Install QEMU with Homebrew: brew install qemu" }
            else { "Install QEMU from your distribution (e.g. sudo apt install qemu-system-x86 or sudo pacman -S qemu-full)." }.to_string())
    } else if best == "tcg" {
        Some(if cfg!(windows) { "Hardware acceleration is off: turn on \"Windows Hypervisor Platform\" in Windows features and restart." }
            else if cfg!(target_os = "linux") { "Hardware acceleration is off: enable virtualisation (VT-x/AMD-V) in the BIOS and add your user to the kvm group." }
            else { "Hardware acceleration is not available; machines will be slow." }.to_string())
    } else { None };
    Host { qemu_x86, qemu_arm, accel_x86, accel_arm, native_arch, cpus: std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(2), ram_mb: total_ram_mb(), hint }
}

fn total_ram_mb() -> u64 {
    #[cfg(target_os = "linux")]
    if let Ok(s) = fs::read_to_string("/proc/meminfo") {
        if let Some(kb) = s.lines().find(|l| l.starts_with("MemTotal:")).and_then(|l| l.split_whitespace().nth(1)).and_then(|v| v.parse::<u64>().ok()) { return kb / 1024; }
    }
    8192 // unknown: a conservative guess, only used to cap the RAM slider
}

// ---------- machines ----------
pub fn list() -> Vec<VmSpec> {
    let mut v: Vec<VmSpec> = fs::read_dir(vms_dir()).into_iter().flatten().flatten()
        .filter_map(|e| fs::read_to_string(e.path().join("vm.json")).ok()).filter_map(|s| serde_json::from_str(&s).ok()).collect();
    v.sort_by_key(|x| std::cmp::Reverse(x.created));
    v
}
pub fn get(id: &str) -> Option<VmSpec> { fs::read_to_string(vm_dir(id).join("vm.json")).ok().and_then(|s| serde_json::from_str(&s).ok()) }
fn save(s: &VmSpec) -> Result<(), VmError> { fs::write(vm_dir(&s.id).join("vm.json"), serde_json::to_string_pretty(s).unwrap())?; Ok(()) }

fn validate(s: &VmSpec, h: &Host) -> Result<(), VmError> {
    if s.name.trim().is_empty() || s.name.chars().count() > 60 { return Err(VmError::Bad("Give the machine a name (1-60 characters)".into())); }
    if !(1..=h.cpus.max(1)).contains(&s.cpus) { return Err(VmError::Bad(format!("Use between 1 and {} processors", h.cpus))); }
    if s.ram_mb < 256 || s.ram_mb as u64 > h.ram_mb.saturating_sub(1024).max(1024) { return Err(VmError::Bad("Not enough free memory for that much RAM".into())); }
    if !(1..=2048).contains(&s.disk_gb) { return Err(VmError::Bad("Disk size must be between 1 and 2048 GB".into())); }
    if !["x86_64", "aarch64"].contains(&s.arch.as_str()) { return Err(VmError::Bad("Unknown architecture".into())); }
    if let Some(i) = &s.iso { if !Path::new(i).is_file() { return Err(VmError::Bad("The installation image was not found".into())); } }
    for (hp, _) in &s.ports { if *hp < 1024 { return Err(VmError::Bad("Forwarded host ports must be 1024 or higher".into())); } }
    Ok(())
}

pub fn create(mut s: VmSpec) -> Result<VmSpec, VmError> {
    let h = host();
    validate(&s, &h)?;
    s.id = format!("vm{}", now_ms());
    s.created = now_ms();
    let d = vm_dir(&s.id);
    fs::create_dir_all(&d)?;
    crate::qcow2::create(&d.join("disk.qcow2"), s.disk_gb as u64 * (1 << 30))?;
    save(&s)?;
    Ok(s)
}
/// Change settings while stopped (the disk can only grow by recreating it, so its size is fixed here).
pub fn update(s: &VmSpec) -> Result<(), VmError> {
    if state(&s.id) != VmState::Stopped { return Err(VmError::Running); }
    let old = get(&s.id).ok_or_else(|| VmError::Bad("Machine not found".into()))?;
    let mut n = s.clone(); n.disk_gb = old.disk_gb; n.created = old.created;
    validate(&n, &host())?;
    save(&n)
}
pub fn delete(id: &str) -> Result<(), VmError> {
    if state(id) != VmState::Stopped { return Err(VmError::Running); }
    if !id.starts_with("vm") || id.contains(['/', '\\', '.']) { return Err(VmError::Bad("bad id".into())); }
    fs::remove_dir_all(vm_dir(id))?;
    Ok(())
}

fn run_info(id: &str) -> Option<RunInfo> { fs::read_to_string(vm_dir(id).join("run.json")).ok().and_then(|s| serde_json::from_str(&s).ok()) }

pub fn state(id: &str) -> VmState {
    let Some(r) = run_info(id) else { return VmState::Stopped };
    match Qmp::connect(r.qmp).and_then(|mut q| q.cmd("query-status", None)) {
        Ok(v) => if v.get("status").and_then(|x| x.as_str()) == Some("paused") { VmState::Paused } else { VmState::Running },
        Err(_) => { let _ = fs::remove_file(vm_dir(id).join("run.json")); VmState::Stopped }
    }
}

fn free_port() -> u16 { std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(4444) }

fn firmware(bin: &Path, arch: &str) -> Option<(PathBuf, Option<PathBuf>)> {
    let (code, vars) = if arch == "aarch64" { ("edk2-aarch64-code.fd", "edk2-arm-vars.fd") } else { ("edk2-x86_64-code.fd", "edk2-i386-vars.fd") };
    let mut dirs: Vec<PathBuf> = vec![];
    if let Some(p) = bin.parent() { dirs.push(p.join("share")); dirs.push(p.join("../share/qemu")); }
    dirs.extend(["/usr/share/qemu", "/usr/local/share/qemu", "/opt/homebrew/share/qemu"].map(PathBuf::from));
    for d in &dirs { let c = d.join(code); if c.is_file() { let v = d.join(vars); return Some((c, v.is_file().then_some(v))); } }
    None
}

/// The full QEMU command for a machine (also shown in the UI so advanced users can see what runs).
pub fn command(s: &VmSpec, h: &Host, qmp_port: u16) -> Result<(PathBuf, Vec<String>), VmError> {
    let bin = if s.arch == "aarch64" { h.qemu_arm.clone() } else { h.qemu_x86.clone() }.ok_or(VmError::NoQemu)?;
    let accel = if s.arch == "aarch64" { &h.accel_arm } else { &h.accel_x86 };
    let d = vm_dir(&s.id);
    let mut a: Vec<String> = vec![];
    let mut push = |x: &[&str]| a.extend(x.iter().map(|s| s.to_string()));
    push(&["-name", &format!("Nebulix · {}", s.name)]);
    if s.arch == "aarch64" { push(&["-machine", "virt,highmem=on"]); } else { push(&["-machine", "q35"]); }
    push(&["-accel", accel]);
    // the host CPU model needs a hardware accelerator; WHPX works best with the default model
    let cpu = match accel.as_str() { "kvm" | "hvf" => "host", "whpx" => "qemu64", _ => "max" };
    push(&["-cpu", cpu, "-smp", &s.cpus.to_string(), "-m", &format!("{}M", s.ram_mb)]);
    let disk = d.join("disk.qcow2");
    if s.os == "windows" && s.arch == "x86_64" { // Windows has AHCI drivers out of the box (virtio needs extra drivers)
        push(&["-drive", &format!("file={},if=none,id=d0,format=qcow2,discard=unmap", disk.display()), "-device", "ahci,id=ahci", "-device", "ide-hd,drive=d0,bus=ahci.0"]);
    } else {
        push(&["-drive", &format!("file={},if=virtio,format=qcow2,discard=unmap", disk.display())]);
    }
    if let Some(iso) = &s.iso {
        if s.arch == "aarch64" { push(&["-drive", &format!("file={iso},if=none,id=cd0,media=cdrom,readonly=on"), "-device", "usb-storage,drive=cd0"]); }
        else { push(&["-cdrom", iso]); }
    }
    let needs_uefi = s.uefi || s.arch == "aarch64";
    if needs_uefi {
        let (code, vars) = firmware(&bin, &s.arch).ok_or_else(|| VmError::Bad("UEFI firmware (edk2) was not found next to QEMU".into()))?;
        push(&["-drive", &format!("if=pflash,format=raw,readonly=on,file={}", code.display())]);
        let mine = d.join("efivars.fd");
        if !mine.exists() { match &vars { Some(v) => { fs::copy(v, &mine)?; } None => { fs::File::create(&mine)?.set_len(64 << 20)?; } } }
        push(&["-drive", &format!("if=pflash,format=raw,file={}", mine.display())]);
    }
    push(&["-boot", if s.boot_iso && s.iso.is_some() { "order=dc,menu=on" } else { "order=c" }]);
    let mut net = "user,id=n0".to_string();
    for (hp, gp) in &s.ports { net.push_str(&format!(",hostfwd=tcp:127.0.0.1:{hp}-:{gp}")); }
    let models = device_models(&bin);
    let nic = if s.os == "windows" || !models.iter().any(|m| m == "virtio-net-pci") { "e1000e" } else { "virtio-net-pci" };
    push(&["-netdev", &net, "-device", &format!("{nic},netdev=n0")]);
    // graphics + absolute pointer (no mouse capture needed); only devices this QEMU build actually has
    let has = |d: &str| models.iter().any(|m| m == d);
    if s.arch == "aarch64" {
        if has("ramfb") { push(&["-device", "ramfb"]); }
        if has("virtio-gpu-pci") { push(&["-device", "virtio-gpu-pci"]); }
    } else if s.os != "windows" && has("virtio-vga") { push(&["-device", "virtio-vga"]); }
    else { push(&["-vga", "std"]); }
    if has("qemu-xhci") && has("usb-tablet") { push(&["-device", "qemu-xhci", "-device", "usb-tablet", "-device", "usb-kbd"]); } else { push(&["-usb", "-device", "usb-tablet"]); }
    if has("virtio-rng-pci") { push(&["-device", "virtio-rng-pci"]); }
    if s.fullscreen { push(&["-full-screen"]); }
    if let Ok(d) = std::env::var("NEBULIX_QEMU_DISPLAY") { push(&["-display", &d]); } // tests: "none"
    push(&["-qmp", &format!("tcp:127.0.0.1:{qmp_port},server=on,wait=off")]);
    Ok((bin, a))
}

pub fn start(id: &str) -> Result<(), VmError> {
    let s = get(id).ok_or_else(|| VmError::Bad("Machine not found".into()))?;
    if state(id) != VmState::Stopped { return Err(VmError::Running); }
    let h = host();
    let port = free_port();
    let (bin, args) = command(&s, &h, port)?;
    let log = fs::File::create(vm_dir(id).join("qemu.log"))?;
    let mut c = Command::new(bin);
    c.args(&args).stdin(Stdio::null()).stdout(log.try_clone()?).stderr(log);
    no_window(&mut c);
    let child = c.spawn()?;
    fs::write(vm_dir(id).join("run.json"), serde_json::to_string(&RunInfo { pid: child.id(), qmp: port }).unwrap())?;
    // wait until QEMU answers on QMP (or exits with an error)
    let mut child = child;
    for _ in 0..50 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if let Ok(Some(_)) = child.try_wait() {
            let _ = fs::remove_file(vm_dir(id).join("run.json"));
            let log = fs::read_to_string(vm_dir(id).join("qemu.log")).unwrap_or_default();
            return Err(VmError::Bad(format!("QEMU stopped: {}", log.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("unknown error"))));
        }
        if Qmp::connect(port).is_ok() { std::thread::spawn(move || { let _ = child.wait(); }); return Ok(()); }
    }
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(())
}

fn qmp(id: &str) -> Result<Qmp, VmError> { let r = run_info(id).ok_or(VmError::NotRunning)?; Qmp::connect(r.qmp).map_err(|_| VmError::NotRunning) }

/// ACPI power button (the guest shuts down cleanly).
pub fn shutdown(id: &str) -> Result<(), VmError> { qmp(id)?.cmd("system_powerdown", None)?; Ok(()) }
pub fn force_off(id: &str) -> Result<(), VmError> { let _ = qmp(id)?.cmd("quit", None); let _ = fs::remove_file(vm_dir(id).join("run.json")); Ok(()) }
pub fn reset(id: &str) -> Result<(), VmError> { qmp(id)?.cmd("system_reset", None)?; Ok(()) }
pub fn pause(id: &str) -> Result<(), VmError> { qmp(id)?.cmd("stop", None)?; Ok(()) }
pub fn resume(id: &str) -> Result<(), VmError> { qmp(id)?.cmd("cont", None)?; Ok(()) }
/// Send a key combination such as ["ctrl", "alt", "delete"].
pub fn send_keys(id: &str, keys: &[&str]) -> Result<(), VmError> {
    let k: Vec<_> = keys.iter().map(|k| serde_json::json!({ "type": "qcode", "data": k })).collect();
    qmp(id)?.cmd("send-key", Some(serde_json::json!({ "keys": k })))?; Ok(())
}
/// PPM screenshot of the guest screen written by QEMU into the machine folder.
pub fn screenshot(id: &str) -> Result<PathBuf, VmError> {
    let p = vm_dir(id).join(format!("screen-{}.ppm", now_ms()));
    qmp(id)?.cmd("screendump", Some(serde_json::json!({ "filename": p.display().to_string() })))?;
    Ok(p)
}

// ---------- snapshots (disk + memory, inside the qcow2) ----------
pub fn snapshots(id: &str) -> Result<Vec<String>, VmError> {
    let out = qmp(id)?.hmp("info snapshots")?;
    // table: "ID  TAG  VM SIZE  DATE  VM CLOCK ..." ; take the TAG column
    Ok(out.lines().skip_while(|l| !l.contains("TAG")).skip(1).filter_map(|l| l.split_whitespace().nth(1).map(str::to_string)).collect())
}
fn snap_name(n: &str) -> Result<String, VmError> {
    let n = n.trim();
    if n.is_empty() || n.len() > 40 || !n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') { return Err(VmError::Bad("Snapshot names use letters, numbers, - and _ (max 40)".into())); }
    Ok(n.to_string())
}
pub fn save_snapshot(id: &str, name: &str) -> Result<(), VmError> { let n = snap_name(name)?; qmp(id)?.hmp(&format!("savevm {n}"))?; Ok(()) }
pub fn load_snapshot(id: &str, name: &str) -> Result<(), VmError> { let n = snap_name(name)?; qmp(id)?.hmp(&format!("loadvm {n}"))?; Ok(()) }
pub fn delete_snapshot(id: &str, name: &str) -> Result<(), VmError> { let n = snap_name(name)?; qmp(id)?.hmp(&format!("delvm {n}"))?; Ok(()) }

pub fn now_ms() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

/// Do not flash a console window for child processes on Windows.
pub fn no_window(c: &mut Command) {
    #[cfg(windows)]
    { use std::os::windows::process::CommandExt; c.creation_flags(0x0800_0000); }
    let _ = c;
}
