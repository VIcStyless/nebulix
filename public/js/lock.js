// Screen lock: a password that hides Nebulix (blurred and frozen) until it is typed again. Locks with Ctrl+Shift+L,
// from the account menu, after some idle minutes, or every time Nebulix opens. Survives reloads and closing the tab.
// The account password also unlocks it (for when the lock password is forgotten).
import { h, mount } from './util.js';
import { t, locale } from './i18n.js';
import { api } from './api.js';
import { S, bus } from './state.js';
import { avatarEl } from './cosmetics.js';
import { toast } from './ui.js';

const KEY = 'nbx.locked';
const flag = (v) => { try { if (v === undefined) return localStorage.getItem(KEY) === '1'; if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch {} return false; };
let el = null; let idleT = 0; let clockT = 0; let wired = false; let last = Date.now();

export const lockOn = () => !!(S.me && S.me.lock && S.me.lock.on);
export const isLocked = () => !!el;

export function lockNow() {
  if (!lockOn()) { toast(t('Set a lock password first in Settings → Security.'), 'info'); location.hash = '#/settings/security'; return; }
  if (el) return; flag(true);
  const app = document.getElementById('app'); if (app) app.inert = true; document.documentElement.classList.add('nbx-locked');
  try { document.querySelectorAll('video, audio').forEach((m) => { if (!m.paused) { m.dataset.lockPaused = '1'; m.pause(); } }); } catch {}
  let useAccount = false;
  const time = h('div.lk-time'); const date = h('div.lk-date');
  const paintClock = () => { const d = new Date(); time.textContent = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }); date.textContent = d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }); };
  paintClock(); clockT = setInterval(paintClock, 1000);
  const inp = h('input', { type: 'password', autocomplete: 'off', placeholder: t('Lock password'), 'aria-label': t('Lock password') });
  const err = h('div.lk-err'); const hint = h('button.lk-hint', { type: 'button', style: 'background:none;border:0;color:inherit;cursor:pointer;text-decoration:underline' });
  const paintHint = () => { hint.textContent = useAccount ? t('Use the lock password instead') : t('Forgot it? Use your account password'); inp.placeholder = useAccount ? t('Account password') : t('Lock password'); };
  hint.onclick = () => { useAccount = !useAccount; paintHint(); inp.focus(); }; paintHint();
  const form = h('form', { onSubmit: async (e) => {
    e.preventDefault(); if (!inp.value) return; const btn = form.querySelector('button'); btn.disabled = true;
    try { await api.post('/api/lock/verify', { password: inp.value, account: useAccount }, { quiet: true }); unlock(); }
    catch (er) { err.textContent = er.code === 'rate_limited' || er.status === 429 ? t('Too many tries. Wait a minute.') : t('Wrong password'); form.classList.remove('lk-shake'); void form.offsetWidth; form.classList.add('lk-shake'); inp.select(); }
    btn.disabled = false;
  } }, inp, h('button', { type: 'submit' }, '→'));
  el = h('div.nbx-lock', { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Nebulix is locked') },
    h('div.lk-orb', { style: 'width:340px;height:340px;background:#7c3aed;left:10%;top:15%' }), h('div.lk-orb', { style: 'width:280px;height:280px;background:#06b6d4;right:12%;bottom:10%;animation-delay:-6s' }),
    time, date, h('div.lk-av', S.me ? avatarEl(S.me, { size: 84, frame: false }) : '🔒'), h('b', S.me ? (S.me.displayName || S.me.username) : ''), form, err, hint);
  document.body.append(el); setTimeout(() => inp.focus(), 50);
  bus.emit('lock', true);
}

function unlock() {
  if (!el) return; flag(false); clearInterval(clockT);
  const node = el; el = null; node.classList.add('out'); setTimeout(() => node.remove(), 450);
  const app = document.getElementById('app'); if (app) app.inert = false; document.documentElement.classList.remove('nbx-locked');
  try { document.querySelectorAll('[data-lock-paused="1"]').forEach((m) => { delete m.dataset.lockPaused; m.play().catch(() => {}); }); } catch {}
  last = Date.now(); bus.emit('lock', false);
}

// called after every login / start
export function initLock() {
  if (!wired) {
    wired = true;
    const poke = () => { last = Date.now(); };
    ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach((ev) => addEventListener(ev, poke, { passive: true, capture: true }));
    addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) { e.preventDefault(); if (S.me) lockNow(); } }, true);
    clearInterval(idleT); idleT = setInterval(() => { if (!S.me || el || !lockOn()) return; const m = S.me.lock.idle || 0; if (m && Date.now() - last > m * 60000) lockNow(); }, 5000);
  }
  if (!lockOn()) { if (el) unlock(); flag(false); return; }
  if (flag() || S.me.lock.start) lockNow();
}

// ---- Settings → Security card ----
export function lockSettings() {
  const box = h('div');
  const IDLE = [[0, t('Never')], [1, t('1 minute')], [2, t('2 minutes')], [5, t('5 minutes')], [10, t('10 minutes')], [15, t('15 minutes')], [30, t('30 minutes')], [60, t('1 hour')]];
  function paint() {
    const L = S.me.lock; const pw = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: t('New lock password (4+ characters)') }); const cur = h('input.input', { type: 'password', autocomplete: 'off', placeholder: t('Current lock password') });
    const save = h('button.btn.primary', { type: 'button', onClick: async () => { try { const r = await api.post('/api/lock/set', { password: pw.value, current: cur.value }); S.me.lock = r.lock; toast(L ? t('Lock password changed') : t('Screen lock is on. Lock now with Ctrl+Shift+L.'), 'good'); paint(); } catch (e) { toast(e.message, 'err'); } } }, L ? t('Change lock password') : t('Turn on screen lock'));
    const opt = (body) => api.post('/api/lock/options', body).then((r) => { S.me.lock = r.lock; paint(); }).catch((e) => toast(e.message, 'err'));
    mount(box,
      h('p.small.muted', t('Hide Nebulix behind a password when you step away. Lock it with Ctrl+Shift+L or from your account menu; it stays locked after reloading. Your account password also unlocks it.')),
      L ? h('div', { style: 'display:grid;gap:10px;margin:10px 0' },
        h('label.row', { style: 'gap:8px;align-items:center' }, h('span.grow', t('Lock automatically after')), h('select.input', { style: 'width:auto', onChange: (e) => opt({ idle: Number(e.target.value) }) }, IDLE.map(([v, l]) => h('option', { value: v, selected: (L.idle || 0) === v }, l)))),
        h('label.row', { style: 'gap:8px;align-items:center' }, h('input', { type: 'checkbox', checked: L.start, onChange: (e) => opt({ start: e.target.checked }) }), h('span', t('Ask for it every time Nebulix opens'))),
        h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, h('button.btn', { type: 'button', onClick: lockNow }, '🔒 ' + t('Lock now')),
          h('button.btn.danger', { type: 'button', onClick: async () => { const p = prompt(t('Type your lock or account password to turn the screen lock off')); if (!p) return; try { await api.post('/api/lock/remove', { password: p }); S.me.lock = null; toast(t('Screen lock turned off'), 'good'); paint(); } catch (e) { toast(e.message, 'err'); } } }, t('Turn off')))) : null,
      h('div', { style: 'display:grid;gap:8px;max-width:420px' }, L ? cur : null, pw, h('div', save)));
  }
  paint(); return box;
}
