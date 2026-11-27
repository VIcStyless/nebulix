'use strict';
// Nebulix Android (phase 9) and Nebulix Cloud PC (phase 10): real Android devices and Linux virtual machines on compute
// nodes. Users create, start and stop them here; the screen, uploads and screenshots go straight between the browser
// and the node with tickets from this API. Both products share the node registry (server/compute.js) and this code.
const crypto = require('crypto');
const { S, isPro, tierRank } = require('../state');
const { HttpError, now } = require('../util');
const C = require('../compute');

const devs = () => S.store.table('cdevices');
const touch = () => S.store.touch('cdevices');
const nodeOf = (d) => C.allNodes().find((n) => n.id === d.node);
const kindOf = (d) => d.kind || 'android';
const staff = (u) => u.role === 'owner' || u.role === 'admin';

const KINDS = {
  android: {
    prefix: '/api/android', label: 'Android device', needsKvm: true,
    quota: (u) => (staff(u) ? 10 : isPro(u) ? [2, 3, 4, 5][tierRank(u)] || 2 : 1),
    caps: (u) => (isPro(u) ? { cpu: 4, ram: 6144, storage: 16 } : { cpu: 2, ram: 3072, storage: 6 }),
    defaults: { cpu: 2, ram: 2048, storage: 4 }, min: { cpu: 1, ram: 1536, storage: 2 },
    fits: (h, b) => h.data.images.some((i) => i.api === Number(b.api)),
    body: (b) => ({ api: Number(b.api) || 0, profile: b.profile }),
    record: (j, b) => ({ api: Number(b.api) || 0, profile: j.device.profile }),
    subs: { apps: 'apps', logcat: 'logcat', files: 'files', info: 'info', snapshots: 'snapshots' },
    ops: { start: 'start', stop: 'stop', restart: 'restart', rotate: 'rotate', gps: 'gps', resolution: 'resolution', shell: 'shell', config: 'config',
      'snapshot-save': 'snapshots/save', 'snapshot-load': 'snapshots/load', 'snapshot-delete': 'snapshots/delete', 'app-uninstall': 'apps/uninstall', 'app-launch': 'apps/launch', 'app-stop': 'apps/stop' },
    scopes: ['view', 'ctl', 'apk', 'file', 'shot', 'rec'], wsPath: '/v1/stream',
    none: 'Nebulix Android needs a compute node, and none is connected yet', noFit: 'No compute node has that Android version online right now',
  },
  vm: {
    prefix: '/api/cloudpc', label: 'virtual machine', needsKvm: false,
    quota: (u) => (staff(u) ? 10 : isPro(u) ? [2, 3, 4, 5][tierRank(u)] || 2 : 1),
    caps: (u) => (isPro(u) ? { cpu: 8, ram: 16384, storage: 200 } : { cpu: 2, ram: 4096, storage: 30 }),
    defaults: { cpu: 2, ram: 2048, storage: 20 }, min: { cpu: 1, ram: 512, storage: 4 },
    fits: (h, b) => (h.data.vmImages || []).some((i) => i.id === String(b.image)),
    body: (b) => ({ kind: 'vm', image: String(b.image || '') }),
    record: (j) => ({ kind: 'vm', image: j.device.image, os: j.device.os || 'linux' }),
    subs: { info: 'info', snapshots: 'snapshots' },
    ops: { start: 'start', stop: 'stop', restart: 'restart', config: 'config', keys: 'keys', 'snapshot-save': 'snapshots/save', 'snapshot-load': 'snapshots/load', 'snapshot-delete': 'snapshots/delete' },
    scopes: ['ctl', 'shot'], wsPath: '/v1/vnc',
    none: 'Nebulix Cloud PC needs a compute node, and none is connected yet', noFit: 'No compute node has that system online right now',
  },
};

const view = (d, live) => ({ id: d.id, kind: kindOf(d), os: d.os || (live && live.os) || (kindOf(d) === 'vm' ? 'linux' : 'android'), name: d.name, api: d.api, android: live ? live.android : null, image: d.image || null, profile: d.profile, cpu: d.cpu, ram: d.ram, storage: d.storage, created: d.created,
  node: (nodeOf(d) || {}).name || '?', state: live ? live.state : 'unreachable', since: live ? live.since : null, snapshots: live ? live.snapshots : [], recording: live ? live.recording : false, iso: live ? live.iso : null });

