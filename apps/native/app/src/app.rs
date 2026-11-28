//! App state, background tasks and the account side: sign-in, realtime events, notifications, daily reward, wallet,
//! friends. Network calls never run on the UI thread: `task` runs them on a worker and applies the result in the
//! event loop.
use crate::i18n::{t, tv};
use crate::util::*;
use crate::{Api, AppWindow, NoticeItem, Person, Theme, Tx};
use nebulix_core::e2ee::{Identity, PubJwk};
use nebulix_core::store;
use nebulix_core::ws::{Event, Realtime};
use nebulix_core::{Client, Login};
use serde_json::{json, Value};
use slint::{ComponentHandle, ModelRc, SharedString, VecModel, Weak};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

pub struct App {
    pub client: Mutex<Client>,
    pub ui: Weak<AppWindow>,
    pub rt: Mutex<Option<Realtime>>,
    pub me: Mutex<Value>,
    pub id: Mutex<Option<Identity>>,
    /// peer user id -> (conversation id, peer public key)
    pub peers: Mutex<HashMap<String, (String, PubJwk)>>,
    pub open_peer: Mutex<String>,
    pub notices: Mutex<Vec<(String, i64, String, String)>>,
    pub last_typing: Mutex<i64>,
    /// full e-mail address waiting for its verification code
    pub pending_email: Mutex<String>,
}

pub type Ctx = Arc<App>;

impl App {
    pub fn client(&self) -> Client { self.client.lock().unwrap().clone() }
    pub fn me_id(&self) -> String { s(&self.me.lock().unwrap(), "id") }
}

/// Run `work` on a worker thread; then `done` on the UI thread with its result. Errors go to Api.error.
pub fn task<T: Send + 'static>(ctx: &Ctx, busy: bool, work: impl FnOnce(&Ctx) -> Result<T, String> + Send + 'static, done: impl FnOnce(&AppWindow, &Ctx, T) + Send + 'static) {
    let c2 = ctx.clone();
    if let Some(ui) = ctx.ui.upgrade() { ui.global::<Api>().set_error("".into()); if busy { ui.global::<Api>().set_busy(true); } }
    std::thread::spawn(move || {
        let r = work(&c2);
        let c3 = c2.clone();
        let _ = c2.ui.upgrade_in_event_loop(move |ui| {
            if busy { ui.global::<Api>().set_busy(false); }
            match r { Ok(v) => done(&ui, &c3, v), Err(e) => ui.global::<Api>().set_error(e.into()) }
        });
    });
}

/// Like `task`, with a callback when the work fails (after Api.error is set). Used by the desktop downloads.
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
pub fn task_or<T: Send + 'static>(ctx: &Ctx, work: impl FnOnce(&Ctx) -> Result<T, String> + Send + 'static, done: impl FnOnce(&AppWindow, &Ctx, T) + Send + 'static, fail: impl FnOnce(&AppWindow) + Send + 'static) {
    let c2 = ctx.clone();
    if let Some(ui) = ctx.ui.upgrade() { ui.global::<Api>().set_error("".into()); }
    std::thread::spawn(move || {
        let r = work(&c2);
        let c3 = c2.clone();
        let _ = c2.ui.upgrade_in_event_loop(move |ui| match r { Ok(v) => done(&ui, &c3, v), Err(e) => { ui.global::<Api>().set_error(e.into()); fail(&ui); } });
    });
}

pub fn toast(ui: &AppWindow, msg: &str) {
    let api = ui.global::<Api>();
    api.set_toast(msg.into());
    let w = ui.as_weak();
    let m = msg.to_string();
    slint::Timer::single_shot(std::time::Duration::from_secs(4), move || { if let Some(ui) = w.upgrade() { if ui.global::<Api>().get_toast() == m.as_str() { ui.global::<Api>().set_toast("".into()); } } });
}

pub fn model<T: Clone + 'static>(v: Vec<T>) -> ModelRc<T> { ModelRc::from(Rc::new(VecModel::from(v))) }

