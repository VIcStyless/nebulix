//! Nebulix native app: one Rust codebase for Windows, macOS, Linux (binary), Android (cdylib, `android_main`) and iOS
//! (binary inside an .app bundle). The UI is Slint (ui/*.slint), compiled to native code — no web view.
slint::include_modules!();

mod app;
mod chat;
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
mod desktop;
mod drive;
pub mod i18n;
mod util;

use app::{App, Ctx};
use serde_json::json;
use slint::ComponentHandle;
use std::sync::{Arc, Mutex};

/// Build the window, wire every callback and run the event loop.
pub fn run() -> Result<(), slint::PlatformError> { start()?.run() }

thread_local! { static TIMER: std::cell::RefCell<Option<slint::Timer>> = const { std::cell::RefCell::new(None) }; }

/// Build and wire the window without running it (the UI tests drive it on their own platform).
pub fn start() -> Result<AppWindow, slint::PlatformError> {
    let ui = AppWindow::new()?;
    let ctx: Ctx = Arc::new(App {
        client: Mutex::new(nebulix_core::Client::new(nebulix_core::DEFAULT_SERVER)),
        ui: ui.as_weak(),
        rt: Mutex::new(None),
        me: Mutex::new(serde_json::Value::Null),
        id: Mutex::new(None),
        peers: Mutex::new(Default::default()),
        open_peer: Mutex::new(String::new()),
        notices: Mutex::new(vec![]),
        last_typing: Mutex::new(0),
        pending_email: Mutex::new(String::new()),
    });
    wire(&ctx, &ui);
    app::init(&ctx, &ui);
    let t = page_timer(&ctx);
    TIMER.with(|x| *x.borrow_mut() = Some(t));
    Ok(ui)
}

macro_rules! on {
    ($api:expr, $ctx:expr, $name:ident, |$c:ident $(, $a:ident)*| $body:expr) => {{
        let ctx = $ctx.clone();
        $api.$name(move |$($a),*| { let $c = &ctx; $body });
    }};
}

