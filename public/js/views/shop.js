// Nebulix 13 — Shop (Tienda), Locker (Taquilla) and the live economy.  #/shop · #/shop/locker · #/shop/economy
// The Shop rotates every day at 00:00 (Madrid): featured sets, six daily items with a flash deal, limited exclusives
// and utilities. Prices follow the economy index computed by the server every hour (server/market.js).
import { h, mount, fmt } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, modal, loading, emptyState, busy, confetti, promptBox, tabsEl } from '../ui.js';
import { sfx } from '../sfx.js';
import { load3d } from '../avatar3d.js';
import { buildHero, animateHero } from '../worlds-engine.js';
import { outfitAv, dressHero, poseEmote, resetEmote, EMOTE_LEN, wrapMaterial } from '../locker3d.js';
import { itemImage } from '../item-render.js';

const L = pick2;
export const RCOL = { common: '#94a3b8', rare: '#38bdf8', epic: '#c084fc', legendary: '#fbbf24', mythic: '#f43f5e' };
const RNAME = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythic: 'Mythic' };
export const CATN = { outfit: ['Outfit', 'user'], backpack: ['Backpack', 'bag'], pickaxe: ['Pickaxe', 'wrench'], glider: ['Glider', 'send'], wrap: ['Wrap', 'palette'], trail: ['Trail', 'spark'], emote: ['Emote', 'smile'], elim: ['Elimination', 'zap'] };
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const colsOf = (it) => { const s = it.spec || {}; return [s.topHex || s.c || '#6366f1', s.pantsHex || s.c2 || '#0ea5e9']; };
export const thumb = (it, big) => {
  const [a, b] = colsOf(it); const img = h('img.sh-img', { alt: '', loading: 'lazy' }); const ic = h('span.sh-ic', icon((CATN[it.cat] || ['', 'gift'])[1], big ? 56 : 34));
  const el = h('div.sh-thumb' + (big ? '.big' : ''), { style: { '--a': a, '--b': b, '--r': RCOL[it.rarity] || '#94a3b8' } }, ic, img);
  if (CATN[it.cat]) itemImage(it).then((url) => { if (url) { img.src = url; img.classList.add('on'); ic.remove(); } });
  return el;
};

