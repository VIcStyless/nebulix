//! Direct messages, end-to-end encrypted exactly like the web client (nebulix_core::e2ee). The identity key lives in
//! the system's secure storage; a user who already has a key on the web restores it with their backup passphrase.
use crate::app::{model, os_notify, push_notice, task, toast, Ctx};
use crate::i18n::{t, tv};
use crate::util::*;
use crate::{Api, AppWindow, Conv, Msg};
use nebulix_core::api::enc;
use nebulix_core::e2ee::{self, Identity, PubJwk, Sealed};
use nebulix_core::store;
use serde_json::{json, Value};
use slint::{ComponentHandle, Model, VecModel};

fn key_slot(ctx: &Ctx) -> String { store::account_key(ctx.client().base(), &format!("e2ee-{}", ctx.me_id())) }
fn load_local(ctx: &Ctx) -> Option<Identity> {
    store::get_secret(&key_slot(ctx)).and_then(|s| serde_json::from_str::<Value>(&s).ok()).and_then(|v| Identity::from_record(&v).ok())
}
fn save_local(ctx: &Ctx, id: &Identity) { store::put_secret(&key_slot(ctx), Some(&id.to_record().to_string())); }

/// Work out the key state (same states as the web client) and publish a local key the server does not have.
pub fn check_key(ctx: &Ctx) {
    task(ctx, false, |ctx| {
        let c = ctx.client();
        let local = load_local(ctx);
        let remote: Option<PubJwk> = match c.get::<Value>(&format!("/api/users/{}/key", enc(&ctx.me_id()))) {
            Ok(v) => serde_json::from_value(v["pub"].clone()).ok(),
            Err(e) if e.status() == 404 => None,
            Err(e) => return Err(err_text(&e)),
        };
        let state = match (&local, &remote) {
            (Some(l), Some(r)) if l.public.x == r.x && l.public.y == r.y => "ready",
            (Some(l), None) => { c.put::<Value, _>("/api/e2ee/key", &json!({ "pub": l.public })).map_err(|e| err_text(&e))?; "ready" }
            (None, None) => "none",
            (None, Some(_)) => "restore",
            _ => "mismatch",
        };
        Ok((state, local))
    }, |ui, ctx, (state, local)| {
        if state == "ready" { *ctx.id.lock().unwrap() = local; }
        ui.global::<Api>().set_key_state(state.into());
    });
}

pub fn restore_key(ctx: &Ctx, pass: String) {
    task(ctx, true, move |ctx| {
        let c = ctx.client();
        let b: Value = c.get("/api/e2ee/backup").map_err(|e| err_text(&e))?;
        let id = e2ee::restore_backup(&b["blob"], &pass).map_err(|_| t("Wrong passphrase"))?;
        let remote: Option<PubJwk> = serde_json::from_value(b["pub"].clone()).ok();
        if remote.map(|r| r.x != id.public.x || r.y != id.public.y).unwrap_or(true) {
            c.put::<Value, _>("/api/e2ee/key", &json!({ "pub": id.public })).map_err(|e| err_text(&e))?;
        }
        save_local(ctx, &id);
        Ok(id)
    }, |ui, ctx, id| {
        *ctx.id.lock().unwrap() = Some(id);
        ctx.peers.lock().unwrap().clear();
        ui.global::<Api>().set_key_state("ready".into());
        toast(ui, &t("Key restored. Your messages are readable on this device."));
        refresh_convs(ctx);
    });
}

pub fn create_key(ctx: &Ctx) {
    task(ctx, true, |ctx| {
        let id = Identity::generate();
        ctx.client().put::<Value, _>("/api/e2ee/key", &json!({ "pub": id.public })).map_err(|e| err_text(&e))?;
        save_local(ctx, &id);
        Ok(id)
    }, |ui, ctx, id| {
        *ctx.id.lock().unwrap() = Some(id);
        ctx.peers.lock().unwrap().clear();
        ui.global::<Api>().set_key_state("ready".into());
        toast(ui, &t("New key created"));
    });
}

