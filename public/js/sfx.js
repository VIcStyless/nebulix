// Tiny WebAudio sound effects (no files). Quiet by design.
import { S } from './state.js';
let ac = null;
const on = () => !(S.me && S.me.settings && S.me.settings.ui && S.me.settings.ui.sounds === false);
// Do not disturb (account menu) silences message pings but keeps game sounds.
export const dnd = () => { try { return localStorage.getItem('nbx.dnd') === '1'; } catch { return false; } };
function ctx() { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } } if (ac.state === 'suspended') ac.resume().catch(() => {}); return ac; }
function tone(freq, dur = .12, type = 'sine', vol = .05, delay = 0, slide = 0) {
  const c = ctx(); if (!c) return; const t0 = c.currentTime + delay; const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + .01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + .02);
}
// Message / notification sound, chosen in Settings → Appearance (stored on this device: nbx.sound.msg, nbx.sound.vol).
const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem('nbx.' + k)); return v == null ? d : v; } catch { return d; } };
export const MSG_SOUNDS = [['classic', 'Classic'], ['soft', 'Soft'], ['pop', 'Pop'], ['bell', 'Bell'], ['arcade', 'Arcade'], ['drop', 'Water drop'], ['none', 'Silent']];
export const msgSound = () => { const v = lsGet('sound.msg', 'classic'); return MSG_SOUNDS.some((x) => x[0] === v) ? v : 'classic'; };
export const msgVol = () => { const v = Number(lsGet('sound.vol', 1)); return Number.isFinite(v) ? Math.max(0, Math.min(1.5, v)) : 1; };
export function playMsg(kind) {
  const v = msgVol();
  if (kind === 'none' || !v) return;
  if (kind === 'soft') { tone(523, .18, 'sine', .035 * v); tone(659, .22, 'sine', .03 * v, .1); }
  else if (kind === 'pop') { tone(420, .07, 'sine', .06 * v, 0, 500); }
  else if (kind === 'bell') { [1568, 2093].forEach((f, i) => tone(f, .5, 'sine', .03 * v, i * .02)); tone(784, .45, 'triangle', .02 * v); }
  else if (kind === 'arcade') { [660, 880, 1320].forEach((f, i) => tone(f, .06, 'square', .03 * v, i * .05)); }
  else if (kind === 'drop') { tone(1400, .12, 'sine', .05 * v, 0, -900); tone(900, .1, 'sine', .025 * v, .09, 300); }
  else { tone(740, .08, 'sine', .04 * v); tone(988, .1, 'sine', .04 * v, .07); }
}
export const sfx = {
  click() { if (on()) tone(520, .05, 'triangle', .03); },
  coin() { if (on()) { tone(988, .09, 'square', .035); tone(1319, .16, 'square', .035, .08); } },
  win() { if (on()) [523, 659, 784, 1047].forEach((f, i) => tone(f, .16, 'triangle', .06, i * .09)); },
  big() { if (on()) [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, .22, 'triangle', .07, i * .08)); },
  lose() { if (on()) tone(220, .3, 'sawtooth', .04, 0, -120); },
  tick() { if (on()) tone(1200, .03, 'square', .02); },
  msg() { if (on() && !dnd()) playMsg(msgSound()); },
  alarm() { const v = msgVol(); [0, .5, 1].forEach((d) => { tone(880, .18, 'square', .05 * v, d); tone(1175, .22, 'square', .05 * v, d + .2); }); }, // timers: plays even with interface sounds off
  spin() { if (on()) tone(300, .6, 'sawtooth', .02, 0, 500); },
};
