// Inbox: one place for everything that happened while you were elsewhere — mentions, DMs, friend requests,
// duel invites, squad joins, event changes and announcements. Kept per account in localStorage (last 60 items).
import { h, fmt, ls } from './util.js';
import { t } from './i18n.js';
import { S, bus } from './state.js';
import { icon } from './icons.js';
import { openMenu, closeMenu, toast } from './ui.js';
import { dnd } from './sfx.js';

const MAX = 60;
const key = () => 'inbox.' + (S.me ? S.me.id : 'anon');
let items = [];
export const load = () => { items = ls(key()) || []; paintBell(); };
const save = () => { ls(key(), items.slice(0, MAX)); paintBell(); };
export const unread = () => items.filter((i) => !i.read).length;

// Desktop notifications (Windows toast) when Nebulix is in the background — opt-in from the inbox header.
const canNotify = () => 'Notification' in window && Notification.permission === 'granted' && (ls('notify.desktop') !== false);
function desktop(text, link) {
  if (!document.hidden || !canNotify() || dnd()) return;
  try { const n = new Notification('Nebulix', { body: text, icon: '/assets/icon-192.png', tag: 'nbx-' + (link ? link.join('/') : 'info') }); n.onclick = () => { window.focus(); if (link && goRef) goRef(...link); n.close(); }; } catch {}
}
let goRef = null;
export const setGo = (go) => { goRef = go; };

export function push(kind, text, link, extra) {
  desktop(text, link);
  // collapse repeated DMs from the same person into one entry
  if (kind === 'dm' && extra && extra.from) { const old = items.find((i) => i.kind === 'dm' && !i.read && i.from === extra.from); if (old) { old.n = (old.n || 1) + 1; old.at = Date.now(); old.text = text; items = [old, ...items.filter((i) => i !== old)]; save(); return; } }
  items.unshift(Object.assign({ id: Math.random().toString(36).slice(2), kind, text, link, at: Date.now(), read: false }, extra || {}));
  items.length = Math.min(items.length, MAX); save();
}
function paintBell() {
  const b = document.getElementById('bell'); if (!b) return;
  const old = b.querySelector('.bell-dot'); if (old) old.remove();
  if (unread()) b.appendChild(h('span.bell-dot'));
  b.classList.toggle('dnd', dnd());
}
const ICONS = { mention: 'chat', dm: 'mail', friend: 'users', duel: 'gamepad', squad: 'target', event: 'calendar', announce: 'bell', coins: 'coins', info: 'info' };

export function openInbox(anchor, go) {
  const el = openMenu([], anchor); el.classList.add('inbox-pop');
  const list = h('div.inbox-list');
  const paint = () => {
    list.replaceChildren(...(items.length ? items.map((i) => h('div.inbox-item' + (i.read ? '' : '.unread'), { onClick: () => { i.read = true; save(); closeMenu(); if (i.link) go(...i.link); } },
      h('span.ii', icon(ICONS[i.kind] || 'info', 15)), h('div.grow', h('div', i.text + (i.n > 1 ? ` (${i.n})` : '')), h('div.tiny.muted', fmt.rel(i.at)))))
      : [h('div.empty', { style: 'padding:28px 16px' }, h('div.empty-art', icon('inbox', 22)), h('h3', t('All caught up')), h('p', t('Mentions, messages and invites will show up here.')))]));
  };
  const perm = 'Notification' in window ? Notification.permission : 'denied';
  const deskBtn = perm === 'default' ? h('button.btn.ghost.sm', { title: t('Show Windows notifications when Nebulix is in the background'), onClick: async () => { try { await Notification.requestPermission(); } catch {} deskBtn.remove(); } }, icon('bell', 13), t('Desktop alerts')) : null;
  el.append(h('div.inbox-head', h('b', t('Notifications')), deskBtn, items.length ? h('button.btn.ghost.sm', { onClick: () => { items.forEach((i) => (i.read = true)); save(); paint(); } }, t('Mark all read')) : null,
    items.length ? h('button.btn.ghost.icon.sm', { title: t('Clear'), 'aria-label': t('Clear'), onClick: () => { items = []; save(); paint(); } }, icon('trash', 14)) : null), list);
  paint();
  // place the panel under the bell, right-aligned
  const r = anchor.getBoundingClientRect(); el.style.left = Math.max(8, Math.min(r.right - 360, innerWidth - 368)) + 'px';
  return el;
}

// Wire realtime events into the inbox. `isViewing(kind, id)` lets the app skip things the user is looking at.
export function wire(isViewing) {
  const MSG = { ev_soon: '"{e}" starts in {n} min', ev_now: '"{e}" is starting now', ev_cancel: '"{e}" was cancelled', sq_join: '{n} joined your squad "{s}"' };
  bus.on('ws:notify', (m) => {
    const text = MSG[m.msg] ? t(MSG[m.msg], m.vars || {}) : m.text;
    push(m.kind || 'info', text, m.link ? [m.link] : null);
    if (!dnd()) toast(text, m.kind === 'event' ? 'good' : 'info', 7000);
  });
  bus.on('ws:dm', (m) => { if (m.to === S.me.id && !isViewing('dm', m.from)) push('dm', t('New message from {n}', { n: (m.u && (m.u.displayName || m.u.username)) || '?' }), ['dm', m.from], { from: m.from }); });
  bus.on('ws:msg', (m) => { if (m.m.a !== S.me.id && (m.m.m || []).includes(S.me.id) && !isViewing('chat', m.ch)) push('mention', t('{n} mentioned you', { n: (m.u && (m.u.displayName || m.u.username)) || '?' }) + (m.m.c ? ': ' + m.m.c.slice(0, 80) : ''), ['chat', m.ch]); });
  bus.on('ws:friend', (m) => { if (m.from && m.from !== S.me.id) push('friend', t('You have a new friend request'), ['dm', '']); });
  bus.on('ws:duel', (m) => { const d = m.duel; if (d && d.me === 1 && d.status === 'pending') push('duel', t('{u} challenges you to {g}', { u: d.a.displayName || d.a.username, g: t(d.name) }), ['arcade', { duel: d.id }]); });
  bus.on('ws:announce', (m) => push('announce', m.a.title + ' — ' + m.a.body, null));
}
