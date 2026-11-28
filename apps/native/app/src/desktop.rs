//! Desktop-only screens: local virtual machines (QEMU + KVM/WHPX/HVF) and the local Android Emulator.
use crate::app::{model, task, task_or, toast, Ctx};
use crate::i18n::{t, tv};
use crate::{Api, AppWindow, Avd, ImageChoice, Vm};
use nebulix_local::{android, images, qemu};
use slint::{ComponentHandle, Image, Rgb8Pixel, SharedPixelBuffer, SharedString};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

static CANCEL: OnceLock<Arc<AtomicBool>> = OnceLock::new();
fn cancel_flag() -> Arc<AtomicBool> { CANCEL.get_or_init(|| Arc::new(AtomicBool::new(false))).clone() }
pub fn dl_cancel() { cancel_flag().store(true, Ordering::SeqCst); }

fn err<E: std::fmt::Display>(e: E) -> String { t(&e.to_string()) }

/// Progress reporting from a worker thread, throttled to ~10 updates per second.
fn progress_fn(ctx: &Ctx, label: Arc<std::sync::Mutex<String>>) -> impl Fn(u64, u64) + Sync {
    let w = ctx.ui.clone();
    let last = std::sync::Mutex::new(std::time::Instant::now() - std::time::Duration::from_secs(1));
    move |done: u64, total: u64| {
        let mut l = last.lock().unwrap();
        if l.elapsed().as_millis() < 100 && done < total { return; }
        *l = std::time::Instant::now();
        let p = if total > 0 { done as f32 / total as f32 } else { 0.0 };
        let txt = format!("{} · {} / {}", label.lock().unwrap(), crate::util::size(done as i64), if total > 0 { crate::util::size(total as i64) } else { "?".into() });
        let _ = w.upgrade_in_event_loop(move |ui| { let a = ui.global::<Api>(); a.set_dl_progress(p); a.set_dl_label(txt.into()); });
    }
}
fn dl_done(ui: &AppWindow) { let a = ui.global::<Api>(); a.set_dl_progress(-1.0); a.set_dl_label("".into()); }

// ---------- virtual machines ----------
/// Decode QEMU's PPM screendump into a small RGB buffer for the card thumbnail.
fn ppm_thumb(path: &PathBuf, max_w: u32) -> Option<SharedPixelBuffer<Rgb8Pixel>> {
    let data = std::fs::read(path).ok()?;
    let _ = std::fs::remove_file(path);
    let mut fields = vec![]; let mut i = 0;
    while fields.len() < 4 && i < data.len() {
        while i < data.len() && data[i].is_ascii_whitespace() { i += 1; }
        if data.get(i) == Some(&b'#') { while i < data.len() && data[i] != b'\n' { i += 1; } continue; }
        let st = i; while i < data.len() && !data[i].is_ascii_whitespace() { i += 1; }
        fields.push(String::from_utf8_lossy(&data[st..i]).to_string());
    }
    if fields.first().map(String::as_str) != Some("P6") { return None; }
    let (w, h): (u32, u32) = (fields[1].parse().ok()?, fields[2].parse().ok()?);
    let px = &data[i + 1..];
    if px.len() < (w * h * 3) as usize || w == 0 { return None; }
    let tw = w.min(max_w); let th = (h as u64 * tw as u64 / w as u64).max(1) as u32;
    let mut buf = SharedPixelBuffer::<Rgb8Pixel>::new(tw, th);
    let out = buf.make_mut_slice();
    for y in 0..th { for x in 0..tw {
        let sx = x * w / tw; let sy = y * h / th; let o = ((sy * w + sx) * 3) as usize;
        out[(y * tw + x) as usize] = Rgb8Pixel { r: px[o], g: px[o + 1], b: px[o + 2] };
    } }
    Some(buf)
}

