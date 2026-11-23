// Market: spend coins on profile decorations (frames, banners, name effects, particle effects, chat bubbles, titles, badges) and upgrades.
import { h, mount, fmt, debounce } from '../util.js';
import { t, getLang, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { S, bus, patchMe, setMe, isPro } from '../state.js';
import { icon } from '../icons.js';
import { catalog, loadCatalog, previewItem, profileCard } from '../cosmetics.js';
import { toast, toastErr, confirmBox, modal, segEl, tabsEl, emptyState, loading, busy, confetti } from '../ui.js';
import { sfx } from '../sfx.js';

const CATS = [['frame', 'Frames', 'user'], ['banner', 'Banners', 'image'], ['nameFx', 'Names', 'edit'], ['effect', 'Effects', 'spark'], ['bubble', 'Bubbles', 'chat'], ['title', 'Titles', 'flag'], ['badge', 'Badges', 'star'], ['perk', 'Upgrades', 'bolt']];
const SLOT = { frame: 'frame', banner: 'banner', nameFx: 'nameFx', effect: 'effect', bubble: 'bubble', title: 'title', badge: 'badges' };
const RARITY = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
const RCOL = { common: '#94a3b8', rare: '#38bdf8', epic: '#c084fc', legendary: '#fbbf24' };
const nm = (it) => pick2(it.n);

export default {
  title: () => t('Market'),
  async mount(root, ctx) {
    let cat = ctx.params[0] && CATS.some((c) => c[0] === ctx.params[0]) ? ctx.params[0] : 'frame'; let q = ''; let sort = 'price'; let only = 'all';
    const grid = h('div.grid.mk-grid'); const mine = h('div.card.mk-me'); const tabsHost = h('div'); const coinEl = h('span.coin', fmt.coins(S.me.coins));
    mount(root, h('div.inner', h('div.page-title', h('div', h('h2', t('Market')), h('p', t('Spend your coins on looks that stand out. Everything here is cosmetic — and PRO never sells coins.'))),
      h('div.row', coinEl, h('button.btn', { onClick: () => ctx.go('shop') }, icon('bag', 16), t('Daily Shop')), h('button.btn', { onClick: () => ctx.go('home', { daily: 1 }) }, icon('gift', 16), t('Earn coins')))),
      h('div.mk-layout', h('div.mk-main', tabsHost, filters(), grid), h('aside', mine))));

    function filters() {
      const s = h('input.input', { placeholder: t('Search items'), 'aria-label': t('Search items'), onInput: (e) => { q = e.target.value.trim().toLowerCase(); paint(); } });
      return h('div.row', { style: 'flex-wrap:wrap;margin-bottom:14px' }, h('div.grow', { style: 'min-width:160px' }, s),
        segEl([['all', t('All')], ['owned', t('Owned')], ['buyable', t('Can afford')]], only, (v) => { only = v; paint(); }),
        segEl([['price', t('Price ↑')], ['priceDesc', t('Price ↓')], ['rarity', t('Rarity')]], sort, (v) => { sort = v; paint(); }));
    }
    const owned = (it) => !!(S.me.inv && S.me.inv[it.id]);
    const equipped = (it) => { const e = S.me.eq || {}; return it.cat === 'badge' ? (e.badges || []).includes(it.id) : e[SLOT[it.cat]] === it.id; };
    const order = ['common', 'rare', 'epic', 'legendary'];

    function paintTabs() {
      mount(tabsHost, tabsEl(CATS.map(([id, l, ic]) => [id, t(l), ic]), cat, (id) => { cat = id; history.replaceState(null, '', '#/market/' + id); paint(); }));
    }
    function paintMine() {
      const eq = S.me.eq || {}; const slots = [['frame', 'Frame'], ['banner', 'Banner'], ['nameFx', 'Name effect'], ['effect', 'Effect'], ['bubble', 'Bubble'], ['title', 'Title']];
      mount(mine, h('h3', t('Your profile')), profileCard(S.me, { compact: true }),
        h('div.col', { style: 'gap:4px;margin-top:10px' }, slots.map(([k, l]) => { const it = catalog.get(eq[k]); return h('div.setting', { style: 'padding:6px 0' }, h('div.grow', h('div.small.muted', t(l)), h('div.small', it ? nm(it) : t('None'))), it ? h('button.btn.sm.ghost', { onClick: () => equip(k, null) }, t('Remove')) : null); })),
        h('div.small.muted', { style: 'margin-top:8px' }, t('Badges ({n}/3)', { n: (eq.badges || []).length })));
    }
    function paint() {
      paintTabs(); paintMine(); coinEl.textContent = fmt.coins(S.me.coins);
      let list = [...catalog.values()].filter((it) => it.cat === cat && !it.shop && (!it.reward || owned(it)));
      if (q) list = list.filter((it) => (it.n.join(' ')).toLowerCase().includes(q));
      if (only === 'owned') list = list.filter(owned); else if (only === 'buyable') list = list.filter((it) => !owned(it) && it.price <= S.me.coins);
      list.sort((a, b) => sort === 'priceDesc' ? b.price - a.price : sort === 'rarity' ? order.indexOf(b.rarity) - order.indexOf(a.rarity) || a.price - b.price : a.price - b.price);
      mount(grid, ...(list.length ? list.map(card) : [emptyState('🫥', t('Nothing here'), t('Try another filter.'))]));
    }
    function card(it) {
      const o = owned(it), eqd = equipped(it), lock = it.pro && !isPro();
      const rar = h('span.pill', { style: `color:${RCOL[it.rarity]};border-color:${RCOL[it.rarity]}55` }, t(RARITY[it.rarity]));
      let action;
      if (it.cat === 'perk') action = o || isPro() ? h('button.btn.block', { disabled: true }, t('Unlocked')) : h('button.btn.primary.block', { onClick: () => buy(it) }, h('span.coin', fmt.coins(it.price)), t('Buy'));
      else if (o) action = h('button.btn.block' + (eqd ? '' : '.primary'), { onClick: () => equip(SLOT[it.cat], it.cat === 'badge' ? toggleBadge(it.id) : (eqd ? null : it.id)) }, eqd ? t('Equipped — remove') : t('Equip'));
      else if (lock) action = h('button.btn.block', { onClick: () => ctx.go('pro') }, icon('crown', 16), t('PRO only'));
      else if (it.reward) action = h('button.btn.block', { disabled: true }, '🏆 ' + t('Earned in Competitive'));
      else action = h('button.btn.primary.block', { disabled: it.price > S.me.coins, onClick: () => buy(it) }, h('span.coin', fmt.coins(it.price)), it.price > S.me.coins ? t('Not enough') : t('Buy'));
      return h('div.card.mk-card' + (eqd ? '.glow' : ''), h('div.mk-prev', previewItem(it, S.me)), h('div.row', h('b.grow', nm(it)), rar), it.cat === 'perk' ? h('div.small.muted', pick2(it.spec.desc)) : null,
        o && it.cat !== 'perk' ? h('div.tiny.muted', t('Owned since {d}', { d: fmt.date(S.me.inv[it.id]) })) : null, action);
    }
    const toggleBadge = (id) => { const cur = (S.me.eq && S.me.eq.badges) || []; return cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat([id]); };

    async function equip(slot, id) {
      if (slot === 'badges' && Array.isArray(id) && id.length > 3) return toast(t('You can wear up to 3 badges.'), 'err');
      try { const r = await api.post('/api/market/equip', { slot, id }); setMe(r.user); sfx.click(); paint(); } catch (e) { toastErr(e); }
    }
    async function buy(it) {
      const ok = await modal({ title: t('Buy {n}?', { n: nm(it) }), cls: 'narrow', body: h('div.col', h('div.mk-prev', previewItem(it, S.me)), h('div.row', h('span.muted.grow', t('Price')), h('span.coin', fmt.coins(it.price))), h('div.row', h('span.muted.grow', t('Balance after')), h('b', fmt.coins(S.me.coins - it.price)))),
        actions: [{ label: t('Cancel'), value: false }, { label: t('Buy'), kind: 'primary', value: true }] });
      if (ok !== true) return;
      try {
        const r = await api.post('/api/market/buy', { id: it.id }); patchMe({ coins: r.coins, inv: r.inv }); sfx.coin(); confetti();
        toast(t('You bought {n}!', { n: nm(it) }), 'coin'); paint();
        if (it.cat !== 'perk' && it.cat !== 'badge') { if (await confirmBox(t('Equip it now?'), { ok: t('Equip') })) equip(SLOT[it.cat], it.id); }
        else if (it.cat === 'perk') toast(t('Now upload your picture in Settings → Profile.'), 'info', 6000);
      } catch (e) { toastErr(e); if (e.code === 'no_funds') loadCatalog().then(paint); }
    }

    mount(grid, loading(t('Loading the market…')));
    try { const r = await loadCatalog(); patchMe({ inv: r.inv, eq: r.eq, coins: r.coins }); } catch (e) { toastErr(e); }
    paint();
    const repaint = debounce(() => { if (root.isConnected) paint(); }, 200);
    const off = bus.on('me', repaint);
    return () => off();
  },
};
