// Pulse audio engine: one player for the whole app (keeps playing while you browse, chat or use OS mode).
// Sources: your own files (IndexedDB), Nebula Synth generative tracks, internet radio (relayed by Nebulix), Spotify links (official embed).
// Graph: <audio> → preamp → 10-band EQ → 8D panner → limiter → volume → analyser → speakers.
import { bus, S } from '../state.js';
import { ls, clamp } from '../util.js';
import { api, ws } from '../api.js';
import { t } from '../i18n.js';
import { setEnergySource } from '../starfield.js';
import * as lib from './library.js';

export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0], bassplus: [10, 8, 6, 3, 0, -1, -1, 0, 0, 0], vocal: [-2, -2, -1, 0, 2, 4, 4, 3, 1, 0],
  electronic: [5, 4, 1, 0, -2, 1, 1, 2, 4, 5], rock: [5, 3, 2, 1, -1, -1, 1, 3, 4, 5], pop: [-1, 0, 2, 3, 4, 3, 1, 0, -1, -1], lofi: [3, 3, 2, 1, 0, -1, -2, -4, -6, -8],
  treble: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7], night: [6, 5, 3, 0, -1, -1, 0, 2, 4, 5], acoustic: [3, 3, 2, 1, 1, 1, 2, 3, 2, 1],
};
export const EQ_NAMES = { flat: 'Flat', bass: 'Bass boost', bassplus: 'Bass boost+', vocal: 'Vocal', electronic: 'Electronic', rock: 'Rock', pop: 'Pop', lofi: 'Lo-fi warm', treble: 'Treble', night: 'Night (loudness)', acoustic: 'Acoustic', custom: 'Custom' };

const saved = ls('pulse') || {};
const st = {
  queue: Array.isArray(saved.queue) ? saved.queue.slice(0, 500) : [], index: Number.isInteger(saved.index) ? saved.index : -1,
  playing: false, buffering: false, time: saved.pos || 0, duration: 0,
  volume: typeof saved.volume === 'number' ? clamp(saved.volume, 0, 1) : 0.8, muted: !!saved.muted, rate: saved.rate || 1, shuffle: !!saved.shuffle, repeat: ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'all',
  eq: Array.isArray(saved.eq) && saved.eq.length === 10 ? saved.eq : EQ_PRESETS.flat.slice(), eqPreset: saved.eqPreset || 'flat', eqOn: saved.eqOn !== false, preamp: saved.preamp || 0,
  spatial: saved.spatial === '8d' ? '8d' : 'off', loud: !!saved.loud, now: null, spotify: null, sleepAt: 0, sleepEnd: false, error: null,
};
if (st.index >= st.queue.length) st.index = st.queue.length - 1;

const el = new Audio(); el.preload = 'auto'; el.crossOrigin = 'anonymous';
try { el.preservesPitch = true; } catch {}
let ctx = null, srcNode, pre, eqNodes = [], panner, lfo, lfoGain, comp, vol, analyser, freqBuf, waveBuf, curUrl = null, curOwned = false;
const genCache = new Map(); // track id → object URL (rendered Nebula Synth tracks)
let played30 = false, playedFor = 0, lastTick = 0, errors = 0, history = [], radioPoll = null, sleepTimer = null, actTimer = null, loadSeq = 0;

export function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext; ctx = new AC({ latencyHint: 'playback' });
    srcNode = ctx.createMediaElementSource(el);
    pre = ctx.createGain();
    eqNodes = BANDS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1.1; return b; });
    panner = ctx.createStereoPanner(); comp = ctx.createDynamicsCompressor(); vol = ctx.createGain();
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.78;
    freqBuf = new Uint8Array(analyser.frequencyBinCount); waveBuf = new Uint8Array(analyser.fftSize);
    let n = srcNode.connect(pre); for (const b of eqNodes) n = n.connect(b); n.connect(panner).connect(comp).connect(vol).connect(analyser).connect(ctx.destination);
    applyEq(); applyComp(); applySpatial(); applyVolume();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
