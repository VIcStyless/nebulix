// Nebulix 3.0 phase 23 — report JavaScript errors in Nebulix's own code to the server, so admins can see and fix them
// (Admin → Overview → Browser errors). Sent: the message (emails and long numbers masked), the Nebulix file and line, a
// short stack of Nebulix paths, the page name, the app version and the browser family. Not sent: page content, form
// values, addresses, query strings. Errors from browser extensions and other sites are ignored. At most 10 per page load.
import { S } from './state.js';

const sent = new Set(); let n = 0;
const OWN = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin && /^\/(js|css)\//.test(x.pathname); } catch { return false; } };
const IGNORE = /ResizeObserver loop|Script error\.?$|AbortError|The user aborted|NotAllowedError|play\(\) request was interrupted|Load failed|Failed to fetch|NetworkError/i;
const mask = (s) => String(s || '').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>').replace(/\d{6,}/g, '<n>').slice(0, 300);
const browser = () => { const u = navigator.userAgent; return /Edg\//.test(u) ? 'edge' : /OPR\//.test(u) ? 'opera' : /SamsungBrowser/.test(u) ? 'samsung' : navigator.brave ? 'brave' : /Firefox\//.test(u) ? 'firefox' : /Chrome\//.test(u) ? 'chrome' : /Safari\//.test(u) ? 'safari' : 'other'; };
const strip = (s) => String(s || '').split('\n').slice(0, 10).map((l) => l.replace(/https?:\/\/[^/\s)]+/g, '').replace(/\?[^:\s)]*/g, '')).join('\n').slice(0, 2000);
function report(kind, message, file, line, col, stack) {
  if (!S.me || n >= 10 || !message || IGNORE.test(message)) return;
  let f = file; if (!f || !OWN(f)) { const m = /(https?:\/\/[^\s)]+\/(?:js|css)\/[^\s):]+):(\d+):(\d+)/.exec(stack || ''); if (!m || !OWN(m[1])) return; f = m[1]; line = Number(m[2]); col = Number(m[3]); }
  const path = new URL(f, location.href).pathname; const key = message + path + line; if (sent.has(key)) return; sent.add(key); n++;
  const route = (String(location.hash).replace(/^#\/?/, '').split(/[/?]/)[0] || 'home').slice(0, 20);
  fetch('/api/client-errors', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, message: mask(message), file: path, line, col, stack: strip(stack), route: /^[a-z0-9]+$/.test(route) ? route : '', version: (S.cfg && S.cfg.version) || '', browser: browser() }) }).catch(() => {});
}
let started = false;
export function start() {
  if (started) return; started = true;
  addEventListener('error', (e) => { if (e.target && e.target !== window) return; /* resource load errors */ report('error', e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack); });
  addEventListener('unhandledrejection', (e) => { const r = e.reason; if (!r || r.name === 'ApiError' || (r.constructor && r.constructor.name === 'ApiError') || r.status) return; report('promise', (r && r.message) || String(r), '', 0, 0, r && r.stack); });
}
