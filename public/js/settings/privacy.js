// Settings → Privacy: who can message you, and the people you've blocked.
import { h, mount } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, settingRow, segEl, confirmBox, loading, switchEl } from '../ui.js';
import { avatarEl } from '../cosmetics.js';

const DM = [['everyone', t('Everyone')], ['friends', t('Friends only')], ['none', t('No one')]];

export default {
  mount(host, ctx) {
    const dm = (S.me.settings && S.me.settings.dm) || 'everyone';
    const blockBox = h('div.col', { style: 'gap:6px' }, loading());

    async function loadBlocked() {
      try {
        const r = await api.get('/api/friends');
        const blocked = r.blocked || [];
        if (!blocked.length) return mount(blockBox, h('div.empty', { style: 'padding:18px' }, h('div.empty-art.ea-mark'), h('p', t('You have not blocked anyone.'))));
        mount(blockBox, blocked.map((u) => h('div.set-row',
          avatarEl(u, { size: 34, frame: false }), h('div.grow', h('b', u.displayName || u.username), h('div.tiny.muted', '@' + u.username)),
          h('button.btn.sm', { onClick: async () => { try { await api.del('/api/block/' + u.id); toast(t('Unblocked @{u}', { u: u.username }), 'good', 2000); loadBlocked(); } catch (e) { toastErr(e); } } }, t('Unblock')))));
      } catch (e) { mount(blockBox, h('span.error', e.message)); }
    }

    // ---- 13.8: push notifications ----
    const pushBox = h('div');
    const b64 = (k) => { const p = '='.repeat((4 - (k.length % 4)) % 4); const r = atob((k + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
    async function paintPush() {
      const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!ok) return mount(pushBox, settingRow(t('Push notifications'), t('This browser cannot show notifications. On iPhone, add Nebulix to the home screen first.'), h('span.tiny.muted', '—')));
      let reg = null; let sub = null; try { reg = await navigator.serviceWorker.ready; sub = await reg.pushManager.getSubscription(); } catch {}
      const on = !!sub && Notification.permission === 'granted';
      mount(pushBox, settingRow(t('Push notifications'), t('Messages, 1v1 challenges, gifts and friend requests reach you even when Nebulix is closed. Message text is never sent in a notification.'),
        switchEl(on, async (v) => {
          try {
            if (v) {
              const perm = await Notification.requestPermission(); if (perm !== 'granted') { toast(t('Notifications are blocked. Allow them in your browser settings.'), 'err'); return paintPush(); }
              const { key } = await api.get('/api/push/key'); const s2 = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
              await api.post('/api/push/subscribe', { sub: s2.toJSON() }); toast(t('Notifications on'), 'good');
            } else { const s2 = await reg.pushManager.getSubscription(); if (s2) { await api.post('/api/push/unsubscribe', { endpoint: s2.endpoint }); await s2.unsubscribe(); } toast(t('Notifications off'), 'good'); }
          } catch (e) { toastErr(e); }
          paintPush();
        })),
      on ? [['pushDm', t('Direct messages')], ['pushDuel', t('1v1 challenges')], ['pushNotice', t('Gifts, friends and other notices')]].map(([k, n]) => settingRow(n, '', switchEl(!(S.me.settings && S.me.settings[k] === false), async (v) => { try { const r = await api.patch('/api/profile', { settings: { [k]: v } }); patchMe({ settings: r.user.settings }); } catch (e) { toastErr(e); } }))) : null,
      on ? h('div.row', { style: 'justify-content:flex-end' }, h('button.btn.sm', { onClick: async (e) => { e.currentTarget.disabled = true; try { await api.post('/api/push/test'); toast(t('Test sent — it should appear in a few seconds'), 'good'); } catch (err) { toastErr(err); } } }, icon('bell', 14), t('Send a test'))) : null);
    }
    paintPush();
    mount(host,
      h('section.card', h('h3', icon('bell', 18), t('Notifications')), pushBox),
      h('section.card', h('h3', icon('mail', 18), t('Direct messages')),
        settingRow(t('Who can message you'), t('Blocked users can never message you, whatever this is set to. Your friends always can.'),
          segEl(DM, dm, async (v) => { try { const r = await api.patch('/api/profile', { settings: { dm: v } }); patchMe({ settings: r.user.settings }); toast(t('Saved'), 'good', 1500); } catch (e) { toastErr(e); } })),
        settingRow(t('Read receipts'), t('Show "Seen" when you have read a message. If you turn it off, you will not see it for others either.'),
          switchEl(!(S.me.settings && S.me.settings.readReceipts === false), async (v) => { try { const r = await api.patch('/api/profile', { settings: { readReceipts: v } }); patchMe({ settings: r.user.settings }); } catch (e) { toastErr(e); } }))),
      h('section.card', h('h3', icon('gamepad', 18), t('Arcade & activity')),
        settingRow(t('Who can challenge you to duels'), t('Duels can include a coin wager, which both players must accept.'),
          segEl([['everyone', t('Everyone')], ['friends', t('Friends')], ['none', t('Nobody')]], (S.me.settings && S.me.settings.duels) || 'friends', async (v) => { try { const r = await api.patch('/api/profile', { settings: { duels: v } }); patchMe({ settings: r.user.settings }); toast(t('Saved'), 'good', 1500); } catch (e) { toastErr(e); } })),
        settingRow(t('Show my activity'), t('Friends and servers see what you are doing in Nebulix (music, games, browsing).'),
          switchEl(!(S.me.settings && S.me.settings.showActivity === false), async (v) => { try { const r = await api.patch('/api/profile', { settings: { showActivity: v } }); patchMe({ settings: r.user.settings }); } catch (e) { toastErr(e); } })),
        settingRow(t('Show my game library on my profile'), t('Others see what you are playing now, your favourite games and hours played. Your notes stay private.'),
          switchEl(!(S.me.settings && S.me.settings.showLibrary === false), async (v) => { try { const r = await api.patch('/api/profile', { settings: { showLibrary: v } }); patchMe({ settings: r.user.settings }); } catch (e) { toastErr(e); } }))),
      h('section.card', h('h3', icon('eyeoff', 18), t('Blocked users')),
        h('p.muted.small', t('Blocked people cannot message you, add you as a friend or see you online. Block someone from their profile or a chat message.')),
        blockBox),
      h('section.card', h('h3', icon('lock', 18), t('End-to-end encryption')),
        h('p.muted.small', t('Your direct messages are encrypted on your device so no one — not even the Nebulix server — can read them. Manage your keys in the Security tab.')),
        h('button.btn', { onClick: () => ctx.go('settings', 'security') }, icon('key', 16), t('Open encryption settings'))));
    loadBlocked();
    return () => {};
  },
};