export const getCtx = () => ctx;
export const masterInput = () => { audioCtx(); return comp; }; // other modules (sampler) can join the master chain
function applyEq() { if (!ctx) return; const on = st.eqOn; eqNodes.forEach((b, i) => b.gain.setTargetAtTime(on ? st.eq[i] : 0, ctx.currentTime, 0.03)); pre.gain.setTargetAtTime(Math.pow(10, (on ? st.preamp : 0) / 20), ctx.currentTime, 0.03); }
function applyComp() {
  if (!ctx) return; const c = comp;
  if (st.loud) { c.threshold.value = -22; c.ratio.value = 3.5; c.knee.value = 8; c.attack.value = 0.01; c.release.value = 0.3; }
  else { c.threshold.value = -1.5; c.ratio.value = 20; c.knee.value = 0; c.attack.value = 0.003; c.release.value = 0.25; }
}
function applyVolume() { const v = st.muted ? 0 : st.volume * (st.loud ? 1.6 : 1); if (ctx) vol.gain.setTargetAtTime(v * v, ctx.currentTime, 0.02); else el.volume = clamp(st.volume, 0, 1); }
function applySpatial() {
  if (!ctx) return;
  if (st.spatial === '8d') { if (!lfo) { lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; lfoGain = ctx.createGain(); lfoGain.gain.value = 0.85; lfo.connect(lfoGain).connect(panner.pan); lfo.start(); } }
  else if (lfo) { try { lfo.stop(); lfo.disconnect(); lfoGain.disconnect(); } catch {} lfo = null; panner.pan.value = 0; }
}

// ---- snapshot & events ----
export const current = () => (st.index >= 0 ? st.queue[st.index] || null : null);
export function snapshot() {
  return { queue: st.queue, index: st.index, track: current(), playing: st.playing, buffering: st.buffering, time: st.time, duration: st.duration, volume: st.volume, muted: st.muted, rate: st.rate, shuffle: st.shuffle, repeat: st.repeat, eq: st.eq, eqPreset: st.eqPreset, eqOn: st.eqOn, preamp: st.preamp, spatial: st.spatial, loud: st.loud, now: st.now, spotify: st.spotify, sleepAt: st.sleepAt, sleepEnd: st.sleepEnd, live: isLive() };
}
const emit = () => { bus.emit('pulse', snapshot()); persist(); };
const slim = (tr) => { const o = {}; for (const k of ['id', 'kind', 'title', 'artist', 'album', 'duration', 'station', 'url', 'embed', 'thumb', 'recipe', 'bpm', 'color', 'genre']) if (tr[k] !== undefined) o[k] = tr[k]; if (tr.kind !== 'file' && tr.kind !== 'gen' && tr.cover) o.cover = tr.cover; return o; };
let persistT = 0;
function persist() { clearTimeout(persistT); persistT = setTimeout(() => ls('pulse', { queue: st.queue.map(slim), index: st.index, pos: isLive() ? 0 : Math.floor(st.time), volume: st.volume, muted: st.muted, rate: st.rate, shuffle: st.shuffle, repeat: st.repeat, eq: st.eq, eqPreset: st.eqPreset, eqOn: st.eqOn, preamp: st.preamp, spatial: st.spatial, loud: st.loud }), 400); }
const isLive = () => { const c = current(); return !!c && (c.kind === 'radio' || c.kind === 'stream'); };
const isEmbed = (tr) => !!tr && (tr.kind === 'spotify' || tr.kind === 'soundcloud' || tr.kind === 'ytmusic');

