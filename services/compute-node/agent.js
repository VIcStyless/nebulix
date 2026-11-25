#!/usr/bin/env node
'use strict';
// Nebulix Compute Node — runs real Android devices (the official Android Emulator with AOSP system images, KVM
// accelerated) on a Linux host that is NOT the Nebulix web server, and streams them to the browser.
//
//   Browser ──(Nebulix API: create/start/stop, tickets)──▶ Nebulix server (Fly.io) ──(HMAC-signed control API)──▶ node
//   Browser ◀──────────────(WebSocket video H.264 + input, with a short-lived ticket)──────────────────────────── node
//
// The Nebulix server never carries video: it only signs tickets. Video comes from scrcpy (Apache-2.0) running inside
// the device: H.264 packets are relayed as-is and decoded in the browser with WebCodecs.
// Requirements: Linux x86_64 with /dev/kvm, Node.js >= 18, the Android SDK pieces (see README.md / setup.sh).
// No npm dependencies. Configuration through environment variables (see README.md).
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { upgrade, reject } = require('../../server/ws');

const env = process.env;
const ROOT = __dirname;
const CFG = {
  secret: env.NX_NODE_SECRET || '',
  port: Number(env.NX_NODE_PORT || 8790), host: env.NX_NODE_HOST || '0.0.0.0',
  sdk: path.resolve(env.NX_SDK || path.join(ROOT, 'sdk')),
  data: path.resolve(env.NX_DATA || path.join(ROOT, 'data')),
  scrcpy: path.resolve(env.NX_SCRCPY || path.join(ROOT, 'scrcpy-server.jar')), scrcpyVersion: env.NX_SCRCPY_VERSION || '3.3.4',
  maxRunning: Number(env.NX_MAX_RUNNING || Math.max(1, Math.floor(os.cpus().length / 2))),
  maxDevices: Number(env.NX_MAX_DEVICES || 50),
  origins: (env.NX_ALLOWED_ORIGINS || 'https://nebulix.fly.dev').split(',').map((s) => s.trim()).filter(Boolean),
  idleMin: Number(env.NX_IDLE_MINUTES || 30),
  gpu: env.NX_GPU || 'swiftshader_indirect',
  vmImages: path.resolve(env.NX_VM_IMAGES || path.join(ROOT, 'vm-images')), qemu: env.NX_QEMU || 'qemu-system-x86_64', qemuImg: env.NX_QEMU_IMG || 'qemu-img',
};
const VERSION = '1.0.0';
if (CFG.secret.length < 32) { console.error('NX_NODE_SECRET must be set (at least 32 characters, shared with the Nebulix admin panel).'); process.exit(1); }
const ADB = path.join(CFG.sdk, 'platform-tools', 'adb'); const EMU = path.join(CFG.sdk, 'emulator', 'emulator');
const AVD_HOME = path.join(CFG.data, 'avd'); fs.mkdirSync(AVD_HOME, { recursive: true }); fs.mkdirSync(path.join(CFG.data, 'tmp'), { recursive: true });
const ENVX = { ...env, ANDROID_SDK_ROOT: CFG.sdk, ANDROID_HOME: CFG.sdk, ANDROID_AVD_HOME: AVD_HOME, ANDROID_EMULATOR_HOME: CFG.data };
const ANDROID_NAMES = { 21: '5.0', 22: '5.1', 23: '6', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16' };
const PROFILES = { phone: { w: 720, h: 1280, dpi: 320, label: 'Phone' }, tablet: { w: 1280, h: 800, dpi: 160, label: 'Tablet' }, small: { w: 480, h: 854, dpi: 240, label: 'Compact phone' } };
const ID = /^[a-z0-9]{6,24}$/;
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- state ----------
const DB = path.join(CFG.data, 'devices.json');
let devices = {}; try { devices = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
let saveT = null; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { fs.writeFileSync(DB + '.tmp', JSON.stringify(devices, null, 1)); fs.renameSync(DB + '.tmp', DB); }, 200); };
const live = new Map(); // id -> { proc, port, serial, state, bootedAt, viewers:Set, stream, lastSeen }
for (const d of Object.values(devices)) { if (d.pid) { try { process.kill(d.pid); } catch {} d.pid = null; } }

function images() {
  const base = path.join(CFG.sdk, 'system-images'); const out = [];
  for (const dir of (fs.existsSync(base) ? fs.readdirSync(base) : [])) {
    const m = /^android-(\d+)/.exec(dir); if (!m) continue;
    for (const tag of ['default']) if (fs.existsSync(path.join(base, dir, tag, 'x86_64', 'system.img'))) out.push({ api: Number(m[1]), android: ANDROID_NAMES[m[1]] || m[1], tag, play: false });
  }
  return out.sort((a, b) => b.api - a.api);
}

