// Wallet: the economy hub — balance & ledger, coin transfers, pets, chests, inventory and shortcuts to daily rewards, missions and the shop.
import { h, mount, fmt, clamp, ls, parseCoins } from '../util.js';
import { t, getLang } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, tabsEl, field, confirmBox, promptBox, modal, confetti } from '../ui.js';
import { sfx } from '../sfx.js';

const L = (pair) => (Array.isArray(pair) ? (getLang() === 'es' ? pair[1] : pair[0]) : pair);
const coin = (n) => h('span.coin', fmt.coins(n));
const meter = (v, cls) => h('div.wl-meter' + (cls || '') + (v <= 20 ? '.low' : ''), h('i', { style: { width: clamp(v, 0, 100) + '%' } }));
const REASON = (r) => {
  const m = String(r || '');
  if (m.startsWith('casino:')) return t('Casino') + ' · ' + m.slice(7);
  if (m.startsWith('arcade:')) return t('Arcade') + ' · ' + m.slice(7);
  if (m.startsWith('work:')) return t('Work') + ' · ' + m.slice(5);
  if (m.startsWith('invest:')) return t('Invest') + ' · ' + m.slice(7).replace(':', ' ');
  if (m.startsWith('transfer:to:')) return t('Sent to {u}', { u: m.slice(12) });
  if (m.startsWith('transfer:from:')) return t('Received from {u}', { u: m.slice(14) });
  if (m.startsWith('chest:')) return t('Chest') + ' · ' + m.slice(6).replace(':reward', ' ' + t('reward'));
  if (m.startsWith('pet:')) return t('Pets') + ' · ' + m.slice(4);
  if (m.startsWith('buy:')) return t('Market') + ' · ' + m.slice(4);
  if (m === 'daily') return t('Daily reward'); if (m === 'level-up') return t('Level-up reward'); if (m === 'grant:owner-bonus') return t('Owner grant');
  return m;
};