// ---------- conversations ----------
pub fn refresh_convs(ctx: &Ctx) {
    task(ctx, false, |ctx| ctx.client().get::<Value>("/api/dm").map_err(|e| err_text(&e)), |ui, ctx, v| {
        let me = ctx.me_id();
        let mut unread = 0;
        let list: Vec<Conv> = v["conversations"].as_array().cloned().unwrap_or_default().iter().map(|c| {
            let p = &c["peer"];
            let name = s(p, "displayName");
            let u = n(c, "unread") as i32;
            unread += u;
            let last = match c.get("last").filter(|l| !l.is_null()) {
                Some(l) => format!("{}{} · {}", if s(l, "f") == me { t("You") + ": " } else { String::new() }, t("Encrypted message"), when(n(l, "t"))),
                None => String::new(),
            };
            Conv { id: s(c, "id").into(), peer_id: s(p, "id").into(), initials: initials(&name).into(), name: name.into(), username: s(p, "username").into(), unread: u, last: last.into(), online: p.get("online").and_then(Value::as_bool).unwrap_or(false) }
        }).collect();
        let api = ui.global::<Api>();
        api.set_unread_dms(unread);
        api.set_convs(model(list));
    });
}

fn decrypt_all(ctx: &Ctx, conv: &str, peer: &PubJwk, peer_id: &str, msgs: &[Value]) -> Vec<Msg> {
    let me = ctx.me_id();
    let id = ctx.id.lock().unwrap().clone();
    let key = id.and_then(|i| i.conv_key(conv, peer).ok());
    msgs.iter().map(|m| {
        let from = s(m, "f");
        let sealed = Sealed { iv: s(m, "iv"), ct: s(m, "ct") };
        let text = key.as_ref().and_then(|k| k.open(&from, &sealed).ok()).map(|p| {
            let mut t0 = s(&p, "t");
            if p.get("img").map(|x| x.is_object()).unwrap_or(false) { t0 = format!("🖼 {}", if t0.is_empty() { t("Image") } else { t0 }); }
            if p.get("v").map(|x| x.is_object()).unwrap_or(false) { t0 = format!("🎤 {}", t("Voice message")); }
            t0
        });
        let _ = peer_id;
        Msg { id: s(m, "id").into(), mine: from == me, locked: text.is_none(), text: text.unwrap_or_default().into(), time: when(n(m, "t")).into() }
    }).collect()
}

pub fn open_chat(ctx: &Ctx, peer_id: String) {
    *ctx.open_peer.lock().unwrap() = peer_id.clone();
    task(ctx, false, move |ctx| {
        let c = ctx.client();
        let v: Value = c.get(&format!("/api/dm/{}/messages?limit=100", enc(&peer_id))).map_err(|e| err_text(&e))?;
        let conv = s(&v, "id");
        let peer: Option<PubJwk> = v.get("key").and_then(|k| serde_json::from_value(k["pub"].clone()).ok());
        let msgs = v["messages"].as_array().cloned().unwrap_or_default();
        let shown = match &peer { Some(p) => decrypt_all(ctx, &conv, p, &peer_id, &msgs), None => vec![] };
        if let Some(p) = &peer { ctx.peers.lock().unwrap().insert(peer_id.clone(), (conv.clone(), p.clone())); }
        let safety = match (&peer, ctx.id.lock().unwrap().as_ref()) { (Some(p), Some(i)) => i.safety_number(p), _ => String::new() };
        let _ = c.post::<Value, _>(&format!("/api/dm/{}/read", enc(&peer_id)), &json!({}));
        Ok((conv, v["peer"].clone(), shown, safety, peer.is_some()))
    }, |ui, ctx, (conv, peer, shown, safety, has_key)| {
        let api = ui.global::<Api>();
        let name = s(&peer, "displayName");
        api.set_open_conv(if conv.is_empty() { s(&peer, "id") } else { conv }.into());
        api.set_open_peer_name(name.clone().into());
        api.set_open_peer_initials(initials(&name).into());
        api.set_safety(safety.into());
        api.set_peer_typing(false);
        api.set_msgs(model(shown));
        if !has_key { api.set_error(t("This user has not enabled encryption yet. Ask them to open Direct Messages once.").into()); }
        refresh_convs(ctx);
    });
}

/// Start a chat with someone by username.
pub fn start_chat(ctx: &Ctx, username: String) {
    let q = username.trim().trim_start_matches('@').to_lowercase();
    if q.len() < 2 { return; }
    task(ctx, false, move |ctx| {
        let v: Value = ctx.client().get(&format!("/api/users/search?q={}", enc(&q))).map_err(|e| err_text(&e))?;
        v["users"].as_array().and_then(|a| a.iter().find(|u| s(u, "username").to_lowercase() == q).map(|u| s(u, "id"))).ok_or_else(|| t("No player with that username"))
    }, |ui, ctx, id| { ui.global::<Api>().set_page(1); open_chat(ctx, id); });
}

