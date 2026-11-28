//! Headless end-to-end test of the native app against a Nebulix server (see docs/NATIVE-APPS.md, "Tests").
//! Runs the real app on Slint's software renderer (no window), drives it through its own callbacks like the UI does,
//! plays the other person with nebulix_core, checks the results and saves PNG screenshots.
//!   NEBULIX_DATA_DIR=<tmp> HOME=<tmp> NEBULIX_QEMU_DISPLAY=none NEBULIX_ANDROID_SDK=<sdk> \
//!   uitest <server> <shots dir> [alpine.iso]
use nebulix_app::{Api, AppWindow};
use nebulix_core::e2ee::{Identity, PubJwk, Sealed};
use nebulix_core::Client;
use serde_json::{json, Value};
use slint::platform::software_renderer::{MinimalSoftwareWindow, RepaintBufferType};
use slint::platform::{EventLoopProxy, Platform, WindowAdapter};
use slint::{ComponentHandle, Model, PhysicalSize, Rgb8Pixel, Weak};
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

type Job = Box<dyn FnOnce() + Send>;
struct Headless { window: Rc<MinimalSoftwareWindow>, queue: Arc<Mutex<VecDeque<Job>>>, quit: Arc<AtomicBool> }
struct Proxy { queue: Arc<Mutex<VecDeque<Job>>>, quit: Arc<AtomicBool> }
impl EventLoopProxy for Proxy {
    fn quit_event_loop(&self) -> Result<(), slint::EventLoopError> { self.quit.store(true, Ordering::SeqCst); Ok(()) }
    fn invoke_from_event_loop(&self, f: Job) -> Result<(), slint::EventLoopError> { self.queue.lock().unwrap().push_back(f); Ok(()) }
}
impl Platform for Headless {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, slint::PlatformError> { Ok(self.window.clone()) }
    fn run_event_loop(&self) -> Result<(), slint::PlatformError> {
        while !self.quit.load(Ordering::SeqCst) {
            slint::platform::update_timers_and_animations();
            loop { let j = self.queue.lock().unwrap().pop_front(); match j { Some(j) => j(), None => break } }
            std::thread::sleep(Duration::from_millis(5));
        }
        Ok(())
    }
    fn new_event_loop_proxy(&self) -> Option<Box<dyn EventLoopProxy>> { Some(Box::new(Proxy { queue: self.queue.clone(), quit: self.quit.clone() })) }
}

thread_local! { static WIN: std::cell::RefCell<Option<Rc<MinimalSoftwareWindow>>> = const { std::cell::RefCell::new(None) }; }

static PASS: AtomicU32 = AtomicU32::new(0);
static FAIL: AtomicU32 = AtomicU32::new(0);
fn ok(c: bool, m: &str) { if c { PASS.fetch_add(1, Ordering::SeqCst); println!("  ok   {m}"); } else { FAIL.fetch_add(1, Ordering::SeqCst); println!("  FAIL {m}"); } }

/// Run `f` on the UI thread and return its result.
fn ui<T: Send + 'static>(w: &Weak<AppWindow>, f: impl FnOnce(&AppWindow) -> T + Send + 'static) -> T {
    let (tx, rx) = channel();
    w.upgrade_in_event_loop(move |u| { let _ = tx.send(f(&u)); }).unwrap();
    rx.recv_timeout(Duration::from_secs(30)).expect("UI thread did not answer")
}
fn wait(w: &Weak<AppWindow>, secs: u64, f: impl Fn(&AppWindow) -> bool + Send + Sync + Clone + 'static) -> bool {
    let t = Instant::now();
    while t.elapsed() < Duration::from_secs(secs) { let g = f.clone(); if ui(w, move |u| g(u)) { return true; } std::thread::sleep(Duration::from_millis(150)); }
    false
}
fn shot(w: &Weak<AppWindow>, dir: &str, name: &str, width: u32, height: u32) {
    let path = format!("{dir}/{name}.png");
    ui(w, move |u| {
        WIN.with(|x| {
            let win = x.borrow().clone().unwrap();
            win.set_size(PhysicalSize::new(width, height));
            u.window().request_redraw();
            let mut buf = vec![Rgb8Pixel::default(); (width * height) as usize];
            win.request_redraw();
            win.draw_if_needed(|r| { r.render(&mut buf, width as usize); });
            let f = std::fs::File::create(&path).unwrap();
            let mut e = png::Encoder::new(std::io::BufWriter::new(f), width, height);
            e.set_color(png::ColorType::Rgb); e.set_depth(png::BitDepth::Eight);
            let bytes: Vec<u8> = buf.iter().flat_map(|p| [p.r, p.g, p.b]).collect();
            e.write_header().unwrap().write_image_data(&bytes).unwrap();
        });
    });
    // second pass: layout settles after the first render at a new size
    std::thread::sleep(Duration::from_millis(300));
}
fn shot2(w: &Weak<AppWindow>, dir: &str, name: &str, width: u32, height: u32) { shot(w, dir, name, width, height); std::thread::sleep(Duration::from_millis(400)); shot(w, dir, name, width, height); }

