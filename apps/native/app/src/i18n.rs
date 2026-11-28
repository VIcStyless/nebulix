//! Translations. UI strings use Slint's @tr() with lang/<locale>/LC_MESSAGES/nebulix-app.po (bundled at build time).
//! Messages that come from the server (errors, notices) are English; for Spanish they are looked up in the web app's
//! own dictionary, public/js/es.js, embedded at build time — one source of truth for both clients.
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

static ES_JS: &str = include_str!("../../../../public/js/es.js");
static ES: OnceLock<HashMap<String, String>> = OnceLock::new();
static LANG: RwLock<String> = RwLock::new(String::new());

fn parse_js_string(s: &str) -> Option<(String, &str)> {
    // s starts with '"'; returns the decoded string and the rest after the closing quote (JSON-compatible escapes)
    let b = s.as_bytes();
    if b.first() != Some(&b'"') { return None; }
    let mut i = 1;
    while i < b.len() { match b[i] { b'\\' => i += 2, b'"' => break, _ => i += 1 } }
    let raw = s.get(..=i)?;
    Some((serde_json::from_str::<String>(raw).ok()?, &s[i + 1..]))
}

fn es() -> &'static HashMap<String, String> {
    ES.get_or_init(|| {
        let mut m = HashMap::new();
        for line in ES_JS.lines() {
            let l = line.trim_start();
            let Some((k, rest)) = parse_js_string(l) else { continue };
            let rest = rest.trim_start();
            let Some(rest) = rest.strip_prefix(':') else { continue };
            if let Some((v, _)) = parse_js_string(rest.trim_start()) { m.insert(k, v); }
        }
        m
    })
}

pub fn set_lang(l: &str) {
    *LANG.write().unwrap() = l.to_string();
    let _ = slint::select_bundled_translation(if l == "es" { "es" } else { "" });
}
pub fn lang() -> String { let l = LANG.read().unwrap().clone(); if l.is_empty() { "es".into() } else { l } }

/// Translate an English string (server message or Rust-side text). `{name}` placeholders are filled from `vars`.
pub fn t(s: &str) -> String { tv(s, &[]) }
pub fn tv(s: &str, vars: &[(&str, &str)]) -> String {
    let mut out = if lang() == "es" { es().get(s).cloned().or_else(|| es_extra(s).map(str::to_string)).or_else(|| es_prefix(s)).unwrap_or_else(|| s.to_string()) } else { s.to_string() };
    for (k, v) in vars { out = out.replace(&format!("{{{k}}}"), v); }
    out
}

/// Messages that end with technical details (QEMU / emulator output): translate the fixed start, keep the details.
fn es_prefix(s: &str) -> Option<String> {
    const P: &[(&str, &str)] = &[("QEMU stopped: ", "QEMU se ha detenido: "), ("The emulator stopped", "El emulador se ha detenido"), ("download failed: ", "la descarga ha fallado: "),
        ("could not unpack: ", "no se ha podido descomprimir: "), ("Use between 1 and ", "Usa entre 1 y "), ("There is no ", "No hay ninguna imagen "), ("network error: ", "error de red: ")];
    P.iter().find(|(en, _)| s.starts_with(en)).map(|(en, es)| format!("{es}{}", s[en.len()..].replace(" processors", " procesadores").replace(" image of this Android version for this computer", " de esta versión de Android para este ordenador")))
}

