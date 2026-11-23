'use strict';
// Streaming-free HTML rewriter: tokenises tags (not a full parser) and rewrites URL-bearing attributes,
// inline CSS/JS, drops CSP/frame meta tags and injects the Nebulix runtime.
const { rewriteCss } = require('./css');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return m; } }
    const v = NAMED[e.toLowerCase()]; return v !== undefined ? v : m;
  });
}
const encAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const URL_ATTRS = new Set(['href', 'src', 'action', 'poster', 'formaction', 'background', 'xlink:href', 'data', 'manifest', 'cite', 'longdesc']);
const SKIP_URL = /^(#|data:|blob:|javascript:|mailto:|tel:|sms:|about:|magnet:|intent:)/i;
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'plaintext']);
const DROP_REL = /(^|\s)(dns-prefetch|preconnect|prefetch|prerender)(\s|$)/i;

function findBase(html, docUrl) {
  const m = /<base\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html.length > 200000 ? html.slice(0, 200000) : html);
  if (!m) return null;
  try { return new URL(decodeEntities(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]).trim(), docUrl); } catch { return null; }
}

function rewriteSrcset(v, rw) {
  return v.replace(/(\S+)(\s+[\d.]+[wx])?(\s*,\s*|\s*$)/g, (m, u, d, sep) => (SKIP_URL.test(u) ? m : rw(u) + (d || '') + sep));
}

// ctx: { base: URL, rw(url, base)->string, rwJs(code)->string, jsOn: bool, inject: string }
function rewriteHtml(html, ctx) {
  const n = html.length; let out = ''; let i = 0; let injected = !ctx.inject;
  const base = ctx.base;
  const rw = (u) => ctx.rw(u, base);
  const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
  const SKIP = /[\s\/]*/y;
  const injectNow = () => { if (!injected) { out += ctx.inject; injected = true; } };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out += html.slice(i); i = n; break; }
    if (lt > i) out += html.slice(i, lt);
    i = lt;
    const c1 = html.charCodeAt(i + 1);
    if (c1 === 33) { // <! comment / doctype
      if (html.startsWith('<!--', i)) { let e = html.indexOf('-->', i + 4); e = e < 0 ? n : e + 3; out += html.slice(i, e); i = e; continue; }
      let e = html.indexOf('>', i); e = e < 0 ? n : e + 1; out += html.slice(i, e); i = e; continue;
    }
    if (c1 === 63 || c1 === 47) { let e = html.indexOf('>', i); e = e < 0 ? n : e + 1; out += html.slice(i, e); i = e; continue; }
    if (!((c1 >= 65 && c1 <= 90) || (c1 >= 97 && c1 <= 122))) { out += '<'; i++; continue; }

    // ---- start tag ----
    let p = i + 1;
    while (p < n) { const c = html.charCodeAt(p); if (c <= 32 || c === 47 || c === 62) break; p++; }
    const name = html.slice(i + 1, p); const ln = name.toLowerCase();
    const attrs = [];
    for (;;) {
      SKIP.lastIndex = p; SKIP.exec(html); p = SKIP.lastIndex;
      if (p >= n) break;
      if (html.charCodeAt(p) === 62) { p++; break; }
      ATTR.lastIndex = p;
      const m = ATTR.exec(html);
      if (!m) { p++; continue; }
      attrs.push({ n: m[1], ln: m[1].toLowerCase(), v: m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : null, raw: m[0], ch: false, del: false });
      p = ATTR.lastIndex;
    }
    const selfClose = html.charCodeAt(p - 2) === 47;
    const get = (k) => { const a = attrs.find((x) => x.ln === k); return a && a.v !== null ? decodeEntities(a.v) : ''; };

    if (!injected && ln !== 'html' && ln !== 'head') injectNow();

    // tags that are removed entirely
    let drop = false;
    if (ln === 'base') drop = true;
    else if (ln === 'meta') {
      const he = get('http-equiv').toLowerCase(); const nm = get('name').toLowerCase();
      if (he === 'content-security-policy' || he === 'content-security-policy-report-only' || he === 'x-frame-options' || nm === 'referrer') drop = true;
      else if (he === 'refresh') { const a = attrs.find((x) => x.ln === 'content'); if (a && a.v) { const nv = decodeEntities(a.v).replace(/(url\s*=\s*)(['"]?)([^'"]+)\2/i, (mm, pre, q, u) => pre + q + rw(u.trim()) + q); if (nv !== a.v) { a.v = nv; a.ch = true; } } }
    } else if (ln === 'link' && DROP_REL.test(get('rel'))) drop = true;
    if (drop) { i = p; continue; }

    for (const a of attrs) {
      if (a.v === null) continue;
      const k = a.ln;
      if (k === 'integrity' || k === 'nonce' || k === 'referrerpolicy' || k === 'ping') { a.del = true; continue; }
      if (URL_ATTRS.has(k)) {
        if (k === 'data' && ln !== 'object') continue;
        const v = decodeEntities(a.v).trim();
        if (v && !SKIP_URL.test(v)) { const r = rw(v); if (r !== v) { a.v = r; a.ch = true; } }
      } else if (k === 'srcset' || k === 'imagesrcset') {
        const v = decodeEntities(a.v); const r = rewriteSrcset(v, rw);
        if (r !== v) { a.v = r; a.ch = true; }
      } else if (k === 'style') {
        const v = decodeEntities(a.v); const r = rewriteCss(v, base, ctx.rw);
        if (r !== v) { a.v = r; a.ch = true; }
      } else if (ctx.jsOn && k.length > 2 && k.charCodeAt(0) === 111 && k.charCodeAt(1) === 110 && a.v.indexOf('location') >= 0) {
        const v = decodeEntities(a.v); const r = ctx.rwJs(v);
        if (r !== v) { a.v = r; a.ch = true; }
      }
    }

    if (attrs.some((a) => a.ch || a.del)) {
      out += '<' + name + attrs.filter((a) => !a.del).map((a) => (a.ch ? ` ${a.n}="${encAttr(a.v)}"` : ' ' + a.raw)).join('') + (selfClose ? ' /' : '') + '>';
    } else out += html.slice(i, p);
    i = p;
    if (ln === 'head') injectNow();

    // ---- raw text elements ----
    if (RAW_TEXT.has(ln) && !selfClose) {
      const re = new RegExp('</' + ln + '[\\s/>]', 'ig'); re.lastIndex = i;
      const m = re.exec(html);
      const end = m ? m.index : n;
      let body = html.slice(i, end);
      if (ln === 'script') {
        const type = get('type').toLowerCase().trim();
        const isJs = !type || type === 'module' || /^(text|application)\/(x-)?(java|ecma)script$/.test(type);
        if (isJs && ctx.jsOn && !get('src') && body.length) body = ctx.rwJs(body);
      } else if (ln === 'style') body = rewriteCss(body, base, ctx.rw);
      out += body;
      i = end;
    }
  }
  return out;
}

module.exports = { rewriteHtml, findBase, decodeEntities };
