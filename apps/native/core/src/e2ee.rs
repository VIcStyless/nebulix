//! End-to-end encryption for direct messages, byte-for-byte compatible with `public/js/crypto.js`:
//!   identity : ECDH P-256 key pair per account (stored as a JWK record `{ privJwk, pub }`, like the browser's IndexedDB)
//!   per-chat : ECDH shared secret -> HKDF-SHA256 (salt = conversation id, info "nebulix-dm-v1") -> AES-GCM-256
//!   message  : random 96-bit IV, AAD "<convId>|<senderId>", plaintext JSON {"t": text, ...}
//!   files    : same key, AAD "<convId>|<senderId>|file"
//!   backup   : the record encrypted with PBKDF2-SHA256 (600k) -> AES-GCM, AAD "nebulix-backup-v1"
#![allow(deprecated)] // aes-gcm 0.10 still exposes generic-array 0.14 helpers
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use hkdf::Hkdf;
use p256::elliptic_curve::sec1::{FromEncodedPoint, ToEncodedPoint};
use p256::EncodedPoint;
use p256::{PublicKey, SecretKey};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("invalid key")]
    BadKey,
    #[error("cannot decrypt")]
    Decrypt,
    #[error("wrong passphrase")]
    BadPass,
    #[error("passphrase too short")]
    Short,
}

/// Public half of a key, as JWK coordinates (base64url without padding), exactly as the server stores it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PubJwk {
    #[serde(default = "ec")]
    pub kty: String,
    #[serde(default = "p256name")]
    pub crv: String,
    pub x: String,
    pub y: String,
}
fn ec() -> String { "EC".into() }
fn p256name() -> String { "P-256".into() }

impl PubJwk {
    pub fn to_key(&self) -> Result<PublicKey, CryptoError> {
        let x = URL_SAFE_NO_PAD.decode(&self.x).map_err(|_| CryptoError::BadKey)?;
        let y = URL_SAFE_NO_PAD.decode(&self.y).map_err(|_| CryptoError::BadKey)?;
        if x.len() != 32 || y.len() != 32 { return Err(CryptoError::BadKey); }
        let mut sec1 = Vec::with_capacity(65);
        sec1.push(4u8);
        sec1.extend_from_slice(&x);
        sec1.extend_from_slice(&y);
        let pt = EncodedPoint::from_bytes(&sec1).map_err(|_| CryptoError::BadKey)?;
        Option::from(PublicKey::from_encoded_point(&pt)).ok_or(CryptoError::BadKey)
    }
    fn from_key(k: &PublicKey) -> Self {
        let p = k.to_encoded_point(false);
        PubJwk { kty: ec(), crv: p256name(), x: URL_SAFE_NO_PAD.encode(p.x().unwrap()), y: URL_SAFE_NO_PAD.encode(p.y().unwrap()) }
    }
    /// SHA-256 of "x.y" in hex — the fingerprint the web client shows.
    pub fn fingerprint(&self) -> String { hex(&Sha256::digest(format!("{}.{}", self.x, self.y).as_bytes())) }
}

/// This account's identity key on this device.
#[derive(Clone)]
pub struct Identity {
    secret: SecretKey,
    pub public: PubJwk,
}

impl Identity {
    pub fn generate() -> Self {
        let secret = SecretKey::random(&mut OsRng);
        let public = PubJwk::from_key(&secret.public_key());
        Identity { secret, public }
    }
    /// The record format the browser keeps in IndexedDB and puts in the backup: `{ privJwk: {kty,crv,x,y,d,...}, pub }`.
    pub fn from_record(rec: &Value) -> Result<Self, CryptoError> {
        let d = rec.pointer("/privJwk/d").and_then(Value::as_str).ok_or(CryptoError::BadKey)?;
        let d = URL_SAFE_NO_PAD.decode(d).map_err(|_| CryptoError::BadKey)?;
        let secret = SecretKey::from_slice(&d).map_err(|_| CryptoError::BadKey)?;
        let public = PubJwk::from_key(&secret.public_key());
        if let Some(p) = rec.get("pub") {
            let claimed: PubJwk = serde_json::from_value(p.clone()).map_err(|_| CryptoError::BadKey)?;
            if claimed.x != public.x || claimed.y != public.y { return Err(CryptoError::BadKey); }
        }
        Ok(Identity { secret, public })
    }
    pub fn to_record(&self) -> Value {
        let d = URL_SAFE_NO_PAD.encode(self.secret.to_bytes());
        json!({
            "privJwk": { "kty": "EC", "crv": "P-256", "x": self.public.x, "y": self.public.y, "d": d, "ext": true, "key_ops": ["deriveBits"] },
            "pub": { "kty": "EC", "crv": "P-256", "x": self.public.x, "y": self.public.y },
        })
    }