export default {
  title: () => t('Wallet'),
  async mount(root, ctx) {
    let w = null; let tab = ctx.query.get('tab') || ls('wallet.tab') || 'overview'; let alive = true;
    const inner = h('div.inner'); mount(root, inner); mount(inner, loading(t('Counting your coins…')));
    const load = async () => { w = await api.get('/api/wallet'); patchMe({ coins: w.coins }); };
    try { await load(); } catch (e) { mount(inner, emptyState('alert', t('Wallet unavailable'), e.message)); return () => {}; }
    const body = h('div');
    const balEl = h('div.wl-bal');
    const paintBal = () => mount(balEl, h('div.tiny.muted', t('Balance')), h('div.wl-big', w.infinite ? '∞' : coin(S.me.coins)), h('div.tiny.muted', t('Virtual coins · no real-money value')));
    const shortcuts = h('div.wl-quick',
      [['gift', t('Daily reward'), () => ctx.go('home', { daily: 1 })], ['trophy', t('Missions & achievements'), () => ctx.go('progress')], ['bag', t('Shop'), () => ctx.go('market')], ['clip', t('Work'), () => ctx.go('work')], ['chart', t('Invest'), () => ctx.go('invest')], ['dice', t('Casino'), () => ctx.go('casino')]]
        .map(([ic, l, fn]) => h('button.wl-q', { type: 'button', onClick: fn }, icon(ic, 18), h('span', l))));
    const tabs = tabsEl([['overview', t('Overview'), 'coins'], ['bank', t('Bank'), 'chart'], ['send', t('Transfer'), 'send'], ['pets', t('Pets'), 'heart'], ['chests', t('Chests'), 'gift'], ['inv', t('Inventory'), 'bag']], tab, (v) => { tab = v; ls('wallet.tab', v); paint(); });
    mount(inner, h('div.page-title', h('div', h('h2', t('Wallet')), h('p', t('Your coins, transfers, pets, chests and items in one place.'))), balEl), shortcuts, tabs, body);
    paintBal();

    function paint() { paintBal(); ({ overview, bank, send, pets, chests, inv }[tab] || overview)(); }
    // 13.8: the Nebulix Bank lives in the Wallet now (it used to be in Advantages)
    async function bank() {
      mount(body, loading()); let d; try { d = await api.get('/api/perks'); } catch (e) { mount(body, emptyState('alert', t('Could not load this'), e.message)); return; }
      const set = (r) => { if (r && r.bank) d.bank = r.bank; if (r && r.coins !== undefined) patchMe({ coins: r.coins }); if (alive && tab === 'bank') draw(); };
      const draw = () => {
        const b = d.bank; const pct = Math.min(100, (b.bal / b.cap) * 100); const amt = h('input.input', { type: 'text', inputmode: 'decimal', placeholder: '10k, 1m…' });
        const go = (path, all) => async (e) => { const n = all ? 'all' : parseCoins(amt.value); if (!all && !(n > 0)) { toast(t('Enter an amount'), 'err'); return; } if (all && !(await confirmBox(t('Withdraw everything ({n} coins)?', { n: fmt.num(b.bal) })))) return; busy(e.target.closest('button'), async () => { try { set(await api.post(path, { amount: n })); paintBal(); toast(path.endsWith('deposit') ? t('Deposited') : t('Withdrawn'), 'good'); } catch (err) { toastErr(err); } }); };
        mount(body, h('section.pk-bank', { style: 'margin-top:14px' },
          h('div.pk-bank-l', h('div.eyebrow', icon('coins', 13), ' ', t('Nebulix Bank')), h('div.pk-bank-bal', { title: fmt.num(b.bal) }, fmt.coins(b.bal)), h('div.small.muted', t('Earns {r}% a day, paid every hour. About {n} coins a day right now.', { r: (b.rate * 100).toFixed(1), n: fmt.coins(b.perDay) })),
            h('div.pk-bar', h('i', { style: { width: pct + '%' } })), h('div.tiny.muted', t('{a} of {b} vault capacity · {e} earned in interest', { a: fmt.coins(b.bal), b: fmt.coins(b.cap), e: fmt.coins(b.earned) }))),
          h('div.pk-bank-r', amt, h('div.row', { style: 'gap:8px' }, h('button.btn.primary.grow', { onClick: go('/api/bank/deposit') }, icon('download', 14), t('Deposit')), h('button.btn.grow', { onClick: go('/api/bank/withdraw') }, icon('upload', 14), t('Withdraw'))),
            h('button.btn.ghost.sm', { disabled: !b.bal, onClick: go('/api/bank/withdraw', true) }, t('Withdraw all')))),
          h('p.tiny.muted', t('Upgrade the vault and the interest rate in Advantages → Permanent upgrades.')));
      };
      draw();
    }

    function overview() {
      mount(body, h('div.grid.cols-2', { style: 'margin-top:14px' },
        h('div.card', h('h3', t('Recent activity')), w.tx.length ? h('div.cs-hist', w.tx.map((x) => h('div.cs-h' + (x.d > 0 ? '.win' : ''), h('div.grow', h('div', REASON(x.r)), h('div.tiny.muted', fmt.rel(x.t) + ' · ' + t('balance {n}', { n: fmt.coins(x.b) }))), h('b.cs-h-net' + (x.d >= 0 ? '.pos' : '.neg'), (x.d > 0 ? '+' : '') + fmt.coins(x.d))))) : h('p.small.muted', t('Nothing yet.'))),
        h('div.col', h('div.card', h('h3', t('Transfers')), transferList()), h('div.card', h('h3', t('Pets & chests')), h('div.row', { style: 'gap:10px;flex-wrap:wrap' }, h('span.pill', '🐾 ' + t('{n} pets', { n: w.pets.list.length })), h('span.pill', '🎁 ' + t('{n} chests opened', { n: w.chests.opened })), w.pets.bonus ? h('span.pill', '💼 ' + t('Work bonus +{p}%', { p: Math.round(w.pets.bonus * 100) })) : null)))));
    }
    function transferList() {
      return w.transfers.length ? h('div.cs-hist', w.transfers.slice(0, 12).map((x) => h('div.cs-h' + (x.dir === 'in' ? '.win' : ''), h('span.cs-h-ic', icon(x.dir === 'in' ? 'download' : 'send', 15)), h('div.grow', h('div', x.dir === 'in' ? t('From @{u}', { u: x.user ? x.user.username : '?' }) : t('To @{u}', { u: x.user ? x.user.username : '?' })), h('div.tiny.muted', fmt.rel(x.t) + (x.note ? ' · “' + x.note + '”' : ''))), h('b.cs-h-net' + (x.dir === 'in' ? '.pos' : '.neg'), (x.dir === 'in' ? '+' : '−') + fmt.coins(x.amount)))))
        : h('p.small.muted', t('No transfers yet.'));
    }

    function send() {
      const to = h('input.input', { placeholder: t('username'), autocomplete: 'off', value: ctx.query.get('to') || '' }); const amt = h('input.input', { type: 'text', inputmode: 'decimal', placeholder: '100, 10k, 1m' }); const note = h('input.input', { maxlength: '80', placeholder: t('Optional note') });
      const fr = (S.friends && S.friends.friends) || [];
      mount(body, h('div.grid.cols-2', { style: 'margin-top:14px' },
        h('div.card.col', h('h3', icon('send', 18), ' ' + t('Send coins')),
          field(t('To'), to), fr.length ? h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, fr.slice(0, 8).map((f) => h('button.btn.sm.ghost', { type: 'button', onClick: () => { to.value = f.username; } }, '@' + f.username))) : null,
          field(t('Amount'), amt), field(t('Note'), note),
          h('div.small.muted', t('Up to {m} per transfer · {d} per day · sent today: {s}', { m: fmt.coins(w.limits.max), d: fmt.coins(w.limits.day), s: fmt.coins(w.limits.sentToday) })),
          w.infinite ? h('div.cs-paused', icon('info', 16), t('Transfers are disabled for accounts with an unlimited wallet.')) : null,
          h('button.btn.primary', { disabled: w.infinite, onClick: (e) => busy(e.currentTarget, async () => {
            const a = parseCoins(amt.value); const u = to.value.trim().replace(/^@/, '');
            if (!u || !(a > 0)) return toast(t('Enter a username and an amount'), 'err');
            if (!(await confirmBox(t('Send {n} coins to @{u}? Transfers cannot be undone.', { n: fmt.coins(a), u }), { ok: t('Send') }))) return;
            try { const r = await api.post('/api/wallet/transfer', { to: u, amount: a, note: note.value }); patchMe({ coins: r.coins }); sfx.coin ? sfx.coin() : null; toast(t('Sent {n} coins to @{u}', { n: fmt.coins(a), u: r.to.username }), 'coin'); await load(); paint(); } catch (er) { toastErr(er); }
          }) }, icon('send', 16), t('Send coins'))),
        h('div.card', h('h3', t('Recent transfers')), transferList())));
    }

    function pets() {
      const P = w.pets;
      const card = (p) => h('div.card.wl-pet' + (P.active === p.id ? '.on' : ''),
        h('div.wl-petart', h('span', p.e), h('span.wl-lvl', 'Lv ' + p.lvl)),
        h('div.row', { style: 'gap:6px' }, h('b.grow', p.name), P.active === p.id ? h('span.pill', '★ ' + t('Active')) : h('button.btn.sm.ghost', { onClick: (e) => busy(e.currentTarget, () => act(p, 'active')) }, t('Set active'))),
        h('div.tiny.muted', L(p.species)),
        h('div.wl-stat', h('span', '🍖 ' + t('Hunger')), meter(p.hunger)), h('div.wl-stat', h('span', '🎾 ' + t('Joy')), meter(p.joy, '.joy')),
        h('div.wl-stat', h('span', '⭐ XP'), meter(((p.xp - p.cur) / Math.max(1, p.next - p.cur)) * 100, '.xp')),
        h('div.row', { style: 'gap:6px;margin-top:6px;flex-wrap:wrap' },
          h('button.btn.sm', { disabled: Date.now() < p.feedAt, title: Date.now() < p.feedAt ? t('Ready {t}', { t: fmt.time(p.feedAt) }) : '', onClick: (e) => busy(e.currentTarget, () => act(p, 'feed')) }, t('Feed ({n})', { n: P.feedCost })),
          h('button.btn.sm', { disabled: Date.now() < p.playAt, title: Date.now() < p.playAt ? t('Ready {t}', { t: fmt.time(p.playAt) }) : '', onClick: (e) => busy(e.currentTarget, () => act(p, 'play')) }, t('Play')),
          h('button.btn.sm.ghost', { onClick: async () => { const n = await promptBox(t('Rename {n}', { n: p.name }), { value: p.name, label: t('Name') }); if (n) act(p, 'rename', { name: n }); } }, icon('edit', 14))));
      mount(body, h('div', { style: 'margin-top:14px' },
        h('div.cs-note', icon('heart', 16), h('span', t('Your active pet adds +1% work pay per level (up to +25%) while its hunger and joy stay above 20.'))),
        P.list.length ? h('div.wl-pets', P.list.map(card)) : h('p.muted', t('You have no pets yet. Adopt one below!')),
        h('h3', { style: 'margin:22px 0 10px' }, t('Adopt a pet') + ` (${P.list.length}/${P.max})`),
        h('div.wl-shop', P.species.map((s) => h('div.wl-sp', h('div.wl-spart', s.e), h('b', L(s.n)), coin(s.price),
          h('button.btn.sm.primary', { disabled: P.list.length >= P.max || S.me.coins < s.price, onClick: async (e) => { const bt = e.currentTarget; const name = await promptBox(t('Name your {s}', { s: L(s.n) }), { value: L(s.n), label: t('Name') }); if (name === null || name === undefined) return; busy(bt, async () => { try { const r = await api.post('/api/pets/adopt', { species: s.id, name }); patchMe({ coins: r.coins }); confetti(innerWidth / 2, innerHeight / 3, 40); toast(t('Welcome home, {n}!', { n: r.pet.name }), 'good'); await load(); paint(); } catch (er) { toastErr(er); } }); } }, t('Adopt')))))));
    }
    async function act(p, a, body) { try { const r = await api.post(`/api/pets/${p.id}/${a}`, body || {}); if (r.coins !== undefined) patchMe({ coins: r.coins }); if (a === 'feed' || a === 'play') sfx.tick && sfx.tick(); await load(); paint(); } catch (e) { toastErr(e); } }

    function chests() {
      const RAR = { common: t('Common'), rare: t('Rare'), epic: t('Epic'), legendary: t('Legendary') };
      mount(body, h('div', { style: 'margin-top:14px' },
        h('div.wl-chests', w.chests.list.map((c) => h('div.card.wl-chest.' + c.id, h('div.wl-chestart', c.e), h('h3', L(c.n)), coin(c.price),
          h('div.small.muted', t('Coins + {p}% chance of a {r} cosmetic', { p: Math.round(c.item * 100), r: c.rar.map((r) => RAR[r]).join('/') })),
          h('button.btn.primary', { disabled: S.me.coins < c.price, onClick: (e) => busy(e.currentTarget, () => openChest(c)) }, icon('gift', 16), t('Open'))))),
        h('div.card', { style: 'margin-top:16px' }, h('h3', t('Recent openings')), w.chests.log.length ? h('div.cs-hist', w.chests.log.map((x) => { const c = w.chests.list.find((q) => q.id === x.id); return h('div.cs-h' + (c && x.coins >= c.price ? '.win' : ''), h('span.cs-h-ic', c ? c.e : '🎁'), h('div.grow', h('div', (c ? L(c.n) : x.id) + (x.item ? ' · ✨ ' + x.item : '')), h('div.tiny.muted', fmt.rel(x.t))), coin(x.coins)); })) : h('p.small.muted', t('No chests opened yet.')))));
    }
    async function openChest(c) {
      let r; try { r = await api.post('/api/chests/open', { id: c.id }); } catch (e) { return toastErr(e); }
      patchMe({ coins: r.balance }); const box = h('div.wl-open', h('div.wl-openart.shake', c.e)); const m = modal({ title: L(c.n), body: box, actions: [{ label: t('Nice!'), kind: 'primary', value: true }] });
      sfx.spin && sfx.spin(); await new Promise((res) => setTimeout(res, 1100)); if (!alive) return;
      mount(box, h('div.wl-openart.pop', r.item ? '✨' : '🪙'), h('div.wl-prize', '+', coin(r.coins)), r.item ? h('div.wl-item', t('New item: {n}', { n: L(r.item.n) }), h('span.pill', t({ common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' }[r.item.rarity] || r.item.rarity))) : null);
      if (r.coins >= c.price || r.item) { confetti(innerWidth / 2, innerHeight / 2, 60); sfx.big ? sfx.big() : null; } else sfx.win && sfx.win();
      await m; await load(); if (alive) paint();
    }

    function inv() {
      const NAMES = { frame: t('Avatar frames'), banner: t('Banners'), nameFx: t('Name effects'), effect: t('Profile effects'), bubble: t('Chat bubbles'), title: t('Titles'), badge: t('Badges'), perk: t('Upgrades') };
      mount(body, h('div.card', { style: 'margin-top:14px' }, h('h3', t('Inventory')), h('p.small.muted', t('You own {n} of {m} items in the catalog.', { n: w.inventory.total, m: w.inventory.catalog })),
        h('div.wl-inv', Object.keys(NAMES).map((k) => h('div.wl-invc', h('b', String(w.inventory.cats[k] || 0)), h('span.small.muted', NAMES[k])))),
        h('button.btn.primary', { style: 'margin-top:12px', onClick: () => ctx.go('market') }, icon('bag', 16), t('Open the shop & equip items'))));
    }
    paint();
    return () => { alive = false; };
  },
};
