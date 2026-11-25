'use strict';
// Nebulix Android (3.0): real Android devices on compute nodes. Users create, start and stop their devices here; the
// screen, APK uploads and screenshots go straight between the browser and the node with tickets from this API.
const crypto = require('crypto');
const { S, isPro, tierRank } = require('../state');
const { HttpError, now } = require('../util');
const C = require('../compute');

const devs = () => S.store.table('cdevices');
const touch = () => S.store.touch('cdevices');
const quota = (u) => (u.role === 'owner' || u.role === 'admin' ? 10 : isPro(u) ? [2, 3, 4, 5][tierRank(u)] || 2 : 1);
const nodeOf = (d) => C.nodes().find((n) => n.id === d.node);
function mine(c, orphanOk) { const d = devs()[c.params.id]; if (!d || d.owner !== c.user.id) throw new HttpError(404, 'no_device', 'Device not found'); const n = nodeOf(d); if (!n && orphanOk) return [d, null]; if (!n) throw new HttpError(503, 'node_removed', 'The server this device lived on has been removed'); return [d, n]; }
const view = (d, live) => ({ id: d.id, name: d.name, api: d.api, android: live ? live.android : null, profile: d.profile, cpu: d.cpu, ram: d.ram, storage: d.storage, created: d.created, node: (nodeOf(d) || {}).name || '?',
  state: live ? live.state : 'unreachable', since: live ? live.since : null, snapshots: live ? live.snapshots : [], recording: live ? live.recording : false });
const SUBS = { apps: ['GET', 'apps'], logcat: ['GET', 'logcat'], files: ['GET', 'files'], info: ['GET', 'info'], snapshots: ['GET', 'snapshots'] };
const OPS = { start: 'start', stop: 'stop', restart: 'restart', rotate: 'rotate', gps: 'gps', resolution: 'resolution', shell: 'shell', config: 'config',
  'snapshot-save': 'snapshots/save', 'snapshot-load': 'snapshots/load', 'snapshot-delete': 'snapshots/delete', 'app-uninstall': 'apps/uninstall', 'app-launch': 'apps/launch', 'app-stop': 'apps/stop' };