// ---- sources ----
function srcFor(tr) {
  if (tr.kind === 'radio') return Promise.resolve({ url: '/api/music/radio/' + encodeURIComponent(tr.station) });
  if (tr.kind === 'stream') return Promise.resolve({ url: '/api/music/relay?url=' + encodeURIComponent(tr.url) });
  if (tr.kind === 'file') return lib.getBlob(tr.id).then((b) => { if (!b) throw new Error(t('This file is no longer in your library')); return { url: URL.createObjectURL(b), owned: true }; });
  if (tr.kind === 'gen') {
    if (genCache.has(tr.id)) return Promise.resolve({ url: genCache.get(tr.id) });
    bus.emit('pulse:composing', { id: tr.id, on: true, p: 0 });
    return lib.getBlob(tr.id).catch(() => null).then((cached) => cached || import('./gen.js').then((g) => g.renderBlob(tr.recipe, (p) => bus.emit('pulse:composing', { id: tr.id, on: true, p }))).then(({ blob }) => { lib.cacheGenBlob(tr.id, blob).catch(() => {}); return blob; }))
      .then((blob) => {
        const url = URL.createObjectURL(blob); genCache.set(tr.id, url);
        if (genCache.size > 4) { const [k, v] = genCache.entries().next().value; if (k !== tr.id) { genCache.delete(k); URL.revokeObjectURL(v); } }
        return { url };
      }).finally(() => bus.emit('pulse:composing', { id: tr.id, on: false }));
  }
  return Promise.reject(new Error('unsupported'));
}
export async function blobUrlOf(tr) { const s = await srcFor(tr); return s.url; }

async function load(index, { autoplay = true, at = 0 } = {}) {
  const seq = ++loadSeq;
  st.index = index; const tr = current(); st.error = null; st.now = null; played30 = false; playedFor = 0;
  clearInterval(radioPoll); radioPoll = null;
  if (!tr) { stopEl(); emit(); return; }
  if (isEmbed(tr)) { stopEl(); st.spotify = { embed: tr.embed, title: tr.title, thumb: tr.thumb, kind: tr.kind }; st.playing = false; st.duration = 0; st.time = 0; emit(); mediaSession(); activity(); return; }
  st.spotify = null; try { el.pause(); } catch {} st.playing = false; st.buffering = true; st.duration = tr.duration || 0; st.time = at || 0; emit();
  let s;
  try { s = await srcFor(tr); } catch (e) { if (seq !== loadSeq) return; return failed(e); }
  if (seq !== loadSeq) { if (s.owned) URL.revokeObjectURL(s.url); return; }
  if (curUrl && curOwned) URL.revokeObjectURL(curUrl);
  curUrl = s.url; curOwned = !!s.owned;
  el.src = s.url; el.playbackRate = tr.kind === 'radio' || tr.kind === 'stream' ? 1 : st.rate;
  if (at && !isLive()) { const seekTo = () => { try { el.currentTime = at; } catch {} el.removeEventListener('loadedmetadata', seekTo); }; el.addEventListener('loadedmetadata', seekTo); }
  if (isLive()) { pollNow(); radioPoll = setInterval(pollNow, 15000); }
  mediaSession();
  if (autoplay) await play(); else { st.buffering = false; emit(); }
}
function stopEl() { try { el.pause(); } catch {} el.removeAttribute('src'); try { el.load(); } catch {} if (curUrl && curOwned) URL.revokeObjectURL(curUrl); curUrl = null; curOwned = false; st.playing = false; st.buffering = false; }
function failed(e) {
  st.buffering = false; st.playing = false; st.error = (e && e.message) || t('Could not play this track'); emit();
  bus.emit('pulse:error', st.error);
  if (++errors < 3 && st.queue.length > 1) setTimeout(() => next(true), 1200); else errors = 0;
}
async function pollNow() {
  const tr = current(); if (!tr) return;
  try {
    const q = tr.kind === 'radio' ? 'id=' + encodeURIComponent(tr.station) : 'url=' + encodeURIComponent(tr.url);
    const r = await api.get('/api/music/now?' + q, { quiet: true });
    if (r.title && r.title !== st.now) { st.now = r.title; emit(); mediaSession(); activity(); }
  } catch {}
}

