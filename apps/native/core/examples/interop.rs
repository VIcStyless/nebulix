//! Interop check with the browser's WebCrypto (driven by a Node script; see docs/NATIVE-APPS.md).
//! stdin: {"backup":{...},"pass":"...","conv":"...","me":"<my uid>","peer":"<peer uid>","peerPub":{...},"msg":{"iv","ct"},"bytes":{"iv","data"}}
//! stdout: {"pub":{...},"text":"...","bytes":"<b64>","reply":{"iv","ct"},"file":{"iv","data"},"safety":"..."}
use base64::{engine::general_purpose::STANDARD, Engine};
use nebulix_core::e2ee::*;
use serde_json::{json, Value};
fn main() {
    let v: Value = serde_json::from_reader(std::io::stdin()).unwrap();
    let id = restore_backup(&v["backup"], v["pass"].as_str().unwrap()).expect("restore backup");
    let peer: PubJwk = serde_json::from_value(v["peerPub"].clone()).unwrap();
    let conv = v["conv"].as_str().unwrap();
    let k = id.conv_key(conv, &peer).unwrap();
    let msg: Sealed = serde_json::from_value(v["msg"].clone()).unwrap();
    let text = k.open_text(v["peer"].as_str().unwrap(), &msg).expect("open message from peer");
    let data = STANDARD.decode(v["bytes"]["data"].as_str().unwrap()).unwrap();
    let bytes = k.open_bytes(v["peer"].as_str().unwrap(), v["bytes"]["iv"].as_str().unwrap(), &data).expect("open file");
    let reply = k.seal(v["me"].as_str().unwrap(), &format!("RE: {text}"), None);
    let (fiv, fdata) = k.seal_bytes(v["me"].as_str().unwrap(), b"native file \x00\xff");
    println!("{}", json!({ "pub": id.public, "text": text, "bytes": STANDARD.encode(bytes), "reply": reply, "file": { "iv": fiv, "data": STANDARD.encode(fdata) }, "safety": id.safety_number(&peer) }));
}
