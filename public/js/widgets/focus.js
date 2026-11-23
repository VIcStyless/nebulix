// Focus timer: a small Pomodoro-style widget (focus / short break / long break) with a progress ring.
// State lives in localStorage so it keeps running across page changes and reloads.
import { h } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { toast } from '../ui.js';
import { sfx } from '../sfx.js';

const KEY = 'nbx.focus';
const MODES = { focus: 25, short: 5, long: 15 };
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
const fresh = () => ({ mode: 'focus', ends: 0, left: MODES.focus * 60000, running: false, done: 0, today: new Date().toDateString() });

let ticker = null; const subs = new Set();
function state() { let s = load() || fresh(); if (s.today !== new Date().toDateString()) { s.done = 0; s.today = new Date().toDateString(); } return s; }
function tick() {
  const s = state(); if (!s.running) return;
  if (Date.now() >= s.ends) {
    const wasFocus = s.mode === 'focus'; if (wasFocus) s.done++;
    const next = wasFocus ? (s.done % 4 === 0 ? 'long' : 'short') : 'focus';
    Object.assign(s, { mode: next, running: false, left: MODES[next] * 60000, ends: 0 }); save(s);
    try { sfx.big(); } catch {}
    toast(wasFocus ? t('Focus session complete. Take a break.') : t('Break over. Ready for another round?'), 'good', 7000);
    try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Nebulix', { body: wasFocus ? t('Focus session complete. Take a break.') : t('Break over. Ready for another round?') }); } catch {}
  }
  subs.forEach((f) => f());
}
function ensureTicker() { if (!ticker) ticker = setInterval(tick, 500); }
ensureTicker();

export function focusWidget() {
  const R = 46; const C = 2 * Math.PI * R;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 110 110'); svg.classList.add('focus-ring');
  const track = document.createElementNS(ns, 'circle'); const bar = document.createElementNS(ns, 'circle');
  for (const c of [track, bar]) { c.setAttribute('cx', '55'); c.setAttribute('cy', '55'); c.setAttribute('r', String(R)); c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '5'); }
  track.setAttribute('class', 'fr-track'); bar.setAttribute('class', 'fr-bar'); bar.setAttribute('stroke-dasharray', String(C)); bar.setAttribute('stroke-linecap', 'round');
  svg.append(track, bar);
  const time = h('b.focus-time'); const lbl = h('span.focus-lbl');
  const play = h('button.btn.primary.sm', { onClick: toggle }); const reset = h('button.btn.ghost.icon.sm', { 'aria-label': t('Reset'), title: t('Reset'), onClick: doReset }, icon('refresh', 15));
  const seg = h('div.seg', Object.keys(MODES).map((m) => h('button', { type: 'button', dataset: { m }, onClick: () => setMode(m) }, { focus: t('Focus'), short: t('Break'), long: t('Long break') }[m])));
  const dots = h('div.focus-dots');
  const el = h('div.focus', h('div.focus-dial', svg, h('div.focus-mid', time, lbl)), h('div.col', { style: 'gap:10px;flex:1;min-width:0' }, seg, h('div.row', play, reset, h('div.grow'), dots)));

  function left(s) { return s.running ? Math.max(0, s.ends - Date.now()) : s.left; }
  function paint() {
    const s = state(); const ms = left(s); const total = MODES[s.mode] * 60000;
    const m = Math.floor(ms / 60000); const sec = Math.floor((ms % 60000) / 1000);
    time.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    lbl.textContent = { focus: t('Focus'), short: t('Break'), long: t('Long break') }[s.mode];
    bar.setAttribute('stroke-dashoffset', String(C * (ms / total)));
    el.classList.toggle('running', s.running); el.dataset.mode = s.mode;
    play.replaceChildren(icon(s.running ? 'pause' : 'play', 14), s.running ? t('Pause') : ms < total ? t('Resume') : t('Start'));
    [...seg.children].forEach((b) => b.classList.toggle('on', b.dataset.m === s.mode));
    dots.replaceChildren(...[0, 1, 2, 3].map((i) => h('i' + (i < s.done % 4 || (s.done && s.done % 4 === 0) ? '.on' : ''))), h('span.tiny.muted', { style: 'margin-left:6px' }, t('{n} today', { n: s.done })));
  }
  function toggle() {
    const s = state();
    if (s.running) { s.left = Math.max(0, s.ends - Date.now()); s.running = false; } else { s.ends = Date.now() + s.left; s.running = true; try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {} }
    save(s); paint();
  }
  function doReset() { const s = state(); Object.assign(s, { running: false, left: MODES[s.mode] * 60000, ends: 0 }); save(s); paint(); }
  function setMode(m) { const s = state(); Object.assign(s, { mode: m, running: false, left: MODES[m] * 60000, ends: 0 }); save(s); paint(); }
  subs.add(paint); paint();
  el.destroy = () => subs.delete(paint);
  return el;
}
