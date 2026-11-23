// Advantages: spend coins on timed boosts, permanent upgrades and a savings bank. #/perks
import { h, mount, fmt, parseCoins } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { S, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, loading, emptyState, busy, confirmBox } from '../ui.js';

const L = pick2;
const left = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); const hh = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); return d ? `${d}d ${hh}h` : hh ? `${hh}h ${m}m` : `${m}m ${s % 60}s`; };

export default {
  title: () => t('Advantages'),
  async mount(root, ctx) {
    const inner = h('div.inner.pk'); mount(root, inner, loading());
    let d; let timer = 0;
    const set = (v) => { d = v; if (v.coins !== undefined) patchMe({ coins: v.coins }); paint(); };
    try { set(await api.get('/api/perks')); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return () => {}; }
    function paint() {
      const coinsNow = S.me.coins;
      const boostCard = (b) => {
        const can = coinsNow >= b.price;
        const timeEl = h('span.pk-time');
        const el = h('div.pk-card' + (b.on ? '.on' : '') + (b.all ? '.vip' : ''),
          h('div.pk-ic', b.icon), h('div.grow', h('b', L(b.n)), h('div.small.muted', L(b.d)), h('div.tiny.pk-meta', t('{h} h', { h: b.hours }), b.until ? [' · ', icon('clock', 11), ' ', timeEl] : null)),
          h('button.btn' + (can ? '.primary' : ''), { disabled: !can, onClick: (e) => busy(e.currentTarget, async () => { set(await api.post('/api/perks/boost', { id: b.id })); toast(t('{n} is active!', { n: L(b.n) }), 'good'); }) },
            b.until ? t('Extend') : t('Activate'), ' · ', h('span.coin', fmt.coins(b.price))));
        el._tick = () => { if (b.until) timeEl.textContent = left(b.until - Date.now()); }; el._tick();
        return el;
      };
      const upCard = (u) => h('div.pk-card',
        h('div.pk-ic', u.icon), h('div.grow', h('b', L(u.n)), h('div.small.muted', L(u.d)),
          h('div.pk-lv', Array.from({ length: u.max }, (_, i) => h('i' + (i < u.level ? '.on' : ''))), h('span.tiny.muted', t('Level {a}/{b}', { a: u.level, b: u.max })))),
        u.price == null ? h('span.pill', icon('check', 12), t('Max')) : h('button.btn' + (coinsNow >= u.price ? '.primary' : ''), { disabled: coinsNow < u.price, onClick: (e) => busy(e.currentTarget, async () => { set(await api.post('/api/perks/upgrade', { id: u.id })); toast(t('Upgraded!'), 'good'); }) }, t('Upgrade'), ' · ', h('span.coin', fmt.coins(u.price))));
      const b = d.bank;
      const cards = d.boosts.map(boostCard);
      mount(inner,
        h('div.page-title.row', h('div.grow', h('h2', icon('zap', 22), ' ', t('Advantages')), h('p.muted', t('Spend your coins on real advantages: boosts and permanent upgrades.'))), h('div.pk-bal', h('span.muted.tiny', t('Your coins')), h('span.coin', { title: fmt.num(coinsNow) }, fmt.coins(coinsNow)))),
        h('button.card.pk-banklink', { onClick: () => ctx.go('wallet', { tab: 'bank' }) }, icon('coins', 18), h('div.grow', h('b', t('Nebulix Bank')), h('div.small.muted', t('The bank is now in your Wallet: {n} saved, earning {r}% a day.', { n: fmt.coins(b.bal), r: (b.rate * 100).toFixed(1) }))), icon('link', 16)),
        h('h3.pk-h', icon('bolt', 17), ' ', t('Boosts'), h('span.tiny.muted', ' · ' + t('buy again to add more time'))), h('div.pk-grid', cards),
        h('h3.pk-h', icon('layers', 17), ' ', t('Permanent upgrades')), h('div.pk-grid', d.upgrades.map(upCard)),
        h('p.tiny.muted.pk-foot', t('Coins are virtual and have no real-money value. Boosts never change casino odds: cashback is paid after a losing round.')));
      clearInterval(timer); timer = setInterval(() => { for (const c of cards) c._tick(); if (d.boosts.some((x) => x.until && x.until < Date.now())) api.get('/api/perks').then(set).catch(() => {}); }, 1000);
    }
    return () => clearInterval(timer);
  },
};
