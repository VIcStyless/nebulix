// Home: greeting + clock, launcher, KPIs, apps, daily reward, friends online, focus timer, squads, events, activity.
import { h, mount, fmt, ls, countUp } from '../util.js';
import { t, locale, getLang as _gl } from '../i18n.js';
import { api } from '../api.js';
import { S, bus, patchMe } from '../state.js';
import { icon } from '../icons.js';
import { avatarEl, nameEl, badgesEl } from '../cosmetics.js';
import { toast, toastErr, confetti } from '../ui.js';
import { sfx } from '../sfx.js';
import { GAMES, siteLogo } from '../sites.js';
import { focusWidget } from '../widgets/focus.js';
import { addEmailFlow } from '../addemail.js';
import { commandCentre } from '../widgets/command.js';
import { appTile } from '../apps-meta.js';
import { designNow, setDesign } from '../app.js';

const APPS = [
  ['games', 'Nebulix Games', 'Every game in one place', 'gamepad'], ['worlds', 'Nebula Worlds', '3D worlds and builder', 'cube'], ['boss', 'World Boss', 'Fight it together', 'zap'],
  ['clans', 'Clans', 'Team up, Clan War', 'shield'], ['leagues', 'Leagues', 'Climb every week', 'medal'], ['tournaments', 'Tournaments', 'Prizes every hour', 'trophy'],
  ['browse', 'Browser', 'Private, unblocked', 'globe'], ['chat', 'Community', 'Servers and roles', 'users'],
  ['dm', 'Messages', 'End-to-end encrypted', 'mail'], ['squads', 'Squads', 'Find teammates', 'target'],
  ['events', 'Events', 'Tournaments and nights', 'calendar'], ['play', 'Games', 'Web games, unblocked', 'puzzle'],
  ['music', 'Pulse', 'Music, radio, DJ', 'music'],
  ['arcade', 'Arcade', 'Mini-games, duels', 'gamepad'], ['library', 'Game library', 'Backlog and hours', 'layers'],
  ['notes', 'Notes', 'Your scratchpad', 'note'], ['nova', 'Nova AI', 'Ask anything', 'spark'], ['translate', 'Translator', '19 languages', 'translate'],
  ['casino', 'Casino', 'Play money only', 'dice'], ['market', 'Market', 'Profile cosmetics', 'bag'],
  ['themes', 'Themes', 'Create and share', 'palette'], ['nerd', 'Nerd Lab', 'Benchmarks, Linux', 'flask'],
  ['progress', 'Achievements', 'Levels and quests', 'trophy'], ['desktop', 'Desktop mode', 'Windows and widgets', 'desktop'],
];

function greeting() { const hr = new Date().getHours(); return hr < 6 ? t('Up late') : hr < 12 ? t('Good morning') : hr < 19 ? t('Good afternoon') : t('Good evening'); }
function reason(r) {
  if (r === 'daily') return t('Daily reward'); if (r === 'welcome') return t('Welcome bonus'); if (r === 'admin') return t('Staff adjustment'); if (r === 'theme_install') return t('Someone installed your theme');
  if (r.startsWith('buy:')) return t('Market purchase'); if (r.startsWith('casino:')) return t('Casino') + ' · ' + r.slice(7); return r;
}