pub fn refresh_vms(ctx: &Ctx, _ui: &AppWindow) {
    task(ctx, false, |_| {
        let h = qemu::host();
        let list: Vec<(qemu::VmSpec, String, Option<SharedPixelBuffer<Rgb8Pixel>>)> = qemu::list().into_iter().map(|v| {
            let st = qemu::state(&v.id);
            let shot = if st == qemu::VmState::Running { qemu::screenshot(&v.id).ok().and_then(|p| { std::thread::sleep(std::time::Duration::from_millis(150)); ppm_thumb(&p, 320) }) } else { None };
            let st = match st { qemu::VmState::Running => "running", qemu::VmState::Paused => "paused", qemu::VmState::Stopped => "stopped" };
            (v, st.to_string(), shot)
        }).collect();
        let local = images::local();
        Ok((h, list, local))
    }, |ui, _, (h, list, local)| {
        let a = ui.global::<Api>();
        let accel = |x: &str| if x == "tcg" { t("software only (slow)") } else { x.to_uppercase() };
        let best = if h.native_arch == "aarch64" { &h.accel_arm } else { &h.accel_x86 };
        let q = if h.native_arch == "aarch64" { &h.qemu_arm } else { &h.qemu_x86 };
        a.set_has_qemu(q.is_some());
        a.set_host_info(tv("QEMU {qemu} · acceleration: {accel} · {cpus} processors · {ram} GB RAM", &[
            ("qemu", &q.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| t("not installed"))), ("accel", &accel(best)), ("cpus", &h.cpus.to_string()), ("ram", &(h.ram_mb / 1024).to_string()),
        ]).into());
        a.set_host_hint(h.hint.as_deref().map(t).unwrap_or_default().into());
        a.set_host_cpus(h.cpus as i32);
        a.set_host_ram(h.ram_mb.saturating_sub(1024).max(1024) as i32);
        let vms: Vec<Vm> = list.into_iter().map(|(v, st, shot)| Vm {
            id: v.id.into(), name: v.name.into(), os: v.os.into(), arch: v.arch.into(), state: st.into(), cpus: v.cpus as i32, ram: v.ram_mb as i32, disk: v.disk_gb as i32,
            iso: v.iso.as_deref().and_then(|p| std::path::Path::new(p).file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_default().into(),
            ports: v.ports.iter().map(|(h, g)| format!("{h}:{g}")).collect::<Vec<_>>().join(", ").into(),
            has_shot: shot.is_some(), shot: shot.map(Image::from_rgb8).unwrap_or_default(), uefi: v.uefi, boot_iso: v.boot_iso,
        }).collect();
        a.set_vms(model(vms));
        let mut imgs: Vec<ImageChoice> = images::CATALOG.iter().filter(|i| i.archs.contains(&h.native_arch)).map(|i| {
            let have = local.iter().find(|p| p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with(&format!("{}-", i.id)) || n.starts_with(i.id)).unwrap_or(false));
            ImageChoice { id: i.id.into(), name: i.name.into(), about: t(i.about).into(), size: i.size.into(), local: have.is_some(), path: have.map(|p| p.display().to_string()).unwrap_or_default().into() }
        }).collect();
        for p in &local { // other images the user already has
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if !imgs.iter().any(|i| i.path == p.display().to_string().as_str()) { imgs.push(ImageChoice { id: "".into(), name: name.into(), about: t("Downloaded").into(), size: crate::util::size(std::fs::metadata(p).map(|m| m.len() as i64).unwrap_or(0)).into(), local: true, path: p.display().to_string().into() }); }
        }
        a.set_images(model(imgs));
    });
}

