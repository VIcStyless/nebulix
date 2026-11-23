// Nebulix 13 — Competitive: ranked queues for Nebula Royale, Nebula Ops and Duels, seasons, leaderboards. #/ranked
import { h, mount, fmt } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { loading, emptyState, tabsEl, promptBox, toast, toastErr } from '../ui.js';
import { avatarEl, nameEl } from '../cosmetics.js';

const L = pick2;
const MODES = [['royale', 'Nebula Royale', 'storm'], ['ops', 'Nebula Ops', 'target'], ['duel', 'Duels', 'swords']];
const days = (ms) => { const d = Math.floor(ms / 86400000); const hh = Math.floor((ms % 86400000) / 3600000); return d ? t('{d} d {h} h', { d, h: hh }) : t('{h} h', { h: hh }); };
// rank emblems drawn in SVG: a shield with chevrons for Bronce–Diamante, a ring for Nebulosa, a burst for Supernova, a void for Singularidad
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs) => { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
export function rankEmblem(tier, c, size = 22) {
  const s = sv('svg', { viewBox: '0 0 40 40', width: size, height: size, 'aria-hidden': 'true', style: 'flex:none' }); tier = Number(tier) || 0;
  const grad = sv('linearGradient', { id: 'rkg' + tier, x1: '0', y1: '0', x2: '0', y2: '1' }); grad.append(sv('stop', { offset: '0', 'stop-color': '#ffffff', 'stop-opacity': '.85' }), sv('stop', { offset: '.35', 'stop-color': c }), sv('stop', { offset: '1', 'stop-color': c, 'stop-opacity': '.65' })); const defs = sv('defs', {}); defs.append(grad); s.append(defs);
  const fill = `url(#rkg${tier})`;
  if (tier <= 4) { s.append(sv('path', { d: 'M20 2l15 6v11c0 9-6.5 16-15 19C11.5 35 5 28 5 19V8z', fill, stroke: '#0008', 'stroke-width': '1.5' })); for (let i = 0; i <= Math.min(tier, 4); i++) s.append(sv('path', { d: `M12 ${25 - i * 4}l8-4 8 4`, fill: 'none', stroke: '#fff', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); }
  else if (tier === 5) { s.append(sv('circle', { cx: 20, cy: 20, r: 16, fill: 'none', stroke: fill, 'stroke-width': 4 }), sv('circle', { cx: 20, cy: 20, r: 7, fill })); s.append(sv('ellipse', { cx: 20, cy: 20, rx: 18, ry: 6, fill: 'none', stroke: '#fff', 'stroke-width': 1.5, transform: 'rotate(-25 20 20)' })); }
  else if (tier === 6) { let d = ''; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const r = i % 2 ? 8 : 18; d += (i ? 'L' : 'M') + (20 + Math.cos(a) * r).toFixed(1) + ' ' + (20 + Math.sin(a) * r).toFixed(1); } s.append(sv('path', { d: d + 'z', fill, stroke: '#0006', 'stroke-width': 1 }), sv('circle', { cx: 20, cy: 20, r: 5, fill: '#fff' })); }
  else { s.append(sv('circle', { cx: 20, cy: 20, r: 18, fill }), sv('circle', { cx: 20, cy: 20, r: 11, fill: '#05010a' }), sv('circle', { cx: 20, cy: 20, r: 14, fill: 'none', stroke: '#fff', 'stroke-width': 1, 'stroke-dasharray': '3 3' })); }
  return s;
}
const tierOf = (rk) => (rk.tier !== undefined ? rk.tier : rk.t);
export function rankPill(rk, big) { if (!rk) return null; return h('span.rk-pill' + (big ? '.big' : ''), { style: { '--rc': rk.c } }, rankEmblem(tierOf(rk), rk.c, big ? 22 : 15), ' ', L(rk.n)); }

export default {
  title: () => t('Competitive'),
  async mount(root, ctx) {
    const inner = h('div.inner.rk'); mount(root, inner, loading());
    let d; try { d = await api.get('/api/ranked'); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return () => {}; }
    let mode = MODES.some((m) => m[0] === ctx.params[0]) ? ctx.params[0] : 'royale'; const boardEl = h('div'); const tabsHost = h('div');
    const card = ([id, name, em]) => { const r = d.modes[id]; return h('div.rk-card' + (mode === id ? '.on' : ''), { style: { '--rc': r.c }, onClick: () => { mode = id; paintBoard(); paintCards(); } },
      h('div.rk-top', h('span.rk-em', icon(em, 18)), h('b.grow', id === 'duel' ? t('Duels') : name), r.pos ? h('span.tiny.muted', '#' + r.pos) : null),
      h('div.rk-emblem', rankEmblem(r.tier, r.c, 52), h('div', h('div.rk-name', L(r.n)), h('div.tiny.muted', r.g ? t('{rp} RP · {g} games · {w} wins', { rp: r.rp, g: r.g, w: r.w }) : t('Unranked — play to get placed')))),
      h('div.rk-prog', h('i', { style: { width: Math.round(r.prog * 100) + '%' } })), h('div.tiny.muted', r.next ? t('{n} RP to the next rank', { n: r.next - r.rp }) : t('Top rank')),
      h('button.btn.primary.block', { onClick: (e) => { e.stopPropagation(); ctx.go('arena/' + id, { ranked: 1 }); } }, icon('play', 14), t('Play ranked'))); };
    const cardsEl = h('div.rk-cards');
    const paintCards = () => mount(cardsEl, MODES.map(card));
    async function paintBoard() {
      mount(tabsHost, tabsEl(MODES.map(([id, n, em]) => [id, id === 'duel' ? t('Duels') : n, em]), mode, (v) => { mode = v; paintBoard(); paintCards(); }));
      mount(boardEl, loading()); let b; try { b = await api.get('/api/ranked/board?mode=' + mode); } catch (e) { mount(boardEl, emptyState('alert', e.message)); return; }
      mount(boardEl, b.top.length ? h('table.rk-table', h('tr', h('th', '#'), h('th', t('Player')), h('th', t('Rank')), h('th', 'RP'), h('th', t('Games')), h('th', t('Wins'))),
        b.top.map((r) => h('tr' + (r.pos <= 3 ? '.podium' : ''), h('td', r.pos <= 3 ? h('span.rk-medal.m' + r.pos, String(r.pos)) : r.pos), h('td', h('a.row', { href: '#/profile/' + encodeURIComponent(r.user.username), style: 'gap:8px' }, avatarEl(r.user, { size: 26 }), nameEl(r.user))), h('td', rankPill(r)), h('td', h('b', r.rp)), h('td', r.g), h('td', r.w))))
        : emptyState('trophy', t('No ranked players yet'), t('Be the first one on the board.')));
    }
    const tierRow = h('div.rk-tiers', d.tiers.map((tr, i) => h('div.rk-tier', { style: { '--rc': tr.c } }, rankEmblem(i, tr.c, 34), h('b', L(tr.n)), h('span.tiny.muted', i < 5 ? `${i * 300}+ RP` : i === 5 ? '1500+ RP' : i === 6 ? '1900+ RP' : t('2200+ RP and top 100')), h('span.tiny.coin', fmt.coins(tr.coins)))));
    mount(inner,
      h('div.page-title', h('div', h('h2', t('Competitive')), h('p', t('Ranked queues with rank points, seasons and rewards. Leaving a ranked match counts as a loss.'))),
        h('div.row', h('span.pill', icon('flag', 12), ' ', t('Season {n}', { n: d.season.n }), ' · ', t('ends in {d}', { d: days(d.season.left) })), d.shield ? h('span.pill', icon('shield', 12), ' ×' + d.shield) : null)),
      cardsEl,
      h('div.card.rk-duel', h('div.grow', h('b', icon('swords', 15), ' ', t('Challenge a friend')), h('div.small.muted', t('A private 1 vs 1 duel. You can both bet coins: the winner takes 95% of the pot.'))),
        h('button.btn', { onClick: () => challenge() }, icon('send', 14), t('Challenge'))),
      h('h3', t('Leaderboard')), tabsHost, boardEl,
      h('h3', t('Ranks and season rewards')), tierRow,
      h('p.tiny.muted', t('At the end of the season (with at least 3 ranked games) you get coins for the highest rank you reached; Gold and above also earn exclusive items. Rank points are then halved for the new season.')),
      d.hist.length ? [h('h3', t('Recent ranked matches')), h('div.rk-hist', d.hist.map((x) => h('div.rk-h' + (x.d > 0 ? '.up' : x.d < 0 ? '.down' : ''), icon(MODES.find((m) => m[0] === x.m)[2], 15), h('span.grow', x.p ? t('Place #{n}', { n: x.p }) : x.won === null ? '—' : x.won ? t('Victory') : t('Defeat')), h('b', (x.d > 0 ? '+' : '') + x.d + ' RP'), h('span.tiny.muted', fmt.dt(x.t)))))] : null);
    paintCards(); paintBoard();
    async function challenge() {
      const to = await promptBox(t('Challenge a friend'), { label: t('Username'), placeholder: '@username' }); if (!to) return;
      const bet = await promptBox(t('Bet (optional)'), { label: t('Coins each player puts in (0 = no bet)'), value: '0', type: 'number' }); if (bet === null) return;
      try { const r = await api.post('/api/arena/duel/challenge', { to, bet: Number(bet) || 0 }); toast(t('Challenge sent to @{u}. It expires in 2 minutes.', { u: r.to.username }), 'good', 6000); } catch (e) { toastErr(e); }
    }
    return () => {};
  },
};