// ---------- helpers ----------
function run(cmd, args, { timeout = 20000, max = 1 << 20, input } = {}) {
  return new Promise((res) => {
    const p = execFile(cmd, args, { env: ENVX, timeout, maxBuffer: max, encoding: 'buffer' }, (err, out, errOut) => res({ code: err ? (err.code || 1) : 0, out: out || Buffer.alloc(0), err: (errOut || Buffer.alloc(0)).toString() }));
    if (input) { p.stdin.end(input); }
  });
}
const adb = (serial, args, o) => run(ADB, ['-s', serial, ...args], o);
const adbText = async (serial, args, o) => { const r = await adb(serial, args, o); return { ...r, text: r.out.toString('utf8') }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString('base64url');
const hmac = (s) => crypto.createHmac('sha256', CFG.secret).update(s).digest();
function freePort() { const used = new Set([...live.values()].map((l) => l.port)); for (let p = 5554; p < 5554 + 64; p += 2) if (!used.has(p)) return p; return null; }

// ---------- auth ----------
// Control calls from the Nebulix server: Authorization: NX <ts>.<hex hmac(ts \n METHOD \n path \n sha256(body))>
function checkSig(req, body) {
  const m = /^NX (\d{10,14})\.([0-9a-f]{64})$/.exec(req.headers.authorization || ''); if (!m) return false;
  if (Math.abs(Date.now() - Number(m[1])) > 120000) return false;
  const want = hmac(m[1] + '\n' + req.method + '\n' + req.url + '\n' + crypto.createHash('sha256').update(body || '').digest('hex'));
  const got = Buffer.from(m[2], 'hex'); return got.length === want.length && crypto.timingSafeEqual(got, want);
}
// Tickets for the browser: b64url(json { d: device, o: owner, s: 'view ctl apk file shot rec', e: expiry ms }).b64url(hmac)
function ticket(q, scope) {
  const [p, sig] = String(q || '').split('.'); if (!p || !sig) return null;
  const want = Buffer.from(hmac('ticket:' + p).toString('base64url')); const got = Buffer.from(String(sig)); if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null; // compare the canonical text: base64url's last character has unused bits
  let t; try { t = JSON.parse(Buffer.from(p, 'base64url').toString()); } catch { return null; }
  if (!t || t.e < Date.now() || !devices[t.d] || devices[t.d].owner !== t.o) return null;
  if (scope && !String(t.s || '').split(' ').includes(scope)) return null;
  return t;
}

// ---------- AVD lifecycle ----------
function writeAvd(d) {
  const dir = path.join(AVD_HOME, d.id + '.avd'); fs.mkdirSync(dir, { recursive: true });
  const pr = PROFILES[d.profile] || PROFILES.phone;
  fs.writeFileSync(path.join(AVD_HOME, d.id + '.ini'), `avd.ini.encoding=UTF-8\npath=${dir}\ntarget=android-${d.api}\n`);
  fs.writeFileSync(path.join(dir, 'config.ini'), [
    'AvdId=' + d.id, 'avd.ini.displayname=' + d.id, 'abi.type=x86_64', 'hw.cpu.arch=x86_64', 'hw.cpu.ncore=' + d.cpu, 'hw.ramSize=' + d.ram,
    'disk.dataPartition.size=' + d.storage + 'G', 'hw.lcd.width=' + pr.w, 'hw.lcd.height=' + pr.h, 'hw.lcd.density=' + pr.dpi,
    'hw.keyboard=yes', 'hw.gpu.enabled=yes', 'hw.gpu.mode=' + CFG.gpu, 'hw.gps=yes', 'hw.sensors.orientation=yes', 'hw.accelerometer=yes',
    `image.sysdir.1=system-images/android-${d.api}/default/x86_64/`, 'tag.id=default', 'PlayStore.enabled=false', 'fastboot.forceColdBoot=no', '',
  ].join('\n'));
}
const view = (d) => { const l = live.get(d.id); return { id: d.id, kind: d.kind || 'android', image: d.image || null, iso: d.iso || null, owner: d.owner, name: d.name, api: d.api, android: d.kind === 'vm' ? null : ANDROID_NAMES[d.api] || String(d.api), profile: d.profile, cpu: d.cpu, ram: d.ram, storage: d.storage, created: d.created,
  state: l ? l.state : 'stopped', since: l ? l.since : null, viewers: l ? l.viewers.size : 0, snapshots: d.snapshots || [], recording: !!(l && l.rec) }; };

async function start(d) {
  if (live.has(d.id)) return view(d);
  const running = [...live.values()].filter((l) => l.state !== 'stopped').length; if (running >= CFG.maxRunning) throw Object.assign(new Error('This node is running as many devices as it can. Try again later.'), { status: 503, code: 'node_full' });
  const port = freePort(); if (!port) throw Object.assign(new Error('No free emulator ports'), { status: 503 });
  writeAvd(d);
  const args = ['-avd', d.id, '-no-window', '-no-audio', '-no-boot-anim', '-ports', port + ',' + (port + 1), '-accel', 'on', '-gpu', CFG.gpu, '-no-metrics'];
  const logf = fs.openSync(path.join(CFG.data, d.id + '.log'), 'w');
  const proc = spawn(EMU, args, { env: ENVX, stdio: ['ignore', logf, logf], detached: false });
  const l = { proc, port, serial: 'emulator-' + port, state: 'starting', since: Date.now(), viewers: new Set(), stream: null, lastSeen: Date.now() };
  live.set(d.id, l); d.pid = proc.pid; save();
  proc.on('exit', (code) => { fs.closeSync(logf); if (live.get(d.id) === l) { stopStream(l); live.delete(d.id); d.pid = null; save(); log('device', d.id, 'exited', code); for (const v of l.viewers) v.send({ t: 'state', state: 'stopped' }); } });
  log('device', d.id, 'starting on', l.serial);
  (async () => { // wait for Android to finish booting
    const t0 = Date.now();
    while (live.get(d.id) === l && Date.now() - t0 < 240000) {
      const r = await adbText(l.serial, ['shell', 'getprop', 'sys.boot_completed'], { timeout: 5000 });
      if (r.text.trim() === '1') { l.state = 'running'; l.since = Date.now(); log('device', d.id, 'booted in', Date.now() - t0, 'ms'); await adb(l.serial, ['shell', 'settings', 'put', 'system', 'screen_off_timeout', '1800000']); for (const v of l.viewers) { v.send({ t: 'state', state: 'running' }); startStream(d, l).catch(() => {}); } return; }
      await sleep(2000);
    }
    if (live.get(d.id) === l && l.state === 'starting') { log('device', d.id, 'boot timeout'); stop(d, true); }
  })();
  return view(d);
}
async function stop(d, force) {
  const l = live.get(d.id); if (!l) return view(d);
  l.state = 'stopping'; stopStream(l); for (const v of l.viewers) v.send({ t: 'state', state: 'stopping' });
  if (!force) await adb(l.serial, ['emu', 'kill'], { timeout: 60000 }); // saves the quick-boot snapshot: next start resumes where you left off
  const t0 = Date.now(); while (live.get(d.id) === l && Date.now() - t0 < 30000) await sleep(300);
  if (live.get(d.id) === l) { try { l.proc.kill('SIGKILL'); } catch {} }
  return view(d);
}
async function waitAdb(l, ms = 30000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = await adbText(l.serial, ['shell', 'echo', 'nx-ok'], { timeout: 4000 }); if (r.text.trim() === 'nx-ok') return true; await sleep(500); } return false; }
const ready = (d) => { const l = live.get(d.id); if (!l || l.state !== 'running') throw Object.assign(new Error('The device is not running'), { status: 409, code: 'not_running' }); l.lastSeen = Date.now(); return l; };

