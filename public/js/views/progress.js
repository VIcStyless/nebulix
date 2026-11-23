// Achievements: level & XP, daily quests, achievements (with profile showcase) and leaderboards.
import { h, mount, fmt } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { S, bus } from '../state.js';
import { icon } from '../icons.js';
import { avatarEl, nameEl, badgeGlyph } from '../cosmetics.js';
import { tabsEl, segEl, toast, toastErr, loading, emptyState, busy, countUp } from '../ui.js';
import { progressDefs, RARITY } from '../progress-fx.js';

const levelReward = (L) => 20 + L * 10 + ([5, 10, 25, 50, 75, 100].includes(L) ? L * 20 : 0);
const BOARDS = [['xp', 'All-time XP'], ['weekly', 'This week'], ['coins', 'Coins'], ['duels', 'Duel wins'], ['arcade_snake', 'Snake'], ['arcade_2048', '2048'], ['arcade_aim', 'Aim'], ['arcade_typing', 'Typing']];
const RAR_ORDER = ['legendary', 'epic', 'rare', 'common'];

export default {
  title: () => t('Achievements'),
  async mount(root, ctx) {
    mount(root, loading());
    const defs = await progressDefs();
    let st = null; let tab = ctx.query.get('tab') || 'quests'; let filter = 'all'; let board = 'xp'; const offs = []; let tick = null;
    const load = async () => { st = await api.get('/api/progress'); };
    try { await load(); } catch (e) { mount(root, emptyState('🏆', t('Could not load your progress'), e.message)); return; }

    const inner = h('div.inner'); mount(root, inner);
    const head = h('div'); const tabs = tabsEl([['quests', t('Daily quests'), 'gift'], ['ach', t('Achievements'), 'trophy'], ['boards', t('Leaderboards'), 'star']], tab, (v) => { tab = v; paintBody(); });
    const body = h('div'); inner.append(head, tabs, body);

    function paintHead() {
      const lv = st.level; const pct = Math.round(lv.into / Math.max(1, lv.need) * 100);
      const unlocked = st.achievements.length;
      const xpNum = h('b'); const card = h('div.card.glow.pr-head',
        h('div.pr-lvl', h('span.lvl-ring.big', { style: `--p:${pct}` }, h('b', String(lv.level))), h('span.tiny.muted', t('Level'))),
        h('div.grow', h('div.row.wrap', avatarEl(S.me, { size: 34 }), h('h2', { style: 'margin:0' }, nameEl(S.me))),
          h('div.xpbar.big', { style: 'margin:10px 0 6px' }, h('i', { style: `width:${pct}%` })),
          h('div.row.wrap.small.muted', h('span', xpNum, ' / ' + fmt.num(lv.need) + ' XP'), h('span', '·'), h('span', t('Next level: +{n} coins', { n: levelReward(lv.level + 1) })), h('span', '·'), h('span', t('{n} XP this week', { n: fmt.num(st.week) })))),
        h('div.pr-stats', h('div', h('b', fmt.num(st.level.xp)), h('span.tiny.muted', t('Total XP'))), h('div', h('b', `${unlocked}/${defs.achievements.length}`), h('span.tiny.muted', t('Achievements'))), h('div', h('b', fmt.num(st.counters.duelWins || 0)), h('span.tiny.muted', t('Duel wins')))));
      mount(head, card); countUp(xpNum, Math.max(0, lv.into - 40), lv.into, 600);
    }
    function paintBody() { clearInterval(tick); ({ quests: paintQuests, ach: paintAch, boards: paintBoards }[tab] || paintQuests)(); }

    function paintQuests() {
      const left = h('span.mono');
      const upd = () => { const s = Math.max(0, Math.floor((st.resetAt - Date.now()) / 1000)); left.textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; if (s <= 0) { clearInterval(tick); load().then(() => { paintHead(); paintQuests(); }); } };
      tick = setInterval(upd, 1000); upd();
      mount(body, h('div.col',
        h('div.row.between.wrap', h('p.muted', { style: 'margin:0' }, t('Three new quests every day. Finish them, then claim coins and XP.')), h('span.pill', '', t('New quests in'), ' ', left)),
        h('div.grid.cols-3', st.quests.map((q) => {
          const done = q.n >= q.goal; const pct = Math.round(Math.min(1, q.n / q.goal) * 100);
          const claim = h('button.btn' + (done && !q.claimed ? '.primary' : ''), { disabled: !done || q.claimed, onClick: (e) => busy(e.currentTarget, async () => { try { const r = await api.post(`/api/progress/quests/${q.id}/claim`); st = r.state; toast(t('+{c} coins and +{x} XP', { c: r.coins !== undefined ? q.coins : 0, x: q.xp }), 'coin'); paintHead(); paintQuests(); } catch (err) { toastErr(err); } }) }, q.claimed ? h('span', '', t('Claimed')) : done ? t('Claim reward') : t('In progress'));
          return h('div.card.pr-quest' + (q.claimed ? '.claimed' : done ? '.ready' : ''), h('div.pr-qic', badgeGlyph(q.icon)), h('b', t(q.name, { n: q.goal })), h('div.xpbar', h('i', { style: `width:${pct}%` })), h('div.row.between.small', h('span.muted', `${Math.min(q.n, q.goal)} / ${q.goal}`), h('span', h('span.coin', String(q.coins)), ' · ', q.xp + ' XP')), claim);
        })),
        h('div.card', h('h3', t('How to earn XP')), h('div.pr-earn', [['chat', t('Chat in community servers')], ['dice', t('Play in the casino')], ['gamepad', t('Arcade games and duels')], ['music', t('Listen to music in Pulse')], ['sliders', t('Mix tracks in DJ mode')], ['palette', t('Publish and install themes')], ['flask', t('Run Nerd Lab tests')], ['gift', t('Claim your daily reward')]].map(([e, l]) => h('div.row.small', h('span.muted', icon(e, 15)), h('span', l)))), h('p.tiny.muted', t('Each activity has a daily XP limit, so playing a bit of everything levels you up fastest.')))));
    }

    function progressOf(a) {
      if (a.kind === 'count') return Math.min(1, (st.counters[a.key] || 0) / a.goal);
      if (a.kind === 'best') return Math.min(1, (st.best[a.key] || 0) / a.goal);
      if (a.kind === 'level') return Math.min(1, st.level.level / a.goal);
      return 0;
    }
    function paintAch() {
      const have = new Map(st.achievements.map((x) => [x.id, x.t]));
      let list = defs.achievements.slice();
      if (filter === 'unlocked') list = list.filter((a) => have.has(a.id)); else if (filter === 'locked') list = list.filter((a) => !have.has(a.id));
      list.sort((a, b) => (have.has(b.id) - have.has(a.id)) || RAR_ORDER.indexOf(a.rarity) - RAR_ORDER.indexOf(b.rarity));
      const show = new Set(st.showcase);
      const toggleShow = async (id) => {
        const ids = show.has(id) ? st.showcase.filter((x) => x !== id) : [...st.showcase, id].slice(-3);
        try { const r = await api.put('/api/progress/showcase', { ids }); st.showcase = r.showcase; paintAch(); toast(t('Profile showcase updated'), 'good'); } catch (e) { toastErr(e); }
      };
      mount(body, h('div.col',
        h('div.row.between.wrap', segEl([['all', t('All')], ['unlocked', t('Unlocked')], ['locked', t('Locked')]], filter, (v) => { filter = v; paintAch(); }), h('span.small.muted', t('Pin up to 3 unlocked achievements to show on your profile.'))),
        h('div.pr-achs', list.map((a) => {
          const got = have.get(a.id); const p = progressOf(a);
          return h('div.pr-ach' + (got ? '.got' : ''), { style: `--rc:${RARITY[a.rarity] || RARITY.common}` },
            h('div.pr-aic', badgeGlyph(a.icon)), h('div.grow', h('div.row.between', h('b', t(a.name)), h('span.pr-rar', t(a.rarity[0].toUpperCase() + a.rarity.slice(1)))), h('div.small.muted', t(a.desc)),
              got ? h('div.tiny.muted', t('Unlocked {d}', { d: fmt.date(got) })) : (a.kind !== 'flag' ? h('div.xpbar.sm', h('i', { style: `width:${Math.round(p * 100)}%` })) : null)),
            h('div.col.gap-s', { style: 'align-items:flex-end' }, a.coins ? h('span.coin.small', String(a.coins)) : null, got ? h('button.btn.ghost.icon.sm' + (show.has(a.id) ? '.on' : ''), { title: show.has(a.id) ? t('Remove from profile') : t('Show on my profile'), onClick: () => toggleShow(a.id) }, icon('star', 15)) : null));
        }))));
    }

    async function paintBoards() {
      const sel = segEl(BOARDS.map(([k, l]) => [k, t(l)]), board, (v) => { board = v; paintBoards(); });
      const list = h('div.col'); mount(body, h('div.col', sel, list)); mount(list, loading());
      try {
        const r = await api.get('/api/leaderboard?kind=' + board); if (tab !== 'boards') return;
        const unit = board === 'coins' ? t('coins') : board.startsWith('arcade_') ? (board === 'arcade_typing' ? 'WPM' : board === 'arcade_aim' ? t('hits') : t('pts')) : board === 'duels' ? t('wins') : 'XP';
        mount(list, r.top.length ? h('div.card.pr-board', r.top.map((x) => h('button.pr-row' + (x.user.id === S.me.id ? '.me' : ''), { onClick: () => ctx.go('profile', x.user.username) },
          h('span.pr-rank', '#' + x.rank), avatarEl(x.user, { size: 34, status: true }), h('div.grow', nameEl(x.user), h('div.tiny.muted', t('Level {n}', { n: x.level }))), h('b.mono', fmt.num(x.score) + ' ' + unit)))) : emptyState('🏁', t('Nobody here yet'), t('Be the first on this board!')),
          r.me ? h('div.card.tight.row', h('span', t('Your rank')), h('b', '#' + r.me.rank), h('span.muted', t('of {n}', { n: r.total })), h('div.grow'), h('b.mono', fmt.num(r.me.score) + ' ' + unit)) : h('p.small.muted', t('You are not on this board yet.')));
      } catch (e) { mount(list, emptyState('⚠️', e.message)); }
    }

    paintHead(); paintBody();
    offs.push(bus.on('ws:prog', async () => { try { await load(); paintHead(); if (tab !== 'boards') paintBody(); } catch {} }));
    return () => { offs.forEach((f) => f()); clearInterval(tick); };
  },
};
