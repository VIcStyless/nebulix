// Nebulix PRO: perks, pricing, Stripe checkout / manage, and PRO-code redemption.
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, setMe, isPro } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, promptBox, confetti, loading, busy } from '../ui.js';

const PERKS = [
  ['crown', 'Verified PRO badge', 'Stand out with an exclusive PRO badge on your profile and in chat.'],
  ['image', 'Animated avatar & banner', 'Use GIF and animated WEBP for your profile picture and banner.'],
  ['palette', 'All PRO cosmetics', 'Unlock every PRO-only frame, name effect, banner and chat bubble.'],
  ['spark', '10× Nova AI', 'Up to 250 Nova messages a day instead of 25.'],
  ['upload', 'Bigger uploads', 'Larger images and more storage for everything you share.'],
  ['puzzle', 'More Chrome extensions', 'Add more extensions and keep them synced.'],
  ['style', 'Custom CSS themes', 'Write your own CSS for truly one-of-a-kind themes.'],
  ['bolt', 'Early access', 'Try new Nebulix features before anyone else.'],
];

export default {
  title: () => t('Nebulix PRO'),
  async mount(root, ctx) {
    const wrap = h('div.page.pro', loading()); mount(root, wrap);
    // handle Stripe return
    const q = ctx.query;
    if (q.get('paid')) { toast(t('Welcome to PRO!'), 'good', 4000); confetti(); history.replaceState(null, '', '#/pro'); try { setMe((await api.get('/api/me')).user); } catch {} }
    else if (q.get('canceled')) { toast(t('Checkout canceled — no charge was made.'), 'info'); history.replaceState(null, '', '#/pro'); }

    let st; try { st = await api.get('/api/pro/state'); } catch (e) { mount(wrap, h('div.empty', h('span.error', e.message))); return () => {}; }

    const planCard = (plan, label, best) => h('div.pro-plan' + (best ? '.best' : ''),
      best ? h('div.pro-ribbon', t('Best value')) : null,
      h('div.pro-plan-name', t(plan === 'yearly' ? 'Yearly' : 'Monthly')), h('div.pro-price', label),
      h('button.btn.primary.block', { onClick: (e) => checkout(plan, e.currentTarget) }, icon('crown', 16), t('Get PRO')));

    async function checkout(plan, btn) {
      await busy(btn, async () => {
        try { const r = await api.post('/api/pro/checkout', { plan }); if (r.url) location.href = r.url; }
        catch (e) { if (e.code === 'payments_off') { toast(t('Card payments are not set up on this server — redeem a PRO code instead.'), 'info', 5000); redeem(); } else toastErr(e); }
      });
    }
    async function redeem() {
      const code = await promptBox(t('Redeem a PRO code'), { label: t('Enter your code'), placeholder: 'NBX-XXXX-XXXX', ok: t('Redeem') }); if (!code || !code.trim()) return;
      try { const r = await api.post('/api/pro/redeem', { code: code.trim() }); setMe(r.user); confetti(); toast(t('PRO unlocked for {n} days!', { n: r.days }), 'good', 4000); render(); }
      catch (e) { toastErr(e); }
    }
    async function manage(btn) { await busy(btn, async () => { try { const r = await api.post('/api/pro/portal'); if (r.url) location.href = r.url; } catch (e) { toastErr(e); } }); }

    function render() {
      const active = isPro();
      const hero = active
        ? h('div.pro-hero.on', h('div.pro-crown', icon('crown', 30)), h('h2', st.owner ? t('You own Nebulix') : t('You are a PRO member')),
            st.owner ? h('p.muted', t('As the owner you have every PRO perk, forever.')) : h('p.muted', st.proUntil ? t('Your PRO is active until {d}.', { d: fmt.date(st.proUntil) }) + (st.cancelAtEnd ? ' ' + t('It will not renew.') : '') : t('Your PRO is active.')),
            !st.owner && st.manage ? h('button.btn', { onClick: (e) => manage(e.currentTarget) }, icon('gear', 16), t('Manage subscription')) : null,
            !st.owner ? h('button.btn.ghost', { onClick: redeem }, icon('gift', 16), t('Redeem another code')) : null)
        : h('div.pro-hero', h('div.pro-crown', icon('crown', 30)), h('h2', t('Unlock Nebulix PRO')), h('p.muted', t('Support Nebulix and get the best of the gaming community — cosmetics, more AI, bigger uploads and more.')));

      const perks = h('div.pro-perks', PERKS.map(([ic, title, desc]) => h('div.pro-perk' + (active ? '.on' : ''), h('div.pro-perk-ic', icon(ic, 20)), h('div', h('b', t(title)), h('div.small.muted', t(desc))), active ? h('span.pill.ok', '✓') : null)));

      const buy = active ? null : h('div',
        st.payments ? h('div.pro-plans', planCard('monthly', st.labels.monthly), planCard('yearly', st.labels.yearly, true))
          : h('div.card.flat', h('p', t('PRO is unlocked with a code.')), h('p.muted.small', t('Ask the Nebulix owner for a PRO code and redeem it here.'))),
        h('div.row.center', { style: 'margin-top:14px' }, h('button.btn' + (st.payments ? '.ghost' : '.primary'), { onClick: redeem }, icon('gift', 16), t('I have a PRO code'))));

      mount(wrap, h('div.page-title', h('div', h('h2', '', t('Nebulix PRO')), h('p', t('Everything Nebulix, leveled up.')))), hero, perks, buy,
        h('p.tiny.muted', { style: 'text-align:center;margin-top:16px' }, t('PRO is optional — Nebulix is fully usable for free. Prices are shown by the server; taxes may apply at checkout.')));
    }
    render();
    return () => {};
  },
};