    /// AES-256-GCM key for one conversation with one peer key.
    pub fn conv_key(&self, conv_id: &str, peer: &PubJwk) -> Result<ConvKey, CryptoError> {
        let peer = peer.to_key()?;
        let shared = p256::ecdh::diffie_hellman(self.secret.to_nonzero_scalar(), peer.as_affine());
        let hk = Hkdf::<Sha256>::new(Some(conv_id.as_bytes()), &shared.raw_secret_bytes()[..]);
        let mut okm = [0u8; 32];
        hk.expand(b"nebulix-dm-v1", &mut okm).map_err(|_| CryptoError::BadKey)?;
        Ok(ConvKey { conv: conv_id.to_string(), cipher: Aes256Gcm::new(&okm.into()) })
    }

    /// 60-digit safety number both people can compare (same as the web client).
    pub fn safety_number(&self, peer: &PubJwk) -> String {
        let mut parts = [format!("{}.{}", self.public.x, self.public.y), format!("{}.{}", peer.x, peer.y)];
        parts.sort();
        let h = Sha256::digest(parts.join("|").as_bytes());
        let n = num_bigint::BigUint::from_bytes_be(&h).to_str_radix(10);
        let digits = format!("{:0>78}", n);
        digits[..60].as_bytes().chunks(5).map(|c| std::str::from_utf8(c).unwrap()).collect::<Vec<_>>().join(" ")
    }
}

pub struct ConvKey {
    conv: String,
    cipher: Aes256Gcm,
}

/// An encrypted message as the server stores it: base64 IV and ciphertext (with the GCM tag at the end, like WebCrypto).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Sealed {
    pub iv: String,
    pub ct: String,
}

impl ConvKey {
    fn enc(&self, aad: &str, plain: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let mut iv = [0u8; 12];
        OsRng.fill_bytes(&mut iv);
        let ct = self.cipher.encrypt(Nonce::from_slice(&iv), Payload { msg: plain, aad: aad.as_bytes() }).expect("aes-gcm encrypt");
        (iv.to_vec(), ct)
    }
    fn dec(&self, aad: &str, iv: &[u8], ct: &[u8]) -> Result<Vec<u8>, CryptoError> {
        if iv.len() != 12 { return Err(CryptoError::Decrypt); }
        self.cipher.decrypt(Nonce::from_slice(iv), Payload { msg: ct, aad: aad.as_bytes() }).map_err(|_| CryptoError::Decrypt)
    }
    /// Seal a text message from `sender` (the signed-in user). `extra` is merged into the payload (e.g. image descriptors).
    pub fn seal(&self, sender: &str, text: &str, extra: Option<Value>) -> Sealed {
        let mut p = json!({ "t": text });
        if let (Some(Value::Object(x)), Value::Object(m)) = (extra, &mut p) { for (k, v) in x { m.insert(k, v); } }
        let (iv, ct) = self.enc(&format!("{}|{}", self.conv, sender), p.to_string().as_bytes());
        Sealed { iv: STANDARD.encode(iv), ct: STANDARD.encode(ct) }
    }
    /// Full decrypted payload of a message sent by `sender`, or an error if this device cannot read it.
    pub fn open(&self, sender: &str, msg: &Sealed) -> Result<Value, CryptoError> {
        let iv = STANDARD.decode(&msg.iv).map_err(|_| CryptoError::Decrypt)?;
        let ct = STANDARD.decode(&msg.ct).map_err(|_| CryptoError::Decrypt)?;
        let pt = self.dec(&format!("{}|{}", self.conv, sender), &iv, &ct)?;
        serde_json::from_slice(&pt).map_err(|_| CryptoError::Decrypt)
    }
    pub fn open_text(&self, sender: &str, msg: &Sealed) -> Option<String> {
        self.open(sender, msg).ok().map(|v| match v.get("t") { Some(Value::String(s)) => s.clone(), Some(x) => x.to_string(), None => String::new() })
    }
    pub fn seal_bytes(&self, sender: &str, data: &[u8]) -> (String, Vec<u8>) {
        let (iv, ct) = self.enc(&format!("{}|{}|file", self.conv, sender), data);
        (STANDARD.encode(iv), ct)
    }
    pub fn open_bytes(&self, sender: &str, iv_b64: &str, data: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let iv = STANDARD.decode(iv_b64).map_err(|_| CryptoError::Decrypt)?;
        self.dec(&format!("{}|{}|file", self.conv, sender), &iv, data)
    }
}

