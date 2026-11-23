// Decode a library track to an AudioBuffer and analyse it (waveform + BPM + beat offset) in a worker. Results are cached.
import * as lib from './library.js';
import { audioCtx } from './engine.js';

let worker = null, seq = 0; const waiting = new Map();
function w() {
  if (worker) return worker;
  worker = new Worker('/js/pulse/analyze-worker.js');
  worker.onmessage = (e) => { const p = waiting.get(e.data.id); if (p) { waiting.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data); } };
  worker.onerror = (e) => { for (const p of waiting.values()) p.rej(new Error(e.message || 'analysis failed')); waiting.clear(); worker = null; };
  return worker;
}

export async function decode(track, onProgress) {
  const ctx = audioCtx();
  let blob = await lib.getBlob(track.id).catch(() => null);
  if (track.kind === 'gen' && !blob) {
    const g = await import('./gen.js'); const out = await g.render(track.recipe, onProgress);
    lib.cacheGenBlob(track.id, g.toWav(out.buffer)).catch(() => {});
    return { buffer: out.buffer, bpm: out.bpm, offset: out.offset };
  }
  if (track.kind !== 'file' && track.kind !== 'gen') throw new Error('Only songs from your library or Nebula Synth can be loaded on a deck');
  if (!blob) throw new Error('This file is no longer in your library');
  const buf = await blob.arrayBuffer();
  if (track.kind === 'gen') { const buffer = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); }); return { buffer, bpm: track.recipe.bpm, offset: 0.05 }; }
  const buffer = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
  return { buffer };
}

export async function analyze(track, buffer, known = {}) {
  const cached = await lib.getAnalysis(track.id);
  if (cached && cached.v === 2 && Math.abs((cached.dur || 0) - buffer.duration) < 0.5) return cached;
  const n = buffer.length; const mono = new Float32Array(n); const chs = buffer.numberOfChannels;
  for (let c = 0; c < chs; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / chs; }
  const id = ++seq;
  const res = await new Promise((resolve, rej) => { waiting.set(id, { res: resolve, rej }); w().postMessage({ id, data: mono, sr: buffer.sampleRate, knownBpm: known.bpm || 0, knownOffset: known.offset || 0 }, [mono.buffer]); });
  const out = { v: 2, dur: buffer.duration, fr: res.fr, low: res.low, mid: res.mid, high: res.high, peak: res.peak, bpm: res.bpm, offset: res.offset, confidence: res.confidence };
  lib.putAnalysis(track.id, out);
  if (track.kind === 'file' && res.bpm && !track.bpmSet) lib.updateTrack(track.id, { bpm: res.bpm }).catch(() => {});
  return out;
}