fn vm_action(ctx: &Ctx, id: String, f: fn(&str) -> Result<(), qemu::VmError>, msg: Option<&'static str>) {
    task(ctx, false, move |_| f(&id).map_err(err), move |ui, ctx, _| { if let Some(m) = msg { toast(ui, &t(m)); } let c = ctx.clone(); slint::Timer::single_shot(std::time::Duration::from_millis(700), move || { if let Some(ui) = c.ui.upgrade() { refresh_vms(&c, &ui); } }); });
}
pub fn vm_start(ctx: &Ctx, id: String) {
    task(ctx, true, move |_| { qemu::start(&id).map_err(err)?; Ok(qemu::get(&id).map(|v| v.name).unwrap_or_default()) }, |ui, ctx, name| { toast(ui, &tv("{name} started in its own window", &[("name", &name)])); refresh_vms(ctx, ui); });
}
pub fn vm_shutdown(ctx: &Ctx, id: String) { vm_action(ctx, id, qemu::shutdown, None) }
pub fn vm_force_off(ctx: &Ctx, id: String) { vm_action(ctx, id, qemu::force_off, None) }
pub fn vm_reset(ctx: &Ctx, id: String) { vm_action(ctx, id, qemu::reset, None) }
pub fn vm_pause(ctx: &Ctx, id: String) { vm_action(ctx, id, qemu::pause, None) }
pub fn vm_resume(ctx: &Ctx, id: String) { vm_action(ctx, id, qemu::resume, None) }
pub fn vm_delete(ctx: &Ctx, id: String) { vm_action(ctx, id, qemu::delete, None) }
pub fn vm_keys(ctx: &Ctx, id: String, combo: String) {
    task(ctx, false, move |_| { let k: Vec<&str> = combo.split('-').collect(); qemu::send_keys(&id, &k).map_err(err) }, |_, _, _| {});
}

fn parse_ports(s: &str) -> Result<Vec<(u16, u16)>, String> {
    s.split([',', ' ']).filter(|x| !x.trim().is_empty()).map(|p| {
        let (h, g) = p.trim().split_once(':').ok_or_else(|| t("Ports look like 2222:22 (computer:machine)"))?;
        Ok((h.trim().parse().map_err(|_| t("Ports look like 2222:22 (computer:machine)"))?, g.trim().parse().map_err(|_| t("Ports look like 2222:22 (computer:machine)"))?))
    }).collect()
}

#[allow(clippy::too_many_arguments)]
pub fn vm_create(ctx: &Ctx, name: String, os: String, iso: String, cpus: i32, ram: i32, disk: i32, ports: String, uefi: bool) {
    task(ctx, true, move |_| {
        let h = qemu::host();
        let spec = qemu::VmSpec { id: String::new(), name: name.trim().into(), os, arch: h.native_arch.into(), cpus: cpus.max(1) as u32, ram_mb: ram.max(256) as u32, disk_gb: disk.max(1) as u32,
            iso: if iso.is_empty() { None } else { Some(iso.clone()) }, boot_iso: !iso.is_empty(), uefi, ports: parse_ports(&ports)?, fullscreen: false, created: 0 };
        qemu::create(spec).map_err(err)
    }, |ui, ctx, _| refresh_vms(ctx, ui));
}

pub fn vm_update(ctx: &Ctx, id: String, name: String, cpus: i32, ram: i32, boot_iso: bool, ports: String) {
    task(ctx, false, move |_| {
        let mut v = qemu::get(&id).ok_or_else(|| t("Not found"))?;
        v.name = name; v.cpus = cpus.max(1) as u32; v.ram_mb = ram.max(256) as u32; v.boot_iso = boot_iso; v.ports = parse_ports(&ports)?;
        qemu::update(&v).map_err(err)
    }, |ui, ctx, _| { toast(ui, &t("Saved")); refresh_vms(ctx, ui); });
}

pub fn vm_snapshots(ctx: &Ctx, id: String) {
    task(ctx, false, move |_| qemu::snapshots(&id).map_err(err).map(|s| (id, s)), |ui, _, (id, s)| {
        let a = ui.global::<Api>();
        a.set_snaps(model(s.into_iter().map(SharedString::from).collect()));
        a.set_snaps_vm(id.into());
    });
}
pub fn vm_snap(ctx: &Ctx, id: String, name: String, op: &'static str) {
    task(ctx, true, move |_| {
        match op { "save" => qemu::save_snapshot(&id, &name), "load" => qemu::load_snapshot(&id, &name), _ => qemu::delete_snapshot(&id, &name) }.map_err(err)?;
        Ok(id)
    }, move |ui, ctx, id| { if op == "save" { toast(ui, &t("Snapshot saved")); } else if op == "load" { toast(ui, &t("Snapshot restored")); } vm_snapshots(ctx, id); });
}