fn signup(server: &str, name: &str) -> (Client, String) {
    let c = Client::new(server);
    let v: Value = c.post("/api/auth/signup", &json!({ "username": name, "password": format!("Test-pass-{name}9"), "lang": "es" })).expect("signup");
    let id = v["user"]["id"].as_str().unwrap().to_string();
    (c, id)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let server = args.get(1).cloned().unwrap_or_else(|| "http://localhost:3999".into());
    let dir = args.get(2).cloned().unwrap_or_else(|| ".".into());
    let iso = args.get(3).cloned();
    std::fs::create_dir_all(&dir).unwrap();
    nebulix_core::store::set_setting("server", json!(server));

    let window = MinimalSoftwareWindow::new(RepaintBufferType::NewBuffer);
    window.set_size(PhysicalSize::new(1180, 760));
    WIN.with(|x| *x.borrow_mut() = Some(window.clone()));
    slint::platform::set_platform(Box::new(Headless { window, queue: Default::default(), quit: Default::default() })).unwrap();
    let app = nebulix_app::start().expect("start app");
    let w = app.as_weak();

    std::thread::spawn(move || {
        let tag = format!("{:x}", nebulix_core::store::account_key(&format!("{:?}", Instant::now()), "t").len() as u64 * 7919 + std::process::id() as u64);
        let me = format!("nat{}", &tag[tag.len().saturating_sub(5)..]);
        let them = format!("peer{}", &tag[tag.len().saturating_sub(5)..]);
        let (_mc, _my_id) = signup(&server, &me);
        let (pc, peer_id) = signup(&server, &them);
        let peer_key = Identity::generate();
        let _: Value = pc.put("/api/e2ee/key", &json!({ "pub": peer_key.public })).unwrap();

        // ---- login (Spanish UI) ----
        shot2(&w, &dir, "01-login", 1180, 760);
        ok(ui(&w, |u| !u.global::<Api>().get_signed_in()), "starts on the sign-in page");
        let (m2, p2) = (me.clone(), format!("Test-pass-{me}9"));
        ui(&w, move |u| u.global::<Api>().invoke_login("wrong-user-x".into(), "nope-nope".into(), "".into()));
        ok(wait(&w, 10, |u| !u.global::<Api>().get_error().is_empty()), "wrong password shows an error");
        let err = ui(&w, |u| u.global::<Api>().get_error().to_string());
        ok(err.contains("incorrect"), &format!("error in Spanish: {err}"));
        ui(&w, move |u| u.global::<Api>().invoke_login(m2.into(), p2.into(), "".into()));
        ok(wait(&w, 15, |u| u.global::<Api>().get_signed_in()), "signed in");
        let uname = ui(&w, |u| u.global::<Api>().get_me_username().to_string());
        ok(uname == me, "my username shown");
        ok(wait(&w, 10, |u| u.global::<Api>().get_online()), "realtime socket connected");
        ok(nebulix_core::store::get_secret(&nebulix_core::store::account_key(&server, "session")).is_some(), "session saved in secure storage");
        shot2(&w, &dir, "02-home", 1180, 760);

        // ---- end-to-end encrypted messages ----
        ok(wait(&w, 10, |u| u.global::<Api>().get_key_state() == "none"), "no key yet → offers to create one");
        ui(&w, |u| u.global::<Api>().set_page(1));
        shot2(&w, &dir, "03-messages-key", 1180, 760);
        ui(&w, |u| u.global::<Api>().invoke_create_key());
        ok(wait(&w, 10, |u| u.global::<Api>().get_key_state() == "ready"), "key created");
        let my_id = ui(&w, |u| u.global::<Api>().get_me_id().to_string());
        let mine: Value = pc.get(&format!("/api/users/{my_id}/key")).unwrap();
        let my_pub: PubJwk = serde_json::from_value(mine["pub"].clone()).unwrap();
        ok(!my_pub.x.is_empty(), "public key published to the server");
        // the peer writes to us (encrypted with WebCrypto-compatible code)
        let conv: Value = pc.get(&format!("/api/dm/{my_id}/messages")).unwrap();
        let conv_id = conv["id"].as_str().unwrap().to_string();
        let k = peer_key.conv_key(&conv_id, &my_pub).unwrap();
        let s = k.seal(&peer_id, "Hola desde el otro lado 🔐", None);
        let _: Value = pc.post(&format!("/api/dm/{my_id}/messages"), &json!({ "iv": s.iv, "ct": s.ct })).unwrap();
        ok(wait(&w, 10, |u| u.global::<Api>().get_unread_dms() >= 1), "new message counted in real time");
        let pid = peer_id.clone();
        ui(&w, move |u| u.global::<Api>().invoke_open_chat(pid.into()));
        ok(wait(&w, 10, |u| u.global::<Api>().get_msgs().iter().any(|m| m.text == "Hola desde el otro lado 🔐" && !m.mine)), "peer's message decrypted in the app");
        ok(ui(&w, |u| u.global::<Api>().get_safety().len() == 71), "safety number shown");
        ui(&w, |u| u.global::<Api>().invoke_send_msg("Respuesta nativa ✓".into()));
        ok(wait(&w, 10, |u| u.global::<Api>().get_msgs().iter().any(|m| m.text == "Respuesta nativa ✓" && m.mine)), "my reply appears");
        let got: Value = pc.get(&format!("/api/dm/{my_id}/messages")).unwrap();
        let last = got["messages"].as_array().unwrap().last().unwrap().clone();
        let txt = k.open_text(&my_id, &Sealed { iv: last["iv"].as_str().unwrap().into(), ct: last["ct"].as_str().unwrap().into() });
        ok(txt.as_deref() == Some("Respuesta nativa ✓"), "the peer decrypts the app's reply");
        let s2 = k.seal(&peer_id, "¿Me lees en directo?", None);
        let _: Value = pc.post(&format!("/api/dm/{my_id}/messages"), &json!({ "iv": s2.iv, "ct": s2.ct })).unwrap();
        ok(wait(&w, 10, |u| u.global::<Api>().get_msgs().iter().any(|m| m.text == "¿Me lees en directo?")), "live message arrives in the open chat");
        shot2(&w, &dir, "04-chat", 1180, 760);

        // ---- friends ----
        let t2 = them.clone();
        ui(&w, move |u| { u.global::<Api>().set_page(2); u.global::<Api>().invoke_friend_request(t2.into()); });
        ok(wait(&w, 10, |u| u.global::<Api>().get_people().iter().any(|p| p.kind == "outgoing")), "friend request sent");
        let _: Value = pc.post("/api/friends/accept", &json!({ "id": my_id })).unwrap();
        ok(wait(&w, 10, |u| u.global::<Api>().get_people().iter().any(|p| p.kind == "friend")), "friend accepted (realtime refresh)");
        shot2(&w, &dir, "05-friends", 1180, 760);

        // ---- drive ----
        ui(&w, |u| { u.global::<Api>().set_page(3); u.global::<Api>().invoke_drive_new_folder("Fotos".into()); });
        ok(wait(&w, 10, |u| u.global::<Api>().get_drive().iter().any(|d| d.name == "Fotos" && d.folder)), "folder created");
        let mc2 = Client::new(&server);
        let _ = mc2.login(&me, &format!("Test-pass-{me}9"), None).unwrap();
        let up: Value = mc2.put_bytes("/api/drive/upload?name=nota.txt", b"hola drive").unwrap();
        let fid = up["item"]["id"].as_str().unwrap().to_string();
        ui(&w, |u| u.global::<Api>().invoke_drive_open("".into()));
        ok(wait(&w, 10, |u| u.global::<Api>().get_drive().iter().any(|d| d.name == "nota.txt")), "uploaded file listed");
        let f2 = fid.clone();
        ui(&w, move |u| u.global::<Api>().invoke_drive_download(f2.into()));
        let dl = std::path::PathBuf::from(std::env::var("HOME").unwrap()).join("Downloads").join("nota.txt");
        ok(wait(&w, 10, move |_| std::fs::read(&dl).map(|b| b == b"hola drive").unwrap_or(false)), "file downloaded to Downloads");
        shot2(&w, &dir, "06-drive", 1180, 760);

        // ---- wallet ----
        ui(&w, |u| { u.global::<Api>().set_page(4); u.global::<Api>().invoke_claim_daily(); });
        ok(wait(&w, 10, |u| !u.global::<Api>().get_daily_msg().is_empty() || !u.global::<Api>().get_error().is_empty()), "daily reward answered");
        let t3 = them.clone();
        std::thread::sleep(Duration::from_millis(800));
        ui(&w, move |u| u.global::<Api>().invoke_transfer(t3.into(), "5".into(), "test".into()));
        std::thread::sleep(Duration::from_secs(2));
        let pw: Value = pc.get("/api/wallet").unwrap();
        ok(pw["coins"].as_i64().unwrap_or(0) >= 5, &format!("coins sent to the peer ({}; app error: {})", pw["coins"], ui(&w, |u| u.global::<Api>().get_error().to_string())));
        shot2(&w, &dir, "07-wallet", 1180, 760);

        // ---- local virtual machines ----
        ui(&w, |u| { u.global::<Api>().set_page(5); u.global::<Api>().invoke_vm_refresh(); });
        ok(wait(&w, 15, |u| u.global::<Api>().get_has_qemu() && u.global::<Api>().get_host_info().contains("KVM")), "QEMU with KVM detected");
        if let Some(iso) = iso.clone() {
            let dest = nebulix_local::images::images_dir().join(std::path::Path::new(&iso).file_name().unwrap());
            if !dest.exists() { std::fs::copy(&iso, &dest).unwrap(); }
            ui(&w, |u| u.global::<Api>().invoke_vm_refresh());
            ok(wait(&w, 10, |u| u.global::<Api>().get_images().iter().any(|i| i.id == "alpine" && i.local)), "downloaded Alpine image recognised");
            let ip = dest.display().to_string();
            ui(&w, move |u| u.global::<Api>().invoke_vm_create("Alpine de prueba".into(), "linux".into(), ip.into(), 2, 1024, 8, "2222:22".into(), false));
            ok(wait(&w, 10, |u| u.global::<Api>().get_vms().row_count() == 1), "machine created");
            let vid = ui(&w, |u| u.global::<Api>().get_vms().row_data(0).unwrap().id.to_string());
            let v2 = vid.clone();
            ui(&w, move |u| u.global::<Api>().invoke_vm_start(v2.into()));
            ok(wait(&w, 20, |u| u.global::<Api>().get_vms().row_data(0).map(|v| v.state == "running").unwrap_or(false)), "machine running (KVM)");
            ok(wait(&w, 30, |u| u.global::<Api>().get_vms().row_data(0).map(|v| v.has_shot).unwrap_or(false)), "live screen thumbnail");
            std::thread::sleep(Duration::from_secs(6));
            shot2(&w, &dir, "08-vms", 1180, 760);
            let v3 = vid.clone();
            ui(&w, move |u| u.global::<Api>().invoke_vm_snapshots(v3.into()));
            ok(wait(&w, 10, |u| !u.global::<Api>().get_snaps_vm().is_empty()), "snapshot panel");
            let v4 = vid.clone();
            ui(&w, move |u| u.global::<Api>().invoke_vm_force_off(v4.into()));
            ok(wait(&w, 15, |u| u.global::<Api>().get_vms().row_data(0).map(|v| v.state == "stopped").unwrap_or(false)), "machine stopped");
            let v5 = vid.clone();
            ui(&w, move |u| u.global::<Api>().invoke_vm_delete(v5.into()));
            ok(wait(&w, 10, |u| u.global::<Api>().get_vms().row_count() == 0), "machine deleted");
        }

        // ---- local Android ----
        ui(&w, |u| { u.global::<Api>().set_page(6); u.global::<Api>().invoke_droid_refresh(); });
        ok(wait(&w, 20, |u| u.global::<Api>().get_sdk_ready()), "Android SDK detected");
        ok(ui(&w, |u| u.global::<Api>().invoke_has_image(34)), "Android 14 image ready");
        shot2(&w, &dir, "09-android", 1180, 760);

        // ---- phone layout ----
        ui(&w, |u| u.global::<Api>().set_page(0));
        shot2(&w, &dir, "10-phone-home", 390, 844);
        ui(&w, |u| { u.global::<Api>().set_page(1); });
        shot2(&w, &dir, "11-phone-chat", 390, 844);

        // ---- settings: English ----
        ui(&w, |u| { u.global::<Api>().set_page(7); u.global::<Api>().invoke_set_lang("en".into()); });
        shot2(&w, &dir, "12-settings-en", 1180, 760);
        ui(&w, |u| u.global::<Api>().invoke_set_lang("es".into()));

        // ---- sign out ----
        ui(&w, |u| u.global::<Api>().invoke_logout());
        ok(wait(&w, 5, |u| !u.global::<Api>().get_signed_in()), "signed out");
        ok(nebulix_core::store::get_secret(&nebulix_core::store::account_key(&server, "session")).is_none(), "session removed");

        let (p, f) = (PASS.load(Ordering::SeqCst), FAIL.load(Ordering::SeqCst));
        println!("{p} passed, {f} failed");
        std::process::exit(if f > 0 { 1 } else { 0 });
    });
    app.run().unwrap();
}
