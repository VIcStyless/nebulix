//! Nebulix Drive: browse, upload (native file picker on desktop), download to the Downloads folder, folders, star, trash.
use crate::app::{model, task, toast, Ctx};
use crate::i18n::{t, tv};
use crate::util::*;
use crate::{Api, Crumb, DriveItem};
use nebulix_core::api::enc;
use serde_json::{json, Value};
use slint::ComponentHandle;

pub fn load(ctx: &Ctx, folder: Option<String>) {
    let (view, folder) = match ctx.ui.upgrade() {
        Some(ui) => { let a = ui.global::<Api>(); (a.get_drive_view().to_string(), folder.unwrap_or_else(|| a.get_drive_folder().to_string())) }
        None => return,
    };
    task(ctx, false, move |ctx| {
        let mut q = format!("/api/drive/list?view={}", enc(&view));
        if view == "files" && !folder.is_empty() { q.push_str(&format!("&parent={}", enc(&folder))); }
        ctx.client().get::<Value>(&q).map_err(|e| err_text(&e)).map(|v| (v, folder))
    }, |ui, ctx, (v, folder)| {
        let api = ui.global::<Api>();
        let items: Vec<DriveItem> = v["items"].as_array().cloned().unwrap_or_default().iter().map(|x| {
            let kind = s(x, "kind");
            DriveItem { id: s(x, "id").into(), name: s(x, "name").into(), folder: kind == "folder", size: if kind == "file" { size(n(x, "size")).into() } else { "".into() }, kind: kind.into(), when: when(n(x, "updated")).into() }
        }).collect();
        let crumbs: Vec<Crumb> = v["crumbs"].as_array().cloned().unwrap_or_default().iter().map(|c| Crumb { id: s(c, "id").into(), name: s(c, "name").into() }).collect();
        let (used, quota) = (n(&v["usage"], "used"), n(&v["usage"], "quota"));
        api.set_usage(tv("{used} of {quota} used", &[("used", &size(used)), ("quota", &size(quota))]).into());
        api.set_usage_ratio(if quota > 0 { used as f32 / quota as f32 } else { 0.0 });
        api.set_drive(model(items));
        api.set_crumbs(model(crumbs));
        api.set_drive_folder(folder.into());
        let _ = ctx;
    });
}

pub fn open(ctx: &Ctx, id: String) {
    if let Some(ui) = ctx.ui.upgrade() { ui.global::<Api>().set_drive_view("files".into()); }
    load(ctx, Some(id));
}
pub fn set_view(ctx: &Ctx, v: String) {
    if let Some(ui) = ctx.ui.upgrade() { ui.global::<Api>().set_drive_view(v.into()); ui.global::<Api>().set_drive_folder("".into()); }
    load(ctx, Some(String::new()));
}

pub fn new_folder(ctx: &Ctx, name: String) {
    let parent = ctx.ui.upgrade().map(|ui| ui.global::<Api>().get_drive_folder().to_string()).unwrap_or_default();
    task(ctx, false, move |ctx| ctx.client().post::<Value, _>("/api/drive", &json!({ "kind": "folder", "name": name.trim(), "parent": if parent.is_empty() { Value::Null } else { json!(parent) } })).map_err(|e| err_text(&e)), |_, ctx, _| load(ctx, None));
}

pub fn delete(ctx: &Ctx, id: String) {
    let view = ctx.ui.upgrade().map(|ui| ui.global::<Api>().get_drive_view().to_string()).unwrap_or_default();
    task(ctx, false, move |ctx| {
        let c = ctx.client();
        // first delete moves to the trash; deleting from the trash removes it for good
        if view == "trash" { c.delete::<Value>(&format!("/api/drive/item/{}", enc(&id))) } else { c.put::<Value, _>(&format!("/api/drive/item/{}", enc(&id)), &json!({ "trashed": true })) }.map_err(|e| err_text(&e))
    }, |_, ctx, _| load(ctx, None));
}

pub fn star(ctx: &Ctx, id: String) {
    task(ctx, false, move |ctx| {
        let c = ctx.client();
        let it: Value = c.get(&format!("/api/drive/item/{}", enc(&id))).map_err(|e| err_text(&e))?;
        let on = it["item"]["starred"].as_bool().unwrap_or(false);
        c.put::<Value, _>(&format!("/api/drive/item/{}", enc(&id)), &json!({ "starred": !on })).map_err(|e| err_text(&e))
    }, |_, ctx, _| load(ctx, None));
}

pub fn download(ctx: &Ctx, id: String) {
    task(ctx, true, move |ctx| {
        let c = ctx.client();
        let it: Value = c.get(&format!("/api/drive/item/{}", enc(&id))).map_err(|e| err_text(&e))?;
        let url = s(&it["item"], "url");
        let name = s(&it["item"], "name").replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
        if url.is_empty() { return Err(t("Not found")); }
        let data = c.get_bytes(&url, 4 << 30).map_err(|e| err_text(&e))?;
        let dir = dirs_download();
        let mut path = dir.join(&name);
        let mut i = 1;
        while path.exists() { path = dir.join(format!("({i}) {name}")); i += 1; }
        std::fs::write(&path, data).map_err(|e| e.to_string())?;
        Ok(path)
    }, |ui, _, path| toast(ui, &tv("Saved to {path}", &[("path", &path.display().to_string())])));
}

fn dirs_download() -> std::path::PathBuf {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    { if let Some(d) = rfd_download_dir() { return d; } }
    let d = nebulix_core::store::data_dir().join("Downloads");
    let _ = std::fs::create_dir_all(&d);
    d
}
#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
fn rfd_download_dir() -> Option<std::path::PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(|h| std::path::PathBuf::from(h).join("Downloads")).filter(|p| p.is_dir())
}

pub fn upload(ctx: &Ctx) {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        let Some(files) = rfd::FileDialog::new().set_title(t("Upload")).pick_files() else { return };
        let parent = ctx.ui.upgrade().map(|ui| ui.global::<Api>().get_drive_folder().to_string()).unwrap_or_default();
        task(ctx, true, move |ctx| {
            let c = ctx.client();
            let mut names = vec![];
            for f in files {
                let name = f.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
                let data = std::fs::read(&f).map_err(|e| e.to_string())?;
                let mut q = format!("/api/drive/upload?name={}", enc(&name));
                if !parent.is_empty() { q.push_str(&format!("&parent={}", enc(&parent))); }
                c.put_bytes::<Value>(&q, &data).map_err(|e| err_text(&e))?;
                names.push(name);
            }
            Ok(names.join(", "))
        }, |ui, ctx, names| { toast(ui, &tv("Uploaded {name}", &[("name", &names)])); load(ctx, None); });
    }
    let _ = ctx;
}