function mount(r, kind) {
  const K = KINDS[kind]; const P = K.prefix;
  const mine = (c, orphanOk) => { const d = devs()[c.params.id]; if (!d || d.owner !== c.user.id || kindOf(d) !== kind) throw new HttpError(404, 'no_device', 'Not found'); const n = nodeOf(d); if (!n && orphanOk) return [d, null]; if (!n) throw new HttpError(503, 'node_removed', 'The server this ran on has been removed'); return [d, n]; };
  const owned = (u) => Object.values(devs()).filter((d) => d.owner === u.id && kindOf(d) === kind);
  const clampHw = (u, b) => { const cap = K.caps(u); const v = (k) => Math.max(K.min[k], Math.min(cap[k], Number(b[k]) || K.defaults[k])); return { cpu: v('cpu'), ram: v('ram'), storage: v('storage') }; };

  r.get(P + '/status', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const list = C.enabled(); const hs = await Promise.all(list.map((n) => C.check(n)));
    return { configured: list.length > 0, nodes: list.map((n, i) => C.publicNode(n, hs[i])), quota: K.quota(c.user), used: owned(c.user).length, caps: K.caps(c.user), googlePlay: false };
  });
  r.get(P + '/devices', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const list = owned(c.user).sort((a, b) => a.created - b.created);
    const byNode = new Map(); for (const d of list) { const n = nodeOf(d); if (n) byNode.set(n.id, n); }
    const live = new Map();
    await Promise.all([...byNode.values()].map(async (n) => { try { const j = await C.call(n, 'GET', '/v1/devices?owner=' + encodeURIComponent(c.user.id), undefined, 6000); for (const x of j.devices) live.set(x.id, x); } catch {} }));
    return { devices: list.map((d) => view(d, live.get(d.id))) };
  });
  r.post(P + '/devices', { auth: true, verified: true, limit: [10, 600000, 'user'] }, async (c) => {
    const u = c.user; const b = c.body || {};
    if (owned(u).length >= K.quota(u)) throw new HttpError(403, 'quota', isPro(u) ? 'You have reached your limit' : 'Free accounts can have 1 — PRO plans can have more');
    const cands = [];
    for (const n of C.enabled()) { const h = await C.check(n); if (h.ok && (h.data.kvm || !K.needsKvm) && K.fits(h, b)) cands.push([n, h]); }
    if (!cands.length) throw new HttpError(503, 'no_node', C.enabled().length ? K.noFit : K.none);
    cands.sort((a, x) => (x[1].data.kvm ? 1 : 0) - (a[1].data.kvm ? 1 : 0) || (a[1].data.running / a[1].data.maxRunning) - (x[1].data.running / x[1].data.maxRunning)); // KVM nodes first
    const [node, nh] = cands[0]; const id = crypto.randomBytes(6).toString('hex'); const hw = clampHw(u, b);
    // Windows (3.0): the system is the owner's licensed ISO; it needs 2 cores, 4 GB RAM and a 64 GB disk
    const vimg = b.image ? (nh.data.vmImages || []).find((i) => i.id === String(b.image)) : null;
    if (vimg && vimg.os === 'windows') { const cap = K.caps(u); if (cap.storage < 64 || cap.ram < 4096) throw new HttpError(403, 'win_caps', 'Windows needs 4 GB of memory and a 64 GB disk — available with PRO'); hw.cpu = Math.max(2, hw.cpu); hw.ram = Math.max(4096, hw.ram); hw.storage = Math.max(64, hw.storage); }
    const j = await C.call(node, 'POST', '/v1/devices', { id, owner: u.id, name: String(b.name || '').slice(0, 40), ...K.body(b), ...hw }, 120000);
    const d = { id, owner: u.id, node: node.id, name: j.device.name, ...K.record(j, b), cpu: j.device.cpu, ram: j.device.ram, storage: j.device.storage, created: now() };
    devs()[id] = d; touch(); return { device: view(d, j.device) };
  });
  r.delete(P + '/devices/:id', { auth: true, verified: true, limit: [30, 60000, 'user'] }, async (c) => {
    const [d, n] = mine(c, true); if (n) try { await C.call(n, 'DELETE', '/v1/devices/' + d.id, undefined, 90000); } catch (e) { if (e.status !== 404 && !c.query.force) throw e; }
    delete devs()[d.id]; touch(); return { ok: true };
  });
  r.get(P + '/devices/:id/:sub', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const [d, n] = mine(c); const s = K.subs[c.params.sub]; if (!s) throw new HttpError(404, 'not_found', 'Not found');
    const q = c.params.sub === 'logcat' ? '?lines=' + (Number(c.query.lines) || 300) : c.params.sub === 'apps' && c.query.all ? '?all=1' : '';
    return C.call(n, 'GET', '/v1/devices/' + d.id + '/' + s + q);
  });
  r.post(P + '/devices/:id/:op', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const [d, n] = mine(c); const op = c.params.op;
    if (op === 'ticket') { // the browser talks to the node directly with this
      const base = n.url.replace(/\/+$/, ''); const t = C.ticket(n, d.id, c.user.id, K.scopes);
      return { base, ws: base.replace(/^http/, 'ws') + K.wsPath + '?t=' + encodeURIComponent(t), t };
    }
    const path = K.ops[op]; if (!path) throw new HttpError(404, 'not_found', 'Unknown action');
    let b = c.body || {};
    if (op === 'config') { const cap = K.caps(c.user); b = { ...b }; for (const k of ['cpu', 'ram', 'storage']) if (b[k]) b[k] = Math.max(K.min[k], Math.min(cap[k], Number(b[k]))); }
    const j = await C.call(n, 'POST', '/v1/devices/' + d.id + '/' + path, b, op === 'start' || op === 'restart' ? 60000 : 300000);
    if (j.device) { if (j.device.name) d.name = j.device.name; Object.assign(d, { cpu: j.device.cpu, ram: j.device.ram, storage: j.device.storage }); touch(); return { device: view(d, j.device) }; }
    return j;
  });
}

