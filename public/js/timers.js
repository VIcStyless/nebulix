// Nebulix 3.0 phase 22 — stopwatch, countdown timer and break reminder that keep running while you move around
// Nebulix. State lives in localStorage as timestamps (nbx.tm), so a reload resumes them: app.js calls arm() on start
// when a timer is active. Alarms ring with a sound and a toast, plus a system notification when the tab is hidden and
// notifications are allowed. They only fire while a Nebulix tab is open: it is a web page, not a system alarm.
import { ls } from './util.js';
import { t } from './i18n.js';
import { sfx } from './sfx.js';
import { toast } from './ui.js';

const KEY = 'tm';
const blank = () => ({ sw: { start: 0, acc: 0, laps: [] }, cd: { end: 0, left: 0, dur: 300000, label: '' }, br: { every: 0, next: 0 } });
export function state() { const s = ls(KEY); const b = blank(); return s && typeof s === 'object' ? { sw: Object.assign(b.sw, s.sw), cd: Object.assign(b.cd, s.cd), br: Object.assign(b.br, s.br) } : b; }
const save = (s) => { ls(KEY, s); arm(); listeners.forEach((f) => { try { f(s); } catch {} }); };
const listeners = new Set();
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const active = (s = state()) => !!(s.sw.start || s.cd.end || s.br.every);

function ring(title, body) {
  try { sfx.alarm(); } catch {}
  toast(title + (body ? ' — ' + body : ''), 'info', 12000);
  try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body: body || '', tag: 'nbx-timer' }); } catch {}
}

let cdT = 0, brT = 0;
export function arm() {
  clearTimeout(cdT); clearTimeout(brT); const s = state(); const now = Date.now();
  if (s.cd.end) {
    if (s.cd.end <= now) { const late = now - s.cd.end; s.cd.end = 0; s.cd.left = 0; ls(KEY, s); ring(t('Timer finished'), (s.cd.label || '') + (late > 60000 ? ' (' + t('{n} min ago', { n: Math.round(late / 60000) }) + ')' : '')); listeners.forEach((f) => f(s)); }
    else cdT = setTimeout(arm, Math.min(s.cd.end - now, 2 ** 31 - 1));
  }
  if (s.br.every) {
    if (s.br.next <= now) { while (s.br.next <= now) s.br.next += s.br.every; ls(KEY, s); ring(t('Time for a break'), t('Look away from the screen, stretch and drink some water.')); listeners.forEach((f) => f(s)); }
    brT = setTimeout(arm, Math.min(s.br.next - now, 2 ** 31 - 1));
  }
}

// stopwatch
export const swElapsed = (s = state()) => s.sw.acc + (s.sw.start ? Date.now() - s.sw.start : 0);
export function swToggle() { const s = state(); if (s.sw.start) { s.sw.acc += Date.now() - s.sw.start; s.sw.start = 0; } else s.sw.start = Date.now(); save(s); }
export function swLap() { const s = state(); const e = swElapsed(s); if (!e) return; s.sw.laps = [e, ...s.sw.laps].slice(0, 99); save(s); }
export function swReset() { const s = state(); s.sw = blank().sw; save(s); }

// countdown
export const cdLeft = (s = state()) => (s.cd.end ? Math.max(0, s.cd.end - Date.now()) : s.cd.left);
export function cdStart(ms, label) { const s = state(); if (ms != null) { s.cd.dur = ms; s.cd.left = ms; s.cd.label = label || ''; } const left = s.cd.left || s.cd.dur; if (!left) return; s.cd.end = Date.now() + left; s.cd.left = left; save(s); askNotify(); }
export function cdPause() { const s = state(); if (!s.cd.end) return; s.cd.left = Math.max(0, s.cd.end - Date.now()); s.cd.end = 0; save(s); }
export function cdReset() { const s = state(); s.cd.end = 0; s.cd.left = 0; save(s); }

// break reminder
export function brSet(minutes) { const s = state(); s.br = minutes ? { every: minutes * 60000, next: Date.now() + minutes * 60000 } : blank().br; save(s); if (minutes) askNotify(); }

function askNotify() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch {} }
export const fmtMs = (ms, cs = false) => { const tot = Math.max(0, Math.floor(ms / 10)); const c = tot % 100, sec = Math.floor(tot / 100) % 60, m = Math.floor(tot / 6000) % 60, hr = Math.floor(tot / 360000); const p = (n) => String(n).padStart(2, '0'); return (hr ? hr + ':' + p(m) : p(m)) + ':' + p(sec) + (cs ? '.' + p(c) : ''); };
