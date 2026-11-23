import { bus, S } from './state.js';
import { t } from './i18n.js';

export class ApiError extends Error {
  constructor(status, code, message, body) { super(message); this.status = status; this.code = code; this.body = body; }
}
async function req(method, path, body, opts = {}) {
  const init = { method, credentials: 'same-origin', headers: {}, signal: opts.signal };
  if (body !== undefined && method !== 'GET') {
    if (body instanceof Blob || body instanceof ArrayBuffer) { init.body = body; init.headers['Content-Type'] = opts.type || 'application/octet-stream'; }
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  }
  let res;
  try { res = await fetch(path, init); } catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(0, 'network', t('Network error. Is the server running?')); }
  const text = await res.text(); let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  if (!res.ok) {
    const e = new ApiError(res.status, json.error, json.message || res.statusText, json);
    if (res.status === 401 && !opts.quiet) bus.emit('unauthorized');
    throw e;
  }
  return json;
}
export const api = {
  get: (p, o) => req('GET', p, undefined, o), post: (p, b, o) => req('POST', p, b === undefined ? {} : b, o), put: (p, b, o) => req('PUT', p, b, o),
  patch: (p, b, o) => req('PATCH', p, b, o), del: (p, o) => req('DELETE', p, undefined, o),
  upload(kind, file) { return req('POST', '/api/upload?kind=' + encodeURIComponent(kind), file, { type: file.type || 'application/octet-stream' }); },
};

// Server-Sent-Events over fetch (used by Nova, the AI assistant)
export async function streamPost(path, body, { onData, signal } = {}) {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) { let j = {}; try { j = await res.json(); } catch {} throw new ApiError(res.status, j.error, j.message || res.statusText, j); }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); if (chunk.startsWith('data: ')) { try { onData(JSON.parse(chunk.slice(6))); } catch {} } }
  }
}

// ---- realtime socket with automatic reconnect ----
let sock = null, retry = 0, timer = null, wanted = false;
export const ws = {
  connect() {
    wanted = true; if (sock && sock.readyState <= 1) return;
    const url = location.origin.replace(/^http/, 'ws') + '/ws';
    try { sock = new WebSocket(url); } catch { return; }
    sock.onopen = () => { retry = 0; S.ws = true; bus.emit('ws:open'); };
    sock.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } bus.emit('ws:' + m.t, m); bus.emit('ws', m); };
    sock.onclose = () => { S.ws = false; bus.emit('ws:close'); sock = null; if (wanted) { clearTimeout(timer); timer = setTimeout(() => ws.connect(), Math.min(15000, 800 * 2 ** retry++)); } };
    sock.onerror = () => {};
  },
  close() { wanted = false; clearTimeout(timer); if (sock) { try { sock.close(); } catch {} sock = null; } S.ws = false; },
  send(o) { if (sock && sock.readyState === 1) sock.send(JSON.stringify(o)); },
};
setInterval(() => ws.send({ t: 'ping' }), 25000);
