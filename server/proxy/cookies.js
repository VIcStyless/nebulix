'use strict';
// Server-side cookie jar. Cookies of proxied sites never reach the browser, so one site cannot read another's.
const MAX = 400;

function parseSetCookie(str, url) {
  const parts = str.split(';');
  const first = parts.shift();
  const eq = first.indexOf('=');
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim(); const value = first.slice(eq + 1).trim();
  if (!name || name.length + value.length > 4096) return null;
  const host = url.hostname.toLowerCase();
  const ck = { name, value, domain: host, hostOnly: true, path: null, exp: null, secure: false, httpOnly: false };
  for (const p of parts) {
    const i = p.indexOf('='); const k = (i < 0 ? p : p.slice(0, i)).trim().toLowerCase(); const v = i < 0 ? '' : p.slice(i + 1).trim();
    if (k === 'domain' && v) {
      const d = v.replace(/^\./, '').toLowerCase();
      if (d.includes('.') && (host === d || host.endsWith('.' + d))) { ck.domain = d; ck.hostOnly = false; } else return null;
    } else if (k === 'path' && v.startsWith('/')) ck.path = v;
    else if (k === 'expires') { const t = Date.parse(v); if (!Number.isNaN(t)) ck.exp = ck.exp === null || ck._maxAge === undefined ? t : ck.exp; }
    else if (k === 'max-age') { const n = parseInt(v, 10); if (!Number.isNaN(n)) { ck.exp = Date.now() + n * 1000; ck._maxAge = n; } }
    else if (k === 'secure') ck.secure = true;
    else if (k === 'httponly') ck.httpOnly = true;
  }
  delete ck._maxAge;
  if (!ck.path) { const p = url.pathname; const i = p.lastIndexOf('/'); ck.path = i <= 0 ? '/' : p.slice(0, i); }
  if (name.startsWith('__Secure-') && !ck.secure) return null;
  if (name.startsWith('__Host-') && (!ck.secure || !ck.hostOnly || ck.path !== '/')) return null;
  return ck;
}

class Jar {
  constructor() { this.c = new Map(); }
  set(headers, url) {
    for (const h of headers) {
      const ck = parseSetCookie(h, url);
      if (!ck) continue;
      const key = `${ck.domain}|${ck.path}|${ck.name}`;
      if (ck.exp !== null && ck.exp <= Date.now()) { this.c.delete(key); continue; }
      this.c.set(key, ck);
    }
    if (this.c.size > MAX) { const it = this.c.keys(); for (let n = this.c.size - MAX; n > 0; n--) this.c.delete(it.next().value); }
  }
  _match(url, httpOnlyToo) {
    const host = url.hostname.toLowerCase(); const path = url.pathname || '/'; const https = url.protocol === 'https:' || url.protocol === 'wss:';
    const out = [];
    for (const [key, ck] of this.c) {
      if (ck.exp !== null && ck.exp <= Date.now()) { this.c.delete(key); continue; }
      if (ck.secure && !https) continue;
      if (!httpOnlyToo && ck.httpOnly) continue;
      if (ck.hostOnly ? host !== ck.domain : !(host === ck.domain || host.endsWith('.' + ck.domain))) continue;
      if (!(path === ck.path || (path.startsWith(ck.path) && (ck.path.endsWith('/') || path[ck.path.length] === '/')))) continue;
      out.push(ck);
    }
    out.sort((a, b) => b.path.length - a.path.length);
    return out;
  }
  header(url) { return this._match(url, true).map((c) => `${c.name}=${c.value}`).join('; '); }
  // cookies that page JavaScript may read (document.cookie)
  documentCookie(url) { return this._match(url, false).map((c) => `${c.name}=${c.value}`).join('; '); }
  clear(domain) {
    if (!domain) return this.c.clear();
    for (const [k, ck] of this.c) if (ck.domain === domain) this.c.delete(k);
  }
  // metadata only: values never leave the server through the management API
  list() {
    const out = [];
    for (const [k, ck] of this.c) {
      if (ck.exp !== null && ck.exp <= Date.now()) { this.c.delete(k); continue; }
      out.push({ domain: ck.domain, name: ck.name, path: ck.path, secure: ck.secure, httpOnly: ck.httpOnly, exp: ck.exp, size: ck.name.length + ck.value.length });
    }
    return out;
  }
  remove(domain, path, name) { return this.c.delete(`${domain}|${path}|${name}`); }
  size() { return this.c.size; }
}

module.exports = { Jar, parseSetCookie };
