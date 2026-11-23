// Voice rooms: every community channel has one. Audio and video flow peer-to-peer between everyone in the room
// (WebRTC mesh, up to 10 people); the server only relays the handshake. The connection survives page changes.
// A bar in the top bar shows who is talking with mute / deafen / camera / screen / soundboard / settings / leave,
// and a floating stage shows cameras and shared screens. Moderators can mute or disconnect people.
import { h, mount, ls } from './util.js';
import { t } from './i18n.js';
import { ws } from './api.js';
import { S, bus } from './state.js';
import { icon } from './icons.js';
import { avatarEl } from './cosmetics.js';
import { toast, openMenu, modal } from './ui.js';
import { sfx } from './sfx.js';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
const st = { ch: null, sv: null, name: '', stream: null, muted: false, deaf: false, smute: false, peers: new Map(), ac: null, speaking: new Set(), joining: false, users: [], cam: null, screen: null, pttDown: false };
export const rooms = new Map(); // chId -> [{ id, muted, deaf, smute, cam, screen }] — public room state for the channel list
export const current = () => st.ch;
export const isSpeaking = (uid) => st.speaking.has(uid);
const emit = () => bus.emit('vc');
const prefs = () => Object.assign({ ptt: false, pttKey: 'v', vol: {} }, ls('vc.prefs') || {});
const savePrefs = (p) => ls('vc.prefs', p);
const micOn = () => !st.muted && !st.deaf && !st.smute && (!prefs().ptt || st.pttDown);
function applyMic() { if (st.stream) st.stream.getAudioTracks().forEach((tr) => { tr.enabled = micOn(); }); }
function sendState() { ws.send({ t: 'vc_mute', muted: st.muted || st.deaf || (prefs().ptt && !st.pttDown), deaf: st.deaf, cam: !!st.cam, screen: !!st.screen }); }

function analyse(uid, stream) {
  try {
    if (!st.ac) st.ac = new (window.AudioContext || window.webkitAudioContext)();
    const src = st.ac.createMediaStreamSource(stream); const an = st.ac.createAnalyser(); an.fftSize = 512; src.connect(an);
    return { an, src, buf: new Uint8Array(an.fftSize), uid };
  } catch { return null; }
}
let meter = null; let raf = 0;
function loop() {
  const all = [meter, ...[...st.peers.values()].map((p) => p.meter)].filter(Boolean); let changed = false;
  for (const m of all) {
    m.an.getByteTimeDomainData(m.buf); let peak = 0; for (const v of m.buf) peak = Math.max(peak, Math.abs(v - 128));
    const muted = m.uid === S.me.id ? !micOn() : (st.users.find((u) => u.id === m.uid) || {}).muted;
    const on = peak > 14 && !muted; m.hold = on ? 8 : Math.max(0, (m.hold || 0) - 1);
    const was = st.speaking.has(m.uid); const now = m.hold > 0;
    if (now !== was) { changed = true; if (now) st.speaking.add(m.uid); else st.speaking.delete(m.uid); }
  }
  if (changed) emit();
  raf = st.ch ? requestAnimationFrame(loop) : 0;
}