export default {
  title: () => t('Shop'),
  async mount(root, ctx) {
    const tab0 = ['locker', 'economy', 'trade'].includes(ctx.params[0]) ? ctx.params[0] : 'shop';
    const wrap = h('div.inner.sh'); mount(root, wrap);
    let tab = tab0; let cleanup = null; let timer = 0;
    const coinEl = h('span.coin', (S.me.infinite ? '∞' : fmt.coins(S.me.coins))); const tabsHost = h('div'); const body = h('div');
    mount(wrap, h('div.page-title', h('div', h('h2', t('Shop & Locker')), h('p', t('New items every day at midnight. Exclusives come in limited numbers.'))), h('div.row', coinEl)), tabsHost, body);
    function paintTabs() { mount(tabsHost, tabsEl([['shop', t('Shop'), 'bag'], ['trade', t('Marketplace'), 'tag'], ['locker', t('Locker'), 'user'], ['economy', t('Economy'), 'chart']], tab, (v) => { tab = v; open(); })); }
    async function open() { paintTabs(); if (cleanup) { try { cleanup(); } catch {} cleanup = null; } clearInterval(timer); mount(body, loading()); try { cleanup = tab === 'shop' ? await shopTab() : tab === 'trade' ? await tradeTab() : tab === 'locker' ? await lockerTab() : await econTab(); } catch (e) { mount(body, emptyState('alert', t('Could not load this'), e.message)); } }
    const setCoins = (c) => { if (c !== undefined) { patchMe({ coins: c }); coinEl.textContent = fmt.coins(c); } };

    // ---------------- shop ----------------
    async function shopTab() {
      let d = await api.get('/api/shop'); setCoins(d.coins); const t0 = Date.now();
      const resetEl = h('b'); timer = setInterval(() => { const left = d.resetIn - (Date.now() - t0); resetEl.textContent = clock(left); if (left <= 0) { clearInterval(timer); open(); } }, 1000); resetEl.textContent = clock(d.resetIn);
      const card = (it) => h('button.sh-card' + (it.owned ? '.owned' : '') + (it.excl ? '.excl' : ''), { style: { '--r': RCOL[it.rarity] }, onClick: () => detail(it) },
        thumb(it), it.deal ? h('span.sh-tag.deal', '-40%') : null, it.excl ? h('span.sh-tag.ex', t('Exclusive')) : null,
        h('div.sh-cb', h('b', L(it.n)), h('span.tiny', { style: { color: RCOL[it.rarity] } }, t(RNAME[it.rarity]) + ' · ' + t(CATN[it.cat][0])),
          it.excl ? h('div.sh-stock', h('i', { style: { width: (it.left / it.stock) * 100 + '%' } }), h('span.tiny', t('{n} left', { n: it.left }))) : null,
          h('div.sh-price', it.owned ? h('span.pill', icon('check', 12), ' ' + t('Owned')) : [it.deal ? h('s.tiny.muted', fmt.coins(it.full)) : null, h('span.coin', fmt.coins(it.price))])));
      const bundle = (b) => h('div.sh-bundle', { style: { '--a': b.c ? b.c[0] : '#6366f1', '--b': b.c ? b.c[1] : '#0ea5e9' } },
        h('div.sh-bh', h('div', h('span.sh-tag.ex', t('Featured')), h('h3', L(b.n)), h('p.tiny', t('{n} items · 25% off what you do not own', { n: b.items.length }))),
          b.missing ? h('button.btn.primary', { onClick: (e) => busy(e.currentTarget, async () => { const r = await api.post('/api/shop/buy', { id: b.id }); setCoins(r.coins); patchMe({ inv: r.inv }); sfx.coin(); confetti(); toast(t('Set unlocked!'), 'coin'); open(); }) }, h('s.tiny', { style: 'opacity:.7;margin-right:6px' }, fmt.coins(b.full)), h('span.coin', fmt.coins(b.price))) : h('span.pill', icon('check', 12), ' ' + t('Complete'))),
        h('div.sh-bgrid', d.featured.filter((x) => x.set === b.set).map(card)));
      const util = (u) => h('div.sh-util' + (u.on ? '.on' : ''), h('span.sh-uic', icon({ crate: 'crate', 'boost:arena': 'target', 'boost:xp2': 'bolt', shield: 'shield' }[u.id] || 'gift', 24)), h('div.grow', h('b', L(u.n)), h('div.tiny.muted', L(u.d)), u.extra !== null ? h('div.tiny', t('You have {n}', { n: u.extra })) : null),
        h('button.btn.sm' + (u.on ? '' : '.primary'), { onClick: (e) => busy(e.currentTarget, async () => { const r = await api.post('/api/shop/buy', { id: u.id }); setCoins(r.coins); if (r.got) { patchMe({ inv: r.inv }); sfx.coin(); confetti(); reveal(r.got); } else toast(t('Done!'), 'good'); open(); }) }, u.on ? t('Extend') : t('Buy'), ' · ', h('span.coin', fmt.coins(u.price))));
      mount(body,
        h('div.sh-bar', h('span', icon('clock', 14), ' ', t('New Shop in'), ' ', resetEl), h('span.sh-mood', { title: t('Prices follow the live economy') }, icon('chart', 14), ' ', t('Index'), ' ×', d.index.toFixed(2), ' · ', L(d.mood))),
        d.excl.length ? h('section', h('h3.sh-h', icon('star', 16), ' ', t('Exclusive today')), h('div.sh-grid.ex', d.excl.map(card))) : null,
        h('section', h('h3.sh-h', icon('layers', 16), ' ', t('Featured sets')), h('div.sh-bundles', d.bundles.map(bundle))),
        h('section', h('h3.sh-h', icon('calendar', 16), ' ', t('Daily')), h('div.sh-grid', d.daily.map(card))),
        h('section', h('h3.sh-h', icon('wrench', 16), ' ', t('Utilities')), h('div.sh-utils', d.util.map(util)), h('p.tiny.muted', t('Nothing here changes how strong you are in a match: weapons and loot are the same for everyone.'))));
      async function detail(it) {
        const stage = h('div.sh-stage'); let stop = null;
        const actions = [{ label: t('Close'), value: false }];
        if (!it.owned) actions.push({ label: t('Gift'), value: 'gift' }, { label: t('Buy') + ' · ' + fmt.coins(it.price), kind: 'primary', value: 'buy' });
        else actions.push({ label: t('Open Locker'), kind: 'primary', value: 'locker' });
        const p = modal({ title: L(it.n), cls: 'narrow', body: h('div.col', stage, h('div.row', h('span.pill', { style: { color: RCOL[it.rarity], borderColor: RCOL[it.rarity] } }, t(RNAME[it.rarity])), h('span.pill', t(CATN[it.cat][0])), it.excl ? h('span.pill', t('{n} left', { n: it.left })) : null), it.set ? h('p.tiny.muted', t('Part of a set — complete it for a matching look.')) : null) , actions });
        stop = await previewInto(stage, it).catch(() => null);
        const v = await p; if (stop) stop();
        if (v === 'buy') { try { const r = await api.post('/api/shop/buy', { id: it.id }); setCoins(r.coins); patchMe({ inv: r.inv }); sfx.coin(); confetti(); toast(t('You bought {n}!', { n: L(it.n) }), 'coin'); open(); } catch (e) { toastErr(e); } }
        else if (v === 'gift') { const to = await promptBox(t('Gift {n}', { n: L(it.n) }), { label: t('Username of your friend'), placeholder: '@username' }); if (to) { try { const r = await api.post('/api/shop/gift', { id: it.id, to }); setCoins(r.coins); toast(t('Gift sent to @{u}!', { u: r.to.username }), 'good'); sfx.coin(); } catch (e) { toastErr(e); } } }
        else if (v === 'locker') { tab = 'locker'; open(); }
      }
      function reveal(it) { modal({ title: t('From the crate…'), cls: 'narrow', body: h('div.col.sh-reveal', { style: { '--r': RCOL[it.rarity] } }, thumb(it, true), h('h3', L(it.n)), h('p', { style: { color: RCOL[it.rarity] } }, t(RNAME[it.rarity]) + ' · ' + t(CATN[it.cat][0]))), actions: [{ label: t('Nice!'), kind: 'primary', value: true }] }); }
      return () => clearInterval(timer);
    }

    // ---------------- locker ----------------
    async function lockerTab() {
      let d = await api.get('/api/locker'); const stage = h('div.lk-stage'); const slotsEl = h('div.lk-slots'); const listEl = h('div.lk-list'); let sel = 'outfit'; let stage3 = null;
      const by = (id) => d.items.find((x) => x.id === id);
      const SLOTS = ['outfit', 'backpack', 'pickaxe', 'glider', 'wrap', 'trail', 'elim', 'emotes'];
      mount(body, h('div.lk', h('div.lk-left', stage, h('div.lk-emotes', h('span.tiny.muted', t('Try an emote')), ...['wave'].concat((d.eq.emotes || []).map((id) => (by(id) || {}).spec && by(id).spec.k).filter(Boolean)).map((k) => h('button.btn.sm', { onClick: () => stage3 && stage3.emote(k) }, icon('smile', 13), ' ', k)), h('button.btn.sm.ghost', { onClick: () => stage3 && stage3.glide() }, icon('send', 13), ' ', t('Glider'))), h('p.tiny.muted', t('{n} of {t} items collected', { n: d.items.length, t: d.total }))), h('div.lk-right', slotsEl, listEl)));
      function lk() { const o = {}; for (const k of ['outfit', 'backpack', 'pickaxe', 'glider', 'wrap', 'trail', 'elim']) { const it = by(d.eq[k]); if (it) o[k] = Object.assign({ id: it.id }, it.spec); } o.emotes = (d.eq.emotes || []).map(by).filter(Boolean).map((it) => Object.assign({ id: it.id }, it.spec)); return o; }
      function paint() {
        mount(slotsEl, SLOTS.map((k) => { const cat = k === 'emotes' ? 'emote' : k; const cur = k === 'emotes' ? (d.eq.emotes || []).map(by).filter(Boolean) : [by(d.eq[k])].filter(Boolean);
          return h('button.lk-slot' + (sel === k ? '.on' : ''), { onClick: () => { sel = k; paint(); } }, cur[0] ? thumb(cur[0]) : h('div.sh-thumb.empty', h('span.sh-ic', icon(CATN[cat][1], 28))), h('div.tiny', t(k === 'emotes' ? 'Emotes' : CATN[cat][0])), h('div.tiny.muted', cur.length ? (k === 'emotes' ? cur.length + '/4' : L(cur[0].n)) : t('Default'))); }));
        const cat = sel === 'emotes' ? 'emote' : sel; const own = d.items.filter((x) => x.cat === cat);
        const isOn = (it) => (sel === 'emotes' ? (d.eq.emotes || []).includes(it.id) : d.eq[sel] === it.id);
        mount(listEl, h('div.row', h('b.grow', t(sel === 'emotes' ? 'Emotes' : CATN[cat][0])), sel !== 'emotes' && d.eq[sel] ? h('button.btn.sm.ghost', { onClick: () => equip(sel, null) }, t('Use default')) : null),
          own.length ? h('div.lk-grid', own.map((it) => h('button.lk-item' + (isOn(it) ? '.on' : ''), { style: { '--r': RCOL[it.rarity] }, onClick: () => { if (sel === 'emotes') { const cur = d.eq.emotes || []; const nx = cur.includes(it.id) ? cur.filter((x) => x !== it.id) : cur.concat([it.id]); if (nx.length > 4) return toast(t('Up to 4 emotes'), 'err'); equip('emotes', nx); } else equip(sel, isOn(it) ? null : it.id); } }, thumb(it), h('div.tiny', L(it.n)), it.excl ? h('span.sh-tag.ex', icon('star', 10)) : it.reward ? h('span.sh-tag', icon('trophy', 10)) : null)))
            : emptyState('bag', t('Nothing here yet'), t('Find these in the daily Shop or in supply crates.'), h('button.btn.primary', { onClick: () => { tab = 'shop'; open(); } }, t('Go to the Shop'))));
      }
      async function equip(slot, id) { try { d = await api.post('/api/locker/equip', { slot, id }); sfx.click(); paint(); if (stage3) stage3.set(lk()); } catch (e) { toastErr(e); } }
      paint();
      stage3 = await heroStage(stage, lk()).catch(() => null);
      return () => { if (stage3) stage3.stop(); };
    }

    // ---------------- marketplace (player to player) ----------------
    async function tradeTab() {
      const q = { cat: '', rarity: '', q: '', sort: 'popular', all: '' }; let view = 'browse';
      const head = h('div'); const out = h('div');
      mount(body, h('div.tr', head, out));
      const trendEl = (v) => (v === null || v === undefined ? h('span.tiny.muted', '—') : h('span.tiny' + (v > 0 ? '.tr-up' : v < 0 ? '.tr-down' : ''), (v > 0 ? '+' : '') + v + '%'));
      function paintHead(sum) {
        const sel = (k, opts) => h('select.input.sm', { onChange: (e) => { q[k] = e.target.value; load(); } }, opts.map(([v, l]) => h('option', { value: v, selected: q[k] === v }, l)));
        mount(head, h('div.tr-top', h('div.tr-stats', sum ? [h('div', h('b', fmt.num(sum.open)), h('span.tiny.muted', t('for sale'))), h('div', h('b', fmt.num(sum.sold7)), h('span.tiny.muted', t('sold this week'))), h('div', h('b.coin', fmt.coins(sum.volume7)), h('span.tiny.muted', t('volume'))), h('div', h('b', '×' + sum.tradeIndex.toFixed(2)), h('span.tiny.muted', t('vs. shop prices')))] : null),
          h('div.seg', h('button' + (view === 'browse' ? '.on' : ''), { onClick: () => { view = 'browse'; load(); } }, t('Browse')), h('button' + (view === 'mine' ? '.on' : ''), { onClick: () => { view = 'mine'; load(); } }, t('Sell & my orders')))),
          view === 'browse' ? h('div.tr-filters', h('input.input.sm', { placeholder: t('Search items'), value: q.q, onChange: (e) => { q.q = e.target.value; load(); } }),
            sel('cat', [['', t('All categories')], ...Object.keys(CATN).map((k) => [k, t(CATN[k][0])]), ['frame', t('Frames')], ['banner', t('Banners')], ['nameFx', t('Names')], ['effect', t('Effects')], ['bubble', t('Bubbles')], ['title', t('Titles')], ['badge', t('Badges')]]),
            sel('rarity', [['', t('Any rarity')], ...Object.keys(RNAME).map((k) => [k, t(RNAME[k])])]), sel('sort', [['popular', t('Most traded')], ['cheap', t('Cheapest')], ['expensive', t('Most expensive')], ['trend', t('Rising')]]),
            h('label.row.tiny', { style: 'gap:6px;align-items:center' }, h('input', { type: 'checkbox', checked: !!q.all, onChange: (e) => { q.all = e.target.checked ? '1' : ''; load(); } }), t('Show items with no offers'))) : null);
      }
      const row = (r) => h('button.tr-row', { onClick: () => itemModal(r.id) }, h('div.tr-th', CATN[r.cat] ? thumb(r) : h('div.sh-thumb', { style: { '--a': '#312e81', '--b': '#0e7490', '--r': RCOL[r.rarity] } }, h('span.sh-ic', icon('star', 26)))),
        h('div.grow', h('b', L(r.n)), h('div.tiny', { style: { color: RCOL[r.rarity] } }, t(RNAME[r.rarity] || 'Common') + ' · ' + t((CATN[r.cat] || [r.cat])[0]))),
        h('div.tr-col', h('span.tiny.muted', t('From')), r.stats.floor ? h('b.coin', fmt.coins(r.stats.floor)) : h('span.tiny.muted', t('No offers'))),
        h('div.tr-col', h('span.tiny.muted', t('Offers')), h('b', String(r.stats.listed))), h('div.tr-col', h('span.tiny.muted', t('7 days')), trendEl(r.stats.trend)), r.owned ? h('span.pill', t('Owned')) : null);
      async function load() {
        mount(out, loading());
        try {
          if (view === 'browse') { const d = await api.get('/api/trade?' + new URLSearchParams(q)); paintHead(d.summary); setCoins(d.coins);
            mount(out, d.rows.length ? h('div.tr-list', d.rows.map(row)) : emptyState('tag', t('No offers yet'), t('Be the first to sell something: open “Sell & my orders”.')),
              d.recent.length ? [h('h3.sh-h', icon('activity', 16), ' ', t('Latest sales')), h('div.tr-recent', d.recent.map((x) => h('div.tr-rc', h('span.grow.small', L(x.n)), h('b.coin', fmt.coins(x.price)), h('span.tiny.muted', fmt.rel ? fmt.rel(x.soldAt) : ''))))] : null);
          } else { const d = await api.get('/api/trade/mine'); paintHead(null);
            mount(out, h('h3.sh-h', t('Your tradable items')), d.items.length ? h('div.tr-list', d.items.map((r) => h('div.tr-row', h('div.tr-th', CATN[r.cat] ? thumb(r) : null), h('div.grow', h('b', L(r.n)), h('div.tiny.muted', t('Suggested price: {p}', { p: fmt.coins(r.stats.suggested) }) + (r.stats.floor ? ' · ' + t('lowest offer {p}', { p: fmt.coins(r.stats.floor) }) : ''))), h('button.btn.sm.primary', { onClick: () => sell(r) }, icon('tag', 13), t('Sell'))))) : emptyState('bag', t('You have nothing to sell'), t('Buy items in the Shop or here, then sell them when they are worth more.')),
              h('h3.sh-h', t('Your orders')), d.listings.length ? h('div.tr-list', d.listings.map((l) => h('div.tr-row', h('div.grow', h('b', L(l.n)), h('div.tiny.muted', l.bought ? t('Bought') : l.status === 'open' ? t('For sale') : l.status === 'sold' ? t('Sold') : t('Cancelled'))), h('b.coin', fmt.coins(l.price)), l.status === 'open' && !l.bought ? h('button.btn.sm', { onClick: (e) => busy(e.currentTarget, async () => { await api.post(`/api/trade/${l.id}/cancel`); load(); }) }, t('Cancel')) : null))) : h('p.small.muted', t('No orders yet.')));
          }
        } catch (e) { mount(out, emptyState('alert', t('Could not load this'), e.message)); }
      }
      async function sell(r) {
        const inp = h('input.input', { type: 'number', min: r.stats.bounds[0], max: r.stats.bounds[1], value: r.stats.floor ? Math.max(r.stats.bounds[0], r.stats.floor - 1) : r.stats.suggested });
        const ok = await modal({ title: t('Sell {n}', { n: L(r.n) }), cls: 'narrow', body: h('div.col', thumb(r, true), h('label.small', t('Price in coins')), inp, h('p.tiny.muted', t('Suggested by the market script: {p}. Allowed: {a} – {b}. You receive 95% when it sells; 5% is the market fee.', { p: fmt.coins(r.stats.suggested), a: fmt.coins(r.stats.bounds[0]), b: fmt.coins(r.stats.bounds[1]) }))), actions: [{ label: t('Cancel'), value: false }, { label: t('Put on sale'), kind: 'primary', value: true }] });
        if (ok !== true) return; try { await api.post('/api/trade/list', { item: r.id, price: Number(inp.value) }); toast(t('On sale!'), 'good'); load(); } catch (e) { toastErr(e); }
      }
      async function itemModal(id) {
        let d; try { d = await api.get('/api/trade/item/' + encodeURIComponent(id)); } catch (e) { return toastErr(e); }
        const it = d.item; const cv = h('canvas.tr-chart', { width: 520, height: 160 });
        const p = modal({ title: L(it.n), body: h('div.col.tr-item', h('div.row', { style: 'gap:14px;align-items:flex-start' }, CATN[it.cat] ? thumb(it, true) : null, h('div.col.grow', { style: 'gap:4px' },
            h('div.tr-kv', h('span', t('Lowest offer')), h('b.coin', it.stats.floor ? fmt.coins(it.stats.floor) : '—')), h('div.tr-kv', h('span', t('Last sale')), h('b', it.stats.last ? fmt.coins(it.stats.last) : '—')), h('div.tr-kv', h('span', t('7-day average')), h('b', it.stats.avg7 ? fmt.coins(it.stats.avg7) : '—')),
            h('div.tr-kv', h('span', t('Sold in 7 days')), h('b', String(it.stats.sold7))), h('div.tr-kv', h('span', t('Fair price (market script)')), h('b.coin', fmt.coins(it.stats.suggested))))), cv,
          h('h4', t('Offers')), d.listings.length ? d.listings.map((l) => h('div.tr-offer', h('span.grow.small', '@' + (l.seller ? l.seller.username : '?')), h('b.coin', fmt.coins(l.price)), l.seller && l.seller.id === S.me.id ? h('span.tiny.muted', t('yours')) : h('button.btn.sm.primary', { disabled: it.owned, onClick: (e) => busy(e.currentTarget, async () => { const r = await api.post(`/api/trade/${l.id}/buy`); setCoins(r.coins); patchMe({ inv: r.inv }); sfx.coin(); toast(t('Bought!'), 'coin'); load(); e.target.disabled = true; }) }, it.owned ? t('Owned') : t('Buy')))) : h('p.small.muted', t('Nobody is selling this right now.')),
          it.owned ? h('button.btn', { onClick: () => sell(it) }, icon('tag', 14), t('Sell yours')) : null), actions: [{ label: t('Close') }] });
        drawPrices(cv, d.history); await p;
      }
      paintHead(null); load();
      return () => {};
    }

    // ---------------- economy ----------------
    async function econTab() {
      const d = await api.get('/api/economy/market'); const cv = h('canvas.ec-chart', { width: 900, height: 240 });
      const stat = (label, val, sub) => h('div.ec-stat', h('div.tiny.muted', label), h('b', val), sub ? h('div.tiny.muted', sub) : null);
      const list = (title, arr) => h('div.card', h('h4', title), arr.length ? arr.map((x) => h('div.row.small', h('span.grow', x.k || x.id), h('b', fmt.coins(x.v)))) : h('p.tiny.muted', '—'));
      mount(body, h('div.ec',
        h('div.card.ec-head', h('div', h('div.tiny.muted', t('Price index')), h('div.ec-big', '×' + d.idx.toFixed(3)), h('div', L(d.mood))), h('p.small.muted.grow', t('Every hour Nebulix looks at how many coins the players have and how fast they are created and spent. When there is a lot of money around, the shops get more expensive; when money is tight, everything goes on sale.'))),
        h('div.card', cv),
        h('div.ec-stats', stat(t('Players'), fmt.num(d.players), t('{n} active today', { n: fmt.num(d.active) })), stat(t('Typical wealth'), fmt.coins(d.median), t('median')), stat(t('Coins created (24 h)'), fmt.coins(d.minted)), stat(t('Coins spent (24 h)'), fmt.coins(d.burned)), d.supply !== undefined ? stat(t('Total supply'), fmt.coins(d.supply), 'Gini ' + d.gini) : null),
        d.sources ? h('div.ec-lists', list(t('Where coins come from'), d.sources), list(t('Where coins go'), d.sinks), list(t('Most wanted items'), (d.demand || []).map((x) => ({ k: x.id, v: x.v })))) : null,
        d.sources ? h('button.btn.sm', { onClick: (e) => busy(e.currentTarget, async () => { await api.post('/api/economy/market/refresh'); open(); }) }, icon('refresh', 14), t('Recalculate now')) : null));
      drawChart(cv, d.hist);
      return () => {};
    }
    open();
    return () => { clearInterval(timer); if (cleanup) cleanup(); };
  },
};