// ---- passphrase backup (PBKDF2-SHA256 -> AES-GCM, AAD "nebulix-backup-v1") ----
pub const BACKUP_ITER: u32 = 600_000;

fn pass_key(pass: &str, salt: &[u8], iter: u32) -> Aes256Gcm {
    let mut k = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(pass.as_bytes(), salt, iter, &mut k);
    Aes256Gcm::new(&k.into())
}

/// Decrypt the server's backup blob `{ salt, iv, ct, iter }` into an identity.
pub fn restore_backup(blob: &Value, pass: &str) -> Result<Identity, CryptoError> {
    let g = |k: &str| blob.get(k).and_then(Value::as_str).and_then(|s| STANDARD.decode(s).ok()).ok_or(CryptoError::BadPass);
    let (salt, iv, ct) = (g("salt")?, g("iv")?, g("ct")?);
    let iter = blob.get("iter").and_then(Value::as_u64).unwrap_or(BACKUP_ITER as u64).clamp(100_000, 2_000_000) as u32;
    if iv.len() != 12 { return Err(CryptoError::BadPass); }
    let pt = pass_key(pass, &salt, iter)
        .decrypt(Nonce::from_slice(&iv), Payload { msg: &ct, aad: b"nebulix-backup-v1" })
        .map_err(|_| CryptoError::BadPass)?;
    let rec: Value = serde_json::from_slice(&pt).map_err(|_| CryptoError::BadPass)?;
    Identity::from_record(&rec)
}

/// Encrypt an identity into a backup blob for `PUT /api/e2ee/backup`.
pub fn make_backup(id: &Identity, pass: &str) -> Result<Value, CryptoError> {
    if pass.chars().count() < 8 { return Err(CryptoError::Short); }
    let mut salt = [0u8; 16];
    let mut iv = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut iv);
    let ct = pass_key(pass, &salt, BACKUP_ITER)
        .encrypt(Nonce::from_slice(&iv), Payload { msg: id.to_record().to_string().as_bytes(), aad: b"nebulix-backup-v1" })
        .expect("aes-gcm encrypt");
    Ok(json!({ "salt": STANDARD.encode(salt), "iv": STANDARD.encode(iv), "ct": STANDARD.encode(ct), "iter": BACKUP_ITER }))
}

fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{:02x}", x)).collect() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_between_two_people() {
        let (a, b) = (Identity::generate(), Identity::generate());
        let ka = a.conv_key("conv1", &b.public).unwrap();
        let kb = b.conv_key("conv1", &a.public).unwrap();
        let s = ka.seal("ua", "hola ñ 🚀", None);
        assert_eq!(kb.open_text("ua", &s).as_deref(), Some("hola ñ 🚀"));
        assert!(kb.open_text("ub", &s).is_none(), "AAD binds the sender");
        assert!(b.conv_key("conv2", &a.public).unwrap().open_text("ua", &s).is_none(), "salt binds the chat");
        assert_eq!(a.safety_number(&b.public), b.safety_number(&a.public));
        assert_eq!(a.safety_number(&b.public).len(), 60 + 11);
    }
    #[test]
    fn record_and_backup() {
        let a = Identity::generate();
        let r = Identity::from_record(&a.to_record()).unwrap();
        assert_eq!(r.public, a.public);
        let blob = make_backup(&a, "correct horse").unwrap();
        assert!(restore_backup(&blob, "wrong pass").is_err());
        assert_eq!(restore_backup(&blob, "correct horse").unwrap().public, a.public);
    }
}