fn server_key(c: &Client) -> String { store::account_key(c.base(), "session") }

// ---------- session ----------
pub fn init(ctx: &Ctx, ui: &AppWindow) {
    let api = ui.global::<Api>();
    let server = store::setting("server").and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| nebulix_core::DEFAULT_SERVER.into());
    api.set_server(server.clone().into());
    api.set_version(env!("CARGO_PKG_VERSION").into());
    api.set_platform(platform().into());
    api.set_desktop(cfg!(any(target_os = "windows", target_os = "macos", target_os = "linux")));
    let lang = store::setting("lang").and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| "es".into());
    crate::i18n::set_lang(&lang);
    api.set_lang(lang.into());
    let dark = store::setting("dark").and_then(|v| v.as_bool()).unwrap_or(true);
    ui.global::<Theme>().set_dark(dark);
    api.set_os_notify(store::setting("osNotify").and_then(|v| v.as_bool()).unwrap_or(true));
    *ctx.client.lock().unwrap() = Client::new(&server);
    // resume a saved session
    let c = ctx.client();
    if let Some(cookie) = store::get_secret(&server_key(&c)) {
        c.set_session(Some(cookie));
        task(ctx, true, |ctx| ctx.client().me().map_err(|e| err_text(&e)), |ui, ctx, (u, _cfg)| {
            match u { Some(u) => signed_in(ctx, ui, u), None => { let c = ctx.client(); store::put_secret(&server_key(&c), None); } }
        });
    }
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "windows") { "Windows" } else if cfg!(target_os = "macos") { "macOS" } else if cfg!(target_os = "android") { "Android" } else if cfg!(target_os = "ios") { "iOS" } else { "Linux" }
}

pub fn set_server(ctx: &Ctx, ui: &AppWindow, url: &str) {
    let u = url.trim().trim_end_matches('/');
    if !(u.starts_with("https://") || u.starts_with("http://127.0.0.1") || u.starts_with("http://localhost")) {
        ui.global::<Api>().set_error(t("Use an https:// address").into());
        return;
    }
    store::set_setting("server", json!(u));
    *ctx.client.lock().unwrap() = Client::new(u);
    ui.global::<Api>().set_server(u.into());
    toast(ui, &t("Saved"));
}

pub fn login(ctx: &Ctx, id: String, pass: String, code: String) {
    if id.trim().is_empty() || pass.is_empty() { if let Some(ui) = ctx.ui.upgrade() { ui.global::<Api>().set_error(t("Enter your username/email and password").into()); } return; }
    task(ctx, true, move |ctx| ctx.client().login(id.trim(), &pass, if code.trim().is_empty() { None } else { Some(code.trim()) }).map_err(|e| err_text(&e)), |ui, ctx, r| {
        let api = ui.global::<Api>();
        match r {
            Login::Ok(u) => { api.set_need_2fa(false); signed_in(ctx, ui, u); }
            Login::Needs2fa => { api.set_need_2fa(true); api.set_error(t("Enter the 6-digit code from your authenticator app").into()); }
            Login::NeedsVerify { email, raw } => { *ctx.pending_email.lock().unwrap() = raw; api.set_verify_email(email.into()); }
        }
    });
}

pub fn signup(ctx: &Ctx, user: String, pass: String, email: String) {
    let lang = crate::i18n::lang();
    task(ctx, true, move |ctx| {
        let mut b = json!({ "username": user.trim(), "password": pass, "lang": lang });
        if !email.trim().is_empty() { b["email"] = json!(email.trim()); }
        ctx.client().post::<Value, _>("/api/auth/signup", &b).map_err(|e| err_text(&e))
    }, |ui, ctx, v| {
        if v.get("verify").and_then(Value::as_bool) == Some(true) {
            *ctx.pending_email.lock().unwrap() = s(&v, "emailRaw");
            ui.global::<Api>().set_verify_email(s(&v, "email").into());
        } else if let Some(u) = v.get("user") { signed_in(ctx, ui, u.clone()); }
    });
}

