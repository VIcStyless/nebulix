// Tournaments: hourly (free), daily and weekly Arcade tournaments with automatic prizes. #/tournaments
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, confirmBox, openModal } from '../ui.js';
import { avatarEl } from '../cosmetics.js';

const KIND = { hourly: ['Hourly', '⚡'], daily: ['Daily cup', '🏆'], weekly: ['Weekly championship', '👑'] };
const left = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); const hh = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60; return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : `${m}m ${String(ss).padStart(2, '0')}s`; };
const medal = (r) => ['🥇', '🥈', '🥉'][r - 1] || '#' + r;

export default {
  title: () => t('Tournaments'),
  async mount(root, ctx) {
    const inner = h('div.inner.tn'); mount(root, inner, loading()); let d; let timer = 0;
    const load = async () => { d = await api.get('/api/tournaments'); paint(); };
    try { await load(); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return () => {}; }
    async function join(btn, x) {
      if (x.fee && !(await confirmBox(t('Join for {n} coins? If fewer than 2 people play, you get it back.', { n: fmt.num(x.fee) })))) return;
      await busy(btn, async () => { try { await api.post('/api/tournaments/' + x.id + '/join'); toast(t('You are in! Your best score in {g} counts until the end.', { g: x.gname }), 'good'); await load(); } catch (e) { toastErr(e); } });
    }
    async function board(x) {
      let r; try { r = await api.get('/api/tournaments/' + x.id); } catch (e) { toastErr(e); return; }
      openModal([h('h2', KIND[r.kind][1] + ' ' + t(KIND[r.kind][0]) + ' · ' + r.gname), h('p.small.muted', t('{n} players · prize pool {p}', { n: r.players, p: fmt.coins(r.pool) })),
        r.top.length ? h('div.tn-board', r.top.map((x) => h('div.tn-row', h('span.tn-rk', medal(x.rank)), avatarEl(x.user, { size: 26 }), h('b.grow', x.user.displayName), h('span.mono', fmt.num(x.best))))) : h('p.muted', t('No scores yet.'))], { cls: 'tn-modal' });
    }
    function card(x) {
      const k = KIND[x.kind]; const play = h('a.btn' + (x.joined ? '.primary' : ''), { href: '#/arcade?play=' + encodeURIComponent(x.game) }, icon('play', 14), t('Play now'));
      return h('div.tn-card.tn-' + x.kind,
        h('div.tn-top', h('span.tn-kind', k[1] + ' ' + t(k[0])), h('span.tn-time', icon('clock', 12), ' ', h('span.tn-cd', { 'data-end': x.end }, left(x.end - Date.now())))),
        h('h3', x.gname), h('div.tn-pool', h('span.tiny.muted', t('Prize pool')), h('b.coin', fmt.coins(x.pool)), h('span.tiny.muted', x.prizes.map((p, i) => medal(i + 1) + ' ' + fmt.coins(p)).join('  '))),
        h('div.small.muted', t('{n} players', { n: x.players }) + ' · ' + (x.fee ? t('entry {n}', { n: fmt.coins(x.fee) }) : t('free entry'))),
        x.joined ? h('div.tn-me', t('Your best: {s}', { s: fmt.num(x.myBest) }), x.myRank ? ' · ' + t('rank {r}', { r: medal(x.myRank) }) : '') : null,
        x.top.length ? h('div.tn-mini', x.top.map((p) => h('div', medal(p.rank) + ' ' + p.user.displayName + ' — ' + fmt.num(p.best)))) : null,
        h('div.row', { style: 'gap:8px;margin-top:auto;flex-wrap:wrap' }, x.joined ? play : h('button.btn.primary', { onClick: (e) => join(e.currentTarget, x) }, icon('plus', 14), x.fee ? t('Join · {n}', { n: fmt.coins(x.fee) }) : t('Join free')), x.joined ? null : play, h('button.btn.ghost', { onClick: () => board(x) }, icon('trophy', 14), t('Ranking'))));
    }
    function paint() {
      mount(inner,
        h('div.page-title', h('div', h('h2', icon('trophy', 22), ' ', t('Tournaments')), h('p', t('A new Arcade tournament every hour, a daily cup and a weekly championship. Join, play the game and your best score counts. Prizes are paid automatically.'))), h('button.btn', { onClick: () => ctx.go('cups') }, icon('users', 16), t('Community Cups'))),
        d.wins ? h('div.cs-note', '🏅 ', t('You have won prizes in {n} tournaments.', { n: d.wins })) : null,
        h('div.tn-live', d.live.map(card)),
        h('div.grid2', { style: 'margin-top:16px' },
          h('div.card', h('h3', icon('calendar', 17), ' ', t('Coming up')), h('div.tn-list', d.upcoming.map((x) => h('div.tn-row', h('span', KIND[x.kind][1]), h('b.grow', x.gname), h('span.small.muted', new Date(x.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), h('span.tiny.muted', h('span.tn-cd', { 'data-end': x.start }, left(x.start - Date.now()))))))),
          h('div.card', h('h3', icon('star', 17), ' ', t('Latest results')), d.past.length ? h('div.tn-list', d.past.map((x) => h('button.tn-row', { onClick: () => board(x) }, h('span', KIND[x.kind][1]), h('b.grow', x.gname), x.top[0] ? h('span.small', '🥇 ' + x.top[0].user.displayName) : h('span.small.muted', t('nobody played')), h('span.coin.small', fmt.coins(x.prizes[0]))))) : h('p.small.muted', t('The first results appear when a tournament ends.')))),
        h('p.tiny.muted', t('Casino games are never tournaments. Paid tournaments with fewer than 2 players refund the entry.')));
    }
    timer = setInterval(() => { const n = Date.now(); let reload = false; for (const el of inner.querySelectorAll('.tn-cd')) { const e = +el.dataset.end; if (e - n <= 0) reload = true; el.textContent = left(e - n); } if (reload) load().catch(() => {}); }, 1000);
    void ctx; return () => clearInterval(timer);
  },
};
