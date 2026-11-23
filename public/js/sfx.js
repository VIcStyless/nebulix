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
export const sfx = {
  click() { if (on()) tone(520, .05, 'triangle', .03); },
  coin() { if (on()) { tone(988, .09, 'square', .035); tone(1319, .16, 'square', .035, .08); } },
  win() { if (on()) [523, 659, 784, 1047].forEach((f, i) => tone(f, .16, 'triangle', .06, i * .09)); },
  big() { if (on()) [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, .22, 'triangle', .07, i * .08)); },
  lose() { if (on()) tone(220, .3, 'sawtooth', .04, 0, -120); },
  tick() { if (on()) tone(1200, .03, 'square', .02); },
  msg() { if (on() && !dnd()) { tone(740, .08, 'sine', .04); tone(988, .1, 'sine', .04, .07); } },
  spin() { if (on()) tone(300, .6, 'sawtooth', .02, 0, 500); },
};
