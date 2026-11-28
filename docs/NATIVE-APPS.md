# Nebulix native apps (v17)

One Rust codebase, `apps/native`, builds the Nebulix apps for **Windows, macOS, Linux, Android and iOS**. They are
real native programs: the interface is [Slint](https://slint.dev) compiled to machine code, and they talk to the
Nebulix server through its API and WebSocket. There is no web view and no copy of the website inside.

They replace the old apps: an Electron window (`apps/windows`) and a Java WebView (`apps/android`), which only
opened the website.

## Layout

| Crate | What it does |
|---|---|
| `core` (`nebulix-core`) | Blocking HTTP client with the session cookie; realtime WebSocket with reconnect; **end-to-end encryption byte-for-byte compatible with `public/js/crypto.js`** (ECDH P-256 → HKDF-SHA256 → AES-GCM-256, passphrase backups with PBKDF2 600k); secure storage (Windows Credential Manager, macOS Keychain, Secret Service on Linux, the app sandbox on mobile). |
| `local` (`nebulix-local`) | Desktop-only features that run **on this computer**: QEMU virtual machines with hardware acceleration (KVM / WHPX / HVF), a qcow2 writer (no `qemu-img` needed), a QMP client, official OS images, and the official Android Emulator installed from Google's SDK index. |
| `app` (`nebulix-app`) | The Slint UI (`ui/*.slint`) and its logic (`src/*.rs`). It builds as a desktop/iOS binary (`nebulix`) and an Android `cdylib` (`android_main`). |

Icons are [Lucide](https://lucide.dev) SVGs (ISC licence), recoloured by Slint, in `app/icons/ui`. Text glyphs and emoji are not used
as icons, because Android and iOS system fonts lack many of them.

The server needed no changes. Native requests carry no `Origin`, which the server's cross-site check allows. The
WebSocket sends the server's own origin, as the server requires.

## What the apps do

On every platform:
- **Account:** sign in (with two-step codes and e-mail verification), sign up, choose another server, and stay
  signed in with the session kept in secure storage.
- **Home:** coins, gems, level, the daily reward, and a notification center fed by the realtime socket.
  Desktop builds also show them as system notifications.
- **Messages:** end-to-end encrypted, interoperable with the web.
  - Restore your web key with its backup passphrase, or create a key.
  - Read, send and get messages live, with typing indicators and the safety number.
  - Messages from older keys show as unreadable instead of failing.
- **Friends:** requests, accept or decline, remove, and online status.
- **Drive:** folders and views (my files, recent, starred, shared, trash), new folder, star, trash and delete, and
  usage. Desktop builds also upload (native file picker) and download to *Downloads*.
- **Wallet:** balances, recent activity and sending coins.
- **Settings:** Spanish or English, dark or light theme, system notifications, sign out, and the data folder.
- **Layout:** a sidebar on wide windows and bottom tabs on phones.

Only on Windows, macOS and Linux:
- **Virtual machines.** QEMU runs each machine in its own native window with KVM (Linux), WHPX (Windows Hypervisor
  Platform) or HVF (macOS), much faster than the in-browser v86 or the server's software-only (TCG) Cloud PC.
  - Create a machine from Alpine, Debian or Ubuntu. The app downloads them from the official mirrors and checks
    them against each project's own SHA-256 list. You can also use your own ISO.
  - Set processors, RAM, disk, UEFI, and port forwards (e.g. SSH on 2222).
  - Start, ACPI shutdown, pause, resume, restart, force off and Ctrl+Alt+Del.
  - Snapshots of disk and memory, kept inside the qcow2 disk.
  - A live thumbnail of the guest screen, and the exact QEMU command for advanced users.
  - Device models are chosen from what the installed QEMU build actually has.
- **Android Emulator.** The official emulator, adb and AOSP system images (Android 10–16, no Google Play), from the
  same Google index Android Studio uses, checked against Google's SHA-1.
  - The app asks you to accept the Android SDK licence first.
  - Create phones, tablets or foldables. Each runs in its own window with GPU and hardware acceleration.
  - Cold boot, install APKs, send files to *Download*, take screenshots, rotate, set the GPS location, and list or
    uninstall apps.

The app checks whether acceleration is available and explains how to enable it when it is not. When QEMU is missing,
the app says how to install it on that system.

## Not yet in the native apps (planned)

- The other web sections (games, office, Hub, Nova AI, casino…). The native apps grow screen by screen; the website
  keeps everything.
- File picking on Android and iOS (system document picker through JNI / UIKit), so Drive uploads and downloads appear
  on phones too. Until then those two buttons are hidden on mobile.
- Push notifications while the app is closed (FCM / APNs need Firebase and Apple developer accounts).
- Viewing remote Cloud PC / Nebulix Android sessions natively with the platform's video decoder.

## Builds and releases

`.github/workflows/release.yml` builds everything on a `v*` tag, or by hand with optional publishing:

| Platform | File | Notes |
|---|---|---|
| Windows x64 | `Nebulix-Setup-<v>.exe` (Inno Setup, per-user by default), `…-windows-x64-portable.zip` | Local VMs need QEMU for Windows and "Windows Hypervisor Platform" turned on. |
| macOS (Apple Silicon + Intel) | `Nebulix-<v>-macos-universal.dmg` | Ad-hoc signed, not notarised (no Apple Developer account): open it with right-click → Open the first time. Local VMs need `brew install qemu`. |
| Linux x86_64 | `Nebulix-<v>-amd64.deb`, `Nebulix-<v>-linux-x86_64.tar.gz` | Built on Ubuntu 22.04 (glibc 2.35). QEMU from the distribution. |
| Android (arm64 + x86_64) | `Nebulix-<v>-android.apk` | Same package id (`dev.nebulix.app`) and the same release key (repository secrets), so it updates the old app in place. Its versionCode (17.8 M) is higher than the old one. |
| iOS / iPadOS 15+ | `Nebulix-<v>-ios-unsigned.ipa` | Unsigned: install with AltStore or Sideloadly. A free Apple ID has to re-sign every 7 days. CI also boots the app in the iPhone simulator and keeps a screenshot. |

## Tests

- `cargo test -p nebulix-core -p nebulix-local --lib && cargo test -p nebulix-app --lib`: encryption round trips
  and backups, the qcow2 header, and loading the web's Spanish dictionary. These also run in `ci.yml`.
- **WebCrypto interop:** `core/examples/interop.rs`, driven by a Node script that mirrors `crypto.js` step by step.
  - Rust restores a browser backup and decrypts browser messages and files.
  - The browser decrypts Rust's messages and files.
  - Both compute the same safety number.
- **Local features on a real machine** (`local/examples/localtest.rs`):
  - `index`: the live Alpine, Debian, Ubuntu and Google indexes resolve.
  - `vm`: 20 checks with KVM, including snapshots inside the app-made qcow2.
  - `android`: 13 checks; the emulator boots, takes screenshots, copies files, sets GPS, lists apps, stops and is
    deleted.
- **The whole app, headless** (`app/examples/uitest.rs`): the real app runs on Slint's software renderer against a
  local server and is driven through its own callbacks. It makes 35 checks and saves screenshots:
  - sign-in errors in Spanish;
  - end-to-end messages both ways and live;
  - friends, Drive (folder, upload, download), daily reward and transfer;
  - a KVM machine with a live thumbnail and snapshots;
  - Android detection, the phone layout, and sign-out.
- Test switches: `NEBULIX_DATA_DIR` (data folder), `NEBULIX_NO_KEYRING` (file secrets instead of the OS store),
  `NEBULIX_QEMU_DISPLAY=none`, `NEBULIX_EMU_HEADLESS=1`, `NEBULIX_ANDROID_SDK` (reuse an existing SDK).

## Building locally

```bash
cd apps/native
cargo run -p nebulix-app --release            # desktop app
cargo apk build --release -p nebulix-app      # Android (needs the NDK; see release.yml)
```
Linux needs the fontconfig, freetype, xkbcommon, wayland and X11 development packages.
