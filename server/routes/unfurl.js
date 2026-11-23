'use strict';
// Link previews for community messages: title, description, site name and an image, fetched by the server
// through the proxy's SSRF guard (public internet only, validated DNS, small size and time limits).
// Images are re-served from our own origin so the strict app CSP stays as it is.
const http = require('http');
const https = require('https');
const guard = require('../proxy/guard');
const { HttpError } = require('../util');

const cache = new Map(); // url -> { at, data }
const imgs = new Map();  // token -> image url (only images we found in a preview can be fetched)
const TTL = 30 * 60000;
const UA = 'Mozilla/5.0 (compatible; NebulixLinkPreview/3.0; +https://nebulix.app)';

function get(urlStr, { maxBytes, accept, hops = 0 }) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlStr); guard.checkUrl(u); } catch (e) { return reject(e); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('scheme'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', lookup: guard.lookup, timeout: 4500, headers: { 'user-agent': UA, accept, 'accept-language': 'en,es;q=0.8' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 3) { res.resume(); return resolve(get(new URL(res.headers.location, u).href, { maxBytes, accept, hops: hops + 1 })); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('status ' + res.statusCode)); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { chunks.push(c.subarray(0, Math.max(0, c.length - (n - maxBytes)))); res.destroy(); } else chunks.push(c); });
      res.on('close', () => resolve({ body: Buffer.concat(chunks), type: String(res.headers['content-type'] || ''), url: u.href }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const decode = (s) => String(s).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => {
  const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }; if (map[e.toLowerCase()]) return map[e.toLowerCase()];
  const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(cp) && cp > 31 ? String.fromCodePoint(cp) : '';
}).replace(/\s+/g, ' ').trim();
function meta(html, names) {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i'); const tag = re.exec(html);
    if (tag) { const c = /content=["']([^"']*)["']/i.exec(tag[0]); if (c && c[1].trim()) return decode(c[1]); }
  }
  return '';
}
async function preview(url) {
  const hit = cache.get(url); if (hit && Date.now() - hit.at < TTL) return hit.data;
  let data = null;
  try {
    const r = await get(url, { maxBytes: 320 * 1024, accept: 'text/html,application/xhtml+xml' });
    if (/text\/html|xhtml/i.test(r.type)) {
      const html = r.body.toString('utf8');
      const title = meta(html, ['og:title', 'twitter:title']) || decode((/<title[^>]*>([^<]{1,300})<\/title>/i.exec(html) || [])[1] || '');
      const desc = meta(html, ['og:description', 'twitter:description', 'description']);
      const site = meta(html, ['og:site_name']) || new URL(r.url).hostname.replace(/^www\./, '');
      let image = meta(html, ['og:image', 'og:image:url', 'twitter:image']); let img = null;
      if (image) { try { image = new URL(image, r.url).href; if (/^https?:/.test(image)) { img = require('crypto').createHash('sha256').update(image).digest('hex').slice(0, 24); imgs.set(img, image); if (imgs.size > 2000) imgs.delete(imgs.keys().next().value); } } catch {} }
      if (title || desc) data = { url, title: title.slice(0, 160), desc: desc.slice(0, 280), site: site.slice(0, 60), img: img ? '/api/unfurl/img/' + img : null };
    }
  } catch { data = null; }
  cache.set(url, { at: Date.now(), data }); if (cache.size > 1000) cache.delete(cache.keys().next().value);
  return data;
}

// Site logos (favicons), fetched server-side so they load even on networks that block the real sites.
// Tries the site's own icons, then DuckDuckGo's icon service; both go through the SSRF guard. Cached in memory.
const favCache = new Map(); // host -> { at, buf, type } | { at, none: true }
const FAV_TTL = 24 * 3600000;
async function fetchFavicon(host) {
  const hit = favCache.get(host); if (hit && Date.now() - hit.at < FAV_TTL) return hit.none ? null : hit;
  const tries = [`https://icons.duckduckgo.com/ip3/${host}.ico`, `https://${host}/favicon.ico`, `https://www.google.com/s2/favicons?sz=64&domain=${host}`];
  for (const url of tries) {
    try {
      const out = await get(url, { maxBytes: 200 * 1024, accept: 'image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,image/jpeg,image/webp,image/gif,*/*;q=0.5' });
      const type = /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|webp|gif)/i.exec(out.type);
      if (type && out.body.length > 70) { const rec = { at: Date.now(), buf: out.body, type: (type[0] === 'image/vnd.microsoft.icon' ? 'image/x-icon' : type[0]).toLowerCase() }; favCache.set(host, rec); return rec; }
    } catch { /* try next */ }
  }
  favCache.set(host, { at: Date.now(), none: true }); if (favCache.size > 3000) favCache.delete(favCache.keys().next().value);
  return null;
}

