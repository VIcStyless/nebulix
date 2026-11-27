'use strict';
// Nebulix 3.0 — compute nodes (separate KVM hosts that run real Android devices; see services/compute-node).
// The web server only keeps the registry and brokers sessions: control calls to a node are HMAC-signed with that
// node's secret, and the browser gets short-lived tickets to stream / upload directly from the node, so heavy traffic
// never goes through Fly.io. Node secrets live in S.meta.compute and are never sent to the browser.
const crypto = require('crypto');
const { S } = require('./state');
const { HttpError } = require('./util');

const nodes = () => (S.meta ? (S.meta.compute = S.meta.compute || { nodes: [] }).nodes : []);
// Nodes can also come from the server environment (Fly secret NX_COMPUTE_NODES="name|https://url|secret;…"), so a
// node can be connected without the secret ever passing through a browser. They are read-only in Admin → Compute.
let envNodes = null;
const fromEnv = () => envNodes || (envNodes = String(process.env.NX_COMPUTE_NODES || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const [name, url, secret] = x.split('|'); try { return { id: 'env-' + crypto.createHash('sha256').update(url).digest('hex').slice(0, 8), name, url: new URL(url).origin, secret, enabled: true, env: true }; } catch { return null; } }).filter((n) => n && n.secret && n.secret.length >= 32));
const allNodes = () => [...fromEnv(), ...nodes()];
const health = new Map(); // node id -> { at, ok, data, error }

function sign(node, method, path, body) {
  const ts = String(Date.now());
  const mac = crypto.createHmac('sha256', node.secret).update(ts + '\n' + method + '\n' + path + '\n' + crypto.createHash('sha256').update(body || '').digest('hex')).digest('hex');
  return 'NX ' + ts + '.' + mac;
}
async function call(node, method, path, body, timeout = 20000) {
  const data = body === undefined ? '' : JSON.stringify(body);
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(node.url.replace(/\/+$/, '') + path, { method, headers: { authorization: sign(node, method, path, data), 'content-type': 'application/json' }, body: method === 'GET' ? undefined : data, signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(r.status >= 500 && r.status !== 503 ? 502 : r.status === 401 ? 502 : r.status, j.error || 'node_error', j.message || (r.status === 401 ? 'The compute node rejected Nebulix (wrong secret)' : 'Compute node error ' + r.status));
    return j;
  } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(503, 'node_offline', 'The compute node is not reachable'); } finally { clearTimeout(tm); }
}
async function check(node, force) {
  const h = health.get(node.id); if (!force && h && Date.now() - h.at < 15000) return h;
  let r; try { const data = await call(node, 'GET', '/v1/health', undefined, 5000); r = { at: Date.now(), ok: true, data }; } catch (e) { r = { at: Date.now(), ok: false, error: e.message }; }
  health.set(node.id, r); return r;
}
// A ticket the node accepts from the browser: scopes view ctl apk file shot rec; 10 minutes by default.
function ticket(node, deviceId, ownerId, scopes, ms = 10 * 60000) {
  const p = Buffer.from(JSON.stringify({ d: deviceId, o: ownerId, s: scopes.join(' '), e: Date.now() + ms })).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', node.secret).update('ticket:' + p).digest('base64url');
}
const enabled = () => allNodes().filter((n) => n.enabled !== false);
function cspOrigins() { // nodes the browser may talk to (stream / uploads)
  const out = []; for (const n of enabled()) { try { const u = new URL(n.url); out.push(u.origin, u.origin.replace(/^http/, 'ws')); } catch {} }
  return out.join(' ');
}
const publicNode = (n, h) => ({ id: n.id, name: n.name, online: !!(h && h.ok), images: h && h.ok ? h.data.images : [], vmImages: h && h.ok ? (h.data.vmImages || []).map((i) => ({ id: i.id, name: i.name, kind: i.kind, os: i.os || 'linux' })) : [], running: h && h.ok ? h.data.running : 0, maxRunning: h && h.ok ? h.data.maxRunning : 0, kvm: h && h.ok ? h.data.kvm : null, windows: h && h.ok ? h.data.windows || null : null, accel: h && h.ok ? h.data.accel || (h.data.kvm ? 'kvm' : 'tcg') : null });
module.exports = { nodes, allNodes, enabled, call, check, ticket, cspOrigins, publicNode, health };
