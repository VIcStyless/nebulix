// Tiny DOM + formatting helpers shared by every view. No innerHTML anywhere: text is always inserted as text nodes.
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'g', 'line', 'polyline', 'polygon', 'ellipse', 'defs', 'linearGradient', 'radialGradient', 'stop', 'text', 'use']);

export function h(tag, attrs, ...kids) {
  let id = null; const classes = [];
  const m = /^([A-Za-z][\w-]*)((?:[.#][\w-]+)*)$/.exec(tag);
  let name = tag;
  if (m) { name = m[1]; for (const p of m[2].match(/[.#][\w-]+/g) || []) (p[0] === '#' ? (id = p.slice(1)) : classes.push(p.slice(1))); }
  const el = SVG_TAGS.has(name) ? document.createElementNS(SVG_NS, name) : document.createElement(name);
  if (id) el.id = id; if (classes.length) el.setAttribute('class', classes.join(' '));
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class' || k === 'className') { const c = Array.isArray(v) ? v.filter(Boolean).join(' ') : v; el.setAttribute('class', classes.length ? classes.join(' ') + ' ' + c : c); }
      else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else for (const [p, x] of Object.entries(v)) (p.startsWith('--') || p.includes('-') ? el.style.setProperty(p, x) : (el.style[p] = x)); }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'indeterminate' || k === 'muted' || k === 'volume') { if (!SVG_TAGS.has(name)) el[k] = v; }
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false || k === true) continue;
    if (Array.isArray(k)) add(el, k); else if (k.nodeType) el.appendChild(k); else el.appendChild(document.createTextNode(String(k)));
  }
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...kids) { clear(el); add(el, kids); return el; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export function debounce(fn, ms = 200) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; }
export function throttle(fn, ms = 100) { let last = 0, t; return (...a) => { const n = Date.now(); if (n - last >= ms) { last = n; fn(...a); } else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (n - last)); } }; }

const LOC = { en: 'en-US', es: 'es-ES', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', it: 'it-IT' };
const loc = () => LOC[document.documentElement.lang] || 'en-US';
const REL = { en: ['now', 'm', 'h', 'd'], es: ['ahora', ' min', ' h', ' d'], pt: ['agora', ' min', ' h', ' d'], fr: ['maintenant', ' min', ' h', ' j'], de: ['jetzt', ' Min.', ' Std.', ' T.'], it: ['ora', ' min', ' h', ' g'] };
export const fmt = {
  num: (n) => new Intl.NumberFormat(loc()).format(Math.round(n || 0)),
  compact: (n) => new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0),
  bytes(n) { if (n < 1024) return n + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < 3); return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i]; },
  time: (ms) => new Date(ms).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }),
  date: (ms) => new Date(ms).toLocaleDateString(loc(), { year: 'numeric', month: 'short', day: 'numeric' }),
  dt: (ms) => new Date(ms).toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' }),
  dur(s) { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`; },
  // coins: exact below 10.000, then abbreviated (10k, 12,5k, 1m, 2,35m, 1b); never rounds up past the real value
  coins(n) {
    n = Math.round(Number(n) || 0); const a = Math.abs(n); if (a < 10000) return fmt.num(n);
    for (const [v, s] of [[1e12, 't'], [1e9, 'b'], [1e6, 'm'], [1e3, 'k']]) if (a >= v) {
      const x = a / v; const d = x < 10 ? 2 : x < 100 ? 1 : 0; const f = Math.pow(10, d); const y = Math.floor(x * f) / f;
      return (n < 0 ? '-' : '') + new Intl.NumberFormat(loc(), { maximumFractionDigits: d }).format(y) + s;
    }
    return fmt.num(n);
  },
  rel(ms) {
    const s = Math.round((Date.now() - ms) / 1000); const w = REL[document.documentElement.lang] || REL.en;
    if (s < 45) return w[0]; if (s < 3600) return Math.round(s / 60) + w[1]; if (s < 86400) return Math.round(s / 3600) + w[2];
    if (s < 86400 * 7) return Math.round(s / 86400) + w[3]; return fmt.date(ms);
  },
};
export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = h('textarea', { style: 'position:fixed;opacity:0', value: text }); document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); } return Promise.resolve();
}
export function download(name, data, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type: mime })); const a = h('a', { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function pickFile(accept) {
  return new Promise((resolve) => { const i = h('input', { type: 'file', accept: accept || '', style: 'display:none' }); i.onchange = () => { resolve(i.files[0] || null); i.remove(); }; i.oncancel = () => resolve(null); document.body.appendChild(i); i.click(); });
}
export const readFile = (file, as = 'text') => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); as === 'buffer' ? r.readAsArrayBuffer(file) : as === 'dataurl' ? r.readAsDataURL(file) : r.readAsText(file); });
export const b64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64url = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isTouch = () => matchMedia('(pointer: coarse)').matches;
export const initial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();
export function safeUrl(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } }
export function once(fn) { let d = false, v; return (...a) => (d ? v : ((d = true), (v = fn(...a)))); }
export function hash32(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
export function hueOf(s) { return hash32(String(s)) % 360; }
// Animate a number element from its current value up to `to`. Respects reduce-motion.
export function countUp(el, to, { dur = 900, format } = {}) {
  to = Number(to) || 0; const fmtFn = format || ((n) => String(Math.round(n)));
  const reduce = document.documentElement.dataset.reduce === '1' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduce || to === 0) { el.textContent = fmtFn(to); return; }
  const from = 0, t0 = performance.now(); const ease = (x) => 1 - Math.pow(1 - x, 3);
  if (el.__cu) cancelAnimationFrame(el.__cu);
  const tick = (now) => { const p = Math.min(1, (now - t0) / dur); el.textContent = fmtFn(from + (to - from) * ease(p)); if (p < 1) el.__cu = requestAnimationFrame(tick); else { el.__cu = 0; el.textContent = fmtFn(to); } };
  el.__cu = requestAnimationFrame(tick);
}
export function ls(key, val) { try { if (val === undefined) { const v = localStorage.getItem('nbx.' + key); return v === null ? null : JSON.parse(v); } if (val === null) localStorage.removeItem('nbx.' + key); else localStorage.setItem('nbx.' + key, JSON.stringify(val)); } catch { return null; } return val; }
// "10k", "1,5m", "2.5M", "1.000.000", "1 000" → integer coins (NaN if it is not a number)
export function parseCoins(v) {
  let s = String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ''); if (!s) return NaN;
  const m = /^(-?[\d.,]+)([kmbt]?)$/.exec(s); if (!m) return NaN;
  let num = m[1]; const mult = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]];
  if (m[2]) num = num.replace(',', '.'); // 1,5k = 1.5k
  else if (/^-?\d{1,3}([.,]\d{3})+$/.test(num)) num = num.replace(/[.,]/g, ''); // 1.000.000 / 1,000,000
  else num = num.replace(',', '.');
  const x = Number(num) * mult; return Number.isFinite(x) ? Math.trunc(x) : NaN;
}