/// Strings used only by the native app (Rust side) that the web dictionary does not have.
fn es_extra(s: &str) -> Option<&'static str> {
    Some(match s {
        "Network error. Check your connection." => "Error de red. Comprueba tu conexión.",
        "Connected" => "Conectado",
        "Saved to {path}" => "Guardado en {path}",
        "Uploaded {name}" => "Subido {name}",
        "Downloading {what}" => "Descargando {what}",
        "Unpacking" => "Descomprimiendo",
        "Ready" => "Listo",
        "Android is ready" => "Android está listo",
        "Starting {name}…" => "Iniciando {name}…",
        "{name} started in its own window" => "{name} se ha iniciado en su propia ventana",
        "Snapshot saved" => "Instantánea guardada",
        "Snapshot restored" => "Instantánea restaurada",
        "Screenshot saved to {path}" => "Captura guardada en {path}",
        "Installed: {what}" => "Instalado: {what}",
        "File sent to the Download folder" => "Archivo enviado a la carpeta Descargas",
        "Location set" => "Ubicación establecida",
        "New message from {name}" => "Nuevo mensaje de {name}",
        "Encrypted message" => "Mensaje cifrado",
        "Key restored. Your messages are readable on this device." => "Clave restaurada. Tus mensajes se pueden leer en este dispositivo.",
        "New key created" => "Nueva clave creada",
        "Wrong passphrase" => "Frase de contraseña incorrecta",
        "Daily reward: +{n} coins" => "Premio diario: +{n} monedas",
        "Sent {n} coins to @{u}" => "Has enviado {n} monedas a @{u}",
        "{used} of {quota} used" => "{used} de {quota} usados",
        "QEMU {qemu} · acceleration: {accel} · {cpus} processors · {ram} GB RAM" => "QEMU {qemu} · aceleración: {accel} · {cpus} procesadores · {ram} GB de RAM",
        "not installed" => "no instalado",
        "software only (slow)" => "solo software (lenta)",
        "Up to {max} per transfer, {day} per day ({sent} sent today)" => "Hasta {max} por envío, {day} al día ({sent} enviadas hoy)",
        "Unlimited" => "Ilimitado",
        "Hardware acceleration: {what}" => "Aceleración por hardware: {what}",
        "Request sent to @{u}" => "Solicitud enviada a @{u}",
        "@{u} wants to be your friend" => "@{u} quiere ser tu amigo",
        "Install QEMU for Windows (qemu.org/download) and turn on \"Windows Hypervisor Platform\" in Windows features." => "Instala QEMU para Windows (qemu.org/download) y activa «Plataforma del hipervisor de Windows» en las características de Windows.",
        "Install QEMU with Homebrew: brew install qemu" => "Instala QEMU con Homebrew: brew install qemu",
        "Install QEMU from your distribution (e.g. sudo apt install qemu-system-x86 or sudo pacman -S qemu-full)." => "Instala QEMU desde tu distribución (p. ej. sudo apt install qemu-system-x86 o sudo pacman -S qemu-full).",
        "Hardware acceleration is off: turn on \"Windows Hypervisor Platform\" in Windows features and restart." => "La aceleración por hardware está desactivada: activa «Plataforma del hipervisor de Windows» en las características de Windows y reinicia.",
        "Hardware acceleration is off: enable virtualisation (VT-x/AMD-V) in the BIOS and add your user to the kvm group." => "La aceleración por hardware está desactivada: activa la virtualización (VT-x/AMD-V) en la BIOS y añade tu usuario al grupo kvm.",
        "Hardware acceleration is not available; machines will be slow." => "La aceleración por hardware no está disponible; las máquinas irán lentas.",
        "QEMU is not installed on this computer" => "QEMU no está instalado en este ordenador",
        "this machine is already running" => "esta máquina ya está en marcha",
        "this machine is not running" => "esta máquina no está en marcha",
        "Give the machine a name (1-60 characters)" => "Ponle nombre a la máquina (1-60 caracteres)",
        "Not enough free memory for that much RAM" => "No hay memoria libre suficiente para tanta RAM",
        "Disk size must be between 1 and 2048 GB" => "El disco debe tener entre 1 y 2048 GB",
        "The installation image was not found" => "No se ha encontrado la imagen de instalación",
        "Forwarded host ports must be 1024 or higher" => "Los puertos redirigidos deben ser 1024 o mayores",
        "Snapshot names use letters, numbers, - and _ (max 40)" => "Los nombres de instantánea usan letras, números, - y _ (máx. 40)",
        "UEFI firmware (edk2) was not found next to QEMU" => "No se ha encontrado el firmware UEFI (edk2) junto a QEMU",
        "Give the device a name (1-40 characters)" => "Ponle nombre al dispositivo (1-40 caracteres)",
        "Download this Android version first" => "Descarga antes esta versión de Android",
        "This device is already running" => "Este dispositivo ya está en marcha",
        "Install the Android Emulator first" => "Instala antes el emulador de Android",
        "This device is not running" => "Este dispositivo no está en marcha",
        "Stop the device first" => "Detén antes el dispositivo",
        "Choose an .apk file" => "Elige un archivo .apk",
        "Invalid coordinates" => "Coordenadas no válidas",
        "Could not take the screenshot" => "No se ha podido hacer la captura",
        "the file is damaged (checksum does not match)" => "el archivo está dañado (la suma de comprobación no coincide)",
        "cancelled" => "cancelado",
        "Reading Google's SDK index" => "Leyendo el índice del SDK de Google",
        "Reading Google's system image index" => "Leyendo el índice de imágenes de sistema de Google",
        "Android Emulator" => "Emulador de Android",
        "Android platform tools (adb)" => "Herramientas de plataforma de Android (adb)",
        "Android system image" => "Imagen de sistema de Android",
        "Use between 1 and {n} processors" => "Usa entre 1 y {n} procesadores",
        "Wrong username/email or password" => "Usuario/correo o contraseña incorrectos",
        "Enter the 6-digit code from your authenticator app" => "Escribe el código de 6 cifras de tu app de autenticación",
        "Use an https:// address" => "Usa una dirección https://",
        "Create your encryption key first" => "Crea antes tu clave de cifrado",
        "Invalid public key" => "Clave pública no válida",
        "No player with that username" => "No hay ningún jugador con ese usuario",
        "This user has not enabled encryption yet. Ask them to open Direct Messages once." => "Este usuario aún no ha activado el cifrado. Pídele que abra Mensajes directos una vez.",
        "Ports look like 2222:22 (computer:machine)" => "Los puertos se escriben así: 2222:22 (ordenador:máquina)",
        "Install APK…" => "Instalar APK…",
        "Send file…" => "Enviar archivo…",
        "Use my own ISO…" => "Usar mi propia ISO…",
        "Adjustment" => "Ajuste",
        "Quests" => "Misiones",
        "Phone (1080×2400)" => "Teléfono (1080×2400)",
        "Tablet (2560×1600)" => "Tableta (2560×1600)",
        "Foldable (1840×2208)" => "Plegable (1840×2208)",
        "Small phone (720×1280)" => "Teléfono pequeño (720×1280)",
        "Tiny and fast; boots in seconds. Good for servers and testing." => "Pequeño y rápido; arranca en segundos. Ideal para servidores y pruebas.",
        "Stable Linux; the installer downloads what you choose." => "Linux estable; el instalador descarga lo que elijas.",
        "Full desktop with apps, ready to use." => "Escritorio completo con apps, listo para usar.",
        "Unknown Android version" => "Versión de Android desconocida",
        "Unknown device type" => "Tipo de dispositivo desconocido",
        "Unknown architecture" => "Arquitectura desconocida",
        "You have a new friend request" => "Tienes una nueva solicitud de amistad",
        "Image" => "Imagen",
        "Voice message" => "Mensaje de voz",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn loads_the_web_dictionary() {
        assert!(super::es().len() > 5000);
        super::set_lang("es");
        assert_eq!(super::t("Pick a game"), super::es()["Pick a game"]);
        assert_eq!(super::t("Wrong username/email or password"), "Usuario/correo o contraseña incorrectos");
        assert_eq!(super::t("QEMU stopped: bad option"), "QEMU se ha detenido: bad option");
        assert_eq!(super::t("No such English string here"), "No such English string here");
    }
}
