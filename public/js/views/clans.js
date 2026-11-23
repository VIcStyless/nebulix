// Clans: create or join a clan, share a coin bank, post on the clan wall and fight the weekly Clan War. #/clans
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, bus } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, confirmBox, openModal, promptBox } from '../ui.js';
import { avatarEl } from '../cosmetics.js';

const ROLE = { leader: ['Leader', '👑'], officer: ['Officer', '⭐'], member: ['Member', ''] };
const EMOJI = ['🛡️', '⚔️', '🐉', '🦊', '🐺', '🦅', '🔥', '⚡', '🌙', '⭐', '💎', '👾', '🚀', '🌌', '🍀', '🎯'];
const left = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); const hh = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); return d ? `${d}d ${hh}h` : `${hh}h ${m}m`; };
const tagEl = (c) => h('span.kl-tag', { style: { background: c.color } }, c.tag);

export default {
  title: () => t('Clans'),
  async mount(root) {
    const inner = h('div.inner.klan'); mount(root, inner, loading()); let d; const offs = [];
    const load = async () => { d = await api.get('/api/clans'); paint(); };
    const act = (btn, body, msg) => busy(btn, async () => { try { d = await api.post('/api/clan/manage', body); if (msg) toast(msg, 'good'); paint(); } catch (e) { toastErr(e); } });
    try { await load(); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return () => {}; }
    offs.push(bus.on('ws:clan', () => load().catch(() => {})));

    function form(c) {
      const v = { tag: c ? c.tag : '', name: c ? c.name : '', desc: c ? c.desc : '', emoji: c ? c.emoji : '🛡️', color: c ? c.color : d.colors[0], open: c ? c.open : true };
      const em = h('div.kl-pick', EMOJI.map((e) => h('button' + (v.emoji === e ? '.on' : ''), { type: 'button', onClick: (ev) => { v.emoji = e; for (const b of em.children) b.classList.remove('on'); ev.currentTarget.classList.add('on'); } }, e)));
      const co = h('div.kl-pick', d.colors.map((c2) => h('button.kl-col' + (v.color === c2 ? '.on' : ''), { type: 'button', style: { background: c2 }, onClick: (ev) => { v.color = c2; for (const b of co.children) b.classList.remove('on'); ev.currentTarget.classList.add('on'); } })));
      const m = openModal([h('h2', c ? t('Clan settings') : t('Found a clan')),
        c ? null : h('label.lbl', t('Tag (2–5 letters or numbers)'), h('input.input', { maxlength: 5, value: v.tag, onInput: (e) => { v.tag = e.target.value.toUpperCase(); e.target.value = v.tag; } })),
        h('label.lbl', t('Name'), h('input.input', { maxlength: 30, value: v.name, onInput: (e) => { v.name = e.target.value; } })),
        h('label.lbl', t('Description'), h('input.input', { maxlength: 200, value: v.desc, onInput: (e) => { v.desc = e.target.value; } })),
        h('div.lbl', t('Emblem')), em, h('div.lbl', t('Colour')), co,
        h('label.row.small', { style: 'gap:8px;margin:10px 0' }, h('input', { type: 'checkbox', checked: v.open, onChange: (e) => { v.open = e.target.checked; } }), t('Anyone can join (otherwise they send a request)')),
        h('div.row', { style: 'gap:8px;justify-content:flex-end' }, h('button.btn.ghost', { onClick: () => m.close() }, t('Cancel')),
          h('button.btn.primary', { onClick: (e) => busy(e.currentTarget, async () => { try { d = c ? await api.post('/api/clan/manage', Object.assign({ action: 'settings' }, v)) : await api.post('/api/clans', v); m.close(); toast(c ? t('Saved') : t('Your clan is ready! Invite your friends.'), 'good'); paint(); } catch (er) { toastErr(er); } }) }, c ? t('Save') : t('Found it · {n}', { n: fmt.coins(d.cost) })))], { cls: 'kl-modal' });
    }
    function clanCard(c, extra) {
      return h('div.kl-card', { style: { '--kl': c.color } }, h('div.kl-em', c.emoji), h('div.grow', h('div.row', { style: 'gap:6px;align-items:center' }, tagEl(c), h('b', c.name)), h('div.tiny.muted', t('Level {n}', { n: c.level }) + ' · ' + t('{n}/{m} members', { n: c.members, m: c.cap }) + ' · ' + t('{n} pts this week', { n: fmt.compact(c.week) })), c.desc ? h('div.small', c.desc) : null), extra);
    }
    function warCard() {
      return h('div.card.kl-war', h('h3', '⚔️ ', t('Clan War'), h('span.tiny.muted', ' · ' + t('ends in {t}', { t: left(d.warEnds - Date.now()) }))),
        h('p.small.muted', t('Every XP point members earn counts for their clan. On Monday the top 3 clans win {a}, {b} and {c} coins for their bank.', { a: fmt.coins(d.prizes[0]), b: fmt.coins(d.prizes[1]), c: fmt.coins(d.prizes[2]) })),
        d.war.length ? h('div.kl-board', d.war.slice(0, 10).map((c) => h('div.kl-row' + (d.mine && d.mine.id === c.id ? '.me' : ''), h('span.kl-rk', ['🥇', '🥈', '🥉'][c.rank - 1] || '#' + c.rank), h('span', c.emoji), tagEl(c), h('b.grow', c.name), h('span.mono', fmt.num(c.week))))) : h('p.muted.small', t('No clan has points yet this week.')),
        d.last && d.last.results && d.last.results.length ? h('div.tiny.muted', { style: 'margin-top:8px' }, t('Last week:') + ' ' + d.last.results.map((r) => ['🥇', '🥈', '🥉'][r.rank - 1] + ' [' + r.tag + ']').join('  ')) : null);
    }
    function paint() {
      const c = d.mine;
      if (!c) {
        mount(inner,
          h('div.page-title', h('div', h('h2', icon('shield', 24), ' ', t('Clans')), h('p', t('Team up with friends: a shared coin bank, a clan wall, levels that unlock more members and a weekly Clan War with prizes.')))),
          h('div.grid2', h('div.card.kl-cta', h('h3', t('Found your own clan')), h('p.small.muted', t('Choose a tag, an emblem and a colour. Your tag shows next to your name in Nebula Worlds.')), h('button.btn.primary', { disabled: S.me.coins < d.cost, onClick: () => form(null) }, icon('plus', 14), t('Found a clan · {n}', { n: fmt.coins(d.cost) }))), warCard()),
          h('h3', { style: 'margin-top:18px' }, t('Join a clan')),
          d.browse.length ? h('div.kl-list', d.browse.map((x) => clanCard(x, h('button.btn.sm' + (x.open ? '.primary' : ''), { disabled: x.members >= x.cap, onClick: (e) => busy(e.currentTarget, async () => { try { d = await api.post('/api/clans/' + x.id + '/join'); toast(x.open ? t('Welcome to [{t}]!', { t: x.tag }) : t('Request sent. An officer will answer soon.'), 'good'); paint(); } catch (er) { toastErr(er); } }) }, x.members >= x.cap ? t('Full') : x.open ? t('Join') : t('Request'))))) : emptyState('users', t('No clans yet'), t('Found the first one!')));
        return;
      }
      const lead = c.my.role === 'leader'; const off = c.my.role !== 'member'; const pct = c.next > c.prev ? Math.min(100, ((c.pts - c.prev) / (c.next - c.prev)) * 100) : 100;
      const wallIn = h('input.input.grow', { maxlength: 300, placeholder: t('Write to your clan…'), onKeydown: (e) => { if (e.key === 'Enter') post(e.target); } });
      const post = (inp) => { const text = inp.value.trim(); if (!text) return; act(null, { action: 'post', text }).then(() => { inp.value = ''; }); };
      mount(inner,
        h('section.kl-hero', { style: { '--kl': c.color } }, h('div.kl-big', c.emoji), h('div.grow', h('div.row', { style: 'gap:8px;align-items:center;flex-wrap:wrap' }, tagEl(c), h('h2', { style: 'margin:0' }, c.name)), c.desc ? h('p', { style: 'margin:4px 0' }, c.desc) : null,
          h('div.kl-lvl', h('span', t('Level {n}', { n: c.level })), h('div.ss-bar.sm.grow', h('i', { style: { width: pct + '%' } })), h('span.tiny', fmt.compact(c.pts) + ' / ' + fmt.compact(c.next)))),
          h('div.kl-kpis', h('div', h('b.coin', fmt.coins(c.bank)), h('span.tiny', t('Clan bank'))), h('div', h('b', c.members + '/' + c.cap), h('span.tiny', t('Members'))), h('div', h('b', fmt.compact(c.week)), h('span.tiny', t('Points this week'))))),
        h('div.row', { style: 'gap:8px;flex-wrap:wrap;margin:12px 0' },
          h('button.btn.primary', { onClick: async () => { const v = await promptBox(t('Deposit coins in the clan bank'), { type: 'number', value: '1000', hint: t('Minimum 100. The leader can pay members from the bank.') }); if (v) act(null, { action: 'deposit', amount: Number(v) }, t('Thanks for the deposit!')); } }, '🪙 ', t('Deposit')),
          lead ? h('button.btn', { onClick: () => form(c) }, icon('gear', 14), t('Settings')) : null,
          h('button.btn.ghost', { onClick: async () => { if (!(await confirmBox(lead && c.members === 1 ? t('You are the last member: the clan and its bank will be deleted. Leave?') : t('Leave the clan?'), { danger: true }))) return; try { d = await api.post('/api/clan/leave'); paint(); } catch (e) { toastErr(e); } } }, icon('logout', 14), t('Leave'))),
        c.requests.length ? h('div.card', h('h3', t('Join requests')), c.requests.map((u) => h('div.kl-row', avatarEl(u, { size: 28 }), h('b.grow', u.displayName), h('button.btn.sm.primary', { onClick: (e) => act(e.currentTarget, { action: 'accept', user: u.id }) }, t('Accept')), h('button.btn.sm.ghost', { onClick: (e) => act(e.currentTarget, { action: 'decline', user: u.id }) }, t('Decline'))))) : null,
        h('div.grid2', { style: 'align-items:start' },
          h('div.card', h('h3', icon('users', 17), ' ', t('Members')), h('div.kl-board', c.roster.map((m) => h('div.kl-row', avatarEl(m.user, { size: 30, status: true }), h('div.grow', h('b', m.user.displayName), h('div.tiny.muted', (ROLE[m.role][1] ? ROLE[m.role][1] + ' ' : '') + t(ROLE[m.role][0]) + ' · ' + t('{n} pts this week', { n: fmt.compact(m.week) }))),
            lead && m.user.id !== S.me.id ? h('button.btn.sm.ghost', { 'aria-label': t('Manage'), onClick: () => manage(m) }, '⋯') : off && m.role === 'member' && m.user.id !== S.me.id ? h('button.btn.sm.ghost', { onClick: async (e) => { const b = e.currentTarget; if (await confirmBox(t('Remove @{u} from the clan?', { u: m.user.username }), { danger: true })) act(b, { action: 'kick', user: m.user.id }); } }, t('Remove')) : null)))),
          h('div', h('div.card', h('h3', icon('chat', 17), ' ', t('Clan wall')), h('div.row', { style: 'gap:6px' }, wallIn, h('button.btn.primary', { onClick: () => post(wallIn) }, t('Post'))),
            h('div.kl-wall', c.wall.length ? c.wall.map((p) => h('div.kl-post', avatarEl(p.user, { size: 28 }), h('div.grow', h('div.tiny.muted', h('b', p.user.displayName), ' · ' + fmt.dt(p.at)), h('div', p.text)), p.user.id === S.me.id || off ? h('button.btn.sm.ghost', { 'aria-label': t('Delete'), onClick: (e) => act(e.currentTarget, { action: 'unpost', post: p.id }) }, '×') : null)) : h('p.small.muted', t('Nothing here yet. Say hi!')))),
            warCard(),
            c.log.length ? h('div.card', h('h3', t('Clan log')), h('div.kl-log', c.log.map((l) => h('div.tiny', h('span.muted', fmt.dt(l.at) + ' · '), l.text)))) : null)));
    }
    function manage(m) {
      const md = openModal([h('h2', m.user.displayName), h('div.kl-mgmt',
        m.role === 'member' ? h('button.btn', { onClick: (e) => { act(e.currentTarget, { action: 'promote', user: m.user.id }); md.close(); } }, '⭐ ', t('Make officer')) : h('button.btn', { onClick: (e) => { act(e.currentTarget, { action: 'demote', user: m.user.id }); md.close(); } }, t('Make member')),
        h('button.btn', { onClick: async () => { md.close(); const v = await promptBox(t('Pay @{u} from the clan bank', { u: m.user.username }), { type: 'number', value: '1000', hint: t('Bank: {n} coins', { n: fmt.num(d.mine.bank) }) }); if (v) act(null, { action: 'pay', user: m.user.id, amount: Number(v) }, t('Paid')); } }, '🪙 ', t('Pay from the bank')),
        h('button.btn', { onClick: async () => { md.close(); if (await confirmBox(t('Make @{u} the leader? You will become an officer.', { u: m.user.username }))) act(null, { action: 'transfer', user: m.user.id }); } }, '👑 ', t('Make leader')),
        h('button.btn.danger', { onClick: async () => { md.close(); if (await confirmBox(t('Remove @{u} from the clan?', { u: m.user.username }), { danger: true })) act(null, { action: 'kick', user: m.user.id }); } }, t('Remove')))], { cls: 'kl-modal' });
    }
    return () => offs.forEach((f) => f());
  },
};
