// Command centre for Home: what is happening right now in Nebulix (World Boss, the hourly tournament, your league,
// your clan, community worlds) as live tiles, refreshed every 20 s and on boss events. Also offers the new design once.
import { h, mount, fmt, ls } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { bus } from '../state.js';
import { feedItem } from './feed.js';

const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const hh = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60; return hh ? `${hh}h ${m}m` : `${m}:${String(ss).padStart(2, '0')}`; };

export function commandCentre({ designNow, setDesign } = {}) {
  const box = h('section.cc'); let d = null; let feed = []; let timer = 0; let tick = 0; const offs = [];
  const tile = (o) => h('a.cc-tile' + (o.live ? '.live' : ''), { href: o.href, style: { '--c': o.c } }, o.k ? h('span.cc-k', o.k) : null, h('span.cc-ic', o.ic), h('b', o.title), h('span.cc-sub', o.sub), o.bar !== undefined ? h('div.cc-bar', h('i', { style: { width: Math.max(2, Math.min(100, o.bar)) + '%' } })) : null);
  function paint() {
    if (!d) return; const tiles = []; const now = Date.now();
    const B = d.boss;
    tiles.push(B.live ? tile({ href: '#/boss', live: true, k: t('Live'), ic: B.boss.icon, c: B.boss.color, title: pick2(B.boss.n), sub: t('{n} fighters', { n: B.fighters }) + ' · ' + clock(B.end - now), bar: (B.hp / B.max) * 100 })
      : tile({ href: '#/boss', k: t('Next'), ic: B.boss.icon, c: B.boss.color, title: t('World Boss'), sub: pick2(B.boss.n) + ' · ' + t('in {t}', { t: clock(B.next - now) }) }));
    if (d.tour) tiles.push(tile({ href: '#/tournaments', live: true, k: t('Live'), ic: '🏆', c: '#f59e0b', title: d.tour.gname, sub: t('Prize pool') + ' ' + fmt.coins(d.tour.pool) + ' · ' + clock(d.tour.end - now) + (d.tour.myRank ? ' · #' + d.tour.myRank : '') }));
    tiles.push(tile({ href: '#/leagues', ic: d.league.icon, c: d.league.color, k: d.league.rank ? '#' + d.league.rank : null, title: t('League') + ' ' + pick2(d.league.n), sub: t('{n} XP this week', { n: fmt.num(d.league.xp) }) + ' · ' + t('ends in {t}', { t: clock(d.league.ends - now) }) }));
    tiles.push(d.clan ? tile({ href: '#/clans', ic: d.clan.emoji, c: d.clan.color, k: d.clan.rank ? '#' + d.clan.rank : null, title: '[' + d.clan.tag + '] ' + d.clan.name, sub: t('{n} pts this week', { n: fmt.compact(d.clan.week) }) })
      : tile({ href: '#/clans', ic: '🛡️', c: '#8b5cf6', title: t('Join a clan'), sub: t('Shared bank and a weekly Clan War') }));
    tiles.push(tile({ href: '#/worlds', ic: '🌍', c: '#22d3ee', k: d.worldsOnline ? t('{n} online', { n: d.worldsOnline }) : null, title: t('Nebula Worlds'), sub: d.worlds.length ? t('Popular: {w}', { w: d.worlds[0].name }) : t('Build your own 3D world') }));
    const offer = designNow && designNow() !== 'seven' && !ls('n7.offer') ? h('div.n7-offer', h('span', { style: 'font-size:1.6rem' }, '✨'), h('div.grow', h('b', t('Try the new Nebulix 7 design')), h('div.small.muted', t('Floating glass panels, gradient buttons and smooth motion. Works with every colour theme.'))),
      h('button.btn.primary', { onClick: () => { setDesign('seven'); ls('n7.offer', 1); paint(); } }, t('Turn it on')), h('button.btn.ghost', { onClick: () => { ls('n7.offer', 1); paint(); } }, t('No thanks'))) : null;
    mount(box, offer, h('div.row', { style: 'align-items:center;gap:8px' }, h('h3', { style: 'margin:0' }, '⚡ ' + t('Right now in Nebulix')), h('span.pill', '● ' + t('{n} online', { n: d.online }))), h('div.cc-live', tiles),
      h('div.fd-card', h('div.row', { style: 'align-items:center;gap:8px;margin-bottom:6px' }, h('b.grow', h('span.fd-dot'), ' ' + t('Nebulix Live')), h('a.small', { href: '#/live' }, t('See all'))), feed.length ? h('div.fd-list.compact', feed.slice(0, 5).map((e) => feedItem(e))) : h('p.small.muted', { style: 'margin:0' }, t('Big moments on Nebulix appear here as they happen.'))));
  }
  const load = () => api.get('/api/live', { quiet: true }).then((x) => { d = x; paint(); }).catch(() => {});
  api.get('/api/feed?n=5', { quiet: true }).then((x) => { feed = x.items; paint(); }).catch(() => {});
  load(); timer = setInterval(() => { tick++; if (tick % 20 === 0) load(); else paint(); }, 1000);
  offs.push(bus.on('ws:feed', (m) => { feed.unshift(m.e); feed = feed.slice(0, 5); paint(); }));
  offs.push(bus.on('ws:boss', (m) => { if (m.ev === 'hp' && d && d.boss.live) { d.boss.hp = m.hp; d.boss.max = m.max; d.boss.fighters = m.fighters; } else load(); }));
  box.stop = () => { clearInterval(timer); offs.forEach((f) => f()); };
  return box;
}