// ---------- streaming (scrcpy) ----------
function connectRetry(port, ms) {
  return new Promise((res, rej) => { const t0 = Date.now(); const tryIt = () => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => res(s)); s.once('error', () => { s.destroy(); if (Date.now() - t0 > ms) rej(new Error('connect timeout')); else setTimeout(tryIt, 150); }); }; tryIt(); });
}
// adb accepts the forwarded TCP connection even before scrcpy listens inside the device, then drops it: like the
// official client, wait for scrcpy's first ("dummy") byte and retry until it arrives.
function connectVideo(port, ms) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tryIt = () => {
      const s = net.connect(port, '127.0.0.1'); let got = false;
      s.once('data', (d) => { got = true; s.removeAllListeners('close'); s.pause(); res({ sock: s, first: d }); });
      s.once('close', () => { if (got) return; s.destroy(); if (Date.now() - t0 > ms) rej(new Error('connect timeout')); else setTimeout(tryIt, 200); });
      s.once('error', () => {});
    };
    tryIt();
  });
}
async function startStream(d, l) {
  if (l.stream || l.state !== 'running') return; const st = { scid: crypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff, meta: null, config: null, alive: true };
  l.stream = st;
  try {
    if (!l.jar) { const r = await adb(l.serial, ['push', CFG.scrcpy, '/data/local/tmp/nx-scrcpy.jar'], { timeout: 30000 }); if (r.code) throw new Error('push failed: ' + r.err); l.jar = true; }
    const sock = 'scrcpy_' + st.scid.toString(16).padStart(8, '0');
    const fw = await adbText(l.serial, ['forward', 'tcp:0', 'localabstract:' + sock]); st.port = Number(fw.text.trim()); if (!st.port) throw new Error('forward failed');
    st.proc = spawn(ADB, ['-s', l.serial, 'shell', 'CLASSPATH=/data/local/tmp/nx-scrcpy.jar', 'app_process', '/', 'com.genymobile.scrcpy.Server', CFG.scrcpyVersion,
      'scid=' + st.scid.toString(16).padStart(8, '0'), 'tunnel_forward=true', 'audio=false', 'control=true', 'video_codec=h264', 'max_size=1280', 'video_bit_rate=3000000', 'max_fps=30', 'log_level=warn', 'clipboard_autosync=true', 'cleanup=true'], { env: ENVX, stdio: 'ignore' });
    st.proc.on('exit', () => { if (l.stream === st) stopStream(l); });
    await sleep(400);
    const vc = await connectVideo(st.port, 15000); const video = vc.sock; st.video = video;
    let buf = vc.first; let stage = 0;
    video.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      if (stage === 0) { if (buf.length < 77) return; st.meta = { name: buf.subarray(1, 65).toString().replace(/\0+$/, ''), w: buf.readUInt32BE(69), h: buf.readUInt32BE(73) }; buf = buf.subarray(77); stage = 1; for (const v of l.viewers) v.send({ t: 'meta', ...st.meta }); }
      while (buf.length >= 12) {
        const ptsHi = buf.readUInt32BE(0); const n = buf.readUInt32BE(8); if (buf.length < 12 + n) break;
        const cfg = (ptsHi & 0x80000000) !== 0; const key = (ptsHi & 0x40000000) !== 0;
        const pkt = Buffer.allocUnsafe(1 + n); pkt[0] = (cfg ? 1 : 0) | (key ? 2 : 0); buf.copy(pkt, 1, 12, 12 + n); buf = buf.subarray(12 + n);
        if (cfg) st.config = pkt;
        for (const v of l.viewers) { if (v.waitKey && !cfg && !key) continue; if (key) v.waitKey = false; if (v.socket && v.socket.writableLength > 512 * 1024) { v.waitKey = true; continue; } v.sendBinary(pkt); }
      }
    });
    video.on('close', () => { if (l.stream === st) stopStream(l); }); video.on('error', () => {});
    video.emit('data', Buffer.alloc(0)); video.resume();
    const ctrl = await connectRetry(st.port, 3000); st.ctrl = ctrl; let cb = Buffer.alloc(0);
    ctrl.on('data', (chunk) => { cb = Buffer.concat([cb, chunk]); while (cb.length >= 1) { const type = cb[0]; if (type === 0) { if (cb.length < 5) break; const n = cb.readUInt32BE(1); if (cb.length < 5 + n) break; const text = cb.subarray(5, 5 + n).toString(); cb = cb.subarray(5 + n); for (const v of l.viewers) v.send({ t: 'clip', text }); } else if (type === 1) { if (cb.length < 9) break; cb = cb.subarray(9); } else { cb = Buffer.alloc(0); } } });
    ctrl.on('error', () => {});
  } catch (e) { log('stream', d.id, 'failed', e.message); stopStream(l); for (const v of l.viewers) v.send({ t: 'error', error: 'stream_failed' }); }
}
function stopStream(l) {
  const st = l.stream; if (!st) return; l.stream = null; st.alive = false;
  for (const s of [st.video, st.ctrl]) { try { s && s.destroy(); } catch {} }
  try { st.proc && st.proc.kill(); } catch {}
  if (st.port) adb(l.serial, ['forward', '--remove', 'tcp:' + st.port]).catch(() => {});
}
function control(l, m) { // browser input → scrcpy control messages (binary layout from scrcpy 3.3 ControlMessageReader)
  const st = l.stream; if (!st || !st.ctrl) return; let b;
  const pos = (buf, off) => { buf.writeInt32BE(m.x | 0, off); buf.writeInt32BE(m.y | 0, off + 4); buf.writeUInt16BE(m.w & 0xffff, off + 8); buf.writeUInt16BE(m.h & 0xffff, off + 10); };
  if (m.t === 'touch') { b = Buffer.alloc(32); b[0] = 2; b[1] = [0, 1, 2].includes(m.a) ? m.a : 2; b.writeBigInt64BE(m.id == null ? -2n : BigInt(m.id & 15), 2); /* -2 = scrcpy's generic finger; real fingers 0..15 */ pos(b, 10); b.writeUInt16BE(m.a === 1 ? 0 : 0xffff, 22); b.writeInt32BE(0, 24); b.writeInt32BE(0, 28); }
  else if (m.t === 'scroll') { b = Buffer.alloc(21); b[0] = 3; pos(b, 1); const f = (v) => Math.max(-32768, Math.min(32767, Math.round((Number(v) || 0) / 16 * 32768))); b.writeInt16BE(f(m.hs), 13); b.writeInt16BE(f(m.vs), 15); b.writeInt32BE(0, 17); }
  else if (m.t === 'key') { b = Buffer.alloc(14); b[0] = 0; b[1] = m.a === 1 ? 1 : 0; b.writeInt32BE(m.code | 0, 2); b.writeInt32BE(0, 6); b.writeInt32BE(m.meta | 0, 10); }
  else if (m.t === 'text') { const s = Buffer.from(String(m.text || '').slice(0, 300)); b = Buffer.alloc(5 + s.length); b[0] = 1; b.writeUInt32BE(s.length, 1); s.copy(b, 5); }
  else if (m.t === 'back') { b = Buffer.from([4, m.a === 1 ? 1 : 0]); }
  else if (m.t === 'setclip') { const s = Buffer.from(String(m.text || '').slice(0, 100000)); b = Buffer.alloc(14 + s.length); b[0] = 9; b.writeBigInt64BE(0n, 1); b[9] = m.paste ? 1 : 0; b.writeUInt32BE(s.length, 10); s.copy(b, 14); }
  else if (m.t === 'panel') { b = Buffer.from([m.which === 'settings' ? 6 : m.which === 'collapse' ? 7 : 5]); }
  else if (m.t === 'rotate') { b = Buffer.from([11]); }
  else if (m.t === 'keyframe') { b = Buffer.from([17]); }
  if (b) st.ctrl.write(b);
}