pub fn send(ctx: &Ctx, text: String) {
    let text = text.trim().to_string();
    if text.is_empty() { return; }
    let peer_id = ctx.open_peer.lock().unwrap().clone();
    task(ctx, false, move |ctx| {
        let me = ctx.me_id();
        let (conv, peer) = ctx.peers.lock().unwrap().get(&peer_id).cloned().ok_or_else(|| t("This user has not enabled encryption yet. Ask them to open Direct Messages once."))?;
        let id = ctx.id.lock().unwrap().clone().ok_or_else(|| t("Create your encryption key first"))?;
        let sealed = id.conv_key(&conv, &peer).map_err(|_| t("Invalid public key"))?.seal(&me, &text, None);
        let r: Value = ctx.client().post(&format!("/api/dm/{}/messages", enc(&peer_id)), &json!({ "iv": sealed.iv, "ct": sealed.ct })).map_err(|e| err_text(&e))?;
        Ok((s(&r["message"], "id"), text, n(&r["message"], "t")))
    }, |ui, _ctx, (mid, text, at)| append(ui, Msg { id: mid.into(), mine: true, text: text.into(), time: when(at).into(), locked: false }));
}

fn append(ui: &AppWindow, m: Msg) {
    let api = ui.global::<Api>();
    let cur = api.get_msgs();
    if cur.iter().any(|x| x.id == m.id) { return; }
    let mut v: Vec<Msg> = cur.iter().collect();
    v.push(m);
    api.set_msgs(slint::ModelRc::from(std::rc::Rc::new(VecModel::from(v))));
}

/// A `dm` event from the socket (also echoes our own messages).
pub fn on_dm(ctx: &Ctx, ui: &AppWindow, ev: &Value) {
    let me = ctx.me_id();
    let from = s(ev, "from");
    let peer_id = if from == me { s(ev, "to") } else { from.clone() };
    let open = ctx.open_peer.lock().unwrap().clone();
    let api = ui.global::<Api>();
    if open == peer_id && api.get_page() == 1 {
        let cached = ctx.peers.lock().unwrap().get(&peer_id).cloned();
        if let Some((conv, peer)) = cached {
            let m = decrypt_all(ctx, &conv, &peer, &peer_id, std::slice::from_ref(&ev["m"]));
            if let Some(m) = m.into_iter().next() { append(ui, m); }
            api.set_peer_typing(false);
            // mark as read first, then refresh the list (one worker, in order, so the badge does not come back)
            task(ctx, false, move |ctx| { let _ = ctx.client().post::<Value, _>(&format!("/api/dm/{}/read", enc(&peer_id)), &json!({})); Ok(()) }, |_, ctx, _| refresh_convs(ctx));
            return;
        }
    } else if from != me {
        let name = { let d = s(&ev["u"], "displayName"); if d.is_empty() { s(&ev["u"], "username") } else { d } };
        let text = tv("New message from {name}", &[("name", &name)]);
        push_notice(ctx, ui, &text, "dm", "", false);
        if api.get_os_notify() { os_notify("Nebulix", &text); }
    }
    refresh_convs(ctx);
}

pub fn typing(ctx: &Ctx) {
    let now = now_ms();
    { let mut l = ctx.last_typing.lock().unwrap(); if now - *l < 3000 { return; } *l = now; }
    let peer = ctx.open_peer.lock().unwrap().clone();
    if peer.is_empty() { return; }
    let c = ctx.client();
    std::thread::spawn(move || { let _: Result<Value, _> = c.post(&format!("/api/dm/{}/typing", enc(&peer)), &json!({})); });
}

pub fn on_typing(ctx: &Ctx, ui: &AppWindow, from: &str) {
    if *ctx.open_peer.lock().unwrap() != from { return; }
    ui.global::<Api>().set_peer_typing(true);
    let w = ui.as_weak();
    slint::Timer::single_shot(std::time::Duration::from_secs(4), move || { if let Some(ui) = w.upgrade() { ui.global::<Api>().set_peer_typing(false); } });
}

pub fn refresh_open(ctx: &Ctx) { let p = ctx.open_peer.lock().unwrap().clone(); if !p.is_empty() { open_chat(ctx, p); } }

pub fn set_presence(ui: &AppWindow, id: &str, on: bool) {
    let api = ui.global::<Api>();
    let convs = api.get_convs();
    for i in 0..convs.row_count() { if let Some(mut c) = convs.row_data(i) { if c.peer_id == id && c.online != on { c.online = on; convs.set_row_data(i, c); } } }
    let people = api.get_people();
    for i in 0..people.row_count() { if let Some(mut p) = people.row_data(i) { if p.id == id && p.online != on { p.online = on; people.set_row_data(i, p); } } }
}
