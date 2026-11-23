// Nebulix 13.2 — Security Lab: defensive and educational cybersecurity tools. #/security/<tool>
// Account checkup · passwords (strength, generator, breach check with k-anonymity) · website security scan ·
// phishing link check · hashes and encodings · classic ciphers (with brute force) · JWT inspector · 2FA codes ·
// CVE search · CTF practice with coin rewards. Everything except the scan, the breach check and the CVE search runs
// only in your browser.
import { h, mount, fmt } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, busy, loading, emptyState } from '../ui.js';
import { sfx } from '../sfx.js';

const TOOLS = [['check', 'Account checkup', 'user'], ['pass', 'Passwords', 'key'], ['site', 'Website scan', 'globe'], ['phish', 'Phishing check', 'link'], ['hash', 'Hash & encode', 'hash'], ['cipher', 'Ciphers', 'lock'], ['jwt', 'JWT inspector', 'eye'], ['totp', '2FA codes', 'clock'], ['cve', 'CVE search', 'alert'], ['ctf', 'CTF practice', 'flag']];
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function digest(alg, text) { return hex(await crypto.subtle.digest(alg, enc.encode(text))); }
const b64e = (s) => btoa(String.fromCharCode(...enc.encode(s)));
const b64d = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0)));
const field = (label, el) => h('label.sl-f', h('span', label), el);
const out = (txt) => h('pre.sl-out', txt);