// ---------- peers (perfect negotiation, so cameras and screens can be added at any time) ----------
const volOf = (uid) => { const v = prefs().vol[uid]; return v === undefined ? 1 : v; };
function peer(uid) {
  let p = st.peers.get(uid); if (p) return p;
  const pc = new RTCPeerConnection({ iceServers: ICE });
  p = { pc, audio: new Audio(), meter: null, video: null, polite: String(S.me.id) > String(uid), making: false, ignore: false, senders: {} }; p.audio.autoplay = true; st.peers.set(uid, p); applyPeerAudio(uid);
  st.stream.getTracks().forEach((tr) => { p.senders.audio = pc.addTrack(tr, st.stream); });
  for (const k of ['cam', 'screen']) if (st[k]) p.senders[k] = pc.addTrack(st[k].getVideoTracks()[0], st[k]);
  pc.onicecandidate = (e) => { if (e.candidate) ws.send({ t: 'vc_sig', to: uid, d: { kind: 'ice', c: e.candidate.toJSON() } }); };
  pc.onnegotiationneeded = async () => { try { p.making = true; await pc.setLocalDescription(); ws.send({ t: 'vc_sig', to: uid, d: { kind: pc.localDescription.type, sdp: pc.localDescription.toJSON() } }); } catch (e) { console.warn('[vc] nego', e); } finally { p.making = false; } };
  pc.ontrack = (e) => {
    const s = e.streams[0] || new MediaStream([e.track]);
    if (e.track.kind === 'audio') { p.audio.srcObject = s; p.audio.play().catch(() => {}); p.meter = analyse(uid, s); }
    else { p.video = p.video || {}; p.video[s.id] = s; e.track.addEventListener('ended', () => { delete p.video[s.id]; paintStage(); }); s.addEventListener('removetrack', () => { if (!s.getVideoTracks().length) { delete p.video[s.id]; paintStage(); } }); e.track.onmute = () => paintStage(); e.track.onunmute = () => paintStage(); paintStage(); }
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch {} toast(t('Could not connect your voice to {n}. Your networks may block direct connections.', { n: nameOf(uid) }), 'err', 6000); } };
  return p;
}
function applyPeerAudio(uid) { const p = st.peers.get(uid); if (!p) return; const u = st.users.find((x) => x.id === uid); p.audio.muted = st.deaf || !!(u && u.smute); p.audio.volume = Math.max(0, Math.min(1, volOf(uid))); }
function dropPeer(uid) { const p = st.peers.get(uid); if (!p) return; try { p.pc.close(); } catch {} try { if (p.meter && p.meter.src) p.meter.src.disconnect(); } catch {} p.audio.srcObject = null; st.peers.delete(uid); st.speaking.delete(uid); paintStage(); }
const nameOf = (uid) => { const u = (S.userCache && S.userCache[uid]) || null; return u ? u.displayName || u.username : t('Someone'); };

export async function join(chId, name) {
  if (st.ch === chId || st.joining) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection)) return toast(t('Voice needs a browser with microphone access over https or localhost.'), 'err');
  if (st.ch) leave(true);
  st.joining = true;
  try { st.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { st.joining = false; return toast(t('Microphone access was blocked. Allow it in the address bar to join voice.'), 'err'); }
  st.joining = false; st.ch = chId; st.name = name || ''; st.muted = false; st.smute = false;
  meter = analyse(S.me.id, st.stream); applyMic();
  ws.send({ t: 'vc_join', ch: chId }); sendState();
  ws.send({ t: 'act', kind: 'voice', label: t('In voice: #{c}', { c: st.name || '' }) });
  paintBar(); emit();
}
export function leave(silent) {
  if (!st.ch) return;
  ws.send({ t: 'vc_leave' }); ws.send({ t: 'act', kind: null });
  for (const uid of [...st.peers.keys()]) dropPeer(uid);
  stopVideo('cam', true); stopVideo('screen', true);
  if (st.stream) st.stream.getTracks().forEach((tr) => tr.stop());
  st.stream = null; st.ch = null; st.sv = null; st.users = []; meter = null; st.speaking.clear(); st.smute = false;
  if (!silent) sfx.click();
  paintBar(); paintStage(); emit();
}
export function toggleMute() { if (st.smute) return toast(t('A moderator muted you in this voice room.'), 'info'); st.muted = !st.muted; applyMic(); sendState(); paintBar(); emit(); }
export function toggleDeaf() { st.deaf = !st.deaf; for (const uid of st.peers.keys()) applyPeerAudio(uid); applyMic(); sendState(); paintBar(); emit(); }

// ---------- camera and screen share ----------
async function startVideo(kind) {
  if (!st.ch) return;
  try {
    const s = kind === 'cam' ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } }) : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
    st[kind] = s; const tr = s.getVideoTracks()[0]; tr.addEventListener('ended', () => stopVideo(kind));
    if (kind === 'screen') try { tr.contentHint = 'detail'; } catch {}
    for (const p of st.peers.values()) p.senders[kind] = p.pc.addTrack(tr, s);
    sendState(); paintBar(); paintStage(); emit();
  } catch { toast(kind === 'cam' ? t('Camera access was blocked.') : t('Screen sharing was cancelled.'), 'info'); }
}
function stopVideo(kind, quiet) {
  const s = st[kind]; if (!s) return; st[kind] = null; s.getTracks().forEach((tr) => tr.stop());
  for (const p of st.peers.values()) { const snd = p.senders[kind]; if (snd) { try { p.pc.removeTrack(snd); } catch {} delete p.senders[kind]; } }
  if (!quiet) { sendState(); paintBar(); paintStage(); emit(); }
}
export const toggleCam = () => (st.cam ? stopVideo('cam') : startVideo('cam'));
export const toggleScreen = () => (st.screen ? stopVideo('screen') : startVideo('screen'));

