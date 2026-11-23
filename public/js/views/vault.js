// Nebulix 13.1 — Nebula Vault, the game store of Nebulix: a desktop-store layout (store bar, featured carousel with
// screenshots, special offers, browse by tag, tabs of lists), a full page per game (media carousel, purchase box,
// review summary, details) and your library. Creators sell their Hub games for coins and keep 85 %.
// Routes: #/vault · #/vault/app/<id> · #/vault/library · #/vault/wishlist · #/vault/sell
import { h, mount, fmt, debounce } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { loading, emptyState, toast, toastErr, busy, modal, confetti, confirmBox } from '../ui.js';
import { sfx } from '../sfx.js';

// a cover for every game: its own thumbnail, or key art drawn here from its title and tags (always the same for a game)
const seedOf = (id) => [...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const covers = new Map();
export function coverOf(it) {
  if (it.thumb) return it.thumb; if (covers.has(it.id)) return covers.get(it.id);
  let x = seedOf(it.id); const R = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d'); const hue = Math.floor(R() * 360); const hue2 = (hue + 40 + R() * 80) % 360;
  const bg = g.createLinearGradient(0, 0, 640, 360); bg.addColorStop(0, `hsl(${hue},70%,18%)`); bg.addColorStop(1, `hsl(${hue2},70%,32%)`); g.fillStyle = bg; g.fillRect(0, 0, 640, 360);
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,255,255,${R() * 0.7})`; g.fillRect(R() * 640, R() * 360, 1.5, 1.5); }
  const kind = Math.floor(R() * 3);
  if (kind === 0) { const px = 420 + R() * 120, py = 120 + R() * 80, r = 70 + R() * 60; const pg = g.createRadialGradient(px - r / 3, py - r / 3, 5, px, py, r); pg.addColorStop(0, `hsl(${hue2},80%,70%)`); pg.addColorStop(1, `hsl(${hue2},70%,25%)`); g.fillStyle = pg; g.beginPath(); g.arc(px, py, r, 0, 7); g.fill(); g.strokeStyle = `hsla(${hue},80%,80%,.5)`; g.lineWidth = 4; g.beginPath(); g.ellipse(px, py, r * 1.6, r * 0.35, -0.3, 0, 7); g.stroke(); }
  else if (kind === 1) { g.strokeStyle = `hsla(${hue2},90%,65%,.45)`; g.lineWidth = 2; for (let i = 0; i <= 16; i++) { g.beginPath(); g.moveTo(320, 200); g.lineTo(i * 40, 360); g.stroke(); } for (let i = 0; i < 6; i++) { const y = 210 + i * i * 5; g.beginPath(); g.moveTo(0, y); g.lineTo(640, y); g.stroke(); } const sg = g.createLinearGradient(0, 60, 0, 200); sg.addColorStop(0, `hsl(${hue2},90%,65%)`); sg.addColorStop(1, `hsl(${hue},90%,45%)`); g.fillStyle = sg; g.beginPath(); g.arc(320, 200, 90, Math.PI, 0); g.fill(); }
  else { for (let i = 0; i < 7; i++) { g.fillStyle = `hsla(${(hue + i * 25) % 360},70%,${30 + i * 6}%,.9)`; g.beginPath(); g.moveTo(0, 360); let y = 200 + i * 22; for (let xx = 0; xx <= 640; xx += 40) { y += (R() - 0.5) * 40; g.lineTo(xx, Math.max(120, y)); } g.lineTo(640, 360); g.fill(); } }
  const vg = g.createLinearGradient(0, 200, 0, 360); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.75)'); g.fillStyle = vg; g.fillRect(0, 0, 640, 360);
  const title = String(it.title || '').toUpperCase().slice(0, 28); let fs = 64; g.font = `900 italic ${fs}px system-ui, sans-serif`; while (g.measureText(title).width > 580 && fs > 26) { fs -= 4; g.font = `900 italic ${fs}px system-ui, sans-serif`; }
  g.fillStyle = '#000a'; g.fillText(title, 32, 322); g.fillStyle = '#fff'; g.fillText(title, 28, 318);
  g.font = '600 16px system-ui, sans-serif'; g.fillStyle = `hsl(${hue2},90%,75%)`; g.fillText((it.tags || []).slice(0, 3).join(' · ').toUpperCase(), 30, 345);
  const url = c.toDataURL('image/jpeg', 0.85); covers.set(it.id, url); return url;
}
const shotsOf = (it) => [coverOf(it)].concat(it.shots || []).slice(0, 8);
// review summary label from the star rating
export function reviewLabel(r) {
  if (!r || !r.n) return { l: t('No reviews yet'), c: 'none' };
  const p = (r.avg - 1) / 4; const big = r.n >= 10;
  if (p >= 0.9) return { l: big ? t('Overwhelmingly positive') : t('Very positive'), c: 'pos' }; if (p >= 0.75) return { l: t('Very positive'), c: 'pos' }; if (p >= 0.6) return { l: t('Mostly positive'), c: 'pos' };
  if (p >= 0.4) return { l: t('Mixed'), c: 'mix' }; if (p >= 0.25) return { l: t('Mostly negative'), c: 'neg' }; return { l: t('Negative'), c: 'neg' };
}
export function priceTag(s) {
  if (!s) return null; if (s.owned) return h('span.vt-price.own', icon('check', 13), ' ' + t('In library'));
  if (!s.price) return h('span.vt-price.free', t('Free to play'));
  return h('span.vt-price' + (s.disc ? '.disc' : ''), s.disc ? [h('span.vt-disc', '-' + s.disc + '%'), h('span.vt-pp', h('s', fmt.coins(s.price)), h('b', fmt.coins(s.eff)))] : h('b.vt-plain', fmt.coins(s.eff)));
}
export async function buyGame(it, after) {
  const s = it.sale; if (!s || s.owned) return;
  const ok = s.eff ? await confirmBox(t('Buy “{n}” for {c} coins? It stays in your library forever (refund possible for 30 minutes).', { n: it.title, c: fmt.coins(s.eff) }), { ok: t('Buy') }) : true; if (!ok) return;
  try { const r = await api.post(`/api/vault/${it.id}/buy`); patchMe({ coins: r.coins }); it.sale = r.sale; sfx.coin(); if (s.eff) confetti(); toast(t('“{n}” is in your library!', { n: it.title }), 'good'); if (after) after(); } catch (e) { toastErr(e); }
}

export default {
  title: () => 'Nebula Vault', full: true,
  async mount(root, ctx) {
    let tab = ['library', 'sell', 'wishlist', 'app'].includes(ctx.params[0]) ? ctx.params[0] : 'store'; let appId = tab === 'app' ? ctx.params[1] : null; let q = '', tag = '', list = 'new';
    let timer = 0; const body = h('div.vt-body'); const coinEl = h('span.coin', fmt.coins(S.me.coins));
    const search = h('input.vt-search', { placeholder: t('Search the store'), onKeydown: (e) => { if (e.key === 'Enter') { q = e.target.value.trim(); tab = 'store'; open(); } } });
    const nav = h('nav.vt-nav'); mount(root, h('div.vt', h('header.vt-bar', h('div.vt-brand', h('span.vt-logo', icon('layers', 18)), h('b', 'NEBULA'), h('span', 'VAULT')), nav, h('span.grow'), h('div.vt-searchw', icon('search', 15), search), coinEl), body));
    const paintNav = () => mount(nav, [['store', t('Store')], ['library', t('Library')], ['wishlist', t('Wishlist')], ['sell', t('Sell your games')]].map(([k, l]) => h('button' + (tab === k ? '.on' : ''), { onClick: () => { tab = k; q = ''; tag = ''; search.value = ''; open(); } }, l)));
    const capsule = (it) => h('div.vt-cap', { onClick: () => openApp(it.id) }, h('div.vt-capimg', h('img', { src: coverOf(it), alt: '', loading: 'lazy' })), h('div.vt-capb', h('b', it.title), h('div.vt-captags', (it.tags || []).slice(0, 3).map((x) => h('span', x))), h('div.row', h('span.vt-rv.' + reviewLabel(it.rating).c, reviewLabel(it.rating).l), h('span.grow'), priceTag(it.sale))));
    const rowItem = (it) => h('div.vt-li', { onClick: () => openApp(it.id) }, h('img', { src: coverOf(it), alt: '', loading: 'lazy' }), h('div.grow', h('b', it.title), h('div.tiny.muted', (it.tags || []).slice(0, 4).join(', ')), h('span.vt-rv.' + reviewLabel(it.rating).c, reviewLabel(it.rating).l)), priceTag(it.sale));
    const openApp = (id) => { tab = 'app'; appId = id; open(); };

    async function open() {
      clearInterval(timer); paintNav(); coinEl.textContent = fmt.coins(S.me.coins); mount(body, loading()); body.scrollTop = 0;
      try { if (tab === 'app') await appPage(appId); else if (tab === 'store') await store(); else if (tab === 'sell') await sell(); else await library(tab === 'wishlist'); }
      catch (e) { mount(body, emptyState('alert', t('Could not load this'), e.message)); }
    }
    // ---------- store home ----------
    async function store() {
      const d = await api.get('/api/vault' + (q || tag ? '?' + new URLSearchParams({ q, tag }) : ''));
      if (d.results) { mount(body, h('div.vt-wrap', h('h2.vt-h', q ? t('Results for “{q}”', { q }) : tag), d.results.length ? h('div.vt-list', d.results.map(rowItem)) : emptyState('search', t('No games found')))); return; }
      if (!d.counts.games) { mount(body, h('div.vt-wrap', emptyState('gamepad', t('No games yet'), t('Upload the first one in Nebulix Hub.'), h('button.btn.primary', { onClick: () => ctx.go('hub') }, t('Open Hub'))))); return; }
      // featured carousel
      const feat = d.featured.length ? d.featured : d.fresh.slice(0, 5); let fi = 0; const featEl = h('div.vt-feat');
      const paintFeat = () => { const it = feat[fi]; if (!it) return; const shots = shotsOf(it); let si = 0; const big = h('img.vt-fbig', { src: shots[0], alt: '' });
        mount(featEl, h('button.vt-farr.l', { onClick: () => { fi = (fi - 1 + feat.length) % feat.length; paintFeat(); } }, icon('back', 20)),
          h('div.vt-fcard', { onClick: () => openApp(it.id) }, h('div.vt-fmedia', big), h('div.vt-finfo', h('h2', it.title), h('div.vt-fshots', shots.slice(1, 5).map((src) => h('img', { src, alt: '', onMouseenter: () => { big.src = src; }, onMouseleave: () => { big.src = shots[si]; } }))),
            h('div.vt-fwhy', h('b', t('Now available')), h('span.vt-captags', (it.tags || []).slice(0, 4).map((x) => h('span', x)))), h('div.row', h('span.vt-rv.' + reviewLabel(it.rating).c, reviewLabel(it.rating).l), h('span.grow'), priceTag(it.sale)))),
          h('button.vt-farr.r', { onClick: () => { fi = (fi + 1) % feat.length; paintFeat(); } }, icon('fwd', 20)), h('div.vt-dots', feat.map((_, i) => h('i' + (i === fi ? '.on' : ''), { onClick: () => { fi = i; paintFeat(); } })))); };
      paintFeat(); timer = setInterval(() => { if (!featEl.isConnected) return clearInterval(timer); if (featEl.matches(':hover')) return; fi = (fi + 1) % feat.length; paintFeat(); }, 7000);
      const listEl = h('div'); const lists = { new: [t('New and trending'), d.fresh], top: [t('Top sellers'), d.top], rated: [t('Best rated'), d.rated], free: [t('Free to play'), d.free] };
      const paintList = () => mount(listEl, h('div.vt-tabs', Object.entries(lists).map(([k, [l]]) => h('button' + (list === k ? '.on' : ''), { onClick: () => { list = k; paintList(); } }, l))), lists[list][1].length ? h('div.vt-list', lists[list][1].map(rowItem)) : h('p.small.muted', { style: 'padding:16px' }, t('Nothing here yet.')));
      paintList();
      mount(body, h('div.vt-wrap', h('h3.vt-h', t('Featured & recommended')), featEl,
        d.deals.length ? [h('h3.vt-h', t('Special offers')), h('div.vt-caps', d.deals.slice(0, 8).map(capsule))] : null,
        d.tags.length ? [h('h3.vt-h', t('Browse by tag')), h('div.vt-tagtiles', d.tags.slice(0, 12).map((x, i) => h('button.vt-tagtile', { style: { '--h': (i * 47) % 360 }, onClick: () => { tag = x.t; open(); } }, h('b', x.t), h('span', t('{n} games', { n: x.n })))))] : null,
        listEl, h('p.tiny.muted', { style: 'margin-top:18px' }, t('{g} games · {p} for sale · {d} on sale now', { g: d.counts.games, p: d.counts.paid, d: d.counts.deals }))));
    }
    // ---------- game page ----------
    async function appPage(id) {
      const [d, rv] = await Promise.all([api.get('/api/hub/' + encodeURIComponent(id)), api.get(`/api/hub/${encodeURIComponent(id)}/reviews?sort=helpful`).catch(() => null)]);
      const it = d.item; const shots = shotsOf(it); let si = 0; const big = h('div.vt-mbig');
      const paintBig = () => mount(big, h('img', { src: shots[si], alt: '' })); paintBig();
      const strip = h('div.vt-mstrip', shots.map((src, i) => h('img' + (i === 0 ? '.on' : ''), { src, alt: '', onClick: (e) => { si = i; paintBig(); strip.querySelectorAll('img').forEach((x) => x.classList.remove('on')); e.target.classList.add('on'); } })));
      const rl = reviewLabel(it.rating); const s = it.sale || {};
      const buyBox = h('div.vt-buy', h('h3', s.owned ? t('“{n}” is in your library', { n: it.title }) : s.price ? t('Buy {n}', { n: it.title }) : t('Play {n}', { n: it.title })),
        h('div.vt-buyrow', s.disc ? h('span.vt-buydisc', '-' + s.disc + '%') : null, h('div.vt-buyprice', s.owned ? null : s.price ? [s.disc ? h('s', fmt.coins(s.price)) : null, h('b', fmt.coins(s.eff) + ' ' + t('coins'))] : h('b', t('Free to play'))),
          s.owned || !s.price ? h('button.btn.primary.vt-cta', { onClick: () => ctx.go('hub', it.id) }, icon('play', 15), t('Play now')) : h('button.btn.primary.vt-cta', { onClick: () => buyGame(it, () => open()) }, icon('cart', 15), t('Add to library'))),
        s.disc && s.until ? h('div.tiny.muted', t('Offer ends {d}', { d: fmt.date(s.until) })) : null);
      const wish = h('button.btn', { onClick: () => api.post(`/api/vault/${it.id}/wish`).then((r) => { s.wished = r.wished; mount(wish, icon('heart', 14), ' ', r.wished ? t('On your wishlist') : t('Add to wishlist')); }).catch(toastErr) }, icon('heart', 14), ' ', s.wished ? t('On your wishlist') : t('Add to wishlist'));
      const reviews = rv && rv.items.length ? rv.items.slice(0, 8).map((r) => h('div.vt-rev', h('div.vt-revh.' + (r.stars >= 3 ? 'pos' : 'neg'), icon(r.stars >= 3 ? 'thumbup' : 'thumbdown', 20), h('div', h('b', r.stars >= 3 ? t('Recommended') : t('Not recommended')), h('div.tiny.muted', '@' + (r.owner ? r.owner.username : '?') + ' · ' + fmt.date(r.created)))), h('p', r.text || '—'), h('div.tiny.muted', t('{n} people found this helpful', { n: r.helpful })))) : [h('p.small.muted', t('No reviews yet. Play it and be the first.'))];
      mount(body, h('div.vt-wrap.vt-app',
        h('div.vt-crumb', h('a', { onClick: () => { tab = 'store'; open(); } }, t('All games')), ' › ', (it.tags || [])[0] ? h('a', { onClick: () => { tab = 'store'; tag = it.tags[0]; open(); } }, it.tags[0]) : null, ' › ', it.title),
        h('h1.vt-apptitle', it.title),
        h('div.vt-apptop', h('div.vt-media', big, strip), h('aside.vt-side', h('img.vt-sidecap', { src: coverOf(it), alt: '' }), h('p.small', (it.desc || '').split('\n')[0].slice(0, 280) || t('No description.')),
          h('div.vt-kv', h('span', t('All reviews')), h('span.vt-rv.' + rl.c, rl.l, it.rating ? ` (${it.rating.n})` : '')),
          h('div.vt-kv', h('span', t('Release date')), h('b', fmt.date(it.created))), h('div.vt-kv', h('span', t('Developer')), h('a', { href: '#/profile/' + encodeURIComponent(it.owner ? it.owner.username : '') }, it.owner ? it.owner.displayName : '?')),
          h('div.vt-kv', h('span', t('Version')), h('b', 'v' + it.version)), h('div.vt-captags', (it.tags || []).map((x) => h('span', { onClick: () => { tab = 'store'; tag = x; open(); } }, x))))),
        h('div.vt-appbody', h('div.vt-main', buyBox, h('div.row', { style: 'gap:8px;margin:10px 0' }, s.owned || !s.price ? null : wish, h('button.btn', { onClick: () => ctx.go('hub', it.id) }, icon('external', 14), t('Hub page'))),
          h('h3.vt-h', t('About this game')), h('div.vt-desc', it.desc || t('No description.')),
          h('h3.vt-h', t('Player reviews')), rv && rv.rating ? h('div.vt-revsum', h('span.vt-rv.' + rl.c, rl.l), h('span.tiny.muted', ' ' + t('{n} reviews · {a} out of 5', { n: rv.rating.n, a: rv.rating.avg }))) : null, reviews),
          h('aside.vt-side2', h('div.vt-box', h('b', t('Details')), h('div.vt-kv', h('span', t('Size')), h('b', fmt.bytes(it.size || 0))), h('div.vt-kv', h('span', t('Files')), h('b', String(it.files))), h('div.vt-kv', h('span', t('Players')), h('b', fmt.num(it.views))), h('div.vt-kv', h('span', t('Sales')), h('b', fmt.num(s.sales || 0)))),
            h('div.vt-box', h('b', t('More like this')), (d.more || []).filter((x) => x.kind === 'game' || x.kind === 'app').slice(0, 5).map((x) => h('div.vt-mini', { onClick: () => openApp(x.id) }, h('img', { src: coverOf(x), alt: '' }), h('span.small', x.title))))))));
    }
    // ---------- library / wishlist ----------
    async function library(wishOnly) {
      const d = await api.get('/api/vault/library');
      const games = wishOnly ? d.wish : d.owned.concat(d.made.filter((m) => !d.owned.some((o) => o.id === m.id)));
      let sel = games[0] || null; const detail = h('div.vt-libmain');
      const paint = () => { if (!sel) { mount(detail, emptyState(wishOnly ? 'heart' : 'layers', wishOnly ? t('Your wishlist is empty') : t('Your library is empty'), wishOnly ? t('Add games to your wishlist and you will hear when they go on sale.') : t('Games you buy show up here.'))); return; }
        mount(detail, h('div.vt-libhero', { style: { backgroundImage: `url("${coverOf(sel)}")` } }, h('div.vt-libgrad'), h('div.vt-libinfo', h('h1', sel.title), h('div.row', { style: 'gap:8px' }, wishOnly ? h('button.btn.primary', { onClick: () => openApp(sel.id) }, t('View in store')) : h('button.btn.primary.vt-cta', { onClick: () => ctx.go('hub', sel.id) }, icon('play', 16), t('Play')), sel.refundable ? h('button.btn', { onClick: (e) => busy(e.currentTarget, async () => { const r = await api.post(`/api/vault/${sel.id}/refund`); patchMe({ coins: r.coins }); toast(t('Refunded'), 'good'); open(); }) }, t('Refund')) : null, h('button.btn.ghost', { onClick: () => openApp(sel.id) }, t('Store page'))))),
          h('div.vt-libmeta', h('div', h('span.tiny.muted', t('Developer')), h('b', sel.owner ? sel.owner.displayName : '?')), sel.bought ? h('div', h('span.tiny.muted', t('Added')), h('b', fmt.date(sel.bought))) : null, h('div', h('span.tiny.muted', t('Reviews')), h('b', reviewLabel(sel.rating).l)), h('div', h('span.tiny.muted', t('Version')), h('b', 'v' + sel.version))), h('p.small.vt-desc', sel.desc || '')); };
      mount(body, h('div.vt-lib', h('aside.vt-libside', h('div.tiny.muted', { style: 'padding:8px 10px' }, (wishOnly ? t('Wishlist') : t('Games')) + ' (' + games.length + ')'), games.map((g) => h('button.vt-libitem' + (sel && sel.id === g.id ? '.on' : ''), { onClick: (e) => { sel = g; paint(); e.currentTarget.parentNode.querySelectorAll('.vt-libitem').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); } }, h('img', { src: coverOf(g), alt: '' }), h('span.ellipsis', g.title)))), detail));
      paint();
    }
    // ---------- sell ----------
    async function sell() {
      const d = await api.get('/api/vault/library');
      mount(body, h('div.vt-wrap', h('div.vt-sellh', h('div.grow', h('h2', t('Sell your games')), h('p.small.muted', t('Upload a game or app in Nebulix Hub, then set a price here. You get 85% of every sale; buyers can play it, nobody else. Paid games cannot be downloaded or remixed.'))), h('div.vt-earn', h('div.tiny.muted', t('Earned')), h('b.coin', fmt.coins(d.earned)), h('div.tiny.muted', t('{n} sales', { n: d.sold })))),
        d.made.length ? h('div.vt-list', d.made.map((it) => h('div.vt-li', h('img', { src: coverOf(it), alt: '' }), h('div.grow', h('b', it.title), h('div.tiny.muted', it.sale.price ? t('{p} coins', { p: fmt.coins(it.sale.price) }) + (it.sale.disc ? ` · -${it.sale.disc}%` : '') : t('Free'), ' · ', t('{n} sales', { n: it.sale.sales }), ' · ', fmt.coins(it.revenue || 0) + ' ' + t('earned'))), h('button.btn.sm', { onClick: () => saleEditor(it) }, icon('tag', 14), t('Price')))))
          : emptyState('gamepad', t('You have no games yet'), t('Upload one in Nebulix Hub.'), h('button.btn.primary', { onClick: () => ctx.go('hub') }, t('Open Hub')))));
    }
    async function saleEditor(it) {
      const price = h('input.input', { type: 'number', min: 0, max: 1000000, value: it.sale.price || 0 }); const disc = h('input.input', { type: 'number', min: 0, max: 90, value: it.sale.disc || 0 }); const days = h('input.input', { type: 'number', min: 1, max: 30, value: 7 });
      const ok = await modal({ title: t('Price of “{n}”', { n: it.title }), cls: 'narrow', body: h('div.col', h('label.small', t('Price in coins (0 = free)')), price, h('label.small', t('Discount %')), disc, h('label.small', t('Discount lasts (days)')), days, h('p.tiny.muted', t('People with the game on their wishlist are told when a discount starts.'))), actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', value: true }] });
      if (ok !== true) return; try { await api.post(`/api/vault/${it.id}/sale`, { price: Number(price.value) || 0, disc: Number(disc.value) || 0, days: Number(days.value) || 7 }); toast(t('Saved'), 'good'); open(); } catch (e) { toastErr(e); }
    }
    void debounce;
    open();
    return () => clearInterval(timer);
  },
};