// ---------- Cloud PC: Linux virtual machines (QEMU/KVM, screen over VNC) ----------
// Images live in NX_VM_IMAGES: *.qcow2 are ready-made disks (each VM gets a copy-on-write disk on top of it) and
// *.iso are installers / live systems (the VM gets an empty disk and boots the ISO until something is installed).
// Optional labels in NX_VM_IMAGES/images.json: { "debian-12.qcow2": { "name": "Debian 12", "os": "linux" } }.
const VM_DIR = path.join(CFG.data, 'vm'); fs.mkdirSync(VM_DIR, { recursive: true });
function vmImages() {
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(CFG.vmImages, 'images.json'), 'utf8')); } catch {}
  const pretty = (f) => f.replace(/\.(qcow2|iso)$/i, '').replace(/[-_]+/g, ' ').replace(/\b(\w)/g, (m) => m.toUpperCase());
  return (fs.existsSync(CFG.vmImages) ? fs.readdirSync(CFG.vmImages) : []).filter((f) => /\.(qcow2|iso)$/i.test(f)).sort()
    .map((f) => ({ id: f, name: (meta[f] && meta[f].name) || pretty(f), kind: /\.iso$/i.test(f) ? 'iso' : 'disk', size: fs.statSync(path.join(CFG.vmImages, f)).size }));
}
class Qmp { // tiny QMP client over the VM's unix socket
  constructor(sock) { this.sock = sock; this.seq = 0; this.wait = new Map(); this.events = []; }
  open(ms = 8000) {
    return new Promise((res, rej) => {
      const t0 = Date.now(); const tryIt = () => {
        const c = net.connect(this.sock); let buf = ''; let greeted = false;
        c.on('error', () => { c.destroy(); if (Date.now() - t0 > ms) rej(new Error('QMP not available')); else setTimeout(tryIt, 200); });
        c.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.QMP && !greeted) { greeted = true; this.c = c; this.cmd('qmp_capabilities').then(() => res(this), rej); continue; }
          if (m.id !== undefined && this.wait.has(m.id)) { const w = this.wait.get(m.id); this.wait.delete(m.id); m.error ? w.rej(new Error(m.error.desc)) : w.res(m.return); }
          else if (m.event) this.events.push(m); } });
        c.on('close', () => { for (const w of this.wait.values()) w.rej(new Error('QMP closed')); this.wait.clear(); });
      }; tryIt();
    });
  }
  cmd(execute, args, ms = 60000) { return new Promise((res, rej) => { const id = ++this.seq; this.wait.set(id, { res, rej }); this.c.write(JSON.stringify({ execute, arguments: args, id }) + '\n'); setTimeout(() => { if (this.wait.delete(id)) rej(new Error('QMP timeout: ' + execute)); }, ms); }); }
  hmp(line, ms) { return this.cmd('human-monitor-command', { 'command-line': line }, ms); }
  close() { try { this.c && this.c.destroy(); } catch {} }
}
// A qcow2 disk, optionally on top of a base image. Uses qemu-img when installed, otherwise QEMU itself (QMP blockdev-create).
async function createDisk(file, sizeG, backing) {
  const hasImg = await run(CFG.qemuImg, ['--version'], { timeout: 5000 }).then((r) => r.code === 0).catch(() => false);
  if (hasImg) { const r = await run(CFG.qemuImg, ['create', '-f', 'qcow2', ...(backing ? ['-b', backing, '-F', 'qcow2'] : []), file, sizeG + 'G'], { timeout: 60000 }); if (r.code) throw new Error('qemu-img: ' + r.err); return; }
  fs.writeFileSync(file, ''); const sock = file + '.qmp'; fs.rmSync(sock, { force: true });
  const q = spawn(CFG.qemu, ['-nodefaults', '-machine', 'none', '-display', 'none', '-qmp', 'unix:' + sock + ',server=on,wait=off'], { stdio: 'ignore' });
  try {
    const m = await new Qmp(sock).open();
    await m.cmd('blockdev-add', { driver: 'file', filename: file, 'node-name': 'f' });
    const o = { driver: 'qcow2', file: 'f', size: sizeG * 1073741824 }; if (backing) Object.assign(o, { 'backing-file': backing, 'backing-fmt': 'qcow2' });
    await m.cmd('blockdev-create', { 'job-id': 'mk', options: o });
    const t0 = Date.now(); while (!m.events.some((e) => e.event === 'JOB_STATUS_CHANGE' && e.data.status === 'concluded') && Date.now() - t0 < 60000) await sleep(100);
    const jobs = await m.cmd('query-jobs'); const j = jobs.find((x) => x.id === 'mk'); if (j && j.error) throw new Error(j.error);
    await m.cmd('job-dismiss', { id: 'mk' }).catch(() => {}); await m.cmd('quit').catch(() => {}); m.close();
  } finally { setTimeout(() => { try { q.kill(); } catch {} fs.rmSync(sock, { force: true }); }, 500); }
}
const vmDir = (d) => path.join(VM_DIR, d.id);
function freeVnc() { const used = new Set([...live.values()].filter((l) => l.vnc != null).map((l) => l.vnc)); for (let n = 10; n < 110; n++) if (!used.has(n)) return n; return null; }
async function vmStart(d) {
  if (live.has(d.id)) return view(d);
  const running = [...live.values()].filter((l) => l.state !== 'stopped').length; if (running >= CFG.maxRunning) throw Object.assign(new Error('This node is running as many machines as it can. Try again later.'), { status: 503, code: 'node_full' });
  const n = freeVnc(); const dir = vmDir(d); const sock = path.join(dir, 'qmp.sock'); fs.rmSync(sock, { force: true });
  const img = d.iso ? path.join(CFG.vmImages, d.iso) : null;
  // without /dev/kvm (e.g. Fly.io Firecracker machines) QEMU emulates the CPU in software (TCG): it works, just slower
  const accel = fs.existsSync('/dev/kvm') ? ['-enable-kvm', '-cpu', 'host'] : ['-accel', 'tcg,thread=multi', '-cpu', 'max'];
  const args = ['-name', 'nx-' + d.id, ...accel, '-machine', 'q35', '-smp', String(d.cpu), '-m', String(d.ram),
    '-drive', 'file=' + path.join(dir, 'disk.qcow2') + ',if=virtio,format=qcow2,cache=writeback',
    ...(img && fs.existsSync(img) ? ['-drive', 'file=' + img + ',media=cdrom,readonly=on', '-boot', 'order=cd'] : []),
    '-netdev', 'user,id=n0', '-device', 'virtio-net-pci,netdev=n0', '-device', 'virtio-balloon', '-vga', 'std', '-usb', '-device', 'usb-tablet',
    '-display', 'none', '-vnc', '127.0.0.1:' + n, '-qmp', 'unix:' + sock + ',server=on,wait=off'];
  const logf = fs.openSync(path.join(dir, 'qemu.log'), 'w');
  const proc = spawn(CFG.qemu, args, { stdio: ['ignore', logf, logf] });
  const l = { proc, vnc: n, state: 'starting', since: Date.now(), viewers: new Set(), lastSeen: Date.now(), vm: true, cpu0: null };
  live.set(d.id, l); d.pid = proc.pid; save();
  proc.on('exit', (code) => { fs.closeSync(logf); if (live.get(d.id) === l) { try { l.qmp && l.qmp.close(); } catch {} live.delete(d.id); d.pid = null; save(); log('vm', d.id, 'exited', code); for (const v of l.viewers) v.close(1000); } });
  try { l.qmp = await new Qmp(sock).open(30000); l.state = 'running'; l.since = Date.now(); log('vm', d.id, 'running on vnc', 5900 + n); }
  catch (e) { try { proc.kill('SIGKILL'); } catch {} let why = ''; try { why = fs.readFileSync(path.join(dir, 'qemu.log'), 'utf8').trim().split('\n').pop(); } catch {} throw Object.assign(new Error('The machine could not start: ' + (why || e.message)), { status: 500, code: 'vm_failed' }); }
  return view(d);
}
async function vmStop(d, force) {
  const l = live.get(d.id); if (!l) return view(d); l.state = 'stopping';
  if (!force && l.qmp) { await l.qmp.cmd('system_powerdown').catch(() => {}); const t0 = Date.now(); while (live.get(d.id) === l && Date.now() - t0 < 60000) await sleep(500); }
  if (live.get(d.id) === l) { await l.qmp.cmd('quit').catch(() => {}); await sleep(800); if (live.get(d.id) === l) try { l.proc.kill('SIGKILL'); } catch {} }
  const t0 = Date.now(); while (live.get(d.id) === l && Date.now() - t0 < 5000) await sleep(100);
  return view(d);
}
function vmStats(l) { // CPU % since the last call and resident memory of the QEMU process
  try {
    const st = fs.readFileSync('/proc/' + l.proc.pid + '/stat', 'utf8').split(') ')[1].split(' '); const ticks = Number(st[11]) + Number(st[12]); const now = Date.now();
    const rss = Number((/VmRSS:\s+(\d+)/.exec(fs.readFileSync('/proc/' + l.proc.pid + '/status', 'utf8')) || [])[1] || 0) * 1024;
    let cpu = null; if (l.cpu0) cpu = Math.max(0, ((ticks - l.cpu0.t) / 100) / ((now - l.cpu0.at) / 1000) * 100); l.cpu0 = { t: ticks, at: now };
    return { cpu: cpu == null ? null : Math.round(cpu), rss, uptime: Math.round((now - l.since) / 1000) };
  } catch { return null; }
}