// ---------- soundboard (synthesised, so nothing is downloaded) ----------
const SOUNDS = { airhorn: ['📯', 'Air horn'], applause: ['👏', 'Applause'], drum: ['🥁', 'Ba-dum-tss'], tada: ['🎉', 'Ta-da'], wow: ['😮', 'Wow'], sad: ['😢', 'Sad trombone'], bell: ['🔔', 'Bell'], laser: ['🔫', 'Laser'] };
function playSound(k) {
  try {
    const ac = st.ac || (st.ac = new (window.AudioContext || window.webkitAudioContext)()); const t0 = ac.currentTime; const out = ac.createGain(); out.gain.value = st.deaf ? 0 : 0.18; out.connect(ac.destination);
    const tone = (f, at, dur, type = 'square', to) => { const o = ac.createOscillator(); const g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0 + at); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + at + dur); g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(1, t0 + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur); o.connect(g); g.connect(out); o.start(t0 + at); o.stop(t0 + at + dur + 0.05); };
    const noise = (at, dur, hp = 800) => { const b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); const n = ac.createBufferSource(); n.buffer = b; const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; n.connect(f); f.connect(out); n.start(t0 + at); };
    if (k === 'airhorn') { for (let i = 0; i < 3; i++) { tone(466, i * 0.28, 0.24, 'sawtooth'); tone(587, i * 0.28, 0.24, 'sawtooth'); } }
    else if (k === 'applause') { for (let i = 0; i < 40; i++) noise(Math.random() * 1.6, 0.05, 1500); }
    else if (k === 'drum') { tone(120, 0, 0.18, 'sine', 50); tone(180, 0.22, 0.15, 'sine', 70); noise(0.45, 0.6, 5000); }
    else if (k === 'tada') { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.5, 'triangle')); }
    else if (k === 'wow') { tone(300, 0, 0.6, 'sawtooth', 600); }
    else if (k === 'sad') { [392, 370, 349, 330].forEach((f, i) => tone(f, i * 0.35, i === 3 ? 0.9 : 0.32, 'sawtooth', i === 3 ? 300 : null)); }
    else if (k === 'bell') { tone(1318, 0, 1.2, 'sine'); tone(1976, 0, 0.8, 'sine'); }
    else if (k === 'laser') { tone(1800, 0, 0.25, 'square', 200); }
  } catch {}
}
function soundMenu(anchor) { openMenu(Object.entries(SOUNDS).map(([k, [e, n]]) => ({ label: e + '  ' + t(n), onClick: () => ws.send({ t: 'vc_sound', k }) })), anchor); }

// ---------- settings: push-to-talk and per-person volume ----------
function settingsModal() {
  const p = prefs(); const body = h('div.col', { style: 'gap:12px' });
  const paint = () => {
    const others = st.users.filter((u) => u.id !== S.me.id);
    mount(body,
      h('label.row', { style: 'gap:10px;align-items:center' }, h('input', { type: 'checkbox', checked: p.ptt, onChange: (e) => { p.ptt = e.target.checked; savePrefs(p); applyMic(); sendState(); paintBar(); } }), h('span.grow', t('Push to talk')), h('span.small.muted', t('Hold {k} to talk', { k: p.pttKey.toUpperCase() }))),
      h('label.row', { style: 'gap:10px;align-items:center' }, h('span.grow', t('Push-to-talk key')), h('input.input', { value: p.pttKey.toUpperCase(), maxlength: 1, style: 'width:60px;text-align:center', onInput: (e) => { const k = (e.target.value || 'v').toLowerCase().slice(-1); p.pttKey = k; e.target.value = k.toUpperCase(); savePrefs(p); } })),
      h('h4', { style: 'margin:6px 0 0' }, t('Volume')), others.length ? others.map((u) => h('div.row', { style: 'gap:10px;align-items:center' }, avatarEl((S.userCache && S.userCache[u.id]) || { id: u.id, username: '?' }, { size: 26 }), h('span.grow', nameOf(u.id)),
        h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(volOf(u.id) * 100)), onInput: (e) => { p.vol[u.id] = Number(e.target.value) / 100; savePrefs(p); applyPeerAudio(u.id); } }))) : h('p.small.muted', t('Nobody else is here yet.')),
      h('p.tiny.muted', t('Ctrl+Shift+M mutes your microphone from any page.')));
  };
  paint(); modal({ title: t('Voice settings'), cls: 'narrow', body, actions: [{ label: t('Close') }] });
}

