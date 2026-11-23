// Nebulix 13: duel challenges from friends arrive anywhere in the app. Accepting opens the private duel.
import { h } from './util.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { bus } from './state.js';
import { modal, toast, toastErr } from './ui.js';
import { sfx } from './sfx.js';
import { avatarEl } from './cosmetics.js';
import { fmt } from './util.js';

let started = false;
export function initDuelInvites() {
  if (started) return; started = true;
  bus.on('ws:ar_invite', async (m) => {
    try { sfx.coin(); } catch {}
    const v = await modal({ title: t('Duel challenge'), cls: 'narrow', body: h('div.col', { style: 'align-items:center;text-align:center;gap:8px' }, avatarEl(m.from, { size: 64 }), h('b', '@' + m.from.username), h('p', t('challenges you to a 1 vs 1 duel on Prism Court.')), m.bet ? h('p.coin', t('Bet: {n} coins each — the winner takes {w}', { n: fmt.coins(m.bet), w: fmt.coins(Math.floor(m.bet * 2 * 0.95)) })) : h('p.tiny.muted', t('No bet, just for glory.')), h('p.tiny.muted', t('Expires in 2 minutes.'))),
      actions: [{ label: t('Decline'), value: 'no' }, { label: t('Accept'), kind: 'primary', value: 'yes' }] });
    if (v === 'yes') { try { const r = await api.post('/api/arena/duel/accept', { id: m.id }); window.__nbx.go('arena/duel', { room: r.room }); } catch (e) { toastErr(e); } }
    else api.post('/api/arena/duel/decline', { id: m.id }).catch(() => {});
  });
  bus.on('ws:ar_go', (m) => { toast(t('@{u} accepted your duel!', { u: m.by ? m.by.username : '?' }), 'good'); window.__nbx.go('arena/duel', { room: m.room }); });
}