module.exports = function register(r) {
  r.get('/api/android/status', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const list = C.enabled(); const hs = await Promise.all(list.map((n) => C.check(n)));
    return { configured: list.length > 0, nodes: list.map((n, i) => C.publicNode(n, hs[i])), quota: quota(c.user), used: Object.values(devs()).filter((d) => d.owner === c.user.id).length, googlePlay: false };
  });
  r.get('/api/android/devices', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const list = Object.values(devs()).filter((d) => d.owner === c.user.id).sort((a, b) => a.created - b.created);
    const byNode = new Map(); for (const d of list) { const n = nodeOf(d); if (n) byNode.set(n.id, n); }
    const live = new Map();
    await Promise.all([...byNode.values()].map(async (n) => { try { const j = await C.call(n, 'GET', '/v1/devices?owner=' + encodeURIComponent(c.user.id), undefined, 6000); for (const x of j.devices) live.set(x.id, x); } catch {} }));
    return { devices: list.map((d) => view(d, live.get(d.id))) };
  });
  r.post('/api/android/devices', { auth: true, verified: true, limit: [10, 600000, 'user'] }, async (c) => {
    const u = c.user; const b = c.body || {};
    if (Object.values(devs()).filter((d) => d.owner === u.id).length >= quota(u)) throw new HttpError(403, 'quota', isPro(u) ? 'You have reached your device limit' : 'Free accounts can have 1 Android device — PRO plans can have more');
    const api = Number(b.api) || 0; const cands = [];
    for (const n of C.enabled()) { const h = await C.check(n); if (h.ok && h.data.kvm && h.data.images.some((i) => i.api === api)) cands.push([n, h]); }
    if (!cands.length) throw new HttpError(503, 'no_node', C.enabled().length ? 'No compute node has that Android version online right now' : 'Nebulix Android needs a compute node, and none is connected yet');
    cands.sort((a, b) => (a[1].data.running / a[1].data.maxRunning) - (b[1].data.running / b[1].data.maxRunning));
    const [node] = cands[0]; const id = crypto.randomBytes(6).toString('hex');
    const cpu = Math.max(1, Math.min(isPro(u) ? 4 : 2, Number(b.cpu) || 2)); const ram = Math.max(1536, Math.min(isPro(u) ? 6144 : 3072, Number(b.ram) || 2048)); const storage = Math.max(2, Math.min(isPro(u) ? 16 : 6, Number(b.storage) || 4));
    const j = await C.call(node, 'POST', '/v1/devices', { id, owner: u.id, name: String(b.name || '').slice(0, 40), api, profile: b.profile, cpu, ram, storage });
    const d = { id, owner: u.id, node: node.id, name: j.device.name, api, profile: j.device.profile, cpu: j.device.cpu, ram: j.device.ram, storage: j.device.storage, created: now() };
    devs()[id] = d; touch(); return { device: view(d, j.device) };
  });
  r.delete('/api/android/devices/:id', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const [d, n] = mine(c, true); if (n) try { await C.call(n, 'DELETE', '/v1/devices/' + d.id, undefined, 90000); } catch (e) { if (e.status !== 404 && !c.query.force) throw e; }
    delete devs()[d.id]; touch(); return { ok: true };
  });
  r.get('/api/android/devices/:id/:sub', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const [d, n] = mine(c); const s = SUBS[c.params.sub]; if (!s) throw new HttpError(404, 'not_found', 'Not found');
    const q = c.params.sub === 'logcat' ? '?lines=' + (Number(c.query.lines) || 300) : c.params.sub === 'apps' && c.query.all ? '?all=1' : '';
    return C.call(n, 'GET', '/v1/devices/' + d.id + '/' + s[1] + q);
  });
  r.post('/api/android/devices/:id/:op', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const [d, n] = mine(c); const op = c.params.op;
    if (op === 'ticket') { // the browser talks to the node directly with this
      const base = n.url.replace(/\/+$/, ''); const t = C.ticket(n, d.id, c.user.id, ['view', 'ctl', 'apk', 'file', 'shot', 'rec']);
      return { base, ws: base.replace(/^http/, 'ws') + '/v1/stream?t=' + encodeURIComponent(t), t };
    }
    const path = OPS[op]; if (!path) throw new HttpError(404, 'not_found', 'Unknown action');
    const b = c.body || {};
    if (op === 'config') { if (b.cpu) b.cpu = Math.min(isPro(c.user) ? 4 : 2, Number(b.cpu)); if (b.ram) b.ram = Math.min(isPro(c.user) ? 6144 : 3072, Number(b.ram)); if (b.storage) b.storage = Math.min(isPro(c.user) ? 16 : 6, Number(b.storage)); }
    const j = await C.call(n, 'POST', '/v1/devices/' + d.id + '/' + path, b, op === 'start' || op === 'restart' ? 30000 : 150000);
    if (j.device) { if (j.device.name) d.name = j.device.name; Object.assign(d, { cpu: j.device.cpu, ram: j.device.ram, storage: j.device.storage }); touch(); return { device: view(d, j.device) }; }
    return j;
  });

  // ---- admin: compute nodes ----
  const adminView = (n, h) => ({ id: n.id, name: n.name, url: n.url, enabled: n.enabled !== false, added: n.added, health: h ? { ok: h.ok, error: h.error || null, at: h.at, ...(h.ok ? { version: h.data.version, kvm: h.data.kvm, images: h.data.images, running: h.data.running, maxRunning: h.data.maxRunning, devices: h.data.devices, cpus: h.data.cpus, memFree: h.data.memFree, memTotal: h.data.memTotal, load: h.data.load } : {}) } : null,
    devices: Object.values(devs()).filter((d) => d.node === n.id).length });
  r.get('/api/admin/compute', { auth: true, role: 'admin' }, async () => { const list = C.nodes(); const hs = await Promise.all(list.map((n) => C.check(n, true))); return { nodes: list.map((n, i) => adminView(n, hs[i])) }; });
  r.post('/api/admin/compute', { auth: true, role: 'owner', limit: [20, 60000, 'user'] }, async (c) => {
    const b = c.body || {}; let url; try { url = new URL(String(b.url || '')); } catch { throw new HttpError(400, 'bad_url', 'Enter the node address, e.g. https://node1.example.com'); }
    if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'bad_url', 'The address must start with https://');
    const secret = String(b.secret || ''); if (secret.length < 32) throw new HttpError(400, 'bad_secret', 'The node secret must have at least 32 characters (NX_NODE_SECRET on the node)');
    if (C.nodes().length >= 20) throw new HttpError(400, 'too_many', 'Up to 20 nodes');
    const n = { id: crypto.randomBytes(4).toString('hex'), name: String(b.name || url.hostname).slice(0, 40), url: url.origin, secret, enabled: true, added: now() };
    const h = await C.check(n, true); if (!h.ok) throw new HttpError(400, 'node_unreachable', 'Could not reach the node with that secret: ' + h.error);
    C.nodes().push(n); S.store.touch('meta'); require('../state').audit('compute_node_add', c.user.id, n.name + ' ' + n.url); return { node: adminView(n, h) };
  });
  r.put('/api/admin/compute/:id', { auth: true, role: 'owner' }, async (c) => { const n = C.nodes().find((x) => x.id === c.params.id); if (!n) throw new HttpError(404, 'no_node', 'Not found'); if (c.body.enabled !== undefined) n.enabled = !!c.body.enabled; if (c.body.name) n.name = String(c.body.name).slice(0, 40); S.store.touch('meta'); return { node: adminView(n, await C.check(n, true)) }; });
  r.delete('/api/admin/compute/:id', { auth: true, role: 'owner' }, async (c) => { const list = C.nodes(); const i = list.findIndex((x) => x.id === c.params.id); if (i < 0) throw new HttpError(404, 'no_node', 'Not found'); const [n] = list.splice(i, 1); C.health.delete(n.id); S.store.touch('meta'); require('../state').audit('compute_node_remove', c.user.id, n.name); return { ok: true }; });
};