// ---------- HTTP ----------
const J = (res, code, o, extra = {}) => { const s = JSON.stringify(o); res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s), ...extra }); res.end(s); };
const cors = (req) => { const o = req.headers.origin; return o && CFG.origins.includes(o) ? { 'access-control-allow-origin': o, 'access-control-allow-methods': 'GET,PUT,POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'origin' } : {}; };
const readBody = (req, max) => new Promise((res, rej) => { const parts = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > max) { rej(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); } else parts.push(c); }); req.on('end', () => res(Buffer.concat(parts))); req.on('error', rej); });
const clean = (s, n) => String(s || '').replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, n);
const safeFile = (s) => clean(path.basename(String(s || '')), 120).replace(/^\.+/, '') || 'file';

async function vmApi(req, res, d, op, sub, b) {
  if (!op && req.method === 'GET') return J(res, 200, { device: view(d) });
  if (!op && req.method === 'DELETE') { await vmStop(d, true); delete devices[d.id]; save(); fs.rmSync(vmDir(d), { recursive: true, force: true }); return J(res, 200, { ok: true }); }
  if (op === 'start') return J(res, 200, { device: await vmStart(d) });
  if (op === 'stop') return J(res, 200, { device: await vmStop(d, !!b.force) });
  if (op === 'restart') { const l = live.get(d.id); if (l && l.qmp) { await l.qmp.cmd('system_reset'); return J(res, 200, { device: view(d) }); } return J(res, 200, { device: await vmStart(d) }); }
  if (op === 'config' && req.method === 'POST') { if (live.has(d.id)) return J(res, 409, { error: 'running', message: 'Turn the machine off to change its hardware' }); if (b.name) d.name = clean(b.name, 40) || d.name; if (b.cpu) d.cpu = Math.max(1, Math.min(8, b.cpu | 0)); if (b.ram) d.ram = Math.max(512, Math.min(16384, b.ram | 0)); if (b.eject) d.iso = null; save(); return J(res, 200, { device: view(d) }); }
  const l = live.get(d.id); if (!l || l.state !== 'running' || !l.qmp) return J(res, 409, { error: 'not_running', message: 'The machine is not running' });
  l.lastSeen = Date.now();
  if (op === 'info') return J(res, 200, { stats: vmStats(l), status: await l.qmp.cmd('query-status').catch(() => null) });
  if (op === 'keys') { const combos = { cad: ['ctrl', 'alt', 'delete'], cab: ['ctrl', 'alt', 'backspace'], cf1: ['ctrl', 'alt', 'f1'], cf2: ['ctrl', 'alt', 'f2'], cf7: ['ctrl', 'alt', 'f7'] }; const k = combos[b.combo]; if (!k) return J(res, 400, { error: 'bad_combo' }); await l.qmp.cmd('send-key', { keys: k.map((x) => ({ type: 'qcode', data: x })) }); return J(res, 200, { ok: true }); }
  if (op === 'snapshots') {
    const name = clean(b.name, 32).replace(/\s+/g, '_');
    if (sub === 'save') { const n = name || 'snap_' + Date.now(); const out = await l.qmp.hmp('savevm ' + n, 300000); if (/error/i.test(out)) return J(res, 500, { error: 'snapshot_failed', message: out.trim().slice(0, 200) }); d.snapshots = [...(d.snapshots || []).filter((x) => x.name !== n), { name: n, at: Date.now() }].slice(-10); save(); return J(res, 200, { snapshots: d.snapshots }); }
    if (sub === 'load') { if (!(d.snapshots || []).some((x) => x.name === b.name)) return J(res, 404, { error: 'no_snapshot' }); const out = await l.qmp.hmp('loadvm ' + clean(b.name, 32), 300000); return J(res, /error/i.test(out) ? 500 : 200, { ok: !/error/i.test(out), message: out.trim().slice(0, 200) }); }
    if (sub === 'delete') { await l.qmp.hmp('delvm ' + clean(b.name, 32), 120000).catch(() => {}); d.snapshots = (d.snapshots || []).filter((x) => x.name !== b.name); save(); return J(res, 200, { snapshots: d.snapshots }); }
    return J(res, 200, { snapshots: d.snapshots || [] });
  }
  return J(res, 404, { error: 'not_found' });
}