// password strength: character pools, length, patterns → entropy and an offline-attack time estimate
function strength(pw) {
  if (!pw) return null; let pool = 0; if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/\d/.test(pw)) pool += 10; if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(Math.max(pool, 1)); const issues = [];
  if (/(.)\1{2,}/.test(pw)) { bits -= 10; issues.push(t('Repeated characters')); }
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|qwer|asdf|zxcv)/i.test(pw)) { bits -= 15; issues.push(t('Keyboard or number sequences')); }
  if (/^(password|contraseña|qwerty|123456|admin|letmein|welcome|iloveyou|dragon|monkey|football)/i.test(pw)) { bits = Math.min(bits, 10); issues.push(t('One of the most common passwords')); }
  if (/(19|20)\d{2}/.test(pw)) { bits -= 6; issues.push(t('Contains a year')); }
  if (pw.length < 12) issues.push(t('Shorter than 12 characters'));
  bits = Math.max(0, bits); const secs = Math.pow(2, bits) / 1e10 / 2; // 10 billion guesses per second (one modern GPU rig)
  const human = secs < 1 ? t('instantly') : secs < 3600 ? t('{n} minutes', { n: Math.ceil(secs / 60) }) : secs < 86400 * 2 ? t('{n} hours', { n: Math.round(secs / 3600) }) : secs < 31536000 * 2 ? t('{n} days', { n: Math.round(secs / 86400) }) : secs < 31536000 * 1e6 ? t('{n} years', { n: fmt.compact(secs / 31536000) }) : t('millions of years');
  const lvl = bits < 30 ? 0 : bits < 50 ? 1 : bits < 70 ? 2 : bits < 90 ? 3 : 4;
  return { bits: Math.round(bits), human, lvl, issues };
}
function genPassword(len, sets) { const chars = (sets.lower ? 'abcdefghijkmnopqrstuvwxyz' : '') + (sets.upper ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : '') + (sets.num ? '23456789' : '') + (sets.sym ? '!@#$%^&*()-_=+[]{};:,.?' : ''); if (!chars) return ''; const r = crypto.getRandomValues(new Uint32Array(len)); return [...r].map((x) => chars[x % chars.length]).join(''); }
const WORDS = 'nebula orbit pixel comet rocket galaxy laser vector tiger falcon river canyon ember frost thunder shadow crystal quantum prism cobalt zenith lunar solar meteor nova storm jungle harbor summit beacon spark glacier velvet copper marble anchor lantern compass breeze willow coral raven cedar maple onyx titan'.split(' ');
const passphrase = (n) => [...crypto.getRandomValues(new Uint32Array(n))].map((x) => WORDS[x % WORDS.length]).join('-') + '-' + (crypto.getRandomValues(new Uint32Array(1))[0] % 90 + 10);
// phishing heuristics on a link
function phishCheck(raw) {
  let u; try { u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'http://' + raw); } catch { return { bad: true, flags: [[3, t('This is not a valid address')]] }; }
  const f = []; const host = u.hostname;
  if (u.protocol !== 'https:') f.push([2, t('Not encrypted (http instead of https)')]);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) f.push([3, t('Uses a raw IP address instead of a name')]);
  if (host.startsWith('xn--') || host.includes('.xn--')) f.push([3, t('Punycode: letters that look like others (possible fake look-alike domain)')]);
  if (/[^\x00-\x7f]/.test(raw)) f.push([3, t('Contains non-Latin look-alike characters')]);
  if (u.username || raw.includes('@')) f.push([3, t('Has “@” in it: the real site is what comes after it')]);
  if (host.split('.').length > 4) f.push([2, t('Very many subdomains (often used to hide the real domain)')]);
  if (/(login|verify|secure|account|update|wallet|gift|free|bonus|support)/i.test(host)) f.push([2, t('Words like “login”, “verify” or “free” in the domain')]);
  if (/(paypal|apple|google|microsoft|amazon|netflix|steam|discord|instagram|facebook|bank|roblox|epic)/i.test(host) && !/(^|\.)(paypal|apple|google|microsoft|amazon|netflix|steampowered|discord|instagram|facebook|roblox|epicgames)\.(com|net|org|es)$/i.test(host)) f.push([3, t('Mentions a famous brand but is not its real domain')]);
  if (/\.(zip|mov|xyz|top|click|gq|tk|ml|cf|work|rest|country)$/i.test(host)) f.push([2, t('Unusual top-level domain often seen in scams')]);
  if (/^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy)$/i.test(host)) f.push([1, t('Link shortener: you cannot see where it really goes')]);
  if (raw.length > 120) f.push([1, t('Very long address')]);
  const risk = f.reduce((a, x) => a + x[0], 0); return { host, risk, flags: f, level: risk >= 5 ? 2 : risk >= 2 ? 1 : 0 };
}
const caesar = (s, k) => s.replace(/[a-z]/gi, (ch) => { const a = ch === ch.toUpperCase() ? 65 : 97; return String.fromCharCode(((ch.charCodeAt(0) - a + k + 26 * 10) % 26) + a); });
const vigenere = (s, key, dec) => { const K = key.replace(/[^a-z]/gi, '').toUpperCase(); if (!K) return s; let j = 0; return s.replace(/[a-z]/gi, (ch) => { const a = ch === ch.toUpperCase() ? 65 : 97; const k = K.charCodeAt(j++ % K.length) - 65; return String.fromCharCode(((ch.charCodeAt(0) - a + (dec ? 26 - k : k)) % 26) + a); }); };
// TOTP (RFC 6238): 30 s, 6 digits, HMAC-SHA1
function base32(s) { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += A.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return new Uint8Array(out); }
async function totp(secret, step = 30, at = Date.now()) {
  const key = await crypto.subtle.importKey('raw', base32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']); const ctr = Math.floor(at / 1000 / step); const msg = new ArrayBuffer(8); new DataView(msg).setUint32(4, ctr);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg)); const o = sig[19] & 15; const n = ((sig[o] & 127) << 24 | sig[o + 1] << 16 | sig[o + 2] << 8 | sig[o + 3]) % 1e6; return String(n).padStart(6, '0');
}

export default {
  title: () => t('Security Lab'),
  async mount(root, ctx) {
    let tool = TOOLS.some((x) => x[0] === ctx.params[0]) ? ctx.params[0] : 'check'; let timer = 0;
    const side = h('nav.sl-nav'); const main = h('div.sl-main');
    mount(root, h('div.inner.sl', h('div.page-title', h('div', h('h2', t('Security Lab')), h('p', t('Learn and practise cybersecurity the defensive way: protect your accounts, spot scams, understand how attacks work.')))), h('div.sl-wrap', side, main)));
    const paintNav = () => mount(side, TOOLS.map(([id, l, ic]) => h('button' + (tool === id ? '.on' : ''), { onClick: () => { tool = id; open(); } }, icon(ic, 16), h('span', t(l)))));
    function open() { clearInterval(timer); paintNav(); mount(main, loading()); ({ check, pass, site, phish, hash: hashT, cipher, jwt, totp: totpT, cve, ctf }[tool])(); }

    async function check() {
      let me = S.me; let sess = null; try { sess = await api.get('/api/auth/sessions'); } catch {}
      const n = sess ? (sess.sessions || sess.list || []).length : null; const items = [
        [!!(me.tfa || (me.settings && me.settings.tfa)), t('Two-factor authentication'), t('A code from an app is needed besides your password.'), 'settings'],
        [!!me.verified, t('Verified email'), t('You can recover your account if you lose the password.'), 'settings'],
        [!!me.lock, t('Screen lock'), t('A PIN or password protects Nebulix when you step away.'), 'settings'],
        [n !== null && n <= 3, t('Open sessions: {n}', { n: n === null ? '?' : n }), t('Close the sessions you do not recognise.'), 'settings'],
        [!!me.hasKey, t('Encrypted messages'), t('Your DMs are end-to-end encrypted with your own key.'), 'dm'],
      ];
      const score = Math.round((items.filter((x) => x[0]).length / items.length) * 100);
      mount(main, h('div.sl-card', h('div.sl-score', h('div.sl-ring', { style: { '--p': score } }, h('b', score + '%')), h('div', h('h3', score >= 80 ? t('Your account is well protected') : score >= 50 ? t('Good, but you can do better') : t('Your account needs attention')), h('p.small.muted', t('Fix the red items to protect your coins, items and messages.'))))),
        h('div.sl-list', items.map(([ok, title, d, go]) => h('div.sl-item.' + (ok ? 'ok' : 'bad'), icon(ok ? 'check' : 'alert', 18), h('div.grow', h('b', title), h('div.small.muted', d)), ok ? null : h('button.btn.sm', { onClick: () => ctx.go(go) }, t('Fix'))))));
    }
    function pass() {
      const inp = h('input.input', { type: 'password', placeholder: t('Type a password to test (it never leaves your browser)'), autocomplete: 'off' }); const res = h('div'); const show = h('button.btn.sm.ghost', { onClick: () => { inp.type = inp.type === 'password' ? 'text' : 'password'; } }, icon('eye', 14));
      const paint = () => { const s = strength(inp.value); mount(res, s ? [h('div.sl-meter', [0, 1, 2, 3, 4].map((i) => h('i' + (i <= s.lvl ? '.on.l' + s.lvl : '')))), h('p', t('Estimated entropy: {b} bits · an offline attack would take {t}', { b: s.bits, t: s.human })), s.issues.length ? h('ul.small', s.issues.map((x) => h('li', x))) : h('p.small.sl-good', t('No obvious weaknesses.'))] : null); };
      inp.addEventListener('input', paint);
      const breach = h('div'); const checkBreach = async (btn) => busy(btn, async () => { const pw = inp.value; if (!pw) return; const sha = (await digest('SHA-1', pw)).toUpperCase(); const txt = await (await fetch('/api/sec/pwned/' + sha.slice(0, 5), { credentials: 'same-origin' })).text(); const line = txt.split('\n').find((l) => l.startsWith(sha.slice(5))); const n = line ? Number(line.split(':')[1]) : 0;
        mount(breach, h('div.sl-alert.' + (n ? 'bad' : 'ok'), icon(n ? 'alert' : 'check', 18), n ? t('This password appears {n} times in known data breaches. Do not use it.', { n: fmt.num(n) }) : t('Not found in known breaches. (That alone does not make it strong.)'))); });
      const len = h('input', { type: 'range', min: 8, max: 64, value: 20 }); const sets = { lower: true, upper: true, num: true, sym: true }; const gen = h('pre.sl-out'); const lenL = h('span', '20');
      const regen = () => { lenL.textContent = len.value; gen.textContent = genPassword(Number(len.value), sets); }; len.addEventListener('input', regen); regen();
      mount(main, h('div.sl-card', h('h3', t('Test a password')), h('div.row', inp, show), res, h('button.btn', { onClick: (e) => checkBreach(e.currentTarget) }, icon('search', 14), t('Check in known breaches')), h('p.tiny.muted', t('Only the first 5 characters of its SHA-1 fingerprint are sent (k-anonymity). Nobody, not even Nebulix, sees your password.')), breach),
        h('div.sl-card', h('h3', t('Generate a strong password')), h('div.row', t('Length'), len, lenL), h('div.row', Object.keys(sets).map((k) => h('label.row.small', { style: 'gap:4px' }, h('input', { type: 'checkbox', checked: true, onChange: (e) => { sets[k] = e.target.checked; regen(); } }), t({ lower: 'a-z', upper: 'A-Z', num: '0-9', sym: 'Symbols' }[k])))), gen,
          h('div.row', h('button.btn', { onClick: regen }, icon('refresh', 14), t('New')), h('button.btn', { onClick: () => navigator.clipboard.writeText(gen.textContent).then(() => toast(t('Copied!'), 'good', 1000)) }, icon('copy', 14), t('Copy')), h('button.btn', { onClick: () => { gen.textContent = passphrase(5); } }, t('Passphrase')))));
    }
    function site() {
      const inp = h('input.input', { placeholder: 'example.com' }); const res = h('div');
      const run = (btn) => busy(btn, async () => { try { const r = await api.post('/api/sec/site', { url: inp.value }); mount(res, h('div.sl-card', h('div.sl-score', h('div.sl-grade.g' + r.grade.replace('+', 'p'), r.grade), h('div', h('b', r.url), h('div.small.muted', `HTTP ${r.status} · ${r.ms} ms` + (r.tls && r.tls.cert ? ` · ${r.tls.proto || 'TLS'} · ${t('certificate by {i} until {d}', { i: r.tls.cert.issuer || '?', d: r.tls.cert.to })}` : '')))),
        h('div.sl-list', r.items.map((x) => h('div.sl-item.' + (x.ok === true ? 'ok' : x.ok === 'weak' ? 'warn' : 'bad'), icon(x.ok === true ? 'check' : 'alert', 16), h('div.grow', h('b', x.k), h('div.small.muted', pick2(x.d)), x.v ? h('code.tiny', x.v) : null), h('span.tiny', '+' + (x.ok === true ? x.w : x.ok === 'weak' ? x.w / 2 : 0))))),
        r.cookies.length ? [h('h4', t('Cookies')), h('div.sl-list', r.cookies.map((ck) => h('div.sl-item.' + (ck.secure && ck.httpOnly ? 'ok' : 'warn'), h('b.grow', ck.name), h('span.tiny', [ck.secure ? 'Secure' : 'no Secure', ck.httpOnly ? 'HttpOnly' : 'no HttpOnly', 'SameSite=' + (ck.sameSite || '—')].join(' · ')))))] : null,
        r.leaks.length ? h('p.small.muted', t('Reveals software versions: {v}', { v: r.leaks.map((l) => l.k + ': ' + l.v).join(', ') })) : null)); } catch (e) { toastErr(e); } });
      mount(main, h('div.sl-card', h('h3', t('How secure is a website?')), h('p.small.muted', t('Checks HTTPS, the certificate, security headers (HSTS, CSP, frame protection…) and cookie flags. It only reads what any browser receives; it does not attack anything.')), h('div.row', inp, h('button.btn.primary', { onClick: (e) => run(e.currentTarget) }, t('Scan')))), res);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(main.querySelector('.btn.primary')); });
    }
    function phish() {
      const inp = h('input.input', { placeholder: t('Paste a suspicious link') }); const res = h('div');
      inp.addEventListener('input', () => { const r = phishCheck(inp.value.trim()); if (!inp.value.trim()) return mount(res); mount(res, h('div.sl-alert.' + ['ok', 'warn', 'bad'][r.level || 0], icon(r.level ? 'alert' : 'check', 18), [t('No warning signs found'), t('Be careful with this link'), t('This looks like a scam: do not open it or type passwords')][r.level || 0]), h('div.sl-list', (r.flags || []).map(([w, d]) => h('div.sl-item.' + (w >= 3 ? 'bad' : 'warn'), icon('alert', 15), h('span', d)))), r.host ? h('p.small', t('Real domain: {d}', { d: r.host })) : null); });
      mount(main, h('div.sl-card', h('h3', t('Is this link a scam?')), h('p.small.muted', t('Checks the address for the tricks used in phishing: look-alike letters, fake brand domains, hidden destinations… It never opens the link.')), inp, res,
        h('h4', t('How to spot phishing')), h('ul.small', [t('Urgency: “your account will be closed”, “claim your prize in 10 minutes”.'), t('Asking for your password, 2FA code or card: real services never ask by message.'), t('Free coins, skins or items from strangers.'), t('Look at the real domain right before the first “/”.')].map((x) => h('li', x)))));
    }
    function hashT() {
      const inp = h('textarea.input', { rows: 4, placeholder: t('Text') }); const res = h('div.sl-grid2');
      const paint = async () => { const v = inp.value; let b64 = '', b64dec = '', hx = ''; try { b64 = b64e(v); } catch {} try { b64dec = b64d(v.trim()); } catch { b64dec = '—'; } hx = [...enc.encode(v)].map((b) => b.toString(16).padStart(2, '0')).join('');
        const fromHex = /^[0-9a-f\s]+$/i.test(v.trim()) && v.trim().replace(/\s/g, '').length % 2 === 0 ? new TextDecoder().decode(Uint8Array.from(v.trim().replace(/\s/g, '').match(/../g) || [], (x) => parseInt(x, 16))) : '—';
        const rows = [['SHA-1', await digest('SHA-1', v)], ['SHA-256', await digest('SHA-256', v)], ['SHA-512', await digest('SHA-512', v)], ['Base64', b64], [t('Base64 → text'), b64dec], ['Hex', hx], [t('Hex → text'), fromHex], ['URL', encodeURIComponent(v)], ['ROT13', caesar(v, 13)], [t('Binary'), [...enc.encode(v)].map((b) => b.toString(2).padStart(8, '0')).join(' ').slice(0, 2000)]];
        mount(res, rows.map(([k, val]) => h('div.sl-kv', h('span.tiny.muted', k), h('code', { onClick: () => navigator.clipboard.writeText(val).then(() => toast(t('Copied!'), 'good', 800)) }, val || '—')))); };
      inp.addEventListener('input', paint); paint();
      mount(main, h('div.sl-card', h('h3', t('Hashes and encodings')), h('p.small.muted', t('Encoding (Base64, hex) is NOT encryption: anyone can reverse it. A hash is a one-way fingerprint. Click a result to copy it.')), inp, res));
    }
    function cipher() {
      const inp = h('textarea.input', { rows: 3, placeholder: t('Text') }); const key = h('input.input', { placeholder: t('Key (Vigenère) / byte (XOR, 0-255)'), value: 'NEBULIX' }); const res = h('div');
      const paint = () => { const v = inp.value; const k = key.value; const xb = Number(k) & 255;
        const xorHex = /^[0-9a-f]+$/i.test(v.trim()) && v.trim().length % 2 === 0 ? String.fromCharCode(...(v.trim().match(/../g) || []).map((x) => parseInt(x, 16) ^ xb)) : [...enc.encode(v)].map((b) => (b ^ xb).toString(16).padStart(2, '0')).join('');
        mount(res, h('div.sl-kv', h('span.tiny.muted', t('Vigenère encrypt')), h('code', vigenere(v, k))), h('div.sl-kv', h('span.tiny.muted', t('Vigenère decrypt')), h('code', vigenere(v, k, true))), h('div.sl-kv', h('span.tiny.muted', 'XOR (' + xb + ')'), h('code', xorHex)),
          h('h4', t('Caesar: all 25 shifts (brute force)')), h('div.sl-brute', Array.from({ length: 25 }, (_, i) => h('div', h('b', '+' + (i + 1)), ' ', caesar(v, i + 1)))),
          /^[0-9a-f]+$/i.test(v.trim()) ? [h('h4', t('XOR: try every byte (looks for readable text)')), h('div.sl-brute', Array.from({ length: 256 }, (_, b) => [b, String.fromCharCode(...(v.trim().match(/../g) || []).map((x) => parseInt(x, 16) ^ b))]).filter(([, s]) => /^[\x20-\x7e]+$/.test(s)).slice(0, 40).map(([b, s]) => h('div', h('b', b), ' ', s)))] : null); };
      inp.addEventListener('input', paint); key.addEventListener('input', paint); paint();
      mount(main, h('div.sl-card', h('h3', t('Classic ciphers')), h('p.small.muted', t('How old ciphers work and why they are easy to break. Useful for CTF challenges.')), inp, key, res));
    }
    function jwt() {
      const inp = h('textarea.input', { rows: 4, placeholder: 'eyJhbGciOi…' }); const res = h('div');
      inp.addEventListener('input', () => { const p = inp.value.trim().split('.'); if (p.length < 2) return mount(res, h('p.small.muted', t('A JWT has 3 parts separated by dots.'))); let hd, pl; try { hd = JSON.parse(b64d(p[0])); pl = JSON.parse(b64d(p[1])); } catch { return mount(res, h('div.sl-alert.bad', t('Not a valid token'))); }
        const warn = []; if (String(hd.alg).toLowerCase() === 'none') warn.push(t('alg “none”: the token is not signed, anyone can forge it')); if (/^HS/.test(hd.alg)) warn.push(t('HMAC signature: safe only with a long secret key'));
        if (pl.exp) warn.push(pl.exp * 1000 < Date.now() ? t('Expired on {d}', { d: fmt.dt(pl.exp * 1000) }) : t('Expires on {d}', { d: fmt.dt(pl.exp * 1000) }));
        mount(res, h('h4', 'Header'), out(JSON.stringify(hd, null, 2)), h('h4', 'Payload'), out(JSON.stringify(pl, null, 2)), warn.map((w) => h('div.sl-alert.warn', icon('alert', 15), w)), h('p.tiny.muted', t('Never paste real session tokens on websites you do not trust. This one is decoded only in your browser.'))); });
      mount(main, h('div.sl-card', h('h3', t('JWT inspector')), inp, res));
    }
    function totpT() {
      const sec = h('input.input', { placeholder: 'JBSWY3DPEHPK3PXP', value: 'JBSWY3DPEHPK3PXP' }); const code = h('div.sl-totp'); const bar = h('div.sl-totpbar', h('i'));
      const tick = async () => { try { code.textContent = await totp(sec.value); } catch { code.textContent = '------'; } const left = 30 - Math.floor(Date.now() / 1000) % 30; bar.firstChild.style.width = (left / 30) * 100 + '%'; };
      timer = setInterval(tick, 1000); tick(); sec.addEventListener('input', tick);
      mount(main, h('div.sl-card', h('h3', t('How 2FA codes work')), h('p.small.muted', t('Authenticator apps compute a 6-digit code from a shared secret and the current time (TOTP, RFC 6238). The same math runs here. Use it to learn — keep your real secrets only in your authenticator app.')), field(t('Secret (base32)'), sec), code, bar,
        h('button.btn', { onClick: () => ctx.go('settings') }, icon('shield', 14), t('Turn on 2FA for your Nebulix account'))));
    }
    function cve() {
      const inp = h('input.input', { placeholder: t('Product (e.g. openssl, chrome) or CVE-2024-3094') }); const res = h('div');
      const run = (btn) => busy(btn, async () => { try { const r = await api.get('/api/sec/cve?q=' + encodeURIComponent(inp.value)); mount(res, h('p.small.muted', t('{n} results', { n: fmt.num(r.total) })), r.items.map((x) => h('div.sl-cve', h('div.row', h('b', x.id), x.score !== null ? h('span.sl-sev.' + String(x.sev || '').toLowerCase(), x.score + ' ' + (x.sev || '')) : null, h('span.grow'), h('span.tiny.muted', fmt.date(x.published))), h('p.small', x.desc.slice(0, 400)), h('div.tiny', x.refs.map((u) => h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, new URL(u).hostname + ' ')))))); } catch (e) { toastErr(e); } });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(main.querySelector('.btn.primary')); });
      mount(main, h('div.sl-card', h('h3', t('Known vulnerabilities (CVE)')), h('p.small.muted', t('Search the public NIST database to see if software you use has known security holes, and keep it updated.')), h('div.row', inp, h('button.btn.primary', { onClick: (e) => run(e.currentTarget) }, t('Search')))), res);
    }
    async function ctf() {
      let d; try { d = await api.get('/api/sec/ctf'); } catch (e) { return mount(main, emptyState('alert', e.message)); }
      mount(main, h('div.sl-card', h('div.row', h('h3.grow', t('CTF practice')), h('b.coin', d.score + ' ' + t('points'))), h('p.small.muted', t('Capture The Flag: each challenge hides a flag like NBX{…}. Solve it with the Lab’s tools. The first time you solve one you earn its points in coins.'))),
        h('div.sl-ctf', d.items.map((c) => { const inp = h('input.input.sm', { placeholder: 'NBX{…}' }); return h('div.sl-ch' + (c.solved ? '.solved' : ''), h('div.row', h('b.grow', pick2(c.n)), h('span.pill', c.pts + ' pts')), h('code.sl-q', pick2(c.q)),
          c.solved ? h('div.sl-good', icon('check', 14), ' ', t('Solved')) : h('div.row', inp, h('button.btn.sm.primary', { onClick: (e) => busy(e.currentTarget, async () => { const r = await api.post('/api/sec/ctf/' + c.id, { flag: inp.value }); if (r.ok) { sfx.coin(); if (r.coins) { patchMe({ coins: r.coinsTotal }); toast(t('Correct! +{n} coins', { n: r.coins }), 'coin'); } open(); } else { toast(t('Not the right flag'), 'err', 1500); } }) }, t('Submit')), h('button.btn.sm.ghost', { onClick: () => { tool = c.tool === 'encode' ? 'hash' : c.tool; open(); } }, t('Open tool')))); })),
        d.board.length ? h('div.sl-card', h('h4', t('Top players')), d.board.map((b, i) => h('div.row.small', h('span', (i + 1) + '.'), h('span.grow', '@' + b.username), h('b', b.pts)))) : null);
    }
    open();
    return () => clearInterval(timer);
  },
};
