// Plaza: donation booths (open yours, donate, pay to appear first), the player market (sell what you own),
// staff that earn coins while you are away, and gems. All virtual — no real money in or out.
import { h, mount, fmt, ls, parseCoins } from '../util.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import { S, bus, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, tabsEl, field, confirmBox, promptBox, modal, confetti, segEl } from '../ui.js';
import { avatarEl, nameEl, previewItem } from '../cosmetics.js';
import { avatarCanvas } from '../avatar3d.js';

const L = (pair) => (Array.isArray(pair) ? (getLang() === 'es' ? pair[1] : pair[0]) : pair);
const coin = (n) => h('span.coin', fmt.coins(n));
const gem = (n) => h('span.gem', fmt.coins(n));
const left = (ms) => { const m = Math.max(0, Math.round((ms - Date.now()) / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
const COLORS = ['#7c5cff', '#22c3e6', '#3ddc84', '#f5b84a', '#ef4444', '#ec4899', '#0ea5e9', '#a3e635'];

export default {
  title: () => t('Plaza'),
  async mount(root, ctx) {
    let tab = ctx.query.get('tab') || ls('plaza.tab') || 'booths'; let alive = true; let timer = null; let gemLim = null;
    const inner = h('div.inner.plaza'); mount(root, inner);
    const head = h('div.page-title', h('h2', t('Plaza')), h('p.muted', t('Donate to other players, open your own booth, trade items and hire staff that earn coins for you.')));
    const bal = h('div.pz-bal');
    const paintBal = () => mount(bal, h('div.pz-cur', icon('coins', 16), S.me.infinite ? h('span.coin', '∞') : coin(S.me.coins), h('span.tiny.muted', t('coins'))), h('div.pz-cur.g', icon('gem', 16), gem(S.me.gems || 0), h('span.tiny.muted', t('gems'))));
    const tabs = tabsEl([['booths', t('Donation booths'), 'gift'], ['market', t('Player market'), 'bag'], ['staff', t('Staff'), 'users'], ['gems', t('Gems'), 'gem']], tab, (v) => { tab = v; ls('plaza.tab', v); paint(); });
    const body = h('div.pz-body');
    mount(inner, head, h('div.row.wrap.pz-top', tabs, h('div.grow'), bal), body);
    paintBal();
    const offs = [bus.on('ws:coins', paintBal), bus.on('ws:gems', (m) => { patchMe({ gems: m.gems }); paintBal(); })];

    async function paint() { clearInterval(timer); mount(body, loading()); try { await ({ booths: paintBooths, market: paintMarket, staff: paintStaff, gems: paintGems }[tab] || paintBooths)(); } catch (e) { mount(body, emptyState('alert', t('Could not load this'), e.message)); } }

    // ---------------- booths ----------------
    async function paintBooths() {
      const d = await api.get('/api/plaza'); gemLim = d.gemLimits || gemLim;
      const mine = d.mine;
      const myCard = h('div.card.pz-mine',
        mine ? [h('div.row', h('span.pz-emoji', { style: '--bc:' + mine.color }, mine.emoji), h('div.grow', h('b', mine.title), h('div.small.muted', t('{a} of {b} coins raised · {n} donations', { a: fmt.coins(mine.raised), b: fmt.coins(mine.goal), n: mine.donors || 0 }) + (mine.raisedGems ? ' · ' + t('{n} gems', { n: fmt.num(mine.raisedGems) }) : '')))),
          h('div.pz-goal', h('i', { style: 'width:' + Math.min(100, (mine.raised / mine.goal) * 100) + '%;--bc:' + mine.color })),
          h('div.row.wrap', h('button.btn', { onClick: () => editBooth(mine) }, icon('edit', 15), t('Edit')),
            h('button.btn.primary', { onClick: () => boostBooth(d.boostPrice, mine) }, icon('bolt', 15), mine.boosted ? t('Boosted · {t} left', { t: left(mine.boosted) }) : t('Appear first')),
            h('button.btn.ghost', { onClick: async () => { if (await confirmBox(t('Close your booth? The coins you raised stay in your wallet.'))) { await api.del('/api/plaza/booth'); paint(); } } }, t('Close booth')))]
          : [h('h3', icon('gift', 16), t('Open your donation booth')), h('p.muted.small', t('Other players see it in the Plaza and in the 3D casino lobby, and can donate coins to you. Pay coins to appear first.')), h('button.btn.primary', { onClick: () => editBooth(null) }, icon('plus', 15), t('Open my booth'))]);
      const grid = d.booths.length ? h('div.pz-grid', d.booths.map(boothCard)) : emptyState('gift', t('No booths yet'), t('Be the first to open one!'));
      const feed = h('div.card.pz-feed', h('h3', icon('bolt', 15), t('Latest donations')),
        d.feed.length ? d.feed.map((x) => h('div.pz-fi', avatarEl(x.from, { size: 22 }), h('span.grow.small', h('b', '@' + x.from.username), ' → ', h('b', '@' + x.to.username), x.note && x.note !== '🎁' ? h('span.muted', ' “' + x.note + '”') : null), x.cur === 'gems' ? gem(x.amount) : coin(x.amount))) : h('p.muted.small', t('No donations yet.')),
        d.top.length ? [h('h3', { style: 'margin-top:14px' }, icon('trophy', 15), t('Top donors')), d.top.map((x, i) => h('div.pz-fi', h('span.pz-rank', '#' + (i + 1)), avatarEl(x.user, { size: 22 }), h('span.grow.small', '@' + x.user.username), x.donated ? coin(x.donated) : null, x.gems ? gem(x.gems) : null))] : null);
      mount(body, h('div.pz-cols', h('div.col.gap', myCard, grid), feed));
    }
    function boothCard(b) {
      const me = b.uid === S.me.id;
      return h('div.pz-booth' + (b.boosted ? '.boost' : ''), { style: '--bc:' + b.color },
        b.boosted ? h('span.pz-flag', icon('bolt', 12), t('Featured')) : null,
        h('div.pz-av', b.user.av3 ? avatarCanvas(b.user.av3, { size: 92, spin: true }) : avatarEl(b.user, { size: 64 })),
        h('div.pz-btitle', h('span', b.emoji), ' ', b.title),
        h('button.pz-owner', { onClick: () => ctx.go('profile', b.user.username) }, '@' + b.user.username, b.online ? h('i.pz-on') : null),
        h('div.pz-goal', h('i', { style: 'width:' + Math.min(100, (b.raised / b.goal) * 100) + '%' })),
        h('div.tiny.muted', t('{a} / {b} coins', { a: fmt.compact(b.raised), b: fmt.compact(b.goal) }) + (b.raisedGems ? ' · 💎 ' + fmt.compact(b.raisedGems) : '')),
        me ? h('span.pill', t('Your booth')) : h('div.row.pz-dons', [10, 100, 1000].map((n) => h('button.btn.sm', { onClick: (e) => busy(e.currentTarget, () => doDonate(b.user.username, n)) }, fmt.compact(n))), h('button.btn.sm', { title: t('Donate gems'), onClick: () => customDonate(b.user.username, 'gems') }, '💎'), h('button.btn.sm.primary', { onClick: () => customDonate(b.user.username) }, t('Donate'))));
    }
    async function doDonate(username, amount, note, cur = 'coins') {
      const G = cur === 'gems';
      try {
        const r = await api.post('/api/donate', { to: username, amount, note, currency: cur }); patchMe({ coins: r.coins, gems: r.gems }); paintBal();
        toast(G ? t('You donated {n} gems to @{u}', { n: fmt.num(amount), u: username }) : t('You donated {n} coins to @{u}', { n: fmt.coins(amount), u: username }), 'coin');
        if (G ? amount >= 20 : amount >= 1000) confetti(); paint();
      } catch (e) { toastErr(e); }
    }
    async function customDonate(username, start = 'coins') {
      let cur = start; const gl = gemLim || { max: 200, day: 500 };
      const amt = h('input.input', { type: 'text', inputmode: 'decimal' }); const note = h('input.input', { maxlength: 80, placeholder: t('Message (optional)') });
      const hint = h('div.hint'); const lab = h('label');
      const set = (v) => {
        cur = v; const G = v === 'gems'; lab.textContent = G ? t('Gems') : t('Coins');
        amt.placeholder = G ? '5, 20, 100' : '500, 10k'; amt.value = G ? Math.min(10, S.me.gems || 0) || 1 : 500;
        hint.textContent = G ? t('You have {n} gems. Max {m} per donation and {d} per day.', { n: fmt.num(S.me.gems || 0), m: gl.max, d: gl.day }) : t('No limit: donate as many coins as you have.');
      };
      const seg = segEl([['coins', '🪙 ' + t('Coins')], ['gems', '💎 ' + t('Gems')]], cur, set); set(cur);
      const ok = await modal({ title: t('Donate to @{u}', { u: username }), cls: 'narrow', body: h('div.col.gap', seg, h('div.field', lab, amt, hint), field(t('Message'), note)), actions: [{ label: t('Cancel'), value: false }, { label: t('Donate'), kind: 'primary', value: true }] });
      if (ok) doDonate(username, cur === 'gems' ? Math.trunc(Number(String(amt.value).replace(/[^0-9]/g, ''))) : parseCoins(amt.value), note.value, cur);
    }
    async function editBooth(b) {
      let color = (b && b.color) || COLORS[0];
      const title = h('input.input', { maxlength: 48, value: b ? b.title : t('Help me reach my goal!') });
      const emoji = h('input.input', { maxlength: 8, value: b ? b.emoji : '🎁', style: 'width:80px' });
      const goal = h('input.input', { type: 'text', inputmode: 'decimal', placeholder: '10k, 1m', value: b ? b.goal : 10000 });
      const sw = h('div.row.wrap', COLORS.map((c) => h('button.pz-sw' + (c === color ? '.on' : ''), { type: 'button', style: 'background:' + c, onClick: (e) => { color = c; sw.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
      const ok = await modal({ title: b ? t('Edit booth') : t('Open my booth'), cls: 'narrow', body: h('div.col.gap', field(t('Title'), title), h('div.row', field(t('Emoji'), emoji), field(t('Goal (coins)'), goal)), field(t('Colour'), sw)), actions: [{ label: t('Cancel'), value: false }, { label: t('Save'), kind: 'primary', value: true }] });
      if (!ok) return;
      try { await api.post('/api/plaza/booth', { title: title.value, emoji: emoji.value, goal: parseCoins(goal.value), color }); toast(t('Booth saved'), 'good'); paint(); } catch (e) { toastErr(e); }
    }
    async function boostBooth(price) {
      const v = await promptBox(t('Appear first'), { label: t('Hours (1-24). Each hour costs {n} coins.', { n: fmt.coins(price) }), value: '1', type: 'number' }); if (!v) return;
      try { const r = await api.post('/api/plaza/boost', { hours: Number(v) }); patchMe({ coins: r.coins }); paintBal(); toast(t('Your booth is featured for {t}', { t: left(r.boostUntil) }), 'good'); paint(); } catch (e) { toastErr(e); }
    }

    // ---------------- player market ----------------
    async function paintMarket() {
      const d = await api.get('/api/p2p');
      const sell = h('button.btn.primary', { onClick: () => sellDialog(d) }, icon('plus', 15), t('Sell an item'));
      const mine = d.mine.length ? h('div.card', h('h3', t('Your listings')), h('div.pz-list', d.mine.map((l) => listing(l, true, d)))) : null;
      const all = d.listings.filter((l) => l.seller.id !== S.me.id);
      mount(body, h('div.col.gap', h('div.row.wrap', h('p.muted.small.grow', t('Players sell the cosmetics they own. The seller gets the price minus a {p}% fee.', { p: Math.round(d.fee * 100) })), sell), mine,
        all.length ? h('div.pz-list', all.map((l) => listing(l, false, d))) : emptyState('bag', t('Nothing for sale right now'), t('Sell something you own to get started.'))));
    }
    function listing(l, mine, d) {
      return h('div.pz-item' + (l.boosted ? '.boost' : ''), h('div.pz-prev', previewItem(l.item, S.me)),
        h('div.grow', h('b', L(l.item.n)), h('div.tiny.muted', t(l.item.rarity) + ' · ' + t('shop price {n}', { n: fmt.coins(l.item.price) })), h('div.tiny.muted', '@' + l.seller.username)),
        h('div.col', { style: 'align-items:flex-end;gap:6px' }, coin(l.price),
          mine ? h('div.row', h('button.btn.sm', { onClick: async () => { const v = await promptBox(t('Feature this listing'), { label: t('Hours (1-24). Each hour costs {n} coins.', { n: fmt.coins(d.boostPrice) }), value: '1', type: 'number' }); if (!v) return; try { const r = await api.post('/api/p2p/' + l.id + '/boost', { hours: Number(v) }); patchMe({ coins: r.coins }); paintBal(); paint(); } catch (e) { toastErr(e); } } }, icon('bolt', 13)),
            h('button.btn.sm.ghost', { onClick: async () => { try { await api.post('/api/p2p/' + l.id + '/cancel'); toast(t('Back in your inventory'), 'good'); paint(); } catch (e) { toastErr(e); } } }, t('Cancel')))
            : h('button.btn.sm.primary', { onClick: async (e) => { const bt = e.currentTarget; if (!(await confirmBox(t('Buy {i} for {n} coins?', { i: L(l.item.n), n: fmt.coins(l.price) })))) return; busy(bt, async () => { try { const r = await api.post('/api/p2p/' + l.id + '/buy'); patchMe({ coins: r.coins, inv: Object.assign({}, S.me.inv, { [r.item]: Date.now() }) }); paintBal(); toast(t('Bought! It is in your inventory.'), 'good'); paint(); } catch (er) { toastErr(er); } }); } }, t('Buy'))));
    }
    async function sellDialog() {
      const cat = await api.get('/api/market', { quiet: true }).catch(() => null);
      const items = cat && cat.items ? cat.items.filter((i) => S.me.inv && S.me.inv[i.id] && i.cat !== 'perk') : [];
      if (!items.length) { toast(t('You have no items you can sell. Buy cosmetics in the Market first.'), 'info'); return; }
      const sel = h('select.select', items.map((i) => h('option', { value: i.id }, L(i.n) + ' (' + fmt.coins(i.price) + ')')));
      const price = h('input.input', { type: 'text', inputmode: 'decimal', placeholder: '500, 10k', value: items[0].price });
      sel.addEventListener('change', () => { const it = items.find((i) => i.id === sel.value); if (it) price.value = it.price; });
      const ok = await modal({ title: t('Sell an item'), cls: 'narrow', body: h('div.col.gap', field(t('Item'), sel, t('It leaves your inventory while it is on sale. You can cancel any time.')), field(t('Price (coins)'), price)), actions: [{ label: t('Cancel'), value: false }, { label: t('Put on sale'), kind: 'primary', value: true }] });
      if (!ok) return;
      try { await api.post('/api/p2p/sell', { item: sel.value, price: parseCoins(price.value) }); const inv = Object.assign({}, S.me.inv); delete inv[sel.value]; patchMe({ inv }); toast(t('On sale!'), 'good'); paint(); } catch (e) { toastErr(e); }
    }

    // ---------------- staff ----------------
    async function paintStaff() {
      let d = await api.get('/api/staff');
      const pend = h('div.pz-pend');
      const paintPend = () => mount(pend, h('div', h('div.tiny.muted', t('Earned while you were away')), h('div.wl-big', coin(d.pending)), h('div.tiny.muted', t('{r} coins/hour · fills up in {c} h', { r: fmt.coins(d.rate), c: d.cap }) + (d.full ? ' · ' + t('Full! Collect to keep earning.') : ''))),
        h('button.btn.primary', { disabled: d.pending <= 0, onClick: (e) => busy(e.currentTarget, async () => { const r = await api.post('/api/staff/collect'); d = r; patchMe({ coins: r.coins }); paintBal(); if (r.collected) toast(t('+{n} coins from your staff', { n: fmt.coins(r.collected) }), 'coin'); paintAll(); }) }, icon('coins', 15), t('Collect')));
      const list = h('div.pz-staff');
      const paintAll = () => { paintPend(); mount(list, d.list.map((s) => h('div.pz-st', h('div.pz-ste', s.e), h('div.grow', h('b', L(s.n)), h('div.tiny.muted', t('+{r} coins/hour each', { r: fmt.coins(s.rate) })), h('div.tiny', t('Hired: {n}/{m}', { n: s.owned, m: s.max }))),
        h('button.btn.sm' + (s.cur === 'gems' ? '.pz-gbtn' : '.primary'), { disabled: s.owned >= s.max, onClick: (e) => busy(e.currentTarget, async () => { try { d = await api.post('/api/staff/hire', { id: s.id }); patchMe({ coins: d.coins, gems: d.gems }); paintBal(); toast(t('{n} hired!', { n: L(s.n) }), 'good'); paintAll(); } catch (er) { toastErr(er); } }) }, t('Hire'), ' ', s.cur === 'gems' ? gem(s.price) : coin(s.price))))); };
      paintAll();
      mount(body, h('div.col.gap', h('div.card.pz-pendc', pend), h('p.muted.small', t('Staff keep earning while you are offline, up to {h} hours ({p} hours with PRO, which also pays 20% more). Each extra hire of the same kind costs 15% more.', { h: 12, p: 24 })), list));
      timer = setInterval(async () => { if (!alive || tab !== 'staff') return; try { d = await api.get('/api/staff'); paintPend(); } catch {} }, 30000);
    }

    // ---------------- gems ----------------
    async function paintGems() {
      const d = await api.get('/api/gems');
      const n = h('input.input', { type: 'number', min: 1, max: d.left, value: Math.min(5, Math.max(1, d.left)) });
      const cost = h('b'); const upd = () => cost.textContent = fmt.coins(Math.max(0, Number(n.value) || 0) * d.rate) + ' ' + t('coins'); n.addEventListener('input', upd); upd();
      mount(body, h('div.pz-cols',
        h('div.col.gap',
          h('button.card.pk-banklink', { onClick: () => ctx.go('wallet', { tab: 'send', cur: 'gems' }) }, icon('send', 18), h('div.grow', h('b', t('Send gems')), h('div.small.muted', t('Give gems to a friend or donate them to a booth. Up to 200 at a time and 500 a day.'))), icon('link', 16)),
          h('div.card', h('h3', icon('gem', 16), t('What are gems?')), h('p.small', t('Gems are the second currency of Nebulix. Coins are for the casino, arcade, market, donations and staff. Gems are for premium things: 3D avatar parts and premium staff (robots and AI assistants).')),
            h('ul.small.pz-ul', h('li', t('Daily reward: +1 gem (+5 every 7-day streak, double with PRO)')), h('li', t('Every level up: +3 gems')), h('li', t('Every achievement: +2 gems')), h('li', t('Exchange coins: {r} coins = 1 gem, up to {d} per day', { r: fmt.coins(d.rate), d: d.perDay })))),
          h('div.card', h('h3', t('Exchange coins for gems')), h('div.row.wrap', field(t('Gems'), n, t('{n} left today', { n: d.left })), h('div.col', h('span.tiny.muted', t('Cost')), cost)),
            h('button.btn.primary', { disabled: d.left <= 0, onClick: (e) => busy(e.currentTarget, async () => { try { const r = await api.post('/api/gems/exchange', { n: Number(n.value) }); patchMe({ coins: r.coins, gems: r.gems }); paintBal(); toast(t('+{n} gems', { n: Number(n.value) }), 'good'); paint(); } catch (er) { toastErr(er); } }) }, t('Exchange')), h('p.tiny.muted', t('One-way: gems cannot be turned back into coins. Gems are never sold for real money.')))),
        h('div.card', h('h3', t('Gem history')), d.tx.length ? d.tx.map((x) => h('div.pz-fi', h('span.grow.small', x.r), h('b', { class: x.d > 0 ? 'good' : 'bad' }, (x.d > 0 ? '+' : '') + x.d), h('span.tiny.muted', fmt.rel(x.t)))) : h('p.muted.small', t('No gems yet.')))));
    }

    paint();
    return () => { alive = false; clearInterval(timer); offs.forEach((f) => f && f()); };
  },
};