fn wire(ctx: &Ctx, ui: &AppWindow) {
    let api = ui.global::<Api>();
    // session
    on!(api, ctx, on_login, |c, u, p, code| app::login(c, u.into(), p.into(), code.into()));
    on!(api, ctx, on_signup, |c, u, p, e| app::signup(c, u.into(), p.into(), e.into()));
    on!(api, ctx, on_verify, |c, code| app::verify(c, code.into()));
    on!(api, ctx, on_logout, |c| app::logout(c));
    on!(api, ctx, on_set_server, |c, url| if let Some(ui) = c.ui.upgrade() { app::set_server(c, &ui, &url) });
    on!(api, ctx, on_refresh, |c| app::refresh(c));
    on!(api, ctx, on_claim_daily, |c| app::claim_daily(c));
    on!(api, ctx, on_clear_notices, |c| { c.notices.lock().unwrap().clear(); if let Some(ui) = c.ui.upgrade() { app::paint_notices(c, &ui); ui.global::<Api>().set_unread_notices(0); } });
    // messages
    on!(api, ctx, on_open_chat, |c, peer| chat::open_chat(c, peer.into()));
    on!(api, ctx, on_send_msg, |c, text| chat::send(c, text.into()));
    on!(api, ctx, on_typing, |c| chat::typing(c));
    on!(api, ctx, on_restore_key, |c, pass| chat::restore_key(c, pass.into()));
    on!(api, ctx, on_create_key, |c| chat::create_key(c));
    on!(api, ctx, on_start_chat, |c, who| chat::start_chat(c, who.into()));
    // friends
    on!(api, ctx, on_friend_request, |c, u| app::friend(c, "request", u.into()));
    on!(api, ctx, on_friend_accept, |c, id| app::friend(c, "accept", id.into()));
    on!(api, ctx, on_friend_decline, |c, id| app::friend(c, "decline", id.into()));
    on!(api, ctx, on_friend_remove, |c, id| app::friend(c, "remove", id.into()));
    // drive
    on!(api, ctx, on_drive_open, |c, id| drive::open(c, id.into()));
    on!(api, ctx, on_drive_view_set, |c, v| drive::set_view(c, v.into()));
    on!(api, ctx, on_drive_upload, |c| drive::upload(c));
    on!(api, ctx, on_drive_download, |c, id| drive::download(c, id.into()));
    on!(api, ctx, on_drive_new_folder, |c, name| drive::new_folder(c, name.into()));
    on!(api, ctx, on_drive_delete, |c, id| drive::delete(c, id.into()));
    on!(api, ctx, on_drive_star, |c, id| drive::star(c, id.into()));
    // wallet
    on!(api, ctx, on_transfer, |c, to, amount, note| app::transfer(c, to.into(), amount.into(), note.into()));
    // settings
    on!(api, ctx, on_set_lang, |c, l| if let Some(ui) = c.ui.upgrade() { app::set_lang(&ui, &l) });
    on!(api, ctx, on_set_dark, |c, d| if let Some(ui) = c.ui.upgrade() { ui.global::<Theme>().set_dark(d); nebulix_core::store::set_setting("dark", json!(d)); });
    on!(api, ctx, on_set_os_notify, |c, on| if let Some(ui) = c.ui.upgrade() { ui.global::<Api>().set_os_notify(on); nebulix_core::store::set_setting("osNotify", json!(on)); });

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        // local virtual machines
        on!(api, ctx, on_vm_refresh, |c| if let Some(ui) = c.ui.upgrade() { desktop::refresh_vms(c, &ui) });
        on!(api, ctx, on_vm_create, |c, name, os, iso, cpus, ram, disk, ports, uefi| desktop::vm_create(c, name.into(), os.into(), iso.into(), cpus, ram, disk, ports.into(), uefi));
        on!(api, ctx, on_vm_update, |c, id, name, cpus, ram, boot_iso, _x, ports| desktop::vm_update(c, id.into(), name.into(), cpus, ram, boot_iso, ports.into()));
        on!(api, ctx, on_vm_start, |c, id| desktop::vm_start(c, id.into()));
        on!(api, ctx, on_vm_shutdown, |c, id| desktop::vm_shutdown(c, id.into()));
        on!(api, ctx, on_vm_force_off, |c, id| desktop::vm_force_off(c, id.into()));
        on!(api, ctx, on_vm_reset, |c, id| desktop::vm_reset(c, id.into()));
        on!(api, ctx, on_vm_pause, |c, id| desktop::vm_pause(c, id.into()));
        on!(api, ctx, on_vm_resume, |c, id| desktop::vm_resume(c, id.into()));
        on!(api, ctx, on_vm_delete, |c, id| desktop::vm_delete(c, id.into()));
        on!(api, ctx, on_vm_keys, |c, id, combo| desktop::vm_keys(c, id.into(), combo.into()));
        on!(api, ctx, on_vm_snapshots, |c, id| desktop::vm_snapshots(c, id.into()));
        on!(api, ctx, on_vm_snap_save, |c, id, n| desktop::vm_snap(c, id.into(), n.into(), "save"));
        on!(api, ctx, on_vm_snap_load, |c, id, n| desktop::vm_snap(c, id.into(), n.into(), "load"));
        on!(api, ctx, on_vm_snap_delete, |c, id, n| desktop::vm_snap(c, id.into(), n.into(), "delete"));
        api.on_vm_pick_iso(|| desktop::pick_iso().into());
        on!(api, ctx, on_vm_show_command, |c, id| if let Some(ui) = c.ui.upgrade() { desktop::show_command(&ui, &id) });
        on!(api, ctx, on_image_download, |c, id, arch| desktop::image_download(c, id.into(), arch.into()));
        api.on_dl_cancel(desktop::dl_cancel);
        // local Android Emulator
        on!(api, ctx, on_droid_refresh, |c| desktop::refresh_droid(c));
        on!(api, ctx, on_droid_install, |c, level| desktop::droid_install(c, level));
        on!(api, ctx, on_droid_create, |c, name, level, profile, cpus, ram, storage| desktop::droid_create(c, name.into(), level, profile.into(), cpus, ram, storage));
        on!(api, ctx, on_droid_start, |c, id, cold| desktop::droid_start(c, id.into(), cold));
        on!(api, ctx, on_droid_stop, |c, id| desktop::droid_simple(c, id.into(), "stop"));
        on!(api, ctx, on_droid_rotate, |c, id| desktop::droid_simple(c, id.into(), "rotate"));
        on!(api, ctx, on_droid_delete, |c, id| desktop::droid_simple(c, id.into(), "delete"));
        on!(api, ctx, on_droid_apk, |c, id| desktop::droid_apk(c, id.into()));
        on!(api, ctx, on_droid_push, |c, id| desktop::droid_push(c, id.into()));
        on!(api, ctx, on_droid_shot, |c, id| desktop::droid_shot(c, id.into()));
        on!(api, ctx, on_droid_gps, |c, id, lat, lon| desktop::droid_gps(c, id.into(), lat.into(), lon.into()));
        on!(api, ctx, on_droid_list_apps, |c, id| desktop::droid_apps(c, id.into()));
        on!(api, ctx, on_droid_uninstall, |c, id, pkg| desktop::droid_uninstall(c, id.into(), pkg.into()));
        api.on_open_folder(|w| desktop::open_folder(&w));
        api.on_open_url(|u| desktop::open_url(&u));
    }
    let w = ui.as_weak();
    api.on_has_image(move |level| w.upgrade().map(|ui| { use slint::Model; ui.global::<Api>().get_sdk_images().iter().any(|x| x == level) }).unwrap_or(false));
}

/// Keeps live data fresh on the page being shown: VM states and screen thumbnails, Android boot state.
fn page_timer(ctx: &Ctx) -> slint::Timer {
    let t = slint::Timer::default();
    let c = ctx.clone();
    let mut tick = 0u32;
    t.start(slint::TimerMode::Repeated, std::time::Duration::from_secs(3), move || {
        tick = tick.wrapping_add(1);
        let _ = tick; // only the desktop pages read it
        let Some(ui) = c.ui.upgrade() else { return };
        let api = ui.global::<Api>();
        if !api.get_signed_in() { return; }
        match api.get_page() {
            0 => { api.set_unread_notices(0); }
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            5 => desktop::refresh_vms(&c, &ui),
            #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
            6 => if tick % 2 == 0 { desktop::refresh_droid(&c) },
            _ => {}
        }
    });
    t
}

#[cfg(target_os = "android")]
#[no_mangle]
fn android_main(app: slint::android::AndroidApp) {
    if let Some(p) = app.internal_data_path() { nebulix_core::store::set_data_dir(p); }
    slint::android::init(app).expect("Slint Android backend");
    run().expect("Nebulix");
}
