// No console window behind the app on Windows release builds.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

fn main() {
    // iOS: keep data inside the app container (Library/Application Support is backed up and never cleaned)
    #[cfg(target_os = "ios")]
    if let Some(h) = std::env::var_os("HOME") { nebulix_core::store::set_data_dir(std::path::PathBuf::from(h).join("Library/Application Support/Nebulix")); }
    if let Err(e) = nebulix_app::run() {
        eprintln!("Nebulix could not start: {e}");
        std::process::exit(1);
    }
}