module.exports = function register(r) {
  mount(r, 'android'); mount(r, 'vm');

  // ---- admin: compute nodes ----
  const adminView = (n, h) => ({ id: n.id, name: n.name, url: n.url, enabled: n.enabled !== false, added: n.added, env: !!n.env, health: h ? { ok: h.ok, error: h.error || null, at: h.at, ...(h.ok ? { version: h.data.version, windows: h.data.windows || null, kvm: h.data.kvm, images: h.data.images, vmImages: h.data.vmImages || [], accel: h.data.accel || (h.data.kvm ? 'kvm' : 'tcg'), running: h.data.running, maxRunning: h.data.maxRunning, devices: h.data.devices, cpus: h.data.cpus, memFree: h.data.memFree, memTotal: h.data.memTotal, load: h.data.load } : {}) } : null,
    devices: Object.values(devs()).filter((d) => d.node === n.id).length });
  r.get('/api/admin/compute', { auth: true, role: 'admin' }, async () => { const list = C.allNodes(); const hs = await Promise.all(list.map((n) => C.check(n, true))); return { nodes: list.map((n, i) => adminView(n, hs[i])) }; });
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
  // 3.0: system images (e.g. the owner's Windows ISO) are added to a node from a download link; owner only
  r.get('/api/admin/compute/:id/images', { auth: true, role: 'owner' }, async (c) => { const n = C.allNodes().find((x) => x.id === c.params.id); if (!n) throw new HttpError(404, 'no_node', 'Not found'); return C.call(n, 'GET', '/v1/vm-images'); });
  r.post('/api/admin/compute/:id/images', { auth: true, role: 'owner', limit: [10, 600000, 'user'] }, async (c) => {
    const n = C.allNodes().find((x) => x.id === c.params.id); if (!n) throw new HttpError(404, 'no_node', 'Not found'); const b = c.body || {};
    const r2 = await C.call(n, 'POST', '/v1/vm-images', { url: String(b.url || '').slice(0, 2000), file: String(b.file || '').slice(0, 80), name: String(b.name || '').slice(0, 60), os: b.os === 'windows' ? 'windows' : 'linux' });
    require('../state').audit('compute_image_add', c.user.id, n.name + ' ' + r2.job.file); return r2;
  });
  r.delete('/api/admin/compute/:id', { auth: true, role: 'owner' }, async (c) => { const list = C.nodes(); const i = list.findIndex((x) => x.id === c.params.id); if (i < 0) throw new HttpError(404, 'no_node', 'Not found'); const [n] = list.splice(i, 1); C.health.delete(n.id); S.store.touch('meta'); require('../state').audit('compute_node_remove', c.user.id, n.name); return { ok: true }; });
};