async function controlApi(req, res, url, body) {
  const p = url.pathname; let m;
  if (p === '/v1/health') return J(res, 200, { ok: true, version: VERSION, kvm: fs.existsSync('/dev/kvm'), accel: fs.existsSync('/dev/kvm') ? 'kvm' : 'tcg', images: images(), vmImages: vmImages(), devices: Object.keys(devices).length, running: [...live.values()].length, maxRunning: CFG.maxRunning, cpus: os.cpus().length, memFree: os.freemem(), memTotal: os.totalmem(), load: os.loadavg()[0] });
  const b = body.length ? JSON.parse(body.toString()) : {};
  if (p === '/v1/devices' && req.method === 'GET') return J(res, 200, { devices: Object.values(devices).filter((d) => !url.searchParams.get('owner') || d.owner === url.searchParams.get('owner')).map(view) });
  if (p === '/v1/devices' && req.method === 'POST') {
    if (!ID.test(b.id || '') || devices[b.id]) return J(res, 400, { error: 'bad_id' }); if (Object.keys(devices).length >= CFG.maxDevices) return J(res, 503, { error: 'node_full', message: 'This node has no room for more devices' });
    if (b.kind === 'vm') {
      const img = vmImages().find((i) => i.id === b.image); if (!img) return J(res, 400, { error: 'no_image', message: 'That system image is not on this node' });
      const d = { id: b.id, kind: 'vm', owner: String(b.owner || ''), name: clean(b.name, 40) || img.name, image: img.id, iso: img.kind === 'iso' ? img.id : null,
        cpu: Math.max(1, Math.min(8, b.cpu | 0 || 2)), ram: Math.max(512, Math.min(16384, b.ram | 0 || 2048)), storage: Math.max(4, Math.min(200, b.storage | 0 || 20)), created: Date.now(), snapshots: [] };
      fs.mkdirSync(vmDir(d), { recursive: true });
      try { await createDisk(path.join(vmDir(d), 'disk.qcow2'), d.storage, img.kind === 'disk' ? path.join(CFG.vmImages, img.id) : null); } catch (e) { fs.rmSync(vmDir(d), { recursive: true, force: true }); return J(res, 500, { error: 'disk_failed', message: e.message }); }
      devices[d.id] = d; save(); return J(res, 200, { device: view(d) });
    }
    const img = images().find((i) => i.api === Number(b.api)); if (!img) return J(res, 400, { error: 'no_image', message: 'That Android version is not installed on this node' });
    const d = { id: b.id, owner: String(b.owner || ''), name: clean(b.name, 40) || 'Android ' + img.android, api: img.api, profile: PROFILES[b.profile] ? b.profile : 'phone',
      cpu: Math.max(1, Math.min(4, b.cpu | 0 || 2)), ram: Math.max(1536, Math.min(6144, b.ram | 0 || 2048)), storage: Math.max(2, Math.min(16, b.storage | 0 || 4)), created: Date.now(), snapshots: [] };
    devices[d.id] = d; writeAvd(d); save(); return J(res, 200, { device: view(d) });
  }
  if (!(m = /^\/v1\/devices\/([a-z0-9]+)(?:\/([a-z-]+))?(?:\/([a-z-]+))?$/.exec(p))) return J(res, 404, { error: 'not_found' });
  const d = devices[m[1]]; if (!d) return J(res, 404, { error: 'no_device' }); const op = m[2] || ''; const sub = m[3] || '';
  if (!op && req.method === 'GET') return J(res, 200, { device: view(d) });
  if (d.kind === 'vm') return vmApi(req, res, d, op, sub, b);
  if (!op && req.method === 'DELETE') { await stop(d, true); delete devices[d.id]; save(); fs.rmSync(path.join(AVD_HOME, d.id + '.avd'), { recursive: true, force: true }); fs.rmSync(path.join(AVD_HOME, d.id + '.ini'), { force: true }); fs.rmSync(path.join(CFG.data, d.id + '.log'), { force: true }); return J(res, 200, { ok: true }); }
  if (op === 'start') return J(res, 200, { device: await start(d) });
  if (op === 'stop') return J(res, 200, { device: await stop(d, !!b.force) });
  if (op === 'restart') { await stop(d, false); return J(res, 200, { device: await start(d) }); }
  if (op === 'config' && req.method === 'POST') { if (live.has(d.id)) return J(res, 409, { error: 'running', message: 'Stop the device to change its hardware' }); if (b.name) d.name = clean(b.name, 40) || d.name; if (b.cpu) d.cpu = Math.max(1, Math.min(4, b.cpu | 0)); if (b.ram) d.ram = Math.max(1536, Math.min(6144, b.ram | 0)); if (b.storage) d.storage = Math.max(d.storage, Math.min(16, b.storage | 0)); writeAvd(d); save(); return J(res, 200, { device: view(d) }); }
  const l = ready(d);
  if (op === 'snapshots') {
    if (sub === 'save') { const name = clean(b.name, 32).replace(/\s+/g, '_') || 'snap_' + Date.now(); const r = await adbText(l.serial, ['emu', 'avd', 'snapshot', 'save', name], { timeout: 120000 }); if (!/OK/.test(r.text)) return J(res, 500, { error: 'snapshot_failed', message: r.text.trim().slice(0, 200) }); d.snapshots = [...(d.snapshots || []).filter((s) => s.name !== name), { name, at: Date.now() }].slice(-10); save(); return J(res, 200, { snapshots: d.snapshots }); }
    if (sub === 'load') { const s = (d.snapshots || []).find((x) => x.name === b.name); if (!s) return J(res, 404, { error: 'no_snapshot' }); stopStream(l); const r = await adbText(l.serial, ['emu', 'avd', 'snapshot', 'load', s.name], { timeout: 120000 }); await waitAdb(l); l.jar = false; if (l.viewers.size) startStream(d, l).catch(() => {}); return J(res, /OK/.test(r.text) ? 200 : 500, { ok: /OK/.test(r.text), message: r.text.trim().slice(0, 200) }); }
    if (sub === 'delete') { await adbText(l.serial, ['emu', 'avd', 'snapshot', 'delete', String(b.name || '')], { timeout: 60000 }); d.snapshots = (d.snapshots || []).filter((x) => x.name !== b.name); save(); return J(res, 200, { snapshots: d.snapshots }); }
    return J(res, 200, { snapshots: d.snapshots || [] });
  }
  if (op === 'apps') {
    if (sub === 'uninstall') { const r = await adbText(l.serial, ['uninstall', String(b.pkg || '').replace(/[^\w.]/g, '')], { timeout: 60000 }); return J(res, 200, { ok: /Success/.test(r.text), message: (r.text + r.err).trim().slice(0, 300) }); }
    if (sub === 'launch') { const r = await adbText(l.serial, ['shell', 'monkey', '-p', String(b.pkg || '').replace(/[^\w.]/g, ''), '-c', 'android.intent.category.LAUNCHER', '1']); return J(res, 200, { ok: !/No activities/.test(r.text) }); }
    if (sub === 'stop') { await adb(l.serial, ['shell', 'am', 'force-stop', String(b.pkg || '').replace(/[^\w.]/g, '')]); return J(res, 200, { ok: true }); }
    const r = await adbText(l.serial, ['shell', 'pm', 'list', 'packages', url.searchParams.get('all') ? '' : '-3'].filter(Boolean)); return J(res, 200, { apps: r.text.split('\n').map((x) => x.replace(/^package:/, '').trim()).filter(Boolean).sort() });
  }
  if (op === 'gps') { const lat = Number(b.lat), lon = Number(b.lon); if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return J(res, 400, { error: 'bad_location' }); const r = await adbText(l.serial, ['emu', 'geo', 'fix', String(lon), String(lat)]); if (!/OK/.test(r.text)) return J(res, 500, { error: 'gps_failed', message: (r.text + r.err).trim().slice(0, 200) }); return J(res, 200, { ok: true }); }
  if (op === 'rotate') { await adb(l.serial, ['emu', 'rotate']); return J(res, 200, { ok: true }); }
  if (op === 'resolution') { if (b.reset) { await adb(l.serial, ['shell', 'wm', 'size', 'reset']); await adb(l.serial, ['shell', 'wm', 'density', 'reset']); } else { const w = b.w | 0, h = b.h | 0; if (w < 320 || h < 320 || w > 2560 || h > 2560) return J(res, 400, { error: 'bad_size' }); await adb(l.serial, ['shell', 'wm', 'size', w + 'x' + h]); if (b.dpi) await adb(l.serial, ['shell', 'wm', 'density', String(Math.max(120, Math.min(640, b.dpi | 0)))]); } stopStream(l); if (l.viewers.size) startStream(d, l).catch(() => {}); return J(res, 200, { ok: true }); }
  if (op === 'shell') { const cmd = String(b.cmd || '').slice(0, 2000); if (!cmd.trim()) return J(res, 400, { error: 'empty' }); const r = await adbText(l.serial, ['shell', cmd], { timeout: 20000, max: 256 * 1024 }); return J(res, 200, { code: r.code, output: (r.text + r.err).slice(-64000) }); }
  if (op === 'logcat') { const n = Math.max(50, Math.min(2000, Number(url.searchParams.get('lines')) || 300)); const r = await adbText(l.serial, ['logcat', '-d', '-t', String(n), '-v', 'time'], { timeout: 15000, max: 2 << 20 }); return J(res, 200, { log: r.text.slice(-400000) }); }
  if (op === 'files') { const r = await adbText(l.serial, ['shell', 'ls', '-l', '/sdcard/Download/']); return J(res, 200, { files: r.text.split('\n').map((x) => x.trim().split(/\s+/)).filter((c) => c.length >= 8 && c[0][0] === '-').map((c) => ({ name: c.slice(7).join(' '), size: Number(c[4]) })) }); }
  if (op === 'info') { const r = await adbText(l.serial, ['shell', 'getprop', 'ro.build.version.release']); const s = await adbText(l.serial, ['shell', 'wm', 'size']); const bat = await adbText(l.serial, ['shell', 'dumpsys', 'meminfo', '-c']); return J(res, 200, { android: r.text.trim(), size: s.text.trim(), mem: (/^ram,(\d+),(\d+),(\d+)/m.exec(bat.text) || []).slice(1).map(Number) }); }
  return J(res, 404, { error: 'not_found' });
}

