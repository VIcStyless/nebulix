// "Send to a friend": pick a friend and send them some text (a link, a squad, an event) as an end-to-end
// encrypted direct message, without leaving the current page.
import { h } from './util.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { S } from './state.js';
import { avatarEl, nameEl } from './cosmetics.js';
import { modal, toast, toastErr, emptyState } from './ui.js';
import * as cx from './crypto.js';

async function ready() {
  if (!cx.supported()) throw new Error(t('Encryption needs a secure connection'));
  const s = await cx.state();
  if (s.s === 'none') { await cx.createKeys(); return true; }
  if (s.s === 'ready-unpublished') { await cx.publishLocal(); return true; }
  if (s.s !== 'ready') throw new Error(t('Open Messages once to unlock your encryption key on this device.'));
  return true;
}

export async function sendTo(peerId, text) {
  await ready();
  const r = await api.get(`/api/dm/${peerId}/messages?limit=1`);
  if (!r.key) throw new Error(t('{n} has not enabled encryption yet', { n: r.peer.displayName || r.peer.username }));
  const sealed = await cx.seal(r.id, r.key.pub, text);
  await api.post(`/api/dm/${peerId}/messages`, sealed);
  return r.peer;
}

export function sendToFriend(text) {
  const friends = (S.friends.friends || []).slice().sort((a, b) => Number(S.online.has(b.id)) - Number(S.online.has(a.id)) || (a.displayName || a.username).localeCompare(b.displayName || b.username));
  const note = h('textarea.input', { rows: 2, maxlength: 300, placeholder: t('Add a message (optional)') });
  let p;
  const list = friends.length ? h('div.col', { style: 'gap:2px;max-height:300px;overflow:auto' }, friends.map((f) => h('button.link-tile', { onClick: async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { const peer = await sendTo(f.id, (note.value.trim() ? note.value.trim() + '\n' : '') + text); toast(t('Sent to {n}', { n: peer.displayName || peer.username }), 'good'); p.close(); }
    catch (er) { toastErr(er); b.disabled = false; }
  } }, avatarEl(f, { size: 30, status: true }), h('div.grow', nameEl(f)), h('span.tiny.muted', S.online.has(f.id) ? t('Online') : '')))) : emptyState('users', t('No friends yet'), t('Send a friend request to get started.'));
  p = modal({ title: t('Send to a friend'), cls: 'narrow', body: h('div.col', h('div.small.muted', { style: 'word-break:break-all' }, text.split('\n').pop()), note, list, h('div.tiny.muted', t('End-to-end encrypted'))), actions: [{ label: t('Cancel') }] });
}