pub fn verify(ctx: &Ctx, code: String) {
    let email = ctx.pending_email.lock().unwrap().clone();
    task(ctx, true, move |ctx| ctx.client().post::<Value, _>("/api/auth/verify", &json!({ "email": email, "code": code.trim() })).map_err(|e| err_text(&e)),
        |ui, ctx, v| { ui.global::<Api>().set_verify_email("".into()); if let Some(u) = v.get("user").cloned() { signed_in(ctx, ui, u); } });
}

fn signed_in(ctx: &Ctx, ui: &AppWindow, u: Value) {
    let c = ctx.client();
    if let Some(cookie) = c.session() { store::put_secret(&server_key(&c), Some(&cookie)); }
    *ctx.me.lock().unwrap() = u.clone();
    apply_me(ui, &u);
    let api = ui.global::<Api>();
    api.set_signed_in(true);
    api.set_page(0);
    if let Some(l) = u.get("lang").and_then(Value::as_str) { if store::setting("lang").is_none() && (l == "es" || l == "en") { crate::i18n::set_lang(l); api.set_lang(l.into()); } }
    start_realtime(ctx);
    refresh(ctx);
    crate::chat::check_key(ctx);
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    { crate::desktop::refresh_vms(ctx, ui); crate::desktop::refresh_droid(ctx); }
}

fn apply_me(ui: &AppWindow, u: &Value) {
    let api = ui.global::<Api>();
    let name = { let d = s(u, "displayName"); if d.is_empty() { s(u, "username") } else { d } };
    api.set_me_id(s(u, "id").into());
    api.set_me_name(name.clone().into());
    api.set_me_username(s(u, "username").into());
    api.set_me_initials(initials(&name).into());
    api.set_coins(if u.get("infinite").and_then(Value::as_bool) == Some(true) { "∞".into() } else { thousands(n(u, "coins")).into() });
    api.set_gems(thousands(n(u, "gems")).into());
    api.set_level(n(u, "lvl").max(1).to_string().into());
    let tier = s(u, "tier");
    api.set_tier(if tier.is_empty() || tier == "free" { "".into() } else { tier.to_uppercase().into() });
}

pub fn refresh(ctx: &Ctx) {
    task(ctx, false, |ctx| {
        let c = ctx.client();
        let (u, _) = c.me().map_err(|e| err_text(&e))?;
        let friends: Value = c.get("/api/friends").unwrap_or(Value::Null);
        let wallet: Value = c.get("/api/wallet").unwrap_or(Value::Null);
        Ok((u, friends, wallet))
    }, |ui, ctx, (u, friends, wallet)| {
        let Some(u) = u else { signed_out(ctx, ui); return; };
        *ctx.me.lock().unwrap() = u.clone();
        apply_me(ui, &u);
        apply_friends(ui, &friends);
        apply_wallet(ui, &wallet);
        crate::chat::refresh_convs(ctx);
        crate::drive::load(ctx, None);
    });
}

pub fn logout(ctx: &Ctx) {
    let c = ctx.client();
    store::put_secret(&server_key(&c), None);
    if let Some(r) = ctx.rt.lock().unwrap().take() { r.stop(); }
    std::thread::spawn(move || c.logout());
    if let Some(ui) = ctx.ui.upgrade() { signed_out(ctx, &ui); }
}

fn signed_out(ctx: &Ctx, ui: &AppWindow) {
    *ctx.id.lock().unwrap() = None;
    ctx.peers.lock().unwrap().clear();
    ctx.notices.lock().unwrap().clear();
    let api = ui.global::<Api>();
    api.set_signed_in(false);
    api.set_key_state("loading".into());
    api.set_convs(model(vec![]));
    api.set_msgs(model(vec![]));
    api.set_open_conv("".into());
    api.set_notices(model(vec![]));
}