// Reader mode: fetch a page and extract just the article (title, byline, readable HTML), stripped of
// scripts, nav, ads and chrome, sanitised to a safe tag whitelist. Served same-origin so the app renders it;
// image src stay absolute (the browser view re-points them through the proxy). SSRF-guarded via get().
const READ_CACHE = new Map(); const READ_TTL = 30 * 60000;
const READ_TAGS = new Set(['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div']);
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function attrOf(attrs, name) { const m = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(attrs || ''); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : ''; }
function absolute(url, base) { if (!url) return ''; try { const u = new URL(url.trim(), base); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } }
function textLen(html) { return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length; }
function pickRegion(html) {
  const art = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html); if (art && textLen(art[1]) > 400) return art[1];
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html); if (main && textLen(main[1]) > 400) return main[1];
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html); return body ? body[1] : html;
}
function sanitizeArticle(region, base) {
  let html = region
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|button|select|textarea|iframe|object|embed|video|audio|canvas|dialog|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style|svg|nav|header|footer|aside|form|button|select|textarea|iframe|object|embed|video|audio|canvas|dialog|template)\b[^>]*\/?>/gi, ' ');
  html = html.replace(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g, (m, close, tag, attrs) => {
    tag = tag.toLowerCase();
    if (!READ_TAGS.has(tag)) return ' ';
    if (close) return '</' + tag + '>';
    if (tag === 'a') { const href = absolute(attrOf(attrs, 'href'), base); return href ? `<a href="${escAttr(href)}" target="_blank" rel="noopener nofollow">` : '<a>'; }
    if (tag === 'img') { const src = absolute(attrOf(attrs, 'src') || attrOf(attrs, 'data-src') || attrOf(attrs, 'data-lazy-src'), base); if (!src) return ' '; const alt = escAttr(attrOf(attrs, 'alt')); return `<img src="${escAttr(src)}" alt="${alt}" loading="lazy">`; }
    return '<' + tag + '>';
  });
  return html
    .replace(/<(div|span)>\s*<\/\1>/gi, ' ').replace(/<p>\s*<\/p>/gi, ' ')
    .replace(/[ \t\u00a0]+/g, ' ').replace(/(\s*<br>\s*){3,}/gi, '<br><br>').replace(/\n{3,}/g, '\n\n').trim();
}
function bylineFrom(html) { const m = /<[^>]+rel=["']author["'][^>]*>([^<]{2,80})<\/a>/i.exec(html); return m ? decode(m[1]) : ''; }
async function readArticle(url) {
  const hit = READ_CACHE.get(url); if (hit && Date.now() - hit.at < READ_TTL) return hit.v;
  let v = null;
  try {
    const r = await get(url, { maxBytes: 1.6 * 1024 * 1024, accept: 'text/html,application/xhtml+xml' });
    if (/text\/html|xhtml/i.test(r.type)) {
      const html = r.body.toString('utf8');
      const title = meta(html, ['og:title', 'twitter:title']) || decode((/<title[^>]*>([^<]{1,300})<\/title>/i.exec(html) || [])[1] || '');
      const byline = meta(html, ['author', 'article:author', 'og:article:author']) || bylineFrom(html);
      const site = meta(html, ['og:site_name']) || new URL(r.url).hostname.replace(/^www\./, '');
      const lang = ((/<html[^>]+\blang=["']?([a-z]{2,3}(?:-[a-z]{2,4})?)/i.exec(html) || [])[1] || meta(html, ['og:locale']).replace('_', '-') || '').slice(0, 10);
      const base = absolute((/<base[^>]+href=["']([^"']+)["']/i.exec(html) || [])[1] || '', r.url) || r.url;
      const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
      const content = sanitizeArticle(pickRegion(clean), base);
      const words = (content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().match(/\S+/g) || []).length;
      if (words >= 60) v = { url: r.url, title: title.slice(0, 200), byline: (byline || '').slice(0, 120), site: site.slice(0, 80), lang, html: content.slice(0, 600000), words, minutes: Math.max(1, Math.round(words / 220)) };
    }
  } catch { v = null; }
  READ_CACHE.set(url, { at: Date.now(), v }); if (READ_CACHE.size > 300) READ_CACHE.delete(READ_CACHE.keys().next().value);
  return v;
}

module.exports = function register(r) {
  r.get('/api/favicon', { auth: true, limit: [360, 60000, 'user'] }, async (c) => {
    const host = String(c.query.host || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/[^a-z0-9.-]/g, '').replace(/^\.+|\.+$/g, '');
    if (!host || !host.includes('.') || host.length > 253) throw new HttpError(400, 'bad_host', 'Bad host');
    const rec = await fetchFavicon(host);
    if (!rec) { c.res.writeHead(204, { 'Cache-Control': 'public, max-age=3600' }); return c.res.end(); }
    c.res.writeHead(200, { 'Content-Type': rec.type, 'Content-Length': rec.buf.length, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    c.res.end(rec.buf);
  });
  r.get('/api/reader', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    let u; try { u = new URL(String(c.query.url || '')); } catch { throw new HttpError(400, 'bad_url', 'Invalid link'); }
    if (!/^https?:$/.test(u.protocol) || u.href.length > 800) throw new HttpError(400, 'bad_url', 'Invalid link');
    const article = await readArticle(u.href);
    if (!article) throw new HttpError(422, 'no_article', 'No readable article found');
    return { article };
  });
  r.get('/api/unfurl', { auth: true, verified: true, limit: [90, 60000, 'user'] }, async (c) => {
    let u; try { u = new URL(String(c.query.url || '')); } catch { throw new HttpError(400, 'bad_url', 'Invalid link'); }
    if (!/^https?:$/.test(u.protocol) || u.href.length > 600) throw new HttpError(400, 'bad_url', 'Invalid link');
    return { preview: await preview(u.href) };
  });
  r.get('/api/unfurl/img/:id', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const src = imgs.get(c.params.id); if (!src) throw new HttpError(404, 'not_found', 'Not found');
    let out; try { out = await get(src, { maxBytes: 2 * 1048576, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' }); } catch { throw new HttpError(502, 'fetch_failed', 'Image unavailable'); }
    const type = /^image\/(png|jpeg|gif|webp|avif)/i.exec(out.type);
    if (!type || out.body.length > 2 * 1048576 - 1) throw new HttpError(415, 'not_image', 'Not an image');
    c.res.writeHead(200, { 'Content-Type': type[0].toLowerCase(), 'Content-Length': out.body.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    c.res.end(out.body);
  });
};
module.exports.preview = preview;
module.exports.readArticle = readArticle;
module.exports.sanitizeArticle = sanitizeArticle;
