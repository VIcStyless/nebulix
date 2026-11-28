//! Realtime events from `/ws` (DMs, notifications, presence…) on a background thread, reconnecting with backoff.
//! The server only accepts its own origin; a native client legitimately is that app, so it sends the base origin.
use crate::api::{user_agent, Client};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tungstenite::client::IntoClientRequest;
use tungstenite::http::HeaderValue;
use tungstenite::{Message, WebSocket};

#[derive(Debug, Clone)]
pub enum Event {
    Connected,
    Disconnected(String),
    /// A typed message from the server, e.g. {"t":"dm",...} or {"t":"notify",...}
    Message(Value),
    /// The server refused the socket because the session is no longer valid.
    Unauthorized,
}

pub struct Realtime {
    stop: Arc<AtomicBool>,
    out: Sender<String>,
}

impl Realtime {
    /// Start the socket. `on_event` runs on the socket thread; hand work to the UI with its own event-loop call.
    pub fn start(client: Client, on_event: impl Fn(Event) + Send + 'static) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let (out, rx) = channel::<String>();
        let s2 = stop.clone();
        thread::Builder::new().name("nebulix-ws".into()).spawn(move || run(client, s2, rx, on_event)).expect("spawn ws thread");
        Realtime { stop, out }
    }
    /// Send a JSON message (e.g. typing indicators). Dropped silently while disconnected.
    pub fn send(&self, v: &Value) { let _ = self.out.send(v.to_string()); }
    pub fn stop(&self) { self.stop.store(true, Ordering::SeqCst); }
}
impl Drop for Realtime {
    fn drop(&mut self) { self.stop(); }
}

type Sock = WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>;

fn connect(client: &Client) -> Result<Sock, String> {
    let mut req = client.ws_url().into_client_request().map_err(|e| e.to_string())?;
    let h = req.headers_mut();
    h.insert("Origin", HeaderValue::from_str(client.base()).map_err(|e| e.to_string())?);
    h.insert("User-Agent", HeaderValue::from_str(&user_agent()).unwrap());
    if let Some(c) = client.session() { h.insert("Cookie", HeaderValue::from_str(&c).map_err(|e| e.to_string())?); }
    let (sock, _) = tungstenite::connect(req).map_err(|e| match e {
        tungstenite::Error::Http(r) => format!("http {}", r.status().as_u16()),
        e => e.to_string(),
    })?;
    // short read timeout so the loop can also send queued messages and notice `stop`
    match sock.get_ref() {
        tungstenite::stream::MaybeTlsStream::Plain(s) => { let _ = s.set_read_timeout(Some(Duration::from_millis(250))); }
        tungstenite::stream::MaybeTlsStream::Rustls(s) => { let _ = s.get_ref().set_read_timeout(Some(Duration::from_millis(250))); }
        _ => {}
    }
    Ok(sock)
}

fn run(client: Client, stop: Arc<AtomicBool>, rx: Receiver<String>, on_event: impl Fn(Event)) {
    let mut backoff = 1u64;
    while !stop.load(Ordering::SeqCst) {
        match connect(&client) {
            Err(e) if e == "http 401" => { on_event(Event::Unauthorized); return; }
            Err(e) => { on_event(Event::Disconnected(e)); }
            Ok(mut sock) => {
                backoff = 1;
                on_event(Event::Connected);
                let reason = loop {
                    if stop.load(Ordering::SeqCst) { let _ = sock.close(None); return; }
                    loop {
                        match rx.try_recv() {
                            Ok(m) => { if sock.send(Message::text(m)).is_err() { break; } } // a failed send surfaces on the next read
                            Err(TryRecvError::Empty) => break,
                            Err(TryRecvError::Disconnected) => return,
                        }
                    }
                    match sock.read() {
                        Ok(Message::Text(t)) => { if let Ok(v) = serde_json::from_str::<Value>(t.as_str()) { on_event(Event::Message(v)); } }
                        Ok(Message::Close(_)) => break "closed".to_string(),
                        Ok(_) => {} // pings are answered by tungstenite on the next write/flush
                        Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => { let _ = sock.flush(); }
                        Err(e) => break e.to_string(),
                    }
                };
                on_event(Event::Disconnected(reason));
            }
        }
        // wait with backoff (1, 2, 4 … 30 s), still reacting to stop
        for _ in 0..(backoff * 4) { if stop.load(Ordering::SeqCst) { return; } thread::sleep(Duration::from_millis(250)); }
        backoff = (backoff * 2).min(30);
    }
}