// ---- transport ----
export async function play() {
  const tr = current();
  if (!tr) { if (st.queue.length) return load(0); return; }
  if (isEmbed(tr)) return;
  if (!el.src) return load(st.index, { at: st.time });
  audioCtx();
  try { st.buffering = true; emit(); await el.play(); errors = 0; } catch (e) { if (e && e.name === 'AbortError') return; if (e && e.name === 'NotAllowedError') { st.buffering = false; st.playing = false; emit(); return; } return failed(e); }
}
export function pause() { try { el.pause(); } catch {} }
export function toggle() { if (st.playing || st.buffering) pause(); else play(); }
export function seek(sec) { if (isLive() || !Number.isFinite(sec)) return; try { el.currentTime = clamp(sec, 0, (el.duration || st.duration || 0) - 0.05); } catch {} st.time = el.currentTime; bus.emit('pulse:time', { time: st.time, duration: st.duration }); }
export function seekRel(d) { seek((el.currentTime || 0) + d); }
export function next(auto = false) {
  if (!st.queue.length) return;
  if (auto && st.repeat === 'one' && !current()?.kind?.match(/radio|stream|spotify|soundcloud|ytmusic/)) { seek(0); return play(); }
  history.push(st.index); if (history.length > 100) history.shift();
  let i;
  if (st.shuffle && st.queue.length > 1) { do { i = Math.floor(Math.random() * st.queue.length); } while (i === st.index); }
  else { i = st.index + 1; if (i >= st.queue.length) { if (st.repeat === 'off' && auto) { pause(); seek(0); return; } i = 0; } }
  load(i);
}
export function prev() {
  if (!isLive() && (el.currentTime || 0) > 4) { seek(0); return; }
  const h = history.pop(); load(h !== undefined && h < st.queue.length ? h : Math.max(0, st.index - 1));
}
export function jump(i) { if (i >= 0 && i < st.queue.length) load(i); }
export function setVolume(v) { st.volume = clamp(v, 0, 1); if (st.volume > 0) st.muted = false; applyVolume(); emit(); }
export function setMuted(m) { st.muted = !!m; applyVolume(); emit(); }
export function setRate(r) { st.rate = clamp(r, 0.5, 2); if (!isLive()) el.playbackRate = st.rate; emit(); }
export function setShuffle(b) { st.shuffle = !!b; emit(); }
export function setRepeat(m) { st.repeat = ['off', 'all', 'one'].includes(m) ? m : 'all'; emit(); }
export function cycleRepeat() { setRepeat({ off: 'all', all: 'one', one: 'off' }[st.repeat]); }
export function setEq(gains, preset = 'custom') { st.eq = gains.map((g) => clamp(Math.round(g * 2) / 2, -12, 12)); st.eqPreset = preset; applyEq(); emit(); }
export function setEqPreset(name) { if (EQ_PRESETS[name]) { setEq(EQ_PRESETS[name].slice(), name); st.preamp = name === 'night' ? -4 : name === 'bassplus' ? -3 : 0; applyEq(); emit(); } }
export function setEqOn(b) { st.eqOn = !!b; applyEq(); emit(); }
export function setPreamp(db) { st.preamp = clamp(db, -12, 6); applyEq(); emit(); }
export function setSpatial(m) { st.spatial = m === '8d' ? '8d' : 'off'; applySpatial(); emit(); }
export function setLoud(b) { st.loud = !!b; applyComp(); applyVolume(); emit(); }

