// Pulse library: your music lives in this browser (IndexedDB) — nothing is uploaded to the server.
// Stores: tracks (metadata), blobs (audio files), playlists, analysis (waveforms + beat grids for DJ mode).
import { readTags, coverThumb } from './tags.js';
import { bus } from '../state.js';

const DB = 'nbx-pulse'; const VER = 1;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('analysis')) d.createObjectStore('analysis');
    };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('Close other Nebulix tabs and try again'));
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode); const s = t.objectStore(Array.isArray(store) ? store[0] : store); let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('aborted'));
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2, 18));
const changed = (what) => bus.emit('pulse:library', what);

export const AUDIO_RE = /\.(mp3|m4a|aac|mp4|ogg|oga|opus|wav|flac|webm|weba)$/i;
export function isAudio(f) { return !!f && (/^audio\//.test(f.type) || AUDIO_RE.test(f.name || '')); }

function durationOf(blob) {
  return new Promise((resolve) => {
    const a = document.createElement('audio'); const url = URL.createObjectURL(blob); let done = false;
    const fin = (d) => { if (done) return; done = true; URL.revokeObjectURL(url); a.removeAttribute('src'); resolve(Number.isFinite(d) ? d : 0); };
    a.preload = 'metadata'; a.onloadedmetadata = () => fin(a.duration); a.onerror = () => fin(0); setTimeout(() => fin(0), 8000); a.src = url;
  });
}

export async function addFiles(files, onProgress) {
  const list = [...files].filter(isAudio); const added = [];
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
  for (let i = 0; i < list.length; i++) {
    const f = list[i]; onProgress && onProgress(i, list.length, f.name);
    const tags = await readTags(f); const cover = await coverThumb(tags.cover);
    const duration = await durationOf(f);
    if (!duration) continue; // not playable in this browser
    const tr = { id: uid(), kind: 'file', title: tags.title, artist: tags.artist, album: tags.album, genre: tags.genre, bpm: tags.bpm, cover, duration, size: f.size, type: f.type || '', name: f.name, added: Date.now(), plays: 0, liked: false };
    await tx(['tracks', 'blobs'], 'readwrite', (s) => { s.put(tr); s.transaction.objectStore('blobs').put(f, tr.id); });
    added.push(tr);
  }
  if (added.length) changed('tracks');
  return added;
}
export async function addTrack(tr) { const t = Object.assign({ id: uid(), added: Date.now(), plays: 0, liked: false }, tr); await tx('tracks', 'readwrite', (s) => s.put(t)); changed('tracks'); return t; }
export const allTracks = () => tx('tracks', 'readonly', (s) => req(s.getAll())).then((l) => (l || []).sort((a, b) => b.added - a.added));
export const getTrack = (id) => tx('tracks', 'readonly', (s) => req(s.get(id)));
export const getBlob = (id) => tx('blobs', 'readonly', (s) => req(s.get(id)));
export async function updateTrack(id, patch) {
  const t = await getTrack(id); if (!t) return null; Object.assign(t, patch);
  await tx('tracks', 'readwrite', (s) => s.put(t)); changed('tracks'); return t;
}
export async function removeTrack(id) {
  await tx(['tracks', 'blobs', 'analysis'], 'readwrite', (s) => { s.delete(id); s.transaction.objectStore('blobs').delete(id); s.transaction.objectStore('analysis').delete(id); });
  const pls = await playlists();
  for (const p of pls) if (p.ids.includes(id)) await savePlaylist(Object.assign(p, { ids: p.ids.filter((x) => x !== id) }));
  changed('tracks');
}
export async function bumpPlays(id) { const t = await getTrack(id); if (t) { t.plays = (t.plays || 0) + 1; t.last = Date.now(); await tx('tracks', 'readwrite', (s) => s.put(t)); } }

// ---- playlists ----
export const playlists = () => tx('playlists', 'readonly', (s) => req(s.getAll())).then((l) => (l || []).sort((a, b) => a.created - b.created));
export async function savePlaylist(p) { const pl = Object.assign({ id: uid(), name: 'Playlist', ids: [], created: Date.now(), emoji: '🎧' }, p); await tx('playlists', 'readwrite', (s) => s.put(pl)); changed('playlists'); return pl; }
export async function deletePlaylist(id) { await tx('playlists', 'readwrite', (s) => s.delete(id)); changed('playlists'); }
export async function addToPlaylist(pid, ids) {
  const p = (await playlists()).find((x) => x.id === pid); if (!p) return null;
  for (const id of [].concat(ids)) if (!p.ids.includes(id)) p.ids.push(id);
  return savePlaylist(p);
}

// ---- rendered Nebula Synth audio: cached for songs saved in the library (max 8, oldest evicted) ----
export async function cacheGenBlob(id, blob) {
  const t = await getTrack(id); if (!t || t.kind !== 'gen') return false;
  const list = (await allTracks()).filter((x) => x.kind === 'gen' && x.cachedAt && x.id !== id).sort((a, b) => a.cachedAt - b.cachedAt);
  const drop = list.slice(0, Math.max(0, list.length - 7));
  await tx(['blobs', 'tracks'], 'readwrite', (s) => { const ts = s.transaction.objectStore('tracks'); s.put(blob, id); t.cachedAt = Date.now(); ts.put(t); for (const x of drop) { s.delete(x.id); x.cachedAt = 0; ts.put(x); } });
  return true;
}

// ---- analysis cache (waveform + beatgrid) ----
export const getAnalysis = (id) => tx('analysis', 'readonly', (s) => req(s.get(id))).catch(() => null);
export const putAnalysis = (id, a) => tx('analysis', 'readwrite', (s) => s.put(a, id)).catch(() => null);

export async function usage() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch { return { used: 0, quota: 0 }; }
}
export async function wipe() { await tx(['tracks', 'blobs', 'playlists', 'analysis'], 'readwrite', (s) => { for (const n of ['tracks', 'blobs', 'playlists', 'analysis']) s.transaction.objectStore(n).clear(); }); changed('tracks'); changed('playlists'); }
