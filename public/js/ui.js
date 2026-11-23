// Shared UI building blocks: toasts, modals, menus, tabs, switches, emoji picker, confetti.
import { h, $, clear, rand, pick } from './util.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { copyText } from './util.js';

export const errMsg = (e) => (e && e.message) || t('Something went wrong');

export function toast(msg, kind = 'info', ms = 4200) {
  const host = $('#layer-toasts'); if (!host) return;
  if (typeof msg === 'string') msg = msg.replace(/^(?:\p{Extended_Pictographic}|️|‍)+\s*/u, ''); // strip legacy emoji prefixes
  const ic = { err: 'alert', good: 'check', coin: 'coins' }[kind] || 'info';
  const el = h('div.toast' + (kind && kind !== 'info' ? '.' + kind : ''), { role: 'status' }, h('span.ti', icon(ic, 16)), h('div.grow', msg));
  host.appendChild(el); while (host.children.length > 4) host.firstChild.remove();
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  el.addEventListener('click', close); setTimeout(close, ms);
}
export const toastErr = (e) => toast(errMsg(e), 'err', 5200);

const stack = [];
export function openModal(content, { cls = '', dismissable = true, onClose } = {}) {
  const host = $('#layer-modals'); const prev = document.activeElement;
  const box = h('div.modal' + (cls ? '.' + cls.split(' ').join('.') : ''), { role: 'dialog', 'aria-modal': 'true' }, content);
  const ov = h('div.overlay', box);
  const api = {
    el: box, close(v) { const i = stack.indexOf(api); if (i < 0) return; stack.splice(i, 1); ov.remove(); host.style.pointerEvents = stack.length ? 'auto' : 'none'; if (prev && prev.focus) { try { prev.focus(); } catch {} } if (onClose) onClose(v); },
  };
  if (dismissable) ov.addEventListener('mousedown', (e) => { if (e.target === ov) api.close(); });
  stack.push(api); host.appendChild(ov); host.style.pointerEvents = 'auto';
  const f = box.querySelector('input:not([type=hidden]), textarea, select, .btn.primary'); if (f) setTimeout(() => f.focus({ preventScroll: !f.matches('input, textarea, select') }), 30);
  return api;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (menuEl) return closeMenu(); const m = stack[stack.length - 1]; if (m) m.close(); } });

export function modal({ title, body, actions = [], cls = '', dismissable = true }) {
  let m;
  const p = new Promise((resolve) => {
    const bar = h('div.actions', actions.map((a) => h('button.btn' + (a.kind ? '.' + a.kind : ''), { type: 'button', onClick: async (ev) => { const r = a.onClick ? await a.onClick(ev, m) : undefined; if (r !== false) m.close(a.value === undefined ? true : a.value); } }, a.label)));
    m = openModal([title ? h('h2', title) : null, body, actions.length ? bar : null], { cls, dismissable, onClose: (v) => resolve(v === undefined ? null : v) });
  });
  p.close = (v) => { if (m) m.close(v); };
  return p;
}
export const confirmBox = (msg, { danger = false, ok = t('Confirm'), cancel = t('Cancel'), title } = {}) =>
  modal({ title: title || null, cls: 'narrow', body: h('p', msg), actions: [{ label: cancel, value: false }, { label: ok, kind: danger ? 'danger' : 'primary', value: true }] }).then((v) => v === true);
export function promptBox(title, { label, value = '', placeholder = '', type = 'text', hint, ok = t('OK'), validate, multiline = false } = {}) {
  return new Promise((resolve) => {
    const inp = multiline ? h('textarea.input', { value, placeholder, rows: 4 }) : h('input.input', { type, value, placeholder, autocomplete: 'off' });
    const err = h('div.error.small');
    let m;
    const submit = () => { const v = inp.value; const bad = validate && validate(v); if (bad) { err.textContent = bad; return; } m.close(v); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) submit(); });
    m = openModal([h('h2', title), h('div.field', label ? h('label', label) : null, inp, hint ? h('div.hint', hint) : null, err),
      h('div.actions', h('button.btn', { onClick: () => m.close(null) }, t('Cancel')), h('button.btn.primary', { onClick: submit }, ok))], { cls: 'narrow', onClose: (v) => resolve(v === undefined ? null : v) });
  });
}

