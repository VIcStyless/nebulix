//! End-to-end check of the native-only features on a real machine (see docs/NATIVE-APPS.md, "Tests").
//! NEBULIX_DATA_DIR=<tmp> NEBULIX_QEMU_DISPLAY=none [NEBULIX_ANDROID_SDK=<sdk> NEBULIX_EMU_HEADLESS=1] localtest [vm] [android] [index]
use nebulix_local::*;
use std::sync::{atomic::AtomicBool, Arc};
use std::time::{Duration, Instant};
use std::sync::atomic::{AtomicU32, Ordering::Relaxed};
static P: AtomicU32 = AtomicU32::new(0); static F: AtomicU32 = AtomicU32::new(0);
fn ok(c: bool, m: &str) { if c { P.fetch_add(1, Relaxed); println!("  ok   {m}"); } else { F.fetch_add(1, Relaxed); println!("  FAIL {m}"); } }
fn wait(secs: u64, mut f: impl FnMut() -> bool) -> bool { let t = Instant::now(); while t.elapsed() < Duration::from_secs(secs) { if f() { return true; } std::thread::sleep(Duration::from_millis(500)); } false }
fn main() {
    let args: Vec<String> = std::env::args().collect(); let want = |k: &str| args.iter().any(|a| a == k);
    let cancel = Arc::new(AtomicBool::new(false)); let quiet = |_: u64, _: u64| {};
    if want("index") {
        for (id, arch) in [("alpine", "x86_64"), ("alpine", "aarch64"), ("debian", "x86_64"), ("debian", "aarch64"), ("ubuntu", "x86_64")] {
            let r = images::resolve(id, arch); ok(matches!(&r, Ok((u, _, h)) if u.starts_with("https://") && h.len() == 64), &format!("image index {id}/{arch}: {:?}", r.as_ref().map(|x| &x.1)));
        }
        let p = android::plan(34); ok(p.as_ref().map(|v| v.len() == 3).unwrap_or(false), &format!("Google SDK index for API 34: {:?}", p.map(|v| v.into_iter().map(|x| x.1.rsplit('/').next().unwrap().to_string()).collect::<Vec<_>>())));
    }
    if want("vm") {
        let h = qemu::host(); println!("  host: qemu={:?} accel={} cpus={} ram={}MB", h.qemu_x86, h.accel_x86, h.cpus, h.ram_mb);
        ok(h.qemu_x86.is_some() && h.accel_x86 == "kvm", "QEMU found with KVM acceleration");
        let iso = images::download("alpine", "x86_64", &quiet, &cancel); ok(iso.is_ok(), "Alpine ISO downloaded and SHA-256 verified");
        let bad = qemu::create(qemu::VmSpec { id: String::new(), name: "".into(), os: "linux".into(), arch: "x86_64".into(), cpus: 2, ram_mb: 1024, disk_gb: 8, iso: None, boot_iso: false, uefi: false, ports: vec![], fullscreen: false, created: 0 });
        ok(bad.is_err(), "empty name refused");
        let vm = qemu::create(qemu::VmSpec { id: String::new(), name: "Test Alpine".into(), os: "linux".into(), arch: "x86_64".into(), cpus: 2, ram_mb: 1024, disk_gb: 8, iso: iso.ok().map(|p| p.display().to_string()), boot_iso: true, uefi: false, ports: vec![(2222, 22)], fullscreen: false, created: 0 }).expect("create");
        ok(qemu::list().iter().any(|v| v.id == vm.id), "machine listed");
        let st = qemu::start(&vm.id); ok(st.is_ok(), &format!("started {:?}", st.err()));
        ok(qemu::state(&vm.id) == qemu::VmState::Running, "state = running (QMP)");
        ok(qemu::start(&vm.id).is_err(), "second start refused");
        std::thread::sleep(Duration::from_secs(8));
        let shot = qemu::screenshot(&vm.id); ok(shot.as_ref().map(|p| std::fs::metadata(p).map(|m| m.len() > 10000).unwrap_or(false)).unwrap_or(false), "guest screenshot");
        ok(qemu::pause(&vm.id).is_ok() && qemu::state(&vm.id) == qemu::VmState::Paused, "paused"); ok(qemu::resume(&vm.id).is_ok() && qemu::state(&vm.id) == qemu::VmState::Running, "resumed");
        ok(qemu::save_snapshot(&vm.id, "booted").is_ok(), "snapshot saved into the app-made qcow2");
        let sn = qemu::snapshots(&vm.id).unwrap_or_default(); ok(sn.contains(&"booted".to_string()), &format!("snapshot listed {sn:?}"));
        ok(qemu::save_snapshot(&vm.id, "bad name!").is_err(), "invalid snapshot name refused");
        ok(qemu::load_snapshot(&vm.id, "booted").is_ok(), "snapshot restored"); ok(qemu::delete_snapshot(&vm.id, "booted").is_ok(), "snapshot deleted");
        ok(qemu::send_keys(&vm.id, &["ctrl", "alt", "f2"]).is_ok(), "key combo sent");
        ok(qemu::reset(&vm.id).is_ok(), "reset");
        ok(qemu::delete(&vm.id).is_err(), "cannot delete while running");
        ok(qemu::force_off(&vm.id).is_ok() && wait(10, || qemu::state(&vm.id) == qemu::VmState::Stopped), "forced off");
        ok(qemu::delete(&vm.id).is_ok() && qemu::get(&vm.id).is_none(), "deleted");
    }
    if want("android") {
        let st = android::status(); ok(st.emulator && st.adb && st.images.contains(&34), &format!("SDK ready: {st:?}"));
        let (acc, why) = android::accel_check(); ok(acc, &format!("emulator acceleration: {why}"));
        let d = android::create(android::Device { id: String::new(), name: "Test Pixel".into(), api: 34, profile: "phone".into(), cpus: 2, ram_mb: 2048, storage_gb: 4, created: 0 }).expect("create avd");
        ok(android::devices().iter().any(|x| x.id == d.id), "device listed");
        let s = android::start(&d.id, true); ok(s.is_ok(), &format!("emulator started {:?}", s.err()));
        ok(wait(240, || android::booted(&d.id)), "Android finished booting");
        let shot = std::env::temp_dir().join("nbx-droid.png"); ok(android::screenshot(&d.id, &shot).is_ok(), "device screenshot (PNG)");
        let f = std::env::temp_dir().join("nbx-hello.txt"); std::fs::write(&f, "hola").unwrap(); let pf = android::push_file(&d.id, &f); ok(pf.is_ok(), &format!("file copied to Download {:?}", pf.err()));
        ok(android::set_location(&d.id, 40.4168, -3.7038).is_ok(), "GPS location set"); ok(android::set_location(&d.id, 99.0, 0.0).is_err(), "bad coordinates refused");
        ok(android::apps(&d.id).is_ok(), "app list");
        ok(android::delete(&d.id).is_err(), "cannot delete while running");
        ok(android::stop(&d.id).is_ok() && wait(60, || android::serial_of(&d.id).is_none()), "stopped");
        ok(android::delete(&d.id).is_ok() && !android::devices().iter().any(|x| x.id == d.id), "deleted");
    }
    let (p, f) = (P.load(Relaxed), F.load(Relaxed)); println!("{p} passed, {f} failed"); std::process::exit(if f > 0 { 1 } else { 0 });
}