// ---------- top-bar pill ----------
let barEl = null;
function paintBar() {
  const top = document.querySelector('.topbar');
  if (!st.ch) { if (barEl) barEl.remove(); barEl = null; return; }
  if (!top) return;
  if (!barEl) { barEl = h('div.vc-bar'); top.insertBefore(barEl, top.querySelector('.grow') ? top.querySelector('.grow').nextSibling : null); }
  const others = st.users.filter((u) => u.id !== S.me.id); const ptt = prefs().ptt;
  const b = (on, ic, title, fn, cls = '') => h('button.btn.ghost.icon.sm' + (on ? '.vc-off' : '') + cls, { title, 'aria-label': title, onClick: fn }, icon(ic, 15));
  mount(barEl,
    h('span.vc-live'), h('button.vc-name', { title: t('Open channel'), onClick: () => window.__nbx.go('chat', st.ch) }, icon('volume', 14), '#' + (st.name || '…')),
    h('span.vc-people', others.slice(0, 4).map((u) => { const a = avatarEl((S.userCache && S.userCache[u.id]) || { id: u.id, username: '?' }, { size: 20, frame: false }); a.classList.toggle('vc-talk', st.speaking.has(u.id)); return a; }), others.length > 4 ? h('span.tiny', '+' + (others.length - 4)) : null),
    ptt ? h('span.pill.vc-ptt' + (st.pttDown ? '.on' : ''), 'PTT ' + prefs().pttKey.toUpperCase()) : null,
    b(st.muted || st.smute, st.muted || st.smute ? 'micoff' : 'mic', st.smute ? t('Muted by a moderator') : st.muted ? t('Unmute') : t('Mute'), toggleMute),
    b(st.deaf, 'volume', st.deaf ? t('Undeafen') : t('Deafen'), toggleDeaf),
    b(false, st.cam ? 'videooff' : 'video', st.cam ? t('Turn off camera') : t('Turn on camera'), toggleCam, st.cam ? '.vc-on' : ''),
    navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia ? b(false, 'monitor', st.screen ? t('Stop sharing') : t('Share your screen'), toggleScreen, st.screen ? '.vc-on' : '') : null,
    h('button.btn.ghost.icon.sm', { title: t('Soundboard'), 'aria-label': t('Soundboard'), onClick: (e) => soundMenu(e.currentTarget) }, icon('sound', 15)),
    h('button.btn.ghost.icon.sm', { title: t('Voice settings'), 'aria-label': t('Voice settings'), onClick: settingsModal }, icon('gear', 15)),
    h('button.btn.sm.danger', { title: t('Leave voice'), onClick: () => leave() }, icon('phoneoff', 14)));
  barEl.classList.toggle('me-talk', st.speaking.has(S.me.id));
}

// ---------- video stage ----------
let stageEl = null; let big = null;
function paintStage() {
  const tiles = [];
  if (st.cam) tiles.push({ key: 'me-cam', uid: S.me.id, s: st.cam, me: true, kind: 'cam' });
  if (st.screen) tiles.push({ key: 'me-screen', uid: S.me.id, s: st.screen, me: true, kind: 'screen' });
  for (const [uid, p] of st.peers) for (const [id, s] of Object.entries(p.video || {})) if (s.getVideoTracks().some((tr) => tr.readyState === 'live' && !tr.muted)) tiles.push({ key: uid + id, uid, s });
  if (!tiles.length || !st.ch) { if (stageEl) stageEl.remove(); stageEl = null; return; }
  if (!stageEl) { stageEl = h('div.vc-stage'); document.body.append(stageEl); }
  if (big && !tiles.some((x) => x.key === big)) big = null;
  mount(stageEl, h('div.vc-shead', icon('video', 14), h('b.grow', '#' + st.name), h('button.btn.ghost.icon.sm', { title: t('Minimise'), onClick: () => stageEl.classList.toggle('min') }, icon('x', 14))),
    h('div.vc-tiles' + (big ? '.focus' : ''), tiles.map((x) => {
      const v = h('video', { autoplay: true, playsinline: true, muted: true }); v.srcObject = x.s; v.play().catch(() => {});
      return h('div.vc-tile' + (big === x.key ? '.big' : '') + (x.me && x.kind === 'cam' ? '.mirror' : '') + (st.speaking.has(x.uid) ? '.talk' : ''), { onClick: () => { big = big === x.key ? null : x.key; paintStage(); }, onDblclick: () => { try { v.requestFullscreen(); } catch {} } }, v, h('span.vc-tname', (x.me ? t('You') : nameOf(x.uid)) + (x.kind === 'screen' ? ' · ' + t('screen') : '')));
    })));
}