function drawPrices(cv, hist) {
  const g = cv.getContext('2d'); const W = cv.width, H = cv.height; const css = getComputedStyle(document.documentElement); const acc = css.getPropertyValue('--accent').trim() || '#7c5cff'; const mut = css.getPropertyValue('--muted').trim() || '#94a3b8';
  g.clearRect(0, 0, W, H); g.fillStyle = mut; g.font = '12px system-ui';
  if (!hist || hist.length < 2) { g.fillText(t('Not enough sales for a chart yet'), 12, H / 2); return; }
  const ps = hist.map((x) => x[1]); const lo = Math.min(...ps) * 0.9, hi = Math.max(...ps) * 1.1; const y = (v) => H - 18 - ((v - lo) / Math.max(1, hi - lo)) * (H - 30); const x = (i) => 40 + (i / (hist.length - 1)) * (W - 50);
  g.fillText(fmt.coins(hi), 2, 14); g.fillText(fmt.coins(lo), 2, H - 18);
  g.beginPath(); hist.forEach((p, i) => (i ? g.lineTo(x(i), y(p[1])) : g.moveTo(x(i), y(p[1])))); g.strokeStyle = acc; g.lineWidth = 2.5; g.stroke();
  hist.forEach((p, i) => { g.beginPath(); g.arc(x(i), y(p[1]), 3, 0, 7); g.fillStyle = acc; g.fill(); });
}
function drawChart(cv, hist) {
  const g = cv.getContext('2d'); const W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement); const acc = css.getPropertyValue('--accent').trim() || '#7c5cff'; const mut = css.getPropertyValue('--muted').trim() || '#94a3b8';
  g.font = '12px system-ui'; g.fillStyle = mut; g.strokeStyle = mut + '55'; g.lineWidth = 1;
  const lo = 0.75, hi = 1.5; const y = (v) => H - 24 - ((v - lo) / (hi - lo)) * (H - 40);
  for (const v of [0.75, 1, 1.25, 1.5]) { g.beginPath(); g.moveTo(40, y(v)); g.lineTo(W - 8, y(v)); g.stroke(); g.fillText('×' + v.toFixed(2), 2, y(v) + 4); }
  if (!hist || hist.length < 2) { g.fillText('…', W / 2, H / 2); return; }
  const t0 = hist[0][0], t1 = hist[hist.length - 1][0]; const x = (t) => 40 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 50);
  const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, acc + '66'); grd.addColorStop(1, acc + '00');
  g.beginPath(); hist.forEach(([t, v], i) => (i ? g.lineTo(x(t), y(v)) : g.moveTo(x(t), y(v)))); g.lineTo(x(t1), H - 24); g.lineTo(x(t0), H - 24); g.closePath(); g.fillStyle = grd; g.fill();
  g.beginPath(); hist.forEach(([t, v], i) => (i ? g.lineTo(x(t), y(v)) : g.moveTo(x(t), y(v)))); g.strokeStyle = acc; g.lineWidth = 2.5; g.stroke();
}

