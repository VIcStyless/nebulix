//! Blocking HTTP client for the Nebulix API. Call it from worker threads, never from the UI thread.
//! Auth is the same session cookie the web uses (`nx_sid`, or `__Host-nx_sid` on HTTPS). Native requests carry no
//! `Origin` / `Sec-Fetch-Site`, which the server's cross-site check allows (it only blocks browsers on other sites).
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, thiserror::Error)]
pub enum ApiError {
    /// The server answered with an error: HTTP status, machine code and a human message (English; translate with i18n).
    #[error("{message}")]
    Server { status: u16, code: String, message: String },
    #[error("network error: {0}")]
    Network(String),
    #[error("unexpected answer from the server: {0}")]
    Decode(String),
}
impl ApiError {
    pub fn status(&self) -> u16 { if let ApiError::Server { status, .. } = self { *status } else { 0 } }
    pub fn code(&self) -> &str { if let ApiError::Server { code, .. } = self { code } else { "" } }
    pub fn is_auth(&self) -> bool { self.status() == 401 }
}
pub type ApiResult<T> = Result<T, ApiError>;

/// What `POST /api/auth/login` can answer.
#[derive(Debug, Clone)]
pub enum Login {
    Ok(Value),
    /// The account has two-step verification: ask for the 6-digit code and log in again with it.
    Needs2fa,
    /// The e-mail is not verified yet: a code was sent to `email` (masked).
    NeedsVerify { email: String, raw: String },
}

#[derive(Clone)]
pub struct Client {
    inner: Arc<Inner>,
}
struct Inner {
    base: String,
    agent: ureq::Agent,
    /// "name=value" of the session cookie
    cookie: Mutex<Option<String>>,
}

pub fn user_agent() -> String {
    format!("NebulixNative/{} ({}; {})", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH)
}

