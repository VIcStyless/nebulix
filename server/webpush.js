'use strict';
// Web Push (13.8): notifications that reach you when Nebulix is closed — direct messages, 1v1 invites, gifts,
// friend requests and other notices. Standard Web Push with no third-party code:
//   RFC 8292 (VAPID): the server signs a short JWT with its own P-256 key, kept in DATA_DIR/vapid.json (never in the repo).
//   RFC 8291 (aes128gcm): every message is encrypted for the browser that subscribed, so push services cannot read it.
// Only the browser push services are contacted (Google, Mozilla, Microsoft, Apple) — any other address is refused.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ---------- VAPID keys ----------
let vapid = null;
function keys() {
  if (vapid) return vapid;
  const file = path.join(cfg.dataDir, 'vapid.json');
  try { vapid = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (!vapid || !vapid.pub || !vapid.jwk) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-65); // uncompressed point 0x04‖X‖Y
    vapid = { pub: b64u(pub), jwk: privateKey.export({ format: 'jwk' }) };
    try { fs.writeFileSync(file, JSON.stringify(vapid), { mode: 0o600 }); } catch (e) { console.error('[push] could not save keys', e.message); }
  }
  vapid.key = crypto.createPrivateKey({ key: vapid.jwk, format: 'jwk' });
  return vapid;
}
const publicKey = () => keys().pub;

// ---------- allowed push services ----------
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9.-]+\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9.-]+\.push\.apple\.com$/];
function validSub(sub) {
  if (!sub || typeof sub !== 'object') return null;
  let u; try { u = new URL(String(sub.endpoint || '')); } catch { return null; }
  if (u.protocol !== 'https:' || u.port || !PUSH_HOSTS.some((re) => re.test(u.hostname)) || u.href.length > 800) return null;
  const k = sub.keys || {}; const p256dh = unb64u(k.p256dh || ''); const auth = unb64u(k.auth || '');
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  return { endpoint: u.href, keys: { p256dh: b64u(p256dh), auth: b64u(auth) }, at: Date.now() };
}

// ---------- RFC 8291 encryption ----------
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
function encrypt(sub, payload) {
  const uaPub = unb64u(sub.keys.p256dh); const authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const salt = crypto.randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}
// ---------- RFC 8292 VAPID header ----------
function vapidAuth(endpoint) {
  const k = keys(); const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: cfg.appOrigin && /^https:/.test(cfg.appOrigin) ? cfg.appOrigin : 'https://nebulix.fly.dev' }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + claims), { key: k.key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${k.pub}`;
}

async function sendOne(sub, data) {
  const body = encrypt(sub, JSON.stringify(data).slice(0, 3000));
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidAuth(sub.endpoint) }, body, redirect: 'error', signal: AbortSignal.timeout(10000) });
  return r.status;
}

// ---------- per user ----------
const { S } = require('./state');
const recent = new Map(); // uid -> [times] — at most 6 notifications a minute per person
function subscribe(u, raw) {
  const sub = validSub(raw); if (!sub) return false;
  u.push = (u.push || []).filter((x) => x.endpoint !== sub.endpoint); u.push.unshift(sub); u.push = u.push.slice(0, 5); S.store.touch('users'); return true;
}
function unsubscribe(u, endpoint) { const n = (u.push || []).length; u.push = (u.push || []).filter((x) => x.endpoint !== endpoint); if (u.push.length !== n) S.store.touch('users'); }
async function send(uid, data) {
  const u = S.users[uid]; if (!u || !u.push || !u.push.length || u.deleted || (u.settings && u.settings.push === false)) return 0;
  const t = Date.now(); const list = (recent.get(uid) || []).filter((x) => t - x < 60000); if (list.length >= 6) return 0; list.push(t); recent.set(uid, list);
  let sent = 0;
  for (const sub of u.push.slice()) {
    try { const st = await sendOne(sub, data); if (st === 404 || st === 410) unsubscribe(u, sub.endpoint); else if (st < 300) sent++; }
    catch (e) { /* network trouble: try again next time */ }
  }
  return sent;
}
// turn a live message for someone who is offline into a notification (or nothing)
function fromMessage(uid, msg) {
  const u = S.users[uid]; if (!u || !u.push || !u.push.length || !msg) return null;
  const es = u.lang === 'es'; const st = u.settings || {};
  if ((msg.t === 'dm' && st.pushDm === false) || (msg.t === 'ar_invite' && st.pushDuel === false) || ((msg.t === 'notice' || msg.t === 'notify') && st.pushNotice === false)) return null;
  if (msg.t === 'notice' && (msg.text || msg.es)) return { title: 'Nebulix', body: String(es && msg.es ? msg.es : msg.text).slice(0, 200), url: '/#/home', tag: 'notice' };
  if (msg.t === 'notify' && msg.text) return { title: 'Nebulix', body: String(msg.text).slice(0, 200), url: '/#/' + (msg.link || 'home'), tag: msg.kind || 'notify' };
  if (msg.t === 'ar_invite' && msg.from) return { title: es ? 'Reto 1v1' : '1v1 challenge', body: (es ? '@' + msg.from.username + ' te reta a un duelo' : '@' + msg.from.username + ' challenges you to a duel') + (msg.bet ? (es ? ' · apuesta ' : ' · bet ') + msg.bet : ''), url: '/#/arena', tag: 'duel-' + msg.id };
  if (msg.t === 'dm' && msg.to === uid && msg.u) return { title: msg.u.displayName || '@' + msg.u.username, body: es ? 'Te ha enviado un mensaje' : 'Sent you a message', url: '/#/dm/' + msg.conv, tag: 'dm-' + msg.conv }; // DMs are end-to-end encrypted: the text never goes in a push
  return null;
}
function maybe(uid, msg) { const n = fromMessage(uid, msg); if (n) send(uid, n).catch(() => {}); }

module.exports = { publicKey, subscribe, unsubscribe, send, maybe, validSub, encrypt, fromMessage };