// a turning 3D hero wearing a locker; returns { set(lk), emote(k), glide(), stop() }
export async function heroStage(el, lk0) {
  const { THREE, AV } = await load3d(); const W = el.clientWidth || 320, H = el.clientHeight || 360;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true }); r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.setSize(W, H); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; el.append(r.domElement);
  const scene = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 50); cam.position.set(0, 1.5, 5.4); cam.lookAt(0, 1.05, 0);
  scene.add(new THREE.HemisphereLight('#e0e7ff', '#1e1b4b', 1.4)); const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(3, 5, 4); scene.add(key); const rim = new THREE.DirectionalLight('#a78bfa', 2); rim.position.set(-4, 3, -3); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.3, 48), new THREE.MeshStandardMaterial({ color: '#1e1b4b', roughness: 0.4, metalness: 0.5 })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.26, 1.32, 64), new THREE.MeshBasicMaterial({ color: '#7c5cff' })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; scene.add(ring);
  let hero = null; let gun = null; let emote = null; let glide = 0; let drag = null; let rotY = 0.4; let live = true; let raf = 0;
  function set(lk) {
    if (hero) scene.remove(hero); hero = buildHero(THREE, outfitAv(S.me.av3 || null, lk), AV, { shadows: false }); dressHero(THREE, hero, lk); scene.add(hero);
    const wm = lk && lk.wrap ? wrapMaterial(THREE, lk.wrap) : new THREE.MeshStandardMaterial({ color: '#1f2937', metalness: 0.7, roughness: 0.35 });
    gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), wm); gun.position.set(0, -0.32, 0.2); hero.userData.R.el.add(gun);
    hero.userData.lk.pickaxe.visible = !lk || !lk.wrap; gun.visible = !!(lk && lk.wrap);
  }
  set(lk0);
  el.addEventListener('pointerdown', (e) => { drag = e.clientX; el.setPointerCapture(e.pointerId); }); el.addEventListener('pointermove', (e) => { if (drag !== null) { rotY += (e.clientX - drag) * 0.01; drag = e.clientX; } }); el.addEventListener('pointerup', () => { drag = null; });
  let last = performance.now();
  (function loop() {
    if (!live) return; raf = requestAnimationFrame(loop); if (!el.isConnected) { stop(); return; } const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; const ts = now / 1000;
    if (drag === null && !emote) rotY += dt * 0.4; hero.rotation.y = rotY;
    animateHero(hero, dt, ts, { speed: 0, ground: glide <= 0, vy: glide > 0 ? -1 : 0 });
    const g = hero.userData.lk.glider; g.visible = glide > 0; if (glide > 0) { glide -= dt; hero.position.y = 0.6 + Math.sin(ts * 2) * 0.1; g.rotation.z = Math.sin(ts * 1.5) * 0.08; cam.position.y = 2.4; cam.lookAt(0, 1.8, 0); } else { hero.position.y = 0; cam.position.y = 1.5; cam.lookAt(0, 1.05, 0); }
    if (emote) { emote.t += dt; if (emote.t > EMOTE_LEN) { emote = null; resetEmote(hero); } else poseEmote(hero, emote.k, emote.t); }
    hero.traverse((o) => { if (o.name === 'spin') o.rotation.z += dt * 2; if (o.name === 'flame') o.scale.setScalar(0.25 + Math.random() * 0.12); });
    r.render(scene, cam);
  })();
  function stop() { live = false; cancelAnimationFrame(raf); r.dispose(); try { r.forceContextLoss(); } catch {} r.domElement.remove(); }
  return { set, stop, emote: (k) => { emote = { k, t: 0 }; }, glide: () => { glide = 4; } };
}
// preview one shop item: put it on the player's hero (or the hero holding / wearing it)
async function previewInto(el, it) {
  const lk = { [it.cat === 'emote' ? 'emotes' : it.cat]: it.cat === 'emote' ? [Object.assign({ id: it.id }, it.spec)] : Object.assign({ id: it.id }, it.spec) };
  const st = await heroStage(el, lk);
  if (it.cat === 'emote') setTimeout(() => st.emote(it.spec.k), 400); if (it.cat === 'glider' || it.cat === 'trail') st.glide();
  return st.stop;
}