impl Client {
    /// `base` like "https://nebulix.fly.dev" (no trailing slash needed).
    pub fn new(base: &str) -> Self {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(60)))
            .timeout_connect(Some(Duration::from_secs(15)))
            .user_agent(user_agent())
            .build()
            .into();
        Client { inner: Arc::new(Inner { base: base.trim_end_matches('/').to_string(), agent, cookie: Mutex::new(None) }) }
    }
    pub fn base(&self) -> &str { &self.inner.base }
    pub fn session(&self) -> Option<String> { self.inner.cookie.lock().unwrap().clone() }
    pub fn set_session(&self, c: Option<String>) { *self.inner.cookie.lock().unwrap() = c; }
    pub fn url(&self, path: &str) -> String { format!("{}{}", self.inner.base, path) }
    /// The WebSocket URL for realtime events (wss:// on HTTPS).
    pub fn ws_url(&self) -> String {
        let b = &self.inner.base;
        let b = if let Some(r) = b.strip_prefix("https://") { format!("wss://{r}") } else if let Some(r) = b.strip_prefix("http://") { format!("ws://{r}") } else { b.clone() };
        format!("{b}/ws")
    }

    fn take_cookie(&self, resp: &ureq::http::Response<ureq::Body>) {
        for v in resp.headers().get_all("set-cookie") {
            let Ok(v) = v.to_str() else { continue };
            let kv = v.split(';').next().unwrap_or("").trim();
            let Some((name, val)) = kv.split_once('=') else { continue };
            if name == "nx_sid" || name == "__Host-nx_sid" {
                // an expired / cleared cookie means the session ended
                let gone = val.is_empty() || v.to_ascii_lowercase().contains("max-age=0");
                *self.inner.cookie.lock().unwrap() = if gone { None } else { Some(kv.to_string()) };
            }
        }
    }

    fn finish<T: DeserializeOwned>(&self, r: Result<ureq::http::Response<ureq::Body>, ureq::Error>) -> ApiResult<T> {
        let mut resp = r.map_err(|e| ApiError::Network(e.to_string()))?;
        self.take_cookie(&resp);
        let status = resp.status().as_u16();
        let text = resp.body_mut().with_config().limit(64 << 20).read_to_string().map_err(|e| ApiError::Network(e.to_string()))?;
        if !(200..300).contains(&status) {
            let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            return Err(ApiError::Server {
                status,
                code: v.get("error").and_then(Value::as_str).unwrap_or("http_error").to_string(),
                message: v.get("message").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("HTTP {status}")),
            });
        }
        let body = if text.trim().is_empty() { "null" } else { &text };
        serde_json::from_str(body).map_err(|e| ApiError::Decode(format!("{e} in {}", &text.chars().take(120).collect::<String>())))
    }

    fn with_auth<B>(&self, rb: ureq::RequestBuilder<B>) -> ureq::RequestBuilder<B> {
        match self.session() { Some(c) => rb.header("Cookie", c), None => rb }
    }

    pub fn get<T: DeserializeOwned>(&self, path: &str) -> ApiResult<T> {
        self.finish(self.with_auth(self.inner.agent.get(&self.url(path))).call())
    }
    pub fn post<T: DeserializeOwned, B: Serialize>(&self, path: &str, body: &B) -> ApiResult<T> {
        self.finish(self.with_auth(self.inner.agent.post(&self.url(path))).send_json(body))
    }
    pub fn put<T: DeserializeOwned, B: Serialize>(&self, path: &str, body: &B) -> ApiResult<T> {
        self.finish(self.with_auth(self.inner.agent.put(&self.url(path))).send_json(body))
    }
    pub fn patch<T: DeserializeOwned, B: Serialize>(&self, path: &str, body: &B) -> ApiResult<T> {
        self.finish(self.with_auth(self.inner.agent.patch(&self.url(path))).send_json(body))
    }
    pub fn delete<T: DeserializeOwned>(&self, path: &str) -> ApiResult<T> {
        self.finish(self.with_auth(self.inner.agent.delete(&self.url(path))).call())
    }
    /// Raw upload (the body is the file bytes), used by Drive.
    pub fn post_bytes<T: DeserializeOwned>(&self, path: &str, content_type: &str, data: &[u8]) -> ApiResult<T> {
        self.finish(self.with_auth(self.inner.agent.post(&self.url(path))).header("Content-Type", content_type).send(data))
    }
    /// Raw upload with PUT (Drive uploads stream the file as the request body).
    pub fn put_bytes<T: DeserializeOwned>(&self, path: &str, data: &[u8]) -> ApiResult<T> {
        self.finish(self.with_auth(self.inner.agent.put(&self.url(path))).header("Content-Type", "application/octet-stream").send(data))
    }
    /// Download bytes (files, avatars). Gives up above `max` bytes.
    pub fn get_bytes(&self, path_or_url: &str, max: u64) -> ApiResult<Vec<u8>> {
        let url = if path_or_url.starts_with("http") { path_or_url.to_string() } else { self.url(path_or_url) };
        let same = url.starts_with(&self.inner.base);
        let rb = self.inner.agent.get(&url);
        let rb = if same { self.with_auth(rb) } else { rb };
        let mut resp = rb.call().map_err(|e| ApiError::Network(e.to_string()))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) { return Err(ApiError::Server { status, code: "http_error".into(), message: format!("HTTP {status}") }); }
        let mut out = Vec::new();
        resp.body_mut().as_reader().take(max + 1).read_to_end(&mut out).map_err(|e| ApiError::Network(e.to_string()))?;
        if out.len() as u64 > max { return Err(ApiError::Decode("file too large".into())); }
        Ok(out)
    }

    // ---------- auth ----------
    pub fn login(&self, id: &str, password: &str, code: Option<&str>) -> ApiResult<Login> {
        let mut b = serde_json::json!({ "id": id, "password": password });
        if let Some(c) = code { b["code"] = c.into(); }
        let v: Value = self.post("/api/auth/login", &b)?;
        if v.get("needs2fa").and_then(Value::as_bool) == Some(true) { return Ok(Login::Needs2fa); }
        if v.get("needsVerify").and_then(Value::as_bool) == Some(true) {
            return Ok(Login::NeedsVerify { email: v.get("email").and_then(Value::as_str).unwrap_or("").to_string(), raw: v.get("emailRaw").and_then(Value::as_str).unwrap_or("").to_string() });
        }
        Ok(Login::Ok(v.get("user").cloned().unwrap_or(Value::Null)))
    }
    /// The signed-in user (`None` when the session is gone) and the server config.
    pub fn me(&self) -> ApiResult<(Option<Value>, Value)> {
        let v: Value = self.get("/api/me")?;
        let u = v.get("user").cloned().filter(|u| !u.is_null());
        if u.is_none() { self.set_session(None); }
        Ok((u, v.get("config").cloned().unwrap_or(Value::Null)))
    }
    pub fn logout(&self) {
        let _: ApiResult<Value> = self.post("/api/auth/logout", &serde_json::json!({}));
        self.set_session(None);
    }
}

/// Percent-encode one path segment or query value.
pub fn enc(s: &str) -> String { url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>().replace('+', "%20") }
