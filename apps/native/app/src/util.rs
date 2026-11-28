use crate::i18n::t;
use chrono::{Local, TimeZone};
use serde_json::Value;

pub fn s(v: &Value, k: &str) -> String { v.get(k).and_then(Value::as_str).unwrap_or("").to_string() }
pub fn n(v: &Value, k: &str) -> i64 { v.get(k).and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64))).unwrap_or(0) }

/// Two-letter initials for the avatar circle.
pub fn initials(name: &str) -> String {
    let w: Vec<&str> = name.split_whitespace().collect();
    let pick = |s: &str| s.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
    match w.len() { 0 => "?".into(), 1 => w[0].chars().take(2).collect::<String>().to_uppercase(), _ => pick(w[0]) + &pick(w[1]) }
}

pub fn now_ms() -> i64 { chrono::Utc::now().timestamp_millis() }

/// "14:05" today, "ayer"/"yesterday", otherwise a short date.
pub fn when(ms: i64) -> String {
    if ms <= 0 { return String::new(); }
    let Some(d) = Local.timestamp_millis_opt(ms).single() else { return String::new() };
    let today = Local::now().date_naive();
    if d.date_naive() == today { d.format("%H:%M").to_string() }
    else if Some(d.date_naive()) == today.pred_opt() { t("Yesterday") }
    else { d.format("%d/%m/%Y").to_string() }
}

pub fn size(b: i64) -> String {
    let b = b as f64;
    if b < 1024.0 { format!("{} B", b as i64) } else if b < 1048576.0 { format!("{:.0} KB", b / 1024.0) } else if b < 1073741824.0 { format!("{:.1} MB", b / 1048576.0) } else { format!("{:.2} GB", b / 1073741824.0) }
}

pub fn thousands(n: i64) -> String {
    let s = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() { if i > 0 && (s.len() - i) % 3 == 0 { out.push('.'); } out.push(c); }
    if n < 0 { format!("-{out}") } else { out }
}

pub fn err_text(e: &nebulix_core::ApiError) -> String {
    match e {
        nebulix_core::ApiError::Network(_) => t("Network error. Check your connection."),
        nebulix_core::ApiError::Server { message, .. } => t(message),
        nebulix_core::ApiError::Decode(m) => m.clone(),
    }
}
