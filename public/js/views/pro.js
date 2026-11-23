// Nebulix Premium (13.8): three plans — Premium (the former PRO), Premium Pro and Premium Ultimate — with Stripe
// checkout per plan (monthly or yearly), subscription management and code redemption. Memberships never sell coins
// and give no casino advantage: they unlock cosmetics, more AI, bigger uploads and other comfort features.
import { h, mount, fmt, ls } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { setMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, promptBox, confetti, loading, busy } from '../ui.js';

const TIERS = [
  { id: 'premium', name: 'Premium', color: '#a3e635', tag: 'Everything Nebulix, leveled up', perks: [['crown', 'Premium badge on your profile and in chat'], ['image', 'Animated avatar and banner'], ['palette', 'All Premium cosmetics'], ['spark', '10× Nova AI (250 messages a day)'], ['upload', '1 GB files in Drive'], ['puzzle', 'More extensions and custom CSS themes'], ['bot', 'Nova Agent: Nova works on your Nebulix'], ['bolt', 'Early access to new features']] },
  { id: 'pro', name: 'Premium Pro', color: '#38bdf8', tag: 'For people who use Nebulix every day', best: true, perks: [['check', 'Everything in Premium'], ['spark', '2× the Premium AI allowance (500 a day)'], ['upload', '2 GB files in Drive'], ['book', 'Study: up to 150 coins a day'], ['star', 'Premium Pro badge and colour'], ['zap', 'Priority on new features']] },
  { id: 'ultimate', name: 'Premium Ultimate', color: '#f59e0b', tag: 'The most you can get', perks: [['check', 'Everything in Premium Pro'], ['spark', '5× the Premium AI allowance (1,250 a day)'], ['upload', '4 GB files in Drive'], ['book', 'Study: up to 300 coins a day'], ['crown', 'Golden Ultimate badge and name colour'], ['heart', 'Direct line to the creator for ideas']] },
];
const rank = (id) => TIERS.findIndex((x) => x.id === id) + 1;

export default {
  title: () => 'Nebulix Premium',
  async mount(root, ctx) {
    const wrap = h('div.page.pro.prem', loading()); mount(root, wrap);
    const q = ctx.query;
    if (q.get('paid')) { toast(t('Welcome to Premium!'), 'good', 4000); confetti(); history.replaceState(null, '', '#/pro'); try { setMe((await api.get('/api/me')).user); } catch {} }
    else if (q.get('canceled')) { toast(t('Checkout canceled — no charge was made.'), 'info'); history.replaceState(null, '', '#/pro'); }
    let st; try { st = await api.get('/api/pro/state'); } catch (e) { mount(wrap, h('div.empty', h('span.error', e.message))); return () => {}; }
    let period = ls('pro.period') || 'monthly';

    async function checkout(tier, btn) {
      await busy(btn, async () => {
        try { const r = await api.post('/api/pro/checkout', { plan: period, tier }); if (r.url) location.href = r.url; }
        catch (e) { if (e.code === 'payments_off') { toast(t('Card payments are not set up on this server — redeem a code instead.'), 'info', 5000); redeem(); } else toastErr(e); }
      });
    }
    async function redeem() {
      const code = await promptBox(t('Redeem a Premium code'), { label: t('Enter your code'), placeholder: 'NBX-XXXX-XXXX', ok: t('Redeem') }); if (!code || !code.trim()) return;
      try { const r = await api.post('/api/pro/redeem', { code: code.trim() }); setMe(r.user); confetti(); toast(t('Premium unlocked for {n} days!', { n: r.days }), 'good', 4000); st = await api.get('/api/pro/state'); render(); } catch (e) { toastErr(e); }
    }
    async function manage(btn) { await busy(btn, async () => { try { const r = await api.post('/api/pro/portal'); if (r.url) location.href = r.url; } catch (e) { toastErr(e); } }); }

    function render() {
      const cur = st.tier; const curRank = cur ? rank(cur) : 0;
      const label = (id) => { const l = (st.tierLabels && st.tierLabels[id]) || st.labels || {}; return l[period] || ''; };
      const canBuy = (id) => !!st.payments && st.payments.stripe && (id === 'premium' ? true : st.tierPlans && st.tierPlans[id]);
      const hero = cur
        ? h('div.pro-hero.on', h('div.pro-crown', icon('crown', 30)), h('h2', st.owner ? t('You own Nebulix') : t('Your plan: {p}', { p: TIERS[curRank - 1].name })),
            st.owner ? h('p.muted', t('As the owner you have every perk of Premium Ultimate, forever.')) : h('p.muted', st.proUntil ? t('Active until {d}.', { d: fmt.date(st.proUntil) }) + (st.cancelAtEnd ? ' ' + t('It will not renew.') : '') : ''),
            !st.owner && st.manage ? h('button.btn', { onClick: (e) => manage(e.currentTarget) }, icon('gear', 16), t('Manage subscription')) : null)
        : h('div.pro-hero', h('div.pro-crown', icon('crown', 30)), h('h2', t('Choose your Nebulix Premium')), h('p.muted', t('Support Nebulix and unlock more AI, cosmetics, bigger uploads and more. Nebulix stays fully usable for free.')));
      const toggle = h('div.prem-toggle', [['monthly', t('Monthly')], ['yearly', t('Yearly') + ' · ' + t('save ~25%')]].map(([k, n]) => h('button' + (period === k ? '.on' : ''), { onClick: () => { period = k; ls('pro.period', k); render(); } }, n)));
      const cards = h('div.prem-grid', TIERS.map((tr, i) => {
        const mine = cur === tr.id; const lower = curRank > i + 1;
        return h('section.prem-card' + (tr.best ? '.best' : '') + (mine ? '.mine' : ''), { style: { '--tc': tr.color } }, tr.best ? h('div.pro-ribbon', t('Most popular')) : null,
          h('div.prem-name', icon('crown', 18), h('b', tr.name)), h('p.small.muted', t(tr.tag)), h('div.prem-price', label(tr.id) || '—'),
          h('ul.prem-perks', tr.perks.map(([ic, p]) => h('li', icon(ic, 14), h('span', t(p))))),
          mine ? h('button.btn.block', { disabled: true }, icon('check', 15), t('Your plan'))
            : lower ? h('button.btn.block.ghost', { disabled: true }, t('Included in your plan'))
            : canBuy(tr.id) ? h('button.btn.primary.block', { onClick: (e) => checkout(tr.id, e.currentTarget) }, icon('crown', 15), curRank ? t('Upgrade to {p}', { p: tr.name }) : t('Get {p}', { p: tr.name }))
            : h('button.btn.block', { onClick: redeem }, icon('gift', 15), t('Redeem a code')));
      }));
      mount(wrap, h('div.page-title', h('div', h('h2', 'Nebulix Premium'), h('p', t('Three plans. Cancel any time.')))), hero, toggle, cards,
        h('div.row.center', { style: 'margin-top:14px;gap:8px' }, h('button.btn.ghost', { onClick: redeem }, icon('gift', 16), t('I have a code'))),
        h('p.tiny.muted', { style: 'text-align:center;margin-top:16px' }, t('Plans never sell coins and give no advantage in the casino. Prices are shown by the server; taxes may apply at checkout. If you upgrade, manage or cancel the old plan in "Manage subscription".')));
    }
    render();
    return () => {};
  },
};