async function ticketApi(req, res, url) {
  const p = url.pathname; const h = cors(req);
  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
  if (p === '/v1/upload' && req.method === 'PUT') {
    const kind = url.searchParams.get('kind') === 'apk' ? 'apk' : 'file'; const t = ticket(url.searchParams.get('t'), kind); if (!t) return J(res, 403, { error: 'bad_ticket' }, h);
    const d = devices[t.d]; let l; try { l = ready(d); } catch (e) { return J(res, 409, { error: e.code, message: e.message }, h); }
    const tmp = path.join(CFG.data, 'tmp', crypto.randomBytes(8).toString('hex') + (kind === 'apk' ? '.apk' : '')); const max = (kind === 'apk' ? 500 : 200) * 1024 * 1024;
    try {
      await new Promise((ok, bad) => { let n = 0; const out = fs.createWriteStream(tmp); req.on('data', (c) => { n += c.length; if (n > max) { bad(Object.assign(new Error('too_big'), { status: 413 })); req.destroy(); out.destroy(); } }); req.pipe(out); out.on('finish', ok); out.on('error', bad); req.on('error', bad); });
      if (kind === 'apk') {
        const fd = fs.openSync(tmp, 'r'); const head = Buffer.alloc(4); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
        if (head.readUInt32LE(0) !== 0x04034b50) return J(res, 400, { error: 'not_apk', message: 'That file is not an APK (Android package)' }, h);
        const r = await adbText(l.serial, ['install', '-r', '-t', '-g', tmp], { timeout: 300000 });
        const okk = /Success/.test(r.text); const why = (/Failure \[([^\]]+)\]/.exec(r.text + r.err) || [])[1] || (r.text + r.err).trim().slice(-300);
        return J(res, okk ? 200 : 422, okk ? { ok: true } : { error: 'install_failed', message: why }, h);
      }
      const name = safeFile(url.searchParams.get('name')); const r = await adbText(l.serial, ['push', tmp, '/sdcard/Download/' + name], { timeout: 300000 });
      await adb(l.serial, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file:///sdcard/Download/' + name]);
      return J(res, r.code ? 500 : 200, r.code ? { error: 'push_failed', message: r.err.slice(0, 300) } : { ok: true, path: '/sdcard/Download/' + name }, h);
    } catch (e) { return J(res, e.status || 500, { error: e.message }, h); } finally { fs.rm(tmp, { force: true }, () => {}); }
  }
  if (p === '/v1/screenshot' && req.method === 'GET') {
    const t = ticket(url.searchParams.get('t'), 'shot'); if (!t) return J(res, 403, { error: 'bad_ticket' }, h);
    if (devices[t.d].kind === 'vm') { const l = live.get(t.d); if (!l || !l.qmp) return J(res, 409, { error: 'not_running' }, h); const f = path.join(vmDir(devices[t.d]), 'shot.png'); try { await l.qmp.cmd('screendump', { filename: f, format: 'png' }); const png = fs.readFileSync(f); fs.rmSync(f, { force: true }); res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'content-disposition': 'attachment; filename="cloudpc-' + Date.now() + '.png"', ...h }); return res.end(png); } catch (e) { return J(res, 500, { error: 'screenshot_failed', message: e.message }, h); } }
    let l; try { l = ready(devices[t.d]); } catch (e) { return J(res, 409, { error: e.code }, h); }
    const r = await adb(l.serial, ['exec-out', 'screencap', '-p'], { timeout: 15000, max: 32 << 20 }); if (r.code || r.out.length < 8) return J(res, 500, { error: 'screenshot_failed' }, h);
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': r.out.length, 'content-disposition': 'attachment; filename="android-' + Date.now() + '.png"', ...h }); return res.end(r.out);
  }
  if (p === '/v1/pull' && req.method === 'GET') {
    const t = ticket(url.searchParams.get('t'), 'file'); if (!t) return J(res, 403, { error: 'bad_ticket' }, h);
    let l; try { l = ready(devices[t.d]); } catch (e) { return J(res, 409, { error: e.code }, h); }
    const name = safeFile(url.searchParams.get('name')); const f = '/sdcard/Download/' + name;
    const ex = await adbText(l.serial, ['shell', 'test -f "' + f.replace(/["\\$`]/g, '') + '" && echo Y']); if (ex.text.trim() !== 'Y') return J(res, 404, { error: 'no_file' }, h);
    const r = await adb(l.serial, ['exec-out', 'cat', f], { timeout: 120000, max: 200 << 20 }); if (r.code) return J(res, 404, { error: 'no_file' }, h);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': r.out.length, 'content-disposition': 'attachment; filename="' + encodeURIComponent(name) + '"', ...h }); return res.end(r.out);
  }
  if (p === '/v1/record') {
    const t = ticket(url.searchParams.get('t'), 'rec'); if (!t) return J(res, 403, { error: 'bad_ticket' }, h);
    let l; try { l = ready(devices[t.d]); } catch (e) { return J(res, 409, { error: e.code }, h); }
    const op = url.searchParams.get('op');
    if (op === 'start') { if (l.rec) return J(res, 409, { error: 'recording' }, h); l.rec = spawn(ADB, ['-s', l.serial, 'shell', 'screenrecord', '--time-limit', '180', '--bit-rate', '4000000', '/sdcard/nx-rec.mp4'], { env: ENVX, stdio: 'ignore' }); l.rec.on('exit', () => { l.rec = null; l.recDone = true; }); l.recDone = false; return J(res, 200, { ok: true, limit: 180 }, h); }
    if (op === 'stop') { if (l.rec) { await adb(l.serial, ['shell', 'pkill', '-INT', 'screenrecord']); const t0 = Date.now(); while (l.rec && Date.now() - t0 < 8000) await sleep(200); } await sleep(600); return J(res, 200, { ok: true }, h); }
    const r = await adb(l.serial, ['exec-out', 'cat', '/sdcard/nx-rec.mp4'], { timeout: 60000, max: 400 << 20 }); if (r.code || r.out.length < 100) return J(res, 404, { error: 'no_recording' }, h);
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': r.out.length, 'content-disposition': 'attachment; filename="android-' + Date.now() + '.mp4"', ...h }); return res.end(r.out);
  }
  return J(res, 404, { error: 'not_found' }, h);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (/^\/v1\/(upload|screenshot|pull|record)$/.test(url.pathname)) return await ticketApi(req, res, url);
    const body = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readBody(req, 64 * 1024);
    if (!checkSig(req, body)) return J(res, 401, { error: 'unauthorized' });
    await controlApi(req, res, url, body);
  } catch (e) { if (!res.headersSent) J(res, e.status || 500, { error: e.code || 'error', message: e.message }); log('error', req.method, url.pathname, e.message); }
});
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/v1/vnc') { // raw RFB bytes between noVNC in the browser and QEMU's VNC server on localhost
    if (req.headers.origin && !CFG.origins.includes(req.headers.origin)) return reject(socket, 403, 'Forbidden');
    const t = ticket(url.searchParams.get('t'), 'ctl'); const l = t && live.get(t.d); if (!t || !l || !l.vm || l.state !== 'running') return reject(socket, t ? 409 : 403, t ? 'Conflict' : 'Forbidden');
    const conn = upgrade(req, socket, { maxPayload: 1 << 20 }); if (!conn) return;
    const tcp = net.connect(5900 + l.vnc, '127.0.0.1'); l.viewers.add(conn); l.lastSeen = Date.now();
    tcp.on('data', (d) => { conn.sendBinary(d); if (conn.socket.writableLength > 512 * 1024) tcp.pause(); });
    conn.socket.on('drain', () => tcp.resume());
    conn.on('binary', (d) => { l.lastSeen = Date.now(); tcp.write(d); }); conn.on('message', (s2) => tcp.write(Buffer.from(s2)));
    const end = () => { l.viewers.delete(conn); try { tcp.destroy(); } catch {} try { conn.close(); } catch {} };
    tcp.on('close', end); tcp.on('error', end); conn.on('close', end);
    return;
  }
  if (url.pathname !== '/v1/stream') return reject(socket, 404, 'Not Found');
  if (req.headers.origin && !CFG.origins.includes(req.headers.origin)) return reject(socket, 403, 'Forbidden');
  const t = ticket(url.searchParams.get('t'), 'view'); if (!t) return reject(socket, 403, 'Forbidden');
  const d = devices[t.d]; const conn = upgrade(req, socket, { maxPayload: 1 << 17 }); if (!conn) return;
  const canCtl = String(t.s).split(' ').includes('ctl'); conn.waitKey = true;
  const attach = () => { const l = live.get(d.id); if (!l) return null; l.viewers.add(conn); l.lastSeen = Date.now(); return l; };
  let l = attach(); conn.send({ t: 'state', state: l ? l.state : 'stopped' });
  if (l && l.stream && l.stream.meta) { conn.send({ t: 'meta', ...l.stream.meta }); if (l.stream.config) conn.sendBinary(l.stream.config); control(l, { t: 'keyframe' }); }
  else if (l && l.state === 'running') startStream(d, l).catch(() => {});
  conn.on('message', (txt) => {
    let m; try { m = JSON.parse(txt); } catch { return; }
    if (m.t === 'attach') { if (!l || !live.get(d.id)) l = attach(); conn.send({ t: 'state', state: l ? l.state : 'stopped' }); if (l && l.stream && l.stream.meta) { conn.waitKey = true; conn.send({ t: 'meta', ...l.stream.meta }); if (l.stream.config) conn.sendBinary(l.stream.config); control(l, { t: 'keyframe' }); } else if (l && l.state === 'running' && !l.stream) startStream(d, l).catch(() => {}); return; }
    const cur = live.get(d.id); if (!cur) return; cur.lastSeen = Date.now();
    if (m.t === 'keyframe') { conn.waitKey = true; return control(cur, m); }
    if (canCtl) control(cur, m);
  });
  conn.on('close', () => { const cur = live.get(d.id); if (cur) { cur.viewers.delete(conn); cur.lastSeen = Date.now(); if (!cur.viewers.size) setTimeout(() => { if (live.get(d.id) === cur && !cur.viewers.size) stopStream(cur); }, 30000); } });
});
// Devices nobody has looked at for NX_IDLE_MINUTES are stopped (their state is kept in the quick-boot snapshot).
setInterval(() => { for (const [id, l] of live) if (!l.viewers.size && l.state === 'running' && Date.now() - l.lastSeen > CFG.idleMin * 60000) { log('device', id, 'idle → stopping'); (l.vm ? vmStop : stop)(devices[id]).catch(() => {}); } }, 60000).unref();
run(ADB, ['start-server']).then(() => server.listen(CFG.port, CFG.host, () => log(`Nebulix compute node ${VERSION} on ${CFG.host}:${CFG.port} · ${images().length} Android image(s) · ${vmImages().length} VM image(s) · max ${CFG.maxRunning} running · KVM ${fs.existsSync('/dev/kvm') ? 'yes' : 'NO'}`)));
let quitting = false;
const bye = async () => { if (quitting) return; quitting = true; log('shutting down'); server.close(); for (const id of [...live.keys()]) await (live.get(id) && live.get(id).vm ? vmStop : stop)(devices[id]).catch(() => {}); process.exit(0); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
