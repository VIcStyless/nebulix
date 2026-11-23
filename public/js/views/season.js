// Season pass ("Temporada"): free 40-tier monthly track, weekly challenges and today's quests in one place. #/season
import { h, mount, fmt } from '../util.js';
import { t, pick2 } from '../i18n.js';
import { api } from '../api.js';
import { patchMe } from '../state.js';
import { icon } from '../icons.js';
import { toast, toastErr, loading, emptyState, busy, confetti } from '../ui.js';

const L = pick2;
const BOOST = { xp2: 'Double XP', work: 'Overtime pay', vip: 'VIP lounge' };
const left = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const d = Math.floor(s / 86400); const hh = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); return d ? `${d}d ${hh}h` : `${hh}h ${m}m`; };

export default {
  title: () => t('Season'),
  async mount(root) {
    const inner = h('div.inner.ss'); mount(root, inner, loading());
    let d, pr;
    const load = async () => { [d, pr] = await Promise.all([api.get('/api/season'), api.get('/api/progress').catch(() => null)]); paint(); };
    try { await load(); } catch (e) { mount(inner, emptyState('alert', t('Could not load this'), e.message)); return () => {}; }
    async function claim(btn, tier) {
      await busy(btn, async () => { try { const r = await api.post('/api/season/claim', { tier }); patchMe({ coins: r.coins, gems: r.gems }); const got = r.got.length; d = r; paint(); confetti(innerWidth / 2, innerHeight / 3, 30 + got * 6); toast(got > 1 ? t('{n} rewards claimed!', { n: got }) : t('Reward claimed!'), 'coin'); } catch (e) { toastErr(e); } });
    }
    function rewardBits(r) { return [h('span.coin', fmt.coins(r.coins)), r.gems ? h('span.ss-gem', icon('gem', 12), ' ' + r.gems) : null, r.boost ? h('span.ss-boost', '⚡ ' + t(BOOST[r.boost[0]] || r.boost[0]) + ' ' + r.boost[1] + 'h') : null, r.chest ? h('span.ss-boost', '👑 ' + t('Golden chest')) : null, r.badge ? h('span.ss-boost', '🏅 ' + t('Season badge')) : null]; }
    function paint() {
      const pct = d.tier >= d.tiers ? 100 : (d.into / d.tierSp) * 100;
      const track = h('div.ss-track', d.rewards.map((r) => h('div.ss-tier' + (r.claimed ? '.claimed' : r.ready ? '.ready' : '') + (r.tier % 5 === 0 ? '.big' : ''),
        h('div.ss-tn', String(r.tier)), h('div.ss-rw', rewardBits(r)),
        r.claimed ? h('span.ss-ok', icon('check', 14)) : r.ready ? h('button.btn.sm.primary', { onClick: (e) => claim(e.currentTarget, r.tier) }, t('Claim')) : h('span.ss-lock', icon('lock', 13)))));
      const quests = pr && pr.quests ? pr.quests : [];
      mount(inner,
        h('section.ss-hero',
          h('div.grow', h('div.eyebrow', icon('star', 13), ' ', t('Season')), h('h2', L(d.name)), h('div.small.muted', t('Ends in {t} · free for everyone', { t: left(d.endsAt - Date.now()) })),
            h('div.ss-lv', h('b', t('Tier {n}', { n: d.tier })), h('span.muted', ' / ' + d.tiers), h('div.ss-bar', h('i', { style: { width: pct + '%' } })), h('div.tiny.muted', d.tier >= d.tiers ? t('Season complete!') : t('{a}/{b} SP to the next tier', { a: d.into, b: d.tierSp })))),
          h('div.ss-hero-r', d.unclaimed ? h('button.btn.primary.ss-all', { onClick: (e) => claim(e.currentTarget, 'all') }, icon('gift', 16), t('Claim all ({n})', { n: d.unclaimed })) : h('span.pill', icon('check', 12), t('All caught up')),
            d.badges.length ? h('div.tiny.muted', '🏅 ' + t('{n} season badges', { n: d.badges.length })) : null)),
        h('p.small.muted.ss-how', icon('info', 14), ' ', t('Everything you do in Nebulix gives season points (SP): every XP point is 1 SP, daily quests give extra and weekly challenges give a lot. Casino bets never count.')),
        h('div.ss-cols',
          h('div.card', h('h3', icon('calendar', 17), ' ', t('Weekly challenges'), h('span.tiny.muted', ' · ' + t('new ones in {t}', { t: left(d.weekEndsAt - Date.now()) }))),
            h('div.ss-ch', d.weekly.map((c) => h('div.ss-c' + (c.done ? '.done' : ''), h('span.ss-ci', c.icon), h('div.grow', h('b.small', L(c.n)), h('div.ss-bar.sm', h('i', { style: { width: Math.min(100, (c.have / c.goal) * 100) + '%' } })), h('span.tiny.muted', c.have + '/' + c.goal)), h('span.ss-sp', c.done ? '✓' : '+' + c.sp + ' SP'))))),
          h('div.card', h('h3', icon('target', 17), ' ', t('Today')),
            quests.length ? h('div.ss-ch', quests.map((q) => h('div.ss-c' + (q.claimed ? '.done' : ''), h('span.ss-ci', q.icon || '🎯'), h('div.grow', h('b.small', t(q.name, { n: q.goal })), h('div.ss-bar.sm', h('i', { style: { width: Math.min(100, (q.n / q.goal) * 100) + '%' } })), h('span.tiny.muted', q.n + '/' + q.goal)),
              q.claimed ? h('span.ss-sp', '✓') : q.n >= q.goal ? h('button.btn.sm.primary', { onClick: (e) => busy(e.currentTarget, async () => { try { await api.post('/api/progress/quests/' + q.id + '/claim'); toast(t('Quest complete!'), 'coin'); await load(); } catch (er) { toastErr(er); } }) }, t('Claim')) : h('span.ss-sp', '+' + (60 + (q.xp || 0)) + ' SP')))) : h('p.small.muted', t('No quests today.')),
            h('div.row', { style: 'gap:8px;margin-top:10px;flex-wrap:wrap' }, h('a.btn.sm', { href: '#/wallet' }, '🎡 ' + t('Daily reward')), h('a.btn.sm', { href: '#/progress' }, icon('trophy', 14), t('Achievements'))))),
        h('h3.ss-h', icon('gift', 17), ' ', t('Rewards')), track);
      const firstReady = track.querySelector('.ss-tier.ready') || track.children[Math.max(0, d.tier - 1)]; if (firstReady) requestAnimationFrame(() => { track.scrollLeft = firstReady.offsetLeft - 40; });
    }
    return () => {};
  },
};
