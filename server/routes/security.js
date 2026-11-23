'use strict';
// Nebulix 13.2 — Security Lab (defensive and educational):
//   · breached-password check with k-anonymity (only the first 5 characters of the SHA-1 leave the browser; the server
//     forwards them to the Pwned Passwords range API and never sees the password)
//   · website security check: HTTPS, security headers, cookie flags (public internet only, through the SSRF guard)
//   · CVE search (NIST NVD)
//   · CTF practice challenges with flags checked on the server and a coin reward the first time
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const guard = require('../proxy/guard');
const { S } = require('../state');
const { HttpError, now } = require('../util');

const UA = 'Mozilla/5.0 (compatible; NebulixSecurityLab/1.0)';
function head(urlStr, hops = 0) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlStr); guard.checkUrl(u); } catch (e) { return reject(new HttpError(400, 'bad_url', 'Enter a public http(s) address')); }
    if (!/^https?:$/.test(u.protocol)) return reject(new HttpError(400, 'bad_url', 'Only http and https'));
    const lib = u.protocol === 'https:' ? https : http; const t0 = Date.now();
    const req = lib.request(u, { method: 'GET', lookup: guard.lookup, timeout: 6000, headers: { 'user-agent': UA, accept: 'text/html,*/*' } }, (res) => {
      const info = { url: u.href, status: res.statusCode, headers: res.headers, ms: Date.now() - t0, tls: u.protocol === 'https:' ? { proto: res.socket.getProtocol && res.socket.getProtocol(), cert: (() => { try { const c = res.socket.getPeerCertificate(); return c && c.valid_to ? { issuer: c.issuer && (c.issuer.O || c.issuer.CN), to: c.valid_to, subject: c.subject && c.subject.CN } : null; } catch { return null; } })() } : null };
      res.resume();
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 4) { return resolve(head(new URL(res.headers.location, u).href, hops + 1).then((r) => Object.assign(r, { redirects: (r.redirects || []).concat([{ from: u.href, status: res.statusCode }]) }))); }
      resolve(info);
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', (e) => reject(new HttpError(502, 'unreachable', 'Could not reach the site: ' + e.message))); req.end();
  });
}
const CHECKS = [
  ['strict-transport-security', 20, ['Forces HTTPS on future visits (HSTS).', 'Obliga a usar HTTPS en las próximas visitas (HSTS).']],
  ['content-security-policy', 25, ['Limits where scripts and content can load from (CSP) — the best defence against XSS.', 'Limita desde dónde se cargan scripts y contenido (CSP): la mejor defensa contra XSS.']],
  ['x-content-type-options', 10, ['Stops the browser from guessing file types (nosniff).', 'Evita que el navegador adivine el tipo de archivo (nosniff).']],
  ['x-frame-options', 10, ['Prevents the site from being framed (clickjacking).', 'Impide que la web se meta en un marco (clickjacking).']],
  ['referrer-policy', 10, ['Controls how much of the address is shared with other sites.', 'Controla cuánta información de la dirección se comparte con otras webs.']],
  ['permissions-policy', 10, ['Turns off powerful features the site does not need (camera, mic…).', 'Desactiva funciones potentes que la web no necesita (cámara, micro…).']],
  ['cross-origin-opener-policy', 5, ['Isolates the page from other windows (COOP).', 'Aísla la página de otras ventanas (COOP).']],
];
async function siteCheck(url) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const r = await head(url); const H = r.headers; let score = 0; const items = [];
  const https0 = r.url.startsWith('https:'); score += https0 ? 10 : 0; items.push({ k: 'https', ok: https0, w: 10, d: ['The connection is encrypted (HTTPS).', 'La conexión está cifrada (HTTPS).'] });
  for (const [k, w, d] of CHECKS) { let ok = !!H[k]; if (k === 'x-frame-options' && !ok && /frame-ancestors/i.test(H['content-security-policy'] || '')) ok = true; if (k === 'strict-transport-security' && ok && !/max-age=\d{6,}/i.test(H[k])) ok = 'weak'; score += ok === true ? w : ok === 'weak' ? w / 2 : 0; items.push({ k, ok, w, d, v: H[k] ? String(H[k]).slice(0, 300) : null }); }
  const cookies = [].concat(H['set-cookie'] || []).map((c) => ({ name: c.split('=')[0], secure: /;\s*secure/i.test(c), httpOnly: /;\s*httponly/i.test(c), sameSite: (/;\s*samesite=(\w+)/i.exec(c) || [])[1] || null }));
  const leaks = ['server', 'x-powered-by', 'x-aspnet-version'].filter((k) => H[k]).map((k) => ({ k, v: String(H[k]).slice(0, 80) }));
  const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
  return { url: r.url, status: r.status, ms: r.ms, tls: r.tls, redirects: r.redirects || [], score, grade, items, cookies, leaks };
}
// ---------- CTF practice ----------
// flags are stored as SHA-256 hashes; the clues are solvable with the Lab's own tools (encodings, ciphers, hashes, JWT)
const h256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const CTF = [
  { id: 'b64', pts: 50, n: ['Hidden message', 'Mensaje oculto'], q: ['Decode this: TkJYe2Jhc2U2NF9pc19ub3RfZW5jcnlwdGlvbn0=', 'Descodifica esto: TkJYe2Jhc2U2NF9pc19ub3RfZW5jcnlwdGlvbn0='], tool: 'encode', flag: h256('NBX{base64_is_not_encryption}') },
  { id: 'caesar', pts: 75, n: ['Old Roman trick', 'Truco romano'], q: ['Every letter moved by the same amount: AFL{udqqbrq_dkq_ubxqi}', 'Cada letra se ha movido lo mismo: AFL{udqqbrq_dkq_ubxqi}'], tool: 'cipher', flag: h256('NBX{hidden_fun_lessons}') },
  { id: 'hex', pts: 75, n: ['Machine talk', 'Lenguaje de máquina'], q: ['4e42587b6865785f656e636f64696e675f69735f6561737921 7d → join and decode the hex', '4e42587b6865785f656e636f64696e675f69735f6561737921 7d → júntalo y descodifica el hexadecimal'], tool: 'encode', flag: h256('NBX{hex_encoding_is_easy!}') },
  { id: 'jwt', pts: 100, n: ['Token inspector', 'Inspector de tokens'], q: ['Find the flag in this token: eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiZ3Vlc3QiLCJmbGFnIjoiTkJYe25ldmVyX3RydXN0X2FsZ19ub25lfSJ9.', 'Encuentra la flag en este token: eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiZ3Vlc3QiLCJmbGFnIjoiTkJYe25ldmVyX3RydXN0X2FsZ19ub25lfSJ9.'], tool: 'jwt', flag: h256('NBX{never_trust_alg_none}') },
  { id: 'hash', pts: 150, n: ['Weak password', 'Contraseña débil'], q: ['This SHA-256 is a common password: 5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8. The flag is NBX{password}.', 'Este SHA-256 es una contraseña muy común: 5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8. La flag es NBX{contraseña}.'], tool: 'hash', flag: h256('NBX{password}') },
  { id: 'vig', pts: 200, n: ['Keyword cipher', 'Cifrado con clave'], q: ['Vigenère with the key NEBULIX: AFY{grllwx_gizm_mvlm}', 'Vigenère con la clave NEBULIX: AFY{grllwx_gizm_mvlm}'], tool: 'cipher', flag: null },
  { id: 'xor', pts: 200, n: ['Single-byte XOR', 'XOR de un byte'], q: ['Hex bytes XOR-ed with one byte: 0c00193a2b2d1e2d2e2b1e2a1d322e3e', 'Bytes en hexadecimal con XOR de un solo byte: 0c00193a2b2d1e2d2e2b1e2a1d322e3e'], tool: 'cipher', flag: null },
];
// the last two flags are computed so the clue and the answer always match
(function build() {
  const vig = (txt, key, dec) => { let j = 0; return txt.replace(/[a-z]/gi, (ch) => { const up = ch === ch.toUpperCase(); const a = up ? 65 : 97; const k = key.toUpperCase().charCodeAt(j++ % key.length) - 65; return String.fromCharCode(((ch.charCodeAt(0) - a + (dec ? 26 - k : k)) % 26) + a); }); };
  const vplain = 'NBX{secret_keys_rule}'; const vc = CTF.find((x) => x.id === 'vig'); const enc = vig(vplain, 'NEBULIX'); vc.q = [`Vigenère with the key NEBULIX: ${enc}`, `Vigenère con la clave NEBULIX: ${enc}`]; vc.flag = h256(vplain);
  const xplain = 'NBX{xor_is_reversible}'; const key = 0x42; const hex = Buffer.from(xplain).map((b) => b ^ key).toString('hex'); const xc = CTF.find((x) => x.id === 'xor'); xc.q = [`Hex bytes XOR-ed with one byte: ${hex}`, `Bytes en hexadecimal con XOR de un solo byte: ${hex}`]; xc.flag = h256(xplain);
  const cplain = 'NBX{hidden_fun_lessons}'; const shift = 13; const cc = CTF.find((x) => x.id === 'caesar'); const cenc = cplain.replace(/[a-z]/gi, (ch) => { const a = ch === ch.toUpperCase() ? 65 : 97; return String.fromCharCode(((ch.charCodeAt(0) - a + shift) % 26) + a); }); cc.q = [`Every letter moved by the same amount: ${cenc}`, `Cada letra se ha movido lo mismo: ${cenc}`];
  const hx = CTF.find((x) => x.id === 'hex'); const hplain = 'NBX{hex_encoding_is_easy!}'; const hh = Buffer.from(hplain).toString('hex'); hx.q = [`Decode the hexadecimal: ${hh}`, `Descodifica el hexadecimal: ${hh}`];
})();
const cves = new Map();
module.exports = function register(r) {
  r.get('/api/sec/pwned/:prefix', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const p = String(c.params.prefix || '').toUpperCase(); if (!/^[0-9A-F]{5}$/.test(p)) throw new HttpError(400, 'bad_prefix', 'Send the first 5 characters of the SHA-1');
    const resp = await fetch('https://api.pwnedpasswords.com/range/' + p, { headers: { 'user-agent': 'NebulixSecurityLab', 'Add-Padding': 'true' } }).catch(() => null);
    if (!resp || !resp.ok) throw new HttpError(502, 'unavailable', 'The breach database is not answering right now');
    c.res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=3600' }); c.res.end(await resp.text());
  });
  r.post('/api/sec/site', { auth: true, verified: true, limit: [10, 60000, 'user'] }, async (c) => siteCheck(String(c.body.url || '').trim().slice(0, 300)));
  r.get('/api/sec/cve', { auth: true, limit: [20, 60000, 'user'] }, async (c) => {
    const q = String(c.query.q || '').trim().slice(0, 60); if (q.length < 2) throw new HttpError(400, 'short', 'Type a product or a CVE id');
    const key = q.toLowerCase(); const hit = cves.get(key); if (hit && now() - hit.at < 3600000) return hit.data;
    const url = /^CVE-\d{4}-\d{3,}$/i.test(q) ? 'https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=' + encodeURIComponent(q.toUpperCase()) : 'https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=20&keywordSearch=' + encodeURIComponent(q);
    const resp = await fetch(url, { headers: { 'user-agent': 'NebulixSecurityLab' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!resp || !resp.ok) throw new HttpError(502, 'unavailable', 'The CVE database (NIST NVD) is not answering right now — try again in a minute');
    const j = await resp.json(); const data = { total: j.totalResults || 0, items: (j.vulnerabilities || []).slice(0, 20).map((v) => { const x = v.cve; const m = (x.metrics && (x.metrics.cvssMetricV31 || x.metrics.cvssMetricV30 || x.metrics.cvssMetricV2)) || []; const cv = m[0] && m[0].cvssData; return { id: x.id, published: x.published, desc: ((x.descriptions || []).find((d) => d.lang === 'en') || {}).value || '', score: cv ? cv.baseScore : null, sev: cv ? cv.baseSeverity || (m[0].baseSeverity) : null, refs: (x.references || []).slice(0, 3).map((r0) => r0.url) }; }) };
    cves.set(key, { at: now(), data }); if (cves.size > 300) cves.clear(); return data;
  });
  r.get('/api/sec/ctf', { auth: true }, async (c) => { const done = (c.user.ctf || {}); return { items: CTF.map((x) => ({ id: x.id, pts: x.pts, n: x.n, q: x.q, tool: x.tool, solved: !!done[x.id] })), score: CTF.filter((x) => done[x.id]).reduce((a, x) => a + x.pts, 0), board: Object.values(S.users).filter((u) => u && !u.deleted && u.ctf && Object.keys(u.ctf).length).map((u) => ({ username: u.username, pts: CTF.filter((x) => u.ctf[x.id]).reduce((a, x) => a + x.pts, 0) })).sort((a, b) => b.pts - a.pts).slice(0, 10) }; });
  r.post('/api/sec/ctf/:id', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const ch = CTF.find((x) => x.id === c.params.id); if (!ch) throw new HttpError(404, 'no_challenge', 'Unknown challenge');
    const ok = h256(String(c.body.flag || '').trim()) === ch.flag; if (!ok) return { ok: false };
    const u = c.user; u.ctf = u.ctf || {}; let coins = 0; if (!u.ctf[ch.id]) { u.ctf[ch.id] = now(); coins = ch.pts; require('../economy').adjust(u, coins, 'ctf:' + ch.id); S.store.touch('users'); }
    return { ok: true, coins, coinsTotal: u.coins };
  });
};