// ---------- realtime ----------
fn start_realtime(ctx: &Ctx) {
    if let Some(r) = ctx.rt.lock().unwrap().take() { r.stop(); }
    let c2 = ctx.clone();
    let rt = Realtime::start(ctx.client(), move |ev| {
        let c3 = c2.clone();
        let _ = c2.ui.upgrade_in_event_loop(move |ui| on_event(&c3, &ui, ev));
    });
    *ctx.rt.lock().unwrap() = Some(rt);
}

fn on_event(ctx: &Ctx, ui: &AppWindow, ev: Event) {
    let api = ui.global::<Api>();
    match ev {
        Event::Connected => api.set_online(true),
        Event::Disconnected(_) => api.set_online(false),
        Event::Unauthorized => { api.set_online(false); }
        Event::Message(m) => match s(&m, "t").as_str() {
            "dm" => crate::chat::on_dm(ctx, ui, &m),
            "dm_typing" => crate::chat::on_typing(ctx, ui, &s(&m, "from")),
            "dm_del" => crate::chat::refresh_open(ctx),
            "notify" => {
                let text = if !s(&m, "text").is_empty() { s(&m, "text") } else { t(&s(&m, "msg")) };
                push_notice(ctx, ui, &text, &s(&m, "kind"), &s(&m, "link"), true);
            }
            "friend" => {
                refresh(ctx);
                let from = s(&m, "from");
                if !from.is_empty() && from != ctx.me_id() { push_notice(ctx, ui, &t("You have a new friend request"), "friend", "", true); }
            }
            "presence" => {
                let id = s(&m, "id"); let on = m.get("online").and_then(Value::as_bool).unwrap_or(false);
                crate::chat::set_presence(ui, &id, on);
            }
            "coins" | "wallet" | "me" => refresh(ctx),
            "key" => { ctx.peers.lock().unwrap().remove(&s(&m, "id")); }
            _ => {}
        },
    }
}

pub fn push_notice(ctx: &Ctx, ui: &AppWindow, text: &str, kind: &str, link: &str, os: bool) {
    {
        let mut n = ctx.notices.lock().unwrap();
        n.insert(0, (text.to_string(), now_ms(), kind.to_string(), link.to_string()));
        n.truncate(60);
    }
    paint_notices(ctx, ui);
    let api = ui.global::<Api>();
    if api.get_page() != 0 { api.set_unread_notices(api.get_unread_notices() + 1); }
    if os && api.get_os_notify() { os_notify("Nebulix", text); }
}

pub fn paint_notices(ctx: &Ctx, ui: &AppWindow) {
    let v: Vec<NoticeItem> = ctx.notices.lock().unwrap().iter().map(|(t, at, k, l)| NoticeItem { text: t.into(), time: when(*at).into(), kind: k.into(), link: l.into() }).collect();
    ui.global::<Api>().set_notices(model(v));
}

/// A notification from the operating system (desktop). Mobile builds rely on the in-app list.
pub fn os_notify(title: &str, body: &str) {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        let (t, b) = (title.to_string(), body.to_string());
        std::thread::spawn(move || { let _ = notify_rust::Notification::new().summary(&t).body(&b).appname("Nebulix").show(); });
    }
    let _ = (title, body);
}

// ---------- daily, wallet, friends ----------
pub fn claim_daily(ctx: &Ctx) {
    task(ctx, true, |ctx| ctx.client().post::<Value, _>("/api/economy/daily", &json!({})).map_err(|e| err_text(&e)), |ui, ctx, v| {
        let msg = tv("Daily reward: +{n} coins", &[("n", &thousands(n(&v, "total")))]);
        ui.global::<Api>().set_daily_msg(msg.clone().into());
        toast(ui, &msg);
        refresh(ctx);
    });
}