export default {
  title: () => t('Home'),
  async mount(root, ctx) {
    const unsubs = []; let timer = null; let rot = 0; let daily = null; let spinning = false; const go = ctx.go;
    const reduce = () => document.documentElement.dataset.reduce === '1';

    // ----- header + clock -----
    const clockT = h('b'); const clockD = h('span');
    const paintClock = () => { const d = new Date(); clockT.textContent = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }); clockD.textContent = d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }); };
    const head = h('div.home-head',
      h('div', h('div.eyebrow', greeting()), h('h2', nameEl(S.me, { size: 'inherit' }), badgesEl(S.me))),
      h('div.home-clock', clockT, clockD));

    // ----- launcher -----
    const q = h('input', { placeholder: t('Search the web or type a URL…'), 'aria-label': t('Search the web or type a URL…'), autocomplete: 'off', spellcheck: 'false' });
    const launch = () => { const v = q.value.trim(); go('browse', v ? { go: v } : undefined); };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') launch(); });
    // recent sites from the browser history first (one per host), then popular game sites
    const recent = []; const hosts = new Set();
    for (const x of ls('history') || []) { let host = ''; try { host = new URL(x.url).hostname.replace(/^www\./, ''); } catch { continue; } if (hosts.has(host)) continue; hosts.add(host); recent.push([host, x.url]); if (recent.length >= 5) break; }
    const chips = recent.map(([n, u]) => h('button.chip', { title: u, onClick: () => go('browse', { go: u }) }, icon('clock', 12), n))
      .concat(GAMES.filter(([, , u]) => !hosts.has(new URL(u).hostname.replace(/^www\./, ''))).slice(0, 8 - Math.min(recent.length, 4)).map(([, n, u]) => h('button.chip', { onClick: () => go('browse', { go: u }) }, n)));
    const launcher = h('div', h('div.launch', icon('search', 18), q, h('button.btn.primary', { onClick: launch }, t('Go'), icon('fwd', 15))),
      h('div.launch-chips', chips));

    // ----- KPIs -----
    const kpis = h('div.kpis'); let lastStats = {}; let level = null;
    const paintKpis = (stats) => {
      if (stats) lastStats = stats;
      const k = (ic, lbl, v, numeric = true) => {
        const b = h('b'); if (numeric && Number.isFinite(v)) countUp(b, v, { format: (n) => (ic === 'coins' || ic === 'spark' ? fmt.coins(n) : fmt.num(Math.round(n))) }); else b.textContent = v;
        return h('div.kpi', h('span.ki', icon(ic, 16)), h('div.kv', b, h('span', lbl)));
      };
      kpis.replaceChildren(
        k('coins', t('Coins'), S.me.coins),
        k('trophy', t('Level'), level ? level.level : '—', !!level),
        k('mail', t('Messages sent'), (S.me.stats || {}).messages || 0),
        k('spark', t('Biggest win'), lastStats.biggest || 0));
    };
    api.get('/api/progress', { quiet: true }).then((p) => { level = p.level; paintKpis(); }).catch(() => {});

    // ----- apps -----
    const apps = h('section.card.s8', h('div.card-head', h('h3', icon('grid', 16), t('Apps'))),
      h('div.apps', APPS.map(([r, l, d, ic]) => h('button.app-tile', { onClick: () => (r === 'desktop' ? window.__nbx.openDesktop() : go(r)) }, appTile(r, ic, 32), h('span.at', h('span', t(l)), h('small', t(d)))))));

    // ----- daily wheel -----
    const wheelVals = [10, 15, 20, 25, 30, 40, 60, 150]; const step = 360 / wheelVals.length;
    const c1 = 'var(--surface2)'; const c2 = 'var(--surface)'; const ac = 'var(--accent)'; // live CSS variables, so the wheel follows theme changes
    const grad = 'conic-gradient(' + wheelVals.map((v, i) => `${v === 150 ? ac : i % 2 ? c1 : c2} ${i * step}deg ${(i + 1) * step}deg`).join(',') + ')';
    const wheel = h('div.wheel', { style: { background: grad } }, wheelVals.map((v, i) => h('div.wheel-seg' + (v === 150 ? '.hot' : ''), { style: { transform: `rotate(${i * step + step / 2}deg)` } }, v)));
    const result = h('div.small', { style: 'min-height:1.4em' });
    const streakBar = h('div.streak'); const streakTxt = h('div.tiny.muted'); const shieldEl = h('div.row.streak-shield', { style: 'gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px' }); let shieldSig = '';
    const claimBtn = h('button.btn.primary.block', { onClick: claim }, t('Spin & claim'));
    const dailyCard = h('section.card.s4', h('div.card-head', h('h3', icon('gift', 16), t('Daily reward'))),
      h('div.daily', h('div.wheel-wrap', h('div.wheel-ptr'), wheel, h('div.wheel-hub', icon('coins', 16))), h('div.daily-info', streakBar, streakTxt, shieldEl, result)), h('div', { style: 'margin-top:14px' }, claimBtn));
    const paintDaily = () => {
      if (!daily) return;
      const left = Math.max(0, (daily.nextAt - Date.now()) / 1000); const can = daily.can || left <= 0;
      claimBtn.disabled = !can || spinning;
      claimBtn.textContent = can ? t('Spin & claim') : t('Next reward in {t}', { t: fmt.dur(left) });
      const n = Math.min(7, daily.streak || 0);
      streakBar.replaceChildren(...Array.from({ length: 7 }, (_, i) => h('i' + (i < n ? '.on' : ''))));
      streakTxt.textContent = daily.streak > 0 ? t('{n}-day streak · +{b} bonus', { n: daily.streak, b: daily.bonus }) : t('Claim daily to build a streak bonus.');
      const sig = [daily.freezes, daily.freezeMax, daily.saving].join(); if (daily.freezeMax && sig !== shieldSig) shieldSig = sig, mount(shieldEl, h('span.tiny', icon('shield', 13), ' ' + t('Streak shields: {n}/{m}', { n: daily.freezes || 0, m: daily.freezeMax })), daily.saving ? h('span.pill', t('A shield is saving your streak')) : null, (daily.freezes || 0) < daily.freezeMax ? h('button.btn.sm.ghost', { title: t('Protects your streak if you miss a day'), onClick: async (e) => { e.currentTarget.disabled = true; try { const r = await api.post('/api/economy/daily/shield'); daily = Object.assign({}, daily, r.daily); patchMe({ coins: r.coins }); toast(t('Streak shield bought'), 'good'); } catch (err) { toastErr(err); } paintDaily(); } }, t('Buy · {p} coins', { p: daily.freezePrice })) : null);
    };
    async function claim() {
      if (spinning) return; spinning = true; claimBtn.disabled = true; result.textContent = '';
      try {
        const r = await api.post('/api/economy/daily');
        const jitter = (Math.random() - .5) * step * .6; const c = r.index * step + step / 2 + jitter;
        rot += 360 * 5 + ((((-c - rot) % 360) + 360) % 360);
        wheel.style.transform = `rotate(${rot}deg)`; sfx.spin();
        setTimeout(() => {
          spinning = false; sfx.big(); confetti();
          result.replaceChildren(h('span.coin', '+' + fmt.num(r.total)), h('div.tiny.muted', t('{b} from the wheel + {n} streak bonus', { b: r.base, n: r.bonus })));
          patchMe({ coins: r.coins });
          daily = Object.assign({}, daily, { can: false, nextAt: Date.now() + 20 * 3600 * 1000, streak: r.streak, bonus: Math.min(r.streak + 1, 7) * 3, freezes: Math.max(0, (daily.freezes || 0) - (daily.saving || 0)), saving: 0 }); paintDaily(); loadTx();
        }, reduce() ? 80 : 4300);
      } catch (e) { spinning = false; toastErr(e); loadDaily(); }
    }

    // ----- friends online -----
    const friendsBox = h('div.col', { style: 'gap:2px' });
    const paintFriends = () => {
      const online = (S.friends.friends || []).filter((f) => S.online.has(f.id));
      friendsBox.replaceChildren(...(online.length ? online.slice(0, 7).map((f) => h('button.link-tile', { onClick: () => go('dm', f.id) }, avatarEl(f, { size: 30, status: true }), h('div.grow', nameEl(f)), icon('mail', 15)))
        : [h('div.muted.small', { style: 'padding:6px 2px' }, (S.friends.friends || []).length ? t('Nobody is online right now.') : t('Add friends from Messages to see who is online.'))]));
    };
    const friendsCard = h('section.card.s4', h('div.card-head', h('h3', icon('users', 16), t('Friends online')), h('button.btn.ghost.sm', { onClick: () => go('dm') }, t('Open'))), friendsBox);

    // ----- focus timer -----
    const focus = focusWidget();
    const focusCard = h('section.card.s4', h('div.card-head', h('h3', icon('clock', 16), t('Focus timer'))), focus);

    // ----- squads + events preview -----
    const squadsBox = h('div.col', { style: 'gap:2px' }, h('div.muted.small', t('Loading…')));
    const squadsCard = h('section.card.s6', h('div.card-head', h('h3', icon('target', 16), t('Open squads')), h('button.btn.ghost.sm', { onClick: () => go('squads') }, t('See all'))), squadsBox);
    api.get('/api/squads', { quiet: true }).then((r) => {
      const list = (r.squads || []).filter((s) => !s.full).slice(0, 4);
      squadsBox.replaceChildren(...(list.length ? list.map((s) => h('button.link-tile', { onClick: () => go('squads') }, h('span.li', (s.game || '?').slice(0, 2)), h('div.grow', h('div.small', s.title), h('div.tiny.muted', s.game + ' · ' + t('{a}/{b} players', { a: s.members.length, b: s.size }))), icon('fwd', 14)))
        : [h('div.muted.small', { style: 'padding:6px 2px' }, t('No open squads. Start one and find teammates.'))]));
    }).catch(() => squadsBox.replaceChildren(h('div.muted.small', t('No open squads. Start one and find teammates.'))));
    const eventsBox = h('div.col', { style: 'gap:2px' }, h('div.muted.small', t('Loading…')));
    const eventsCard = h('section.card.s6', h('div.card-head', h('h3', icon('calendar', 16), t('Upcoming events')), h('button.btn.ghost.sm', { onClick: () => go('events') }, t('See all'))), eventsBox);
    api.get('/api/events', { quiet: true }).then((r) => {
      const list = (r.events || []).slice(0, 4);
      eventsBox.replaceChildren(...(list.length ? list.map((e) => { const d = new Date(e.at); return h('button.link-tile', { onClick: () => go('events') }, h('span.li.date-li', h('b', String(d.getDate())), h('small', d.toLocaleDateString(locale(), { month: 'short' }))), h('div.grow', h('div.small', e.title), h('div.tiny.muted', d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) + ' · ' + t('{n} going', { n: e.going }))), icon('fwd', 14)); })
        : [h('div.muted.small', { style: 'padding:6px 2px' }, t('Nothing scheduled yet.'))]));
    }).catch(() => eventsBox.replaceChildren(h('div.muted.small', t('Nothing scheduled yet.'))));

    // ----- activity -----
    const txBox = h('div');
    const paintTx = (tx = []) => txBox.replaceChildren(...(tx.length ? tx.slice(0, 6).map((x) => h('div.tx-row', h('div.grow', h('div', reason(x.r)), h('div.tiny.muted', fmt.rel(x.t))), h('b', { style: `color:${x.d >= 0 ? 'var(--success)' : 'var(--danger)'}` }, (x.d >= 0 ? '+' : '') + fmt.num(x.d))))
      : [h('div.muted.small', t('No activity yet. Claim your daily reward.'))]));
    const activity = h('section.card.s4', h('div.card-head', h('h3', icon('activity', 16), t('Recent activity'))), txBox);
    async function loadDaily() { try { const r = await api.get('/api/economy/state'); daily = r.daily; paintDaily(); paintKpis(r.stats); paintTx(r.tx); } catch { /* offline */ } }
    async function loadTx() { try { const r = await api.get('/api/economy/state'); paintKpis(r.stats); paintTx(r.tx); } catch {} }

    const anns = S.announcements || [];
    const annCard = anns.length ? h('section.card.s12', h('div.card-head', h('h3', icon('bell', 16), t('Announcements'))), h('div.col', { style: 'gap:8px' }, anns.slice(0, 2).map((a) => h('div.ann', h('div', h('b', a.title), h('div.small.muted', a.body), h('div.tiny.muted', fmt.rel(a.t))))))) : null;

    // ----- jump into a game (real site logos, fetched through the proxy) -----
    const gamesCard = h('section.card.s12', h('div.card-head', h('h3', icon('gamepad', 16), t('Jump into a game')), h('span.tiny.muted', t('Opens through the proxy'))),
      h('div.site-grid', GAMES.map(([mono, n, u]) => h('button.site-tile', { title: n, onClick: () => go('browse', { go: u }) }, siteLogo(u, n, mono, 38), h('span.ellipsis', n)))));

    const hero = h('section.home-hero', h('span.hh-orb.o1'), h('span.hh-orb.o2'), h('span.hh-orb.o3'), head, launcher);
    // accounts created without an email get a gentle nudge (and a reward) to add one
    const mailNudge = S.me.noEmail && !(S.cfg && S.cfg.canMail === false) ? h('section.card.mail-nudge', h('span.mn-ic', icon('mail', 20)), h('div.grow', h('b', t('Add your email')), h('div.small.muted', t('Verify your email and get 50 coins + a Verified badge'))), h('button.btn.primary', { onClick: () => addEmailFlow() }, t('Add email'))) : null;
    unsubs.push(bus.on('me', () => { if (mailNudge && S.me && !S.me.noEmail) mailNudge.remove(); }));
    // season pass banner: tier, progress and rewards waiting to be claimed
    const seasonCard = h('a.ss-home', { href: '#/season' });
    api.get('/api/season', { quiet: true }).then((d) => { const pct = d.tier >= d.tiers ? 100 : (d.into / d.tierSp) * 100; const wk = d.weekly.filter((c) => c.done).length;
      mount(seasonCard, h('span.ss-home-ic', '⭐'), h('div.grow', h('b', t('Season') + ' · ' + (_gl() === 'es' ? d.name[1] : d.name[0])), h('div.ss-bar.sm', h('i', { style: { width: pct + '%' } })), h('span.tiny.muted', t('Tier {n}', { n: d.tier }) + ' / ' + d.tiers + ' · ' + t('{a}/{b} weekly challenges', { a: wk, b: d.weekly.length }))),
        d.unclaimed ? h('span.ss-home-badge', t('{n} rewards waiting', { n: d.unclaimed })) : h('span.btn.sm', t('Open'))); }).catch(() => seasonCard.remove());
    const cc = commandCentre({ designNow, setDesign }); unsubs.push(() => cc.stop());
    mount(root, h('div.inner.home', hero, mailNudge, cc, seasonCard, kpis,
      h('div.home-grid', annCard, apps, dailyCard, friendsCard, focusCard, activity, squadsCard, eventsCard),
      gamesCard,
      h('div.footer-credit', 'Nebulix · ', t('Created by') + ' ', h('b', 'VicStyles'))));

    paintClock(); paintFriends(); paintKpis(); paintTx([]);
    unsubs.push(bus.on('friends', paintFriends), bus.on('presence', paintFriends), bus.on('me', () => paintKpis()));
    timer = setInterval(() => { paintDaily(); paintClock(); }, 1000);
    await loadDaily();
    if (ctx.query && ctx.query.get('daily')) { dailyCard.scrollIntoView({ behavior: 'smooth', block: 'center' }); dailyCard.animate([{ boxShadow: '0 0 0 0 var(--accent)' }, { boxShadow: '0 0 0 10px transparent' }], { duration: 900, iterations: 2 }); }
    return () => { clearInterval(timer); focus.destroy(); unsubs.forEach((f) => f()); };
  },
};