// ---- context menu ----
let menuEl = null;
export function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; $('#layer-menus').style.pointerEvents = 'none'; } }
export function openMenu(items, anchor) {
  closeMenu(); const host = $('#layer-menus');
  const el = h('div.menu', items.filter(Boolean).map((i) => (i.hr ? h('hr') : h('button' + (i.danger ? '.danger' : ''), { type: 'button', disabled: i.disabled, onClick: () => { closeMenu(); i.onClick && i.onClick(); } }, i.icon ? icon(i.icon, 17) : null, h('span', i.label)))));
  host.appendChild(el); host.style.pointerEvents = 'auto'; menuEl = el;
  let x, y;
  if (anchor instanceof Element) { const r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 6; } else { x = anchor.clientX; y = anchor.clientY; }
  const w = el.offsetWidth, hh = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px'; el.style.top = Math.max(8, Math.min(y, innerHeight - hh - 8)) + 'px';
  setTimeout(() => { const off = (e) => { if (!el.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', off, true); } }; document.addEventListener('mousedown', off, true); }, 0);
  return el;
}

// ---- small controls ----
export function switchEl(checked, onChange, label) {
  const i = h('input', { type: 'checkbox', checked: !!checked, 'aria-label': label || null }); i.addEventListener('change', () => onChange && onChange(i.checked));
  const el = h('label.switch', i, h('i')); el.input = i; return el;
}
export function segEl(options, value, onChange) {
  const el = h('div.seg', options.map(([v, label]) => h('button', { type: 'button', class: v === value ? 'on' : '', dataset: { v: String(v) }, onClick: () => { set(v); onChange && onChange(v); } }, label)));
  function set(v) { [...el.children].forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); } el.set = set; return el;
}
export function tabsEl(items, active, onChange) {
  const el = h('div.tabs', { role: 'tablist' }, items.map(([id, label, ic]) => h('button', { type: 'button', role: 'tab', class: id === active ? 'on' : '', dataset: { id }, onClick: () => { set(id); onChange(id); } }, ic ? icon(ic, 16) : null, label)));
  function set(id) { [...el.children].forEach((b) => b.classList.toggle('on', b.dataset.id === id)); } el.set = set; return el;
}
export const field = (label, input, hint) => h('div.field', label ? h('label', label) : null, input, hint ? h('div.hint', hint) : null);
export const settingRow = (title, desc, control) => h('div.setting', h('div.grow', h('div', { style: 'font-weight:600' }, title), desc ? h('div.sd', desc) : null), control);
// Empty states take an icon name; legacy emoji arguments are mapped to an icon so no emoji reaches the UI.
const EMOJI_ICON = { '💬': 'chat', '🔒': 'lock', '🧑‍🤝‍🧑': 'users', '📭': 'inbox', '🎨': 'palette', '🎮': 'gamepad', '🛍️': 'bag', '🏆': 'trophy', '🎵': 'music', '🔍': 'search', '📻': 'music', '🧩': 'puzzle', '📣': 'bell', '🎲': 'dice', '🛡️': 'shield', '⭐': 'star', '📂': 'inbox', '🌐': 'globe', '🔖': 'bookmark', '🎧': 'music', '🖼️': 'image', '📜': 'note', '👥': 'users', '🚫': 'shield' };
export const emptyState = (ic, title, desc, action) => h('div.empty', h('div.empty-art', icon(EMOJI_ICON[ic] || (/^[a-z]+$/.test(ic || '') ? ic : 'inbox'), 26)), h('h3', title), desc ? h('p', desc) : null, action || null);
export const loading = (label) => h('div.empty', h('span.spinner'), label ? h('p', { style: 'margin-top:10px' }, label) : null);
export function copyBtn(text, label = t('Copy')) {
  const b = h('button.btn.sm', { type: 'button', onClick: async () => { await copyText(text); b.textContent = t('Copied!'); setTimeout(() => (b.textContent = label), 1400); } }, icon('copy', 15), label); return b;
}
export async function busy(btn, fn) {
  if (!btn) return fn(); if (btn.disabled) return; const html = [...btn.childNodes]; btn.disabled = true; clear(btn); btn.appendChild(h('span.spinner', { style: 'width:16px;height:16px;border-width:2px' }));
  try { return await fn(); } finally { clear(btn); html.forEach((n) => btn.appendChild(n)); btn.disabled = false; }
}

// ---- emoji picker ----
const EMOJI = {
  '😀': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😎 🤓 🥳 😏 😒 🙄 😬 😴 🤔 🫡 😤 😡 🥺 😭 😱 🤯 🥶 🥵 🤢 😈 💀 👻 🤖 🎃'.split(' '),
  '👍': '👍 👎 👏 🙌 🤝 🙏 💪 👀 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 ✨ ⭐ 🔥 💥 💯 ✅ ❌ ⚡ 🌈 🎉 🎊 🏆 🥇 👑 💎 💸 🍀'.split(' '),
  '🎮': '🎮 🕹️ 👾 🎲 🎯 🧩 ♟️ 🃏 🎰 🏎️ ⚽ 🏀 🏈 ⚔️ 🛡️ 🏹 💣 🔫 🧪 🚀 🛸 🌌 🪐 🌙 ☄️ 🐉 🦄 🐺 🦊 🐱 🐶 🍕 🍔 🍟 🍿 🥤 🍩 ☕'.split(' '),
};
export function emojiPicker(anchor, onPick) {
  let cat = Object.keys(EMOJI)[0]; const grid = h('div.emoji-grid'); const tabs = h('div.row', { style: 'gap:2px;margin-bottom:6px' });
  const draw = () => { clear(grid); EMOJI[cat].forEach((e) => grid.appendChild(h('button', { type: 'button', onClick: () => { onPick(e); closeMenu(); } }, e))); [...tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.c === cat)); };
  Object.keys(EMOJI).forEach((c) => tabs.appendChild(h('button.btn.ghost.sm', { dataset: { c }, onClick: () => { cat = c; draw(); } }, c)));
  const el = openMenu([], anchor); el.classList.add('emoji-pop'); el.appendChild(tabs); el.appendChild(grid); draw(); return el;
}

// ---- celebration ----
export function confetti(x = innerWidth / 2, y = innerHeight / 2, n = 60) {
  if (document.documentElement.dataset.reduce === '1') return;
  const cv = h('canvas', { style: 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:98' }); cv.width = innerWidth; cv.height = innerHeight; document.body.appendChild(cv);
  const ctx = cv.getContext('2d'); const cs = getComputedStyle(document.documentElement); const cols = [cs.getPropertyValue('--accent').trim() || '#d4ff3f', cs.getPropertyValue('--text').trim() || '#ececef', cs.getPropertyValue('--accent2').trim() || '#5eead4', '#f5c542'];
  const ps = Array.from({ length: n }, () => ({ x, y, vx: rand(-6, 6), vy: rand(-11, -2), r: rand(3, 6), c: pick(cols), rot: rand(0, 6), vr: rand(-.3, .3) }));
  let f = 0; (function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) { p.vy += .35; p.x += p.vx; p.y += p.vy; p.rot += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - f / 80); ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); }
    if (++f < 80) requestAnimationFrame(tick); else cv.remove();
  })();
}
export function countUp(el, from, to, ms = 700) {
  const t0 = performance.now(); (function s(now) { const k = Math.min(1, (now - t0) / ms); el.textContent = new Intl.NumberFormat().format(Math.round(from + (to - from) * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(s); })(t0);
}