pub fn pick_iso() -> String {
    rfd::FileDialog::new().set_title(t("Use my own ISO…")).add_filter("ISO / IMG", &["iso", "img", "qcow2"]).pick_file().map(|p| p.display().to_string()).unwrap_or_default()
}

pub fn show_command(ui: &AppWindow, id: &str) {
    let Some(v) = qemu::get(id) else { return };
    let txt = match qemu::command(&v, &qemu::host(), 4444) { Ok((bin, args)) => format!("{} {}", bin.display(), args.iter().map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() }).collect::<Vec<_>>().join(" ")), Err(e) => err(e) };
    ui.global::<Api>().set_vm_command(txt.into());
}

pub fn image_download(ctx: &Ctx, id: String, _arch: String) {
    cancel_flag().store(false, Ordering::SeqCst);
    let name = images::CATALOG.iter().find(|i| i.id == id).map(|i| i.name).unwrap_or("image");
    let label = Arc::new(std::sync::Mutex::new(tv("Downloading {what}", &[("what", name)])));
    let pf = progress_fn(ctx, label);
    if let Some(ui) = ctx.ui.upgrade() { ui.global::<Api>().set_dl_progress(0.0); }
    task_or(ctx, move |_| images::download(&id, qemu::host().native_arch, &pf, &cancel_flag()).map_err(err), |ui, ctx, _| { dl_done(ui); toast(ui, &t("Ready")); refresh_vms(ctx, ui); }, dl_done);
}

// ---------- Android ----------
pub fn refresh_droid(ctx: &Ctx) {
    task(ctx, false, |_| {
        let st = android::status();
        let running = android::running();
        let devs: Vec<(android::Device, String)> = android::devices().into_iter().map(|d| {
            let state = match running.iter().find(|(_, n)| *n == d.id) { None => "stopped", Some(_) => if android::booted(&d.id) { "booted" } else { "booting" } };
            (d, state.to_string())
        }).collect();
        let accel = if st.emulator { let (ok, why) = android::accel_check(); if ok { String::new() } else { why } } else { String::new() };
        Ok((st, devs, accel))
    }, |ui, _, (st, devs, accel)| {
        let a = ui.global::<Api>();
        a.set_sdk_ready(st.emulator && st.adb && !st.images.is_empty());
        a.set_sdk_images(model(st.images.iter().map(|x| *x as i32).collect()));
        a.set_sdk_accel(if accel.is_empty() { "".into() } else { tv("Hardware acceleration: {what}", &[("what", &accel)]).into() });
        a.set_versions(model(android::VERSIONS.iter().map(|(_, n)| SharedString::from(*n)).collect()));
        a.set_version_ids(model(android::VERSIONS.iter().map(|(api, _)| *api as i32).collect()));
        a.set_profiles(model(android::PROFILES.iter().map(|p| SharedString::from(t(p.1))).collect()));
        a.set_profile_ids(model(android::PROFILES.iter().map(|p| SharedString::from(p.0)).collect()));
        let ver = |api: u32| android::VERSIONS.iter().find(|v| v.0 == api).map(|v| v.1).unwrap_or("Android");
        a.set_avds(model(devs.into_iter().map(|(d, s)| Avd { id: d.id.into(), name: d.name.into(), api: d.api as i32, version: ver(d.api).into(), profile: d.profile.into(), state: s.into(), cpus: d.cpus as i32, ram: d.ram_mb as i32, storage: d.storage_gb as i32 }).collect()));
    });
}

pub fn droid_install(ctx: &Ctx, api: i32) {
    cancel_flag().store(false, Ordering::SeqCst);
    let label = Arc::new(std::sync::Mutex::new(String::new()));
    let pf = progress_fn(ctx, label.clone());
    if let Some(ui) = ctx.ui.upgrade() { ui.global::<Api>().set_dl_progress(0.0); }
    let w = ctx.ui.clone();
    task_or(ctx, move |_| {
        let step = |s: &str| { *label.lock().unwrap() = t(s); let s2 = t(s); let _ = w.upgrade_in_event_loop(move |ui| ui.global::<Api>().set_dl_label(s2.into())); };
        android::install(api as u32, &pf, &step, &cancel_flag()).map_err(err)
    }, |ui, ctx, _| { dl_done(ui); toast(ui, &t("Android is ready")); refresh_droid(ctx); }, dl_done);
}