// ---- queue ----
export function playList(tracks, start = 0) { st.queue = tracks.map(slim); history = []; load(clamp(start, 0, st.queue.length - 1)); }
export function playOne(tr) { // play now, keep the rest of the queue after it
  const i = st.queue.findIndex((x) => x.id === tr.id && x.kind === tr.kind);
  if (i >= 0) return load(i);
  st.queue.splice(st.index + 1, 0, slim(tr)); load(st.index + 1);
}
export function enqueue(tracks, nextUp = false) {
  const list = [].concat(tracks).map(slim); if (!list.length) return;
  if (nextUp && st.index >= 0) st.queue.splice(st.index + 1, 0, ...list); else st.queue.push(...list);
  if (st.index < 0) st.index = 0; emit();
}
export function removeAt(i) {
  if (i < 0 || i >= st.queue.length) return; const wasCur = i === st.index; st.queue.splice(i, 1);
  if (i < st.index) st.index--; if (wasCur) { if (st.queue.length) load(Math.min(st.index, st.queue.length - 1), { autoplay: st.playing }); else { st.index = -1; stopEl(); } }
  emit();
}
export function move(from, to) {
  if (from === to || from < 0 || to < 0 || from >= st.queue.length || to >= st.queue.length) return;
  const [x] = st.queue.splice(from, 1); st.queue.splice(to, 0, x);
  if (st.index === from) st.index = to; else if (from < st.index && to >= st.index) st.index--; else if (from > st.index && to <= st.index) st.index++;
  emit();
}
export function clearQueue() { const c = current(); st.queue = c && st.playing ? [c] : []; st.index = st.queue.length ? 0 : -1; if (!st.queue.length) stopEl(); emit(); }

// ---- sleep timer ----
export function sleep(min) {
  clearTimeout(sleepTimer); st.sleepAt = 0; st.sleepEnd = false;
  if (min === 'track') st.sleepEnd = true;
  else if (min > 0) { st.sleepAt = Date.now() + min * 60000; sleepTimer = setTimeout(fadeOutAndStop, min * 60000); }
  emit();
}
function fadeOutAndStop() {
  st.sleepAt = 0; st.sleepEnd = false; const v0 = st.volume; let k = 0;
  const iv = setInterval(() => { k++; st.volume = v0 * (1 - k / 20); applyVolume(); if (k >= 20) { clearInterval(iv); pause(); st.volume = v0; applyVolume(); emit(); } }, 400);
}

// ---- analysis for visualizers & reactive wallpapers ----
export const analyserNode = () => (ctx ? analyser : null);
export function freq() { if (!analyser) return null; analyser.getByteFrequencyData(freqBuf); return freqBuf; }
export function wave() { if (!analyser) return null; analyser.getByteTimeDomainData(waveBuf); return waveBuf; }
let eAvg = 0.25;
export function energy() {
  if (!analyser || !st.playing) return null;
  const f = freq(); const hz = ctx.sampleRate / analyser.fftSize; const band = (a, b) => { let s = 0, n = 0; for (let i = Math.max(1, Math.floor(a / hz)); i <= Math.min(f.length - 1, Math.ceil(b / hz)); i++) { s += f[i]; n++; } return n ? s / n / 255 : 0; };
  const bass = band(30, 150), mid = band(150, 2000), high = band(2000, 9000);
  const level = (bass * 0.5 + mid * 0.35 + high * 0.15); eAvg += (level - eAvg) * 0.01;
  const k = 0.55 / Math.max(0.12, eAvg); // auto-gain so quiet and loud tracks both move the wallpaper
  return { bass: clamp(bass * k, 0, 1), mid: clamp(mid * k, 0, 1), high: clamp(high * k * 1.2, 0, 1), level: clamp(level * k, 0, 1) };
}
let reactOn = ls('pulse.react') !== false; // wallpapers & OS backgrounds dance with the music
setEnergySource(() => (reactOn ? energy() : null));
export const reacts = () => reactOn;
export function setReact(b) { reactOn = !!b; ls('pulse.react', reactOn); }