fn apply_wallet(ui: &AppWindow, w: &Value) {
    if w.is_null() { return; }
    let api = ui.global::<Api>();
    let tx: Vec<Tx> = w.get("tx").and_then(Value::as_array).map(|a| a.iter().map(|x| {
        let d = n(x, "d");
        Tx { text: reason(&s(x, "r")).into(), amount: format!("{}{}", if d >= 0 { "+" } else { "" }, thousands(d)).into(), positive: d >= 0, time: when(n(x, "t")).into() }
    }).collect()).unwrap_or_default();
    api.set_txs(model(tx));
    if w.get("infinite").and_then(Value::as_bool) == Some(true) { api.set_send_limit(t("Unlimited").into()); }
    else if let Some(l) = w.get("limits") {
        api.set_send_limit(tv("Up to {max} per transfer, {day} per day ({sent} sent today)", &[("max", &thousands(n(l, "max"))), ("day", &thousands(n(l, "day"))), ("sent", &thousands(n(l, "sentToday")))]).into());
    }
}

/// Readable name for a transaction reason like "daily", "arcade:snake" or "transfer:in:@ana".
fn reason(r: &str) -> String {
    let head = r.split(':').next().unwrap_or(r);
    let pretty = match head {
        "daily" => t("Daily reward"), "welcome" => t("Welcome bonus"), "transfer" => t("Transfer"), "arcade" => "Arcade".into(), "casino" => t("Casino"),
        "market" | "shop" => t("Shop"), "work" => t("Work"), "invest" => t("Invest"), "pet" => t("Pets"), "quest" => t("Quests"), "admin" => t("Adjustment"), _ => head.to_string(),
    };
    let rest: Vec<&str> = r.split(':').skip(1).collect();
    if rest.is_empty() { pretty } else { format!("{pretty} · {}", rest.join(" ")) }
}

pub fn transfer(ctx: &Ctx, to: String, amount: String, note: String) {
    let amt: i64 = amount.trim().parse().unwrap_or(0);
    task(ctx, true, move |ctx| ctx.client().post::<Value, _>("/api/wallet/transfer", &json!({ "to": to.trim(), "amount": amt, "note": note })).map_err(|e| err_text(&e)).map(|_| (to, amt)), |ui, ctx, (to, amt)| {
        toast(ui, &tv("Sent {n} coins to @{u}", &[("n", &thousands(amt)), ("u", to.trim().trim_start_matches('@'))]));
        refresh(ctx);
    });
}

fn apply_friends(ui: &AppWindow, f: &Value) {
    if f.is_null() { return; }
    let mut v = vec![];
    for (k, kind) in [("incoming", "incoming"), ("friends", "friend"), ("outgoing", "outgoing")] {
        for p in f.get(k).and_then(Value::as_array).cloned().unwrap_or_default() {
            let name = s(&p, "displayName");
            v.push(Person { id: s(&p, "id").into(), initials: initials(&name).into(), name: name.into(), username: s(&p, "username").into(), kind: kind.into(), online: p.get("online").and_then(Value::as_bool).unwrap_or(false) });
        }
    }
    ui.global::<Api>().set_people(model(v));
}

pub fn friend(ctx: &Ctx, action: &'static str, arg: String) {
    task(ctx, false, move |ctx| {
        let c = ctx.client();
        let r = match action {
            "request" => c.post::<Value, _>("/api/friends/request", &json!({ "username": arg.trim().trim_start_matches('@') })),
            "accept" => c.post("/api/friends/accept", &json!({ "id": arg })),
            "decline" => c.post("/api/friends/decline", &json!({ "id": arg })),
            _ => c.delete(&format!("/api/friends/{}", nebulix_core::api::enc(&arg))),
        };
        r.map_err(|e| err_text(&e))?;
        Ok((action, arg))
    }, |ui, ctx, (action, arg)| {
        if action == "request" { toast(ui, &tv("Request sent to @{u}", &[("u", arg.trim().trim_start_matches('@'))])); }
        refresh(ctx);
    });
}

pub fn set_lang(ui: &AppWindow, l: &str) {
    crate::i18n::set_lang(l);
    store::set_setting("lang", json!(l));
    ui.global::<Api>().set_lang(SharedString::from(l));
}