pub fn droid_create(ctx: &Ctx, name: String, api: i32, profile: String, cpus: i32, ram: i32, storage: i32) {
    task(ctx, true, move |_| android::create(android::Device { id: String::new(), name: name.trim().into(), api: api as u32, profile, cpus: cpus as u32, ram_mb: ram as u32, storage_gb: storage as u32, created: 0 }).map_err(err), |_, ctx, _| refresh_droid(ctx));
}

pub fn droid_start(ctx: &Ctx, id: String, cold: bool) {
    task(ctx, true, move |_| android::start(&id, cold).map_err(err), |ui, ctx, _| {
        toast(ui, &tv("Starting {name}…", &[("name", "Android")]));
        refresh_droid(ctx); // the page timer in lib.rs keeps polling until it has booted
    });
}
pub fn droid_simple(ctx: &Ctx, id: String, op: &'static str) {
    task(ctx, false, move |_| match op { "stop" => android::stop(&id), "rotate" => android::rotate(&id), _ => android::delete(&id) }.map_err(err), |_, ctx, _| refresh_droid(ctx));
}
pub fn droid_apk(ctx: &Ctx, id: String) {
    let Some(f) = rfd::FileDialog::new().set_title(t("Install APK…")).add_filter("APK", &["apk"]).pick_file() else { return };
    task(ctx, true, move |_| android::install_apk(&id, &f).map_err(err).map(|r| (id, r)), |ui, ctx, (id, r)| { toast(ui, &tv("Installed: {what}", &[("what", &r)])); droid_apps(ctx, id); });
}
pub fn droid_push(ctx: &Ctx, id: String) {
    let Some(f) = rfd::FileDialog::new().set_title(t("Send file…")).pick_file() else { return };
    task(ctx, true, move |_| android::push_file(&id, &f).map_err(err), |ui, _, _| toast(ui, &t("File sent to the Download folder")));
}
fn shots_dir() -> PathBuf { let d = nebulix_core::store::data_dir().join("android-shots"); let _ = std::fs::create_dir_all(&d); d }
pub fn droid_shot(ctx: &Ctx, id: String) {
    task(ctx, false, move |_| { let p = shots_dir().join(format!("android-{}.png", chrono::Local::now().format("%Y%m%d-%H%M%S"))); android::screenshot(&id, &p).map_err(err)?; Ok(p) },
        |ui, _, p| toast(ui, &tv("Screenshot saved to {path}", &[("path", &p.display().to_string())])));
}
pub fn droid_gps(ctx: &Ctx, id: String, lat: String, lon: String) {
    task(ctx, false, move |_| {
        let (la, lo) = (lat.trim().replace(',', ".").parse::<f64>().map_err(|_| t("Invalid coordinates"))?, lon.trim().replace(',', ".").parse::<f64>().map_err(|_| t("Invalid coordinates"))?);
        android::set_location(&id, la, lo).map_err(err)
    }, |ui, _, _| toast(ui, &t("Location set")));
}
pub fn droid_apps(ctx: &Ctx, id: String) {
    task(ctx, false, move |_| android::apps(&id).map_err(err).map(|a| (id, a)), |ui, _, (id, a)| {
        let api = ui.global::<Api>();
        api.set_droid_apps(model(a.into_iter().map(SharedString::from).collect()));
        api.set_droid_apps_of(id.into());
    });
}
pub fn droid_uninstall(ctx: &Ctx, id: String, pkg: String) {
    task(ctx, false, move |_| android::uninstall(&id, &pkg).map_err(err).map(|_| id), |_, ctx, id| droid_apps(ctx, id));
}

pub fn open_folder(which: &str) {
    let d = if which == "android-shots" { shots_dir() } else { nebulix_core::store::data_dir() };
    let _ = open::that_detached(d);
}
pub fn open_url(u: &str) { if u.starts_with("https://") { let _ = open::that_detached(u); } }
