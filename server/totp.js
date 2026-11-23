'use strict';
// Two-step verification: RFC 6238 time-based codes (SHA-1, 6 digits, 30 s) as used by every authenticator app,
// plus one-time backup codes. The shared secret is sealed with AES-256-GCM under a key derived from the server secret,
// so a leaked data file alone does not hand out working codes.
const crypto = require('crypto');
const cfg = require('./config');

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) {
  let bits = 0; let val = 0; let out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += ALPHA[(val >>> (bits - 5)) & 31]; bits -= 5; } val &= (1 << bits) - 1; }
  if (bits > 0) out += ALPHA[(val << (5 - bits)) & 31];
  return out;
}
function b32dec(s) {
  let bits = 0; let val = 0; const out = [];
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { val = (val << 5) | ALPHA.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } val &= (1 << bits) - 1; }
  return Buffer.from(out);
}
function hotp(key, counter) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(b).digest(); const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Returns the matching time step (so it can be stored and never accepted twice), or 0.
function verify(secret, code, lastStep = 0, t = Date.now()) {
  code = String(code || '').replace(/\D/g, ''); if (code.length !== 6) return 0;
  const key = b32dec(secret); const step = Math.floor(t / 30000);
  for (const d of [0, -1, 1]) { const s = step + d; if (s > lastStep && eq(hotp(key, s), code)) return s; }
  return 0;
}
const newSecret = () => b32enc(crypto.randomBytes(20));
const sealKey = () => crypto.createHash('sha256').update('nbx-tfa:' + cfg.secret).digest();
function seal(text) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((x) => x.toString('base64')).join('.');
}
function open(sealed) {
  try {
    const [iv, tag, enc] = String(sealed).split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return ''; }
}
const hashBackup = (code) => crypto.createHash('sha256').update('nbx-bk:' + cfg.secret + ':' + String(code).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
function newBackupCodes(n = 8) {
  const codes = []; for (let i = 0; i < n; i++) { const r = crypto.randomBytes(5).toString('hex'); codes.push(r.slice(0, 5) + '-' + r.slice(5)); }
  return codes;
}
// Checks a login code against an account: an authenticator code (never the same step twice) or an unused backup code.
function check(u, code) {
  const t = u.tfa; if (!t || !t.on) return true;
  const step = verify(open(t.enc), code, t.last || 0);
  if (step) { t.last = step; return true; }
  const h = hashBackup(code); const i = (t.backup || []).indexOf(h);
  if (String(code || '').replace(/[^a-z0-9]/gi, '').length === 10 && i >= 0) { t.backup.splice(i, 1); return true; }
  return false;
}
const uri = (username, secret) => `otpauth://totp/${encodeURIComponent(cfg.brand + ':' + username)}?secret=${secret}&issuer=${encodeURIComponent(cfg.brand)}&digits=6&period=30`;

module.exports = { b32enc, b32dec, hotp, verify, newSecret, seal, open, hashBackup, newBackupCodes, check, uri };
