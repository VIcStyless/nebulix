// Leagues: weekly divisions from Bronze to Nebula. Your XP this week ranks you; the top move up, the bottom move down. #/leagues
import { h, mount, fmt } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { S } from '../state.js';
import { loading, emptyState } from '../ui.js';
import { avatarEl } from '../cosmetics.js';

const left = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); const hh = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); return d ? `${d}d ${hh}h` : `${hh}h ${m}m`; };

export default {
  title: () => t('Leagues'),
  async mount(root) {
    const inner = h('div.inner.lg'); mount(root, inner, loading()); let d;
    try { d = await api.get('/api/leagues'); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return () => {}; }
    const T = d.tiers[d.tier]; const n = d.board.length;
    const zoneOf = (r) => (d.up && r <= d.up ? 'up' : d.down && n >= 4 && r > n - d.down ? 'down' : '');
    const last = d.last; const lastT = last ? d.tiers[last.to] : null;
    mount(inner,
      h('section.lg-hero', { style: { '--lg': T.color } }, h('div.lg-badge', T.icon), h('div.grow', h('div.tiny.muted', t('Your league')), h('h2', pick2(T.n)), h('p', { style: 'margin:2px 0' }, t('Earn XP anywhere in Nebulix (games, work, quests, posts…) to climb the ranking. Ends in {t}.', { t: left(d.ends - Date.now()) }))),
        h('div.lg-me', h('b', d.rank ? '#' + d.rank : '—'), h('span.tiny', t('{n} XP this week', { n: fmt.num(d.xp) })))),
      h('div.lg-tiers', d.tiers.map((x) => h('div.lg-t' + (x.i === d.tier ? '.on' : x.i < d.tier ? '.past' : ''), { style: { '--lg': x.color } }, h('span', x.icon), h('b', pick2(x.n)), h('span.tiny.muted', '🥇 ' + fmt.coins(x.top))))),
      last ? h('div.cs-note', lastT.icon + ' ', t('Last week you finished #{r} and got {n} coins.', { r: last.rank, n: fmt.num(last.prize) }), ' ', last.to > last.from ? t('You were promoted!') : last.to < last.from ? t('You moved down.') : '') : null,
      h('div.card', h('h3', T.icon + ' ' + pick2(T.n) + ' · ' + t('{n} players this week', { n: d.players })),
        h('p.small.muted', (d.up ? t('Top {n} move up.', { n: d.up }) + ' ' : '') + (d.down && n >= 4 ? t('Bottom {n} move down.', { n: d.down }) + ' ' : '') + t('Everyone who plays gets coins when the week ends, and the top 3 also get gems.')),
        n ? h('div.lg-board', d.board.map((r) => h('div.lg-row' + (r.user.id === S.me.id ? '.me' : '') + (zoneOf(r.rank) ? '.' + zoneOf(r.rank) : ''), h('span.lg-rk', ['🥇', '🥈', '🥉'][r.rank - 1] || '#' + r.rank), avatarEl(r.user, { size: 30, status: true }),
          h('b.grow', (r.user.clan ? '[' + r.user.clan.tag + '] ' : '') + r.user.displayName), zoneOf(r.rank) === 'up' ? h('span.lg-z.up', '▲') : zoneOf(r.rank) === 'down' ? h('span.lg-z.down', '▼') : null, h('span.mono', fmt.num(r.xp) + ' XP'), h('span.tiny.coin', '+' + fmt.coins(r.prize)))))
          : h('p.muted', t('Nobody has earned XP in this league yet this week. Play anything to be first!'))));
    return () => {};
  },
};