// ---- media session, activity, progress ----
function mediaSession() {
  if (!('mediaSession' in navigator)) return; const tr = current(); if (!tr) return;
  try {
    const title = st.now || tr.title || 'Pulse'; const artist = st.now ? tr.title : (tr.artist || (tr.kind === 'gen' ? 'Nebula Synth' : ''));
    const art = tr.cover || tr.thumb; navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: tr.album || 'Nebulix Pulse', artwork: art ? [{ src: art, sizes: '300x300' }] : [] });
  } catch {}
}
if ('mediaSession' in navigator) {
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
  set('play', () => play()); set('pause', () => pause()); set('nexttrack', () => next()); set('previoustrack', () => prev());
  set('seekto', (d) => seek(d.seekTime)); set('seekbackward', () => seekRel(-10)); set('seekforward', () => seekRel(10));
}
export function labelOf(tr = current()) { if (!tr) return ''; if (st.now) return `${st.now} · ${tr.title}`; return tr.artist ? `${tr.title} — ${tr.artist}` : tr.title; }
function activity() {
  clearTimeout(actTimer);
  actTimer = setTimeout(() => { if (st.playing || st.spotify) { const svc = st.spotify ? { spotify: 'Spotify · ', soundcloud: 'SoundCloud · ', ytmusic: 'YouTube Music · ' }[st.spotify.kind] || '' : ''; ws.send({ t: 'act', kind: 'music', label: (svc + labelOf()).slice(0, 78) }); } else if (S.me) ws.send({ t: 'act' }); }, st.playing || st.spotify ? 1600 : 20000);
}
function tickProgress() {
  const now = performance.now(); if (st.playing && lastTick) playedFor += (now - lastTick) / 1000; lastTick = now;
  if (!played30 && playedFor >= 30) { played30 = true; const tr = current(); if (tr && tr.kind === 'file') lib.bumpPlays(tr.id).catch(() => {}); api.post('/api/progress/event', { type: 'track' }, { quiet: true }).catch(() => {}); }
}

// ---- element events ----
// Only one Nebulix tab plays at a time (e.g. the classic tab and the desktop tab).
const TAB = Math.random().toString(36).slice(2); const foreign = new Set(); let bc = null;
try { bc = new BroadcastChannel('nbx-audio'); bc.onmessage = (e) => { if (e.data && e.data.t === 'claim' && e.data.tab !== TAB) { if (st.playing || st.buffering) pause(); foreign.forEach((f) => { try { f(); } catch {} }); } }; } catch {}
export function claimAudio() { try { bc && bc.postMessage({ t: 'claim', tab: TAB }); } catch {} }
export const onForeignAudio = (fn) => { foreign.add(fn); return () => foreign.delete(fn); };
el.addEventListener('playing', () => { st.playing = true; st.buffering = false; emit(); activity(); claimAudio(); });
el.addEventListener('pause', () => { st.playing = false; st.buffering = false; lastTick = 0; emit(); activity(); });
el.addEventListener('waiting', () => { st.buffering = true; emit(); });
el.addEventListener('canplay', () => { if (st.buffering && el.paused) { st.buffering = false; emit(); } });
el.addEventListener('loadedmetadata', () => { st.duration = Number.isFinite(el.duration) ? el.duration : 0; emit(); });
el.addEventListener('timeupdate', () => { st.time = el.currentTime || 0; tickProgress(); bus.emit('pulse:time', { time: st.time, duration: st.duration }); if (!isLive() && Math.floor(st.time) % 5 === 0) persist(); });
el.addEventListener('ended', () => { if (st.sleepEnd) { st.sleepEnd = false; emit(); return; } next(true); });
el.addEventListener('error', () => { if (!el.getAttribute('src')) return; failed(new Error(isLive() ? t('The station is not answering right now') : t('This format cannot be played in your browser'))); });

// restore the last session (paused) so the mini player shows where you left off
if (st.index >= 0 && current()) { const c = current(); if (isEmbed(c)) st.spotify = { embed: c.embed, title: c.title, thumb: c.thumb, kind: c.kind }; else st.duration = c.duration || 0; }
export const hasSession = () => st.queue.length > 0;
export const el_ = el; // exposed for tests