// ---------- realtime ----------
export function wire() {
  S.userCache = S.userCache || {};
  bus.on('vc', paintBar);
  bus.on('ws:vc_joined', (m) => {
    if (m.ch !== st.ch) return;
    st.sv = m.sv; st.users = m.users || [];
    sfx.msg();
    raf = raf || requestAnimationFrame(loop);
    for (const uid of m.peers) peer(uid); // the newcomer calls everyone already in the room (negotiation starts by itself)
    emit();
  });
  bus.on('ws:vc_sig', async (m) => {
    if (!st.ch || !st.stream) return; const d = m.d || {};
    try {
      if (d.kind === 'offer' || d.kind === 'answer') {
        const p = peer(m.from); const pc = p.pc;
        const collision = d.kind === 'offer' && (p.making || pc.signalingState !== 'stable');
        p.ignore = !p.polite && collision; if (p.ignore) return;
        await pc.setRemoteDescription(d.sdp);
        if (d.kind === 'offer') { await pc.setLocalDescription(); ws.send({ t: 'vc_sig', to: m.from, d: { kind: 'answer', sdp: pc.localDescription.toJSON() } }); }
      } else if (d.kind === 'ice') { const p = st.peers.get(m.from); if (p && d.c) { try { await p.pc.addIceCandidate(d.c); } catch (e) { if (!p.ignore) throw e; } } }
    } catch (e) { console.warn('[vc]', e); }
  });
  bus.on('ws:vc_peer_left', (m) => { if (m.ch === st.ch) { dropPeer(m.id); emit(); } });
  bus.on('ws:vc_state', (m) => {
    if (m.users.length) rooms.set(m.ch, m.users); else rooms.delete(m.ch);
    if (m.ch === st.ch) { const before = new Set(st.users.map((u) => u.id)); st.users = m.users; if (m.users.some((u) => !before.has(u.id) && u.id !== S.me.id)) sfx.msg(); for (const uid of st.peers.keys()) applyPeerAudio(uid); paintStage(); }
    emit();
  });
  bus.on('ws:vc_smute', (m) => { st.smute = !!m.on; applyMic(); paintBar(); toast(m.on ? t('A moderator muted you in this voice room.') : t('A moderator unmuted you.'), 'info'); });
  bus.on('ws:vc_sound', (m) => { if (st.ch) playSound(m.k); });
  bus.on('ws:vc_err', (m) => {
    const msg = { full: t('This voice room is full (10 people).'), timed_out: t('You are timed out in this server.'), no_access: t('You cannot join this voice room.') }[m.error] || t('Could not join voice.');
    toast(msg, 'err'); leave(true);
  });
  bus.on('ws:vc_kicked', (m) => { toast(m.why === 'disconnected' ? t('A moderator disconnected you from voice.') : m.why === 'removed' || m.why === 'timed_out' ? t('You were removed from the voice room.') : t('You joined voice somewhere else.')); leave(true); });
  bus.on('ws:open', () => { if (st.ch) { const ch = st.ch, name = st.name; leave(true); join(ch, name); } }); // reconnect after a network blip
  window.addEventListener('beforeunload', () => { if (st.ch) ws.send({ t: 'vc_leave' }); });
  const typing = (e) => e.target && (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable);
  document.addEventListener('keydown', (e) => {
    if (st.ch && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); toggleMute(); toast(st.muted ? t('Microphone muted') : t('Microphone on'), 'info', 1500); return; }
    if (st.ch && prefs().ptt && !typing(e) && !e.repeat && e.key.toLowerCase() === prefs().pttKey) { st.pttDown = true; applyMic(); sendState(); paintBar(); }
  });
  document.addEventListener('keyup', (e) => { if (st.ch && prefs().ptt && st.pttDown && e.key.toLowerCase() === prefs().pttKey) { st.pttDown = false; applyMic(); sendState(); paintBar(); } });
  window.addEventListener('blur', () => { if (st.pttDown) { st.pttDown = false; applyMic(); sendState(); paintBar(); } });
}
