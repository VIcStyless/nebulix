//! Minimal QMP (QEMU Machine Protocol) client over TCP on 127.0.0.1.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::Duration;

pub struct Qmp {
    rd: BufReader<TcpStream>,
    wr: TcpStream,
}

impl Qmp {
    pub fn connect(port: u16) -> std::io::Result<Self> {
        let s = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2))?;
        s.set_read_timeout(Some(Duration::from_secs(30)))?;
        let mut q = Qmp { rd: BufReader::new(s.try_clone()?), wr: s };
        q.read_one()?; // greeting
        q.cmd("qmp_capabilities", None)?;
        Ok(q)
    }
    fn read_one(&mut self) -> std::io::Result<Value> {
        let mut line = String::new();
        if self.rd.read_line(&mut line)? == 0 { return Err(std::io::Error::other("QEMU closed the control connection")); }
        serde_json::from_str(&line).map_err(std::io::Error::other)
    }
    /// Run a command and return its "return" value (events in between are skipped).
    pub fn cmd(&mut self, name: &str, args: Option<Value>) -> std::io::Result<Value> {
        let mut m = json!({ "execute": name });
        if let Some(a) = args { m["arguments"] = a; }
        self.wr.write_all(format!("{m}\n").as_bytes())?;
        loop {
            let v = self.read_one()?;
            if let Some(r) = v.get("return") { return Ok(r.clone()); }
            if let Some(e) = v.get("error") { return Err(std::io::Error::other(e.get("desc").and_then(Value::as_str).unwrap_or("QEMU error").to_string())); }
        }
    }
    /// Human monitor command (savevm, loadvm, info snapshots…). QEMU reports failures as text in the answer.
    pub fn hmp(&mut self, line: &str) -> std::io::Result<String> {
        let r = self.cmd("human-monitor-command", Some(json!({ "command-line": line })))?;
        let out = r.as_str().unwrap_or("").to_string();
        if out.to_ascii_lowercase().contains("error") { return Err(std::io::Error::other(out.trim().to_string())); }
        Ok(out)
    }
}
