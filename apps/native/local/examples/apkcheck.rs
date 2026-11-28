//! Boots a local emulator, installs an APK, launches it and saves a screenshot (used to check the native Android app).
//! NEBULIX_DATA_DIR=<dir> NEBULIX_ANDROID_SDK=<sdk> NEBULIX_EMU_HEADLESS=1 apkcheck <apk> <screenshot.png> <package>
use nebulix_local::android;
use std::process::Command;
use std::time::{Duration, Instant};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let (apk, shot, pkg) = (&a[1], &a[2], &a[3]);
    let d = android::create(android::Device { id: String::new(), name: "APK check".into(), api: 34, profile: "phone".into(), cpus: 2, ram_mb: 3072, storage_gb: 4, created: 0 }).expect("create");
    android::start(&d.id, true).expect("start");
    let t = Instant::now();
    while !android::booted(&d.id) { assert!(t.elapsed() < Duration::from_secs(300), "boot timeout"); std::thread::sleep(Duration::from_secs(3)); }
    println!("booted in {:?}", t.elapsed());
    std::thread::sleep(Duration::from_secs(8));
    println!("install: {:?}", android::install_apk(&d.id, std::path::Path::new(apk)));
    let serial = android::serial_of(&d.id).unwrap();
    let adb = std::path::PathBuf::from(std::env::var("NEBULIX_ANDROID_SDK").unwrap()).join("platform-tools/adb");
    let run = |args: &[&str]| { let o = Command::new(&adb).arg("-s").arg(&serial).args(args).output().unwrap(); String::from_utf8_lossy(&o.stdout).to_string() + &String::from_utf8_lossy(&o.stderr) };
    println!("launch: {}", run(&["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]).trim());
    std::thread::sleep(Duration::from_secs(15));
    println!("pid: {}", run(&["shell", "pidof", pkg]).trim());
    println!("focus: {}", run(&["shell", "dumpsys", "window", "|", "grep", "-m1", "mCurrentFocus"]).trim());
    android::screenshot(&d.id, std::path::Path::new(shot)).expect("screenshot");
    let log = run(&["logcat", "-d", "-t", "400"]);
    for l in log.lines().filter(|l| l.contains("nebulix") || l.contains("RustPanic") || l.contains("panicked") || l.contains("FATAL") || l.contains("slint")).take(25) { println!("log: {l}"); }
    let _ = android::stop(&d.id);
    let t = Instant::now(); while android::serial_of(&d.id).is_some() && t.elapsed() < Duration::from_secs(60) { std::thread::sleep(Duration::from_secs(2)); }
    let _ = android::delete(&d.id);
}
