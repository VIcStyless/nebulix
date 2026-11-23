// End-to-end encryption for direct messages (runs only in the browser; the server stores public keys and ciphertext).
//   identity : ECDH P-256 key pair per account, private key kept in IndexedDB on this device
//   per-chat : shared secret (ECDH) -> HKDF-SHA256 (salt = conversation id, info "nebulix-dm-v1") -> AES-GCM-256
//   message  : random 96-bit IV, AAD "<convId>|<senderId>", plaintext {"t": text}
//   backup   : private JWK encrypted client-side with a passphrase (PBKDF2-SHA256 600k -> AES-GCM) before upload
import { api } from './api.js';
import { S } from './state.js';
import { b64, unb64, ls } from './util.js';

const enc = new TextEncoder(); const dec = new TextDecoder();
const subtle = () => (window.crypto && window.crypto.subtle) || null;
export const supported = () => !!subtle() && !!window.indexedDB;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const pubOnly = (j) => ({ kty: 'EC', crv: 'P-256', x: j.x, y: j.y });

// ---- tiny IndexedDB key/value store ----
function db() {
  return new Promise((res, rej) => { const r = indexedDB.open('nebulix-e2ee', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idb(mode, fn) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('keys', mode); const out = fn(tx.objectStore('keys')); tx.oncomplete = () => { d.close(); res(out && out.result); }; tx.onerror = () => { d.close(); rej(tx.error); }; }); }
const getLocal = (uid) => idb('readonly', (s) => s.get(uid));
const putLocal = (uid, v) => idb('readwrite', (s) => s.put(v, uid));
const delLocal = (uid) => idb('readwrite', (s) => s.delete(uid));

let mine = null; // { priv: CryptoKey, pub: {kty,crv,x,y} } for the signed-in user
const convKeys = new Map();

async function generate() {
  const kp = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const priv = await subtle().exportKey('jwk', kp.privateKey);
  return { privJwk: priv, pub: pubOnly(priv) };
}
async function load(rec) {
  const priv = await subtle().importKey('jwk', rec.privJwk, ECDH, true, ['deriveBits']);
  return { priv, pub: rec.pub };
}

/** Where are we? 'ready' | 'none' (no key anywhere) | 'restore' (server has a key but this device does not) | 'mismatch' (this device's key differs from the server's) */
export async function state() {
  if (!supported()) return { s: 'unsupported' };
  const uid = S.me.id; const rec = await getLocal(uid).catch(() => null);
  let remote = null; try { remote = (await api.get(`/api/users/${uid}/key`)).pub; } catch (e) { if (e.status !== 404) throw e; }
  if (rec && remote && rec.pub.x === remote.x && rec.pub.y === remote.y) { mine = mine && mine.pub.x === rec.pub.x ? mine : await load(rec); return { s: 'ready', pub: rec.pub, backup: !!S.me.hasBackup }; }
  if (rec && !remote) return { s: 'ready-unpublished', pub: rec.pub };
  if (!rec && !remote) return { s: 'none' };
  if (!rec && remote) return { s: 'restore', hasBackup: !!S.me.hasBackup };
  return { s: 'mismatch', hasBackup: !!S.me.hasBackup };
}

/** Create a fresh identity key, publish its public half. Old messages sent to the previous key become unreadable here. */
export async function createKeys() {
  const k = await generate(); await putLocal(S.me.id, k); mine = await load(k); convKeys.clear();
  await api.put('/api/e2ee/key', { pub: k.pub }); return k.pub;
}
export async function publishLocal() { const rec = await getLocal(S.me.id); if (rec) { await api.put('/api/e2ee/key', { pub: rec.pub }); mine = await load(rec); } }
export async function resetKeys() { await delLocal(S.me.id); mine = null; convKeys.clear(); return createKeys(); }
export function forget() { mine = null; convKeys.clear(); }

async function convKey(convId, peerPub) {
  const id = convId + '|' + peerPub.x + peerPub.y; if (convKeys.has(id)) return convKeys.get(id);
  if (!mine) throw new Error('no-key');
  const peer = await subtle().importKey('jwk', pubOnly(peerPub), ECDH, false, []);
  const bits = await subtle().deriveBits({ name: 'ECDH', public: peer }, mine.priv, 256);
  const hk = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const key = await subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(convId), info: enc.encode('nebulix-dm-v1') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  convKeys.set(id, key); return key;
}
export async function seal(convId, peerPub, text, extra) {
  const key = await convKey(convId, peerPub); const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${convId}|${S.me.id}`) }, key, enc.encode(JSON.stringify(Object.assign({ t: text }, extra || {}))));
  return { iv: b64(iv), ct: b64(ct) };
}
async function openRaw(convId, peerPub, msg) {
  const key = await convKey(convId, peerPub);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(msg.iv), additionalData: enc.encode(`${convId}|${msg.f}`) }, key, unb64(msg.ct));
  return JSON.parse(dec.decode(pt));
}
/** Returns the text, or null when it cannot be decrypted with the keys on this device. */
export async function open(convId, peerPub, msg) {
  try { return String((await openRaw(convId, peerPub, msg)).t); } catch { return null; }
}
/** Full payload: { text, v } where v is an encrypted voice note descriptor { url, iv, dur, mime }. null when undecryptable. */
export async function openMsg(convId, peerPub, msg) {
  try { const p = await openRaw(convId, peerPub, msg); return { text: String(p.t || ''), v: p.v && typeof p.v === 'object' ? p.v : null, img: p.img && typeof p.img === 'object' ? p.img : null }; } catch { return null; }
}
// Attachments (voice notes) are encrypted with the same per-chat key; AAD binds them to the chat, the sender and their purpose.
export async function sealBytes(convId, peerPub, bytes) {
  const key = await convKey(convId, peerPub); const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`${convId}|${S.me.id}|file`) }, key, bytes);
  return { iv: b64(iv), data: new Uint8Array(ct) };
}
export async function openBytes(convId, peerPub, senderId, ivB64, bytes) {
  const key = await convKey(convId, peerPub);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(ivB64), additionalData: enc.encode(`${convId}|${senderId}|file`) }, key, bytes));
}

/** 60-digit number both people can compare out loud / in person to detect a man-in-the-middle. */
export async function safetyNumber(peerPub) {
  const a = `${mine.pub.x}.${mine.pub.y}`; const b = `${peerPub.x}.${peerPub.y}`; const parts = [a, b].sort();
  const h = new Uint8Array(await subtle().digest('SHA-256', enc.encode(parts.join('|'))));
  let n = 0n; for (const x of h) n = (n << 8n) | BigInt(x);
  const digits = n.toString().padStart(78, '0').slice(0, 60);
  return digits.match(/.{5}/g).join(' ');
}
export const fpOf = async (pub) => { const h = new Uint8Array(await subtle().digest('SHA-256', enc.encode(`${pub.x}.${pub.y}`))); return [...h].map((x) => x.toString(16).padStart(2, '0')).join(''); };

/** Remember the first key we saw for each friend; flag when it changes. */
export function checkPeerKey(peerId, fp) {
  const seen = ls('peerfp') || {}; const prev = seen[S.me.id + ':' + peerId];
  if (!prev) { seen[S.me.id + ':' + peerId] = fp; ls('peerfp', seen); return 'new'; }
  return prev === fp ? 'same' : 'changed';
}
export function trustPeerKey(peerId, fp) { const seen = ls('peerfp') || {}; seen[S.me.id + ':' + peerId] = fp; ls('peerfp', seen); }

// ---- passphrase backup ----
const ITER = 600000;
async function passKey(pass, salt, iter, usage) {
  const base = await subtle().importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}
export async function backup(pass) {
  if (!mine) throw new Error('no-key'); if (String(pass).length < 8) throw new Error('short');
  const rec = await getLocal(S.me.id); const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passKey(pass, salt, ITER, ['encrypt']);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('nebulix-backup-v1') }, key, enc.encode(JSON.stringify(rec)));
  await api.put('/api/e2ee/backup', { blob: { salt: b64(salt), iv: b64(iv), ct: b64(ct), iter: ITER } });
}
export async function restore(pass) {
  const r = await api.get('/api/e2ee/backup'); const bl = r.blob;
  let rec;
  try {
    const key = await passKey(pass, unb64(bl.salt), bl.iter || ITER, ['decrypt']);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(bl.iv), additionalData: enc.encode('nebulix-backup-v1') }, key, unb64(bl.ct));
    rec = JSON.parse(dec.decode(pt));
  } catch { throw Object.assign(new Error('Wrong passphrase'), { code: 'bad_pass' }); }
  await putLocal(S.me.id, rec); mine = await load(rec); convKeys.clear();
  if (!r.pub || r.pub.x !== rec.pub.x || r.pub.y !== rec.pub.y) await api.put('/api/e2ee/key', { pub: rec.pub });
  return rec.pub;
}
export const removeBackup = () => api.del('/api/e2ee/backup');
export const myPub = () => (mine ? mine.pub : null);
