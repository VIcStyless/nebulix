// Nebulix 3.0 phase 21 — Recruitment: teams looking for players and players looking for a team, per game. Posts last
// 30 days (renewable); "I'm interested" notifies the author, who sees the list and replies by DM. Ranks are what the
// players write themselves — Nebulix does not read official game stats. #/recruit
import { h, mount, fmt } from '../util.js';
import { t, locale } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { avatarEl } from '../cosmetics.js';
import { toast, toastErr, modal, field, segEl, switchEl, emptyState, loading, confirmBox } from '../ui.js';

export const GAME_NAMES = { fortnite: 'Fortnite', valorant: 'Valorant', rocketleague: 'Rocket League', cs2: 'Counter-Strike 2', minecraft: 'Minecraft', lol: 'League of Legends', apex: 'Apex Legends', overwatch: 'Overwatch 2', r6: 'Rainbow Six Siege', nebulix: 'Nebulix Arena', other: 'Other' };
const ROLES = { valorant: ['Duelist', 'Initiator', 'Controller', 'Sentinel', 'IGL', 'Flex'], cs2: ['Entry', 'AWP', 'Support', 'Lurker', 'IGL', 'Anchor'], rocketleague: ['Striker', 'Midfield', 'Goalkeeper', 'Rotation'], fortnite: ['IGL', 'Fragger', 'Support', 'Builder'], lol: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'], overwatch: ['Tank', 'Damage', 'Support'], apex: ['IGL', 'Fragger', 'Support', 'Recon'], r6: ['Entry', 'Support', 'Flex', 'Anchor', 'Roamer', 'IGL'], minecraft: ['PvP', 'Builder', 'Redstone', 'Speedrun', 'Survival'], nebulix: ['Royale', 'Ops 5v5', '1v1'], other: [] };
const REGIONS = () => ({ any: t('Any region'), eu: 'EU', na: 'NA', latam: 'LATAM', br: 'BR', asia: 'Asia', oce: 'OCE', me: t('Middle East') });
const PLAT = () => ({ any: t('Any platform'), pc: 'PC', console: t('Console'), mobile: t('Mobile') });
const gname = (p) => (p.game === 'other' ? p.gameName || t('Other') : GAME_NAMES[p.game]);

export default {
  title: () => t('Recruitment'),
  async mount(root, ctx) {
    let game = ctx.params[0] && GAME_NAMES[ctx.params[0]] ? ctx.params[0] : ''; let kind = ''; let region = 'any'; let q = ''; let mine = false; let data = null;
    const games = h('div.rc-games'); const list = h('div.rc-list', loading());
    const kindSeg = segEl([['', t('All')], ['team', t('Teams recruiting')], ['player', t('Players looking')], ['scrim', t('Scrims')]], kind, (v) => { kind = v; load(); });
    const regSel = h('select.input', { 'aria-label': t('Region'), onChange: (e) => { region = e.target.value; load(); } }, Object.entries(REGIONS()).map(([k, n]) => h('option', { value: k }, n)));
    const search = h('input.input', { type: 'search', placeholder: t('Search rank, role or text'), onInput: (e) => { q = e.target.value; clearTimeout(search._t); search._t = setTimeout(load, 300); } });
    const mineBtn = h('button.chip', { onClick: () => { mine = !mine; mineBtn.classList.toggle('on', mine); load(); } }, t('My posts'));
    mount(root, h('div.inner.rc',
      h('div.page-title', h('div', h('h2', icon('users', 22), ' ', t('Recruitment')), h('p', t('Find a team, new teammates or a scrim opponent for Fortnite, Valorant, Rocket League, CS2, Minecraft and more. Posts stay up for 30 days; scrims until they start.'))),
        h('button.btn.primary', { onClick: create }, icon('plus', 16), t('New post'))),
      games, h('div.toolbar', search, kindSeg, regSel, mineBtn), list,
      h('p.tiny.muted', { style: 'margin-top:14px' }, t('Ranks and roles are written by the players themselves; Nebulix does not connect to official game accounts. Meet people safely: keep personal details private and report anything wrong.'))));

    const paintGames = () => mount(games, h('button.rc-game' + (!game ? '.on' : ''), { onClick: () => { game = ''; load(); } }, h('b', t('All games'))),
      Object.entries(GAME_NAMES).map(([k, n]) => h('button.rc-game' + (game === k ? '.on' : ''), { onClick: () => { game = k; load(); } }, h('b', k === 'other' ? t('Other') : n), h('span.tiny', String((data && data.counts[k]) || 0)))));
    async function load() {
      history.replaceState(null, '', '#/recruit' + (game ? '/' + game : ''));
      const p = new URLSearchParams({ game, kind, region, q, mine: mine ? '1' : '' });
      try { data = await api.get('/api/recruit?' + p); } catch (e) { toastErr(e); return; }
      paintGames();
      if (!data.posts.length) return mount(list, emptyState('users', t('No posts here yet'), mine ? t('You have no open posts.') : t('Be the first: post that your team needs players, or that you are looking for a team.'), h('button.btn.primary', { onClick: create }, t('New post'))));
      mount(list, data.posts.map(cardEl));
    }
    function cardEl(p) {
      const left = Math.max(0, p.expires - Date.now()); const scrim = p.kind === 'scrim';
      const whenTxt = scrim ? new Date(p.when).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const acts = p.mine
        ? [h('button.btn.sm', { onClick: () => showInterested(p) }, icon('users', 14), t('Interested ({n})', { n: p.interested })), scrim ? null : h('button.btn.sm.ghost', { onClick: async () => { try { await api.post('/api/recruit/' + p.id + '/renew'); toast(t('Renewed for 30 days')); load(); } catch (e) { toastErr(e); } } }, icon('refresh', 14), t('Renew')),
          h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Close this post?'), { danger: true, ok: t('Close') })) { try { await api.del('/api/recruit/' + p.id); load(); } catch (e) { toastErr(e); } } } }, t('Close'))]
        : [h('button.btn.sm' + (p.imIn ? '' : '.primary'), { onClick: async () => { try { const r = await api.post('/api/recruit/' + p.id + '/interest'); toast(r.post.imIn ? t('The author was told you are interested') : t('Removed')); load(); } catch (e) { toastErr(e); } } }, icon(p.imIn ? 'check' : 'star', 14), p.imIn ? (scrim ? t('You’re in') : t('Interested')) : scrim ? t('We want to play') : t('I’m interested')),
          p.by ? h('button.btn.sm', { onClick: () => ctx.go('dm', p.by.id) }, icon('mail', 14), t('Message')) : null];
      return h('article.card.rc-card.' + p.kind,
        h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('span.tag.acc', scrim ? t('Scrim') : p.kind === 'team' ? t('Team recruiting') : t('Looking for a team')), scrim ? h('span.tag.rc-when', icon('calendar', 11), whenTxt) : null, h('span.tag', gname(p)), p.rank ? h('span.tag', icon('trophy', 11), p.rank) : null, h('span.tag', REGIONS()[p.region] || p.region), h('span.tag', PLAT()[p.platform] || p.platform), p.mic ? h('span.tag', icon('mic', 11), t('Voice')) : null, p.lang ? h('span.tag', p.lang) : null, p.age ? h('span.tag', p.age) : null),
        h('h3', p.title), p.text ? h('p.rc-text', p.text) : null,
        p.roles.length ? h('div.row', { style: 'gap:4px;flex-wrap:wrap' }, h('span.tiny.muted', p.kind === 'player' ? t('Plays:') : scrim ? t('Format:') : t('Looking for:')), p.roles.map((r) => h('span.chip.on.sm', t(r)))) : null,
        h('div.rc-foot', p.by ? avatarEl(p.by, { size: 26 }) : null, h('div.grow.tiny.muted', '@' + (p.by ? p.by.username : '?') + ' · ' + fmt.rel(p.created) + ' · ' + (scrim ? (p.when > Date.now() ? t('starts in {t}', { t: fmt.dur((p.when - Date.now()) / 1000) }) : t('in progress')) : t('closes in {t}', { t: fmt.dur(left / 1000) }))), ...acts));
    }
    async function showInterested(p) {
      try {
        const r = await api.get('/api/recruit/' + p.id + '/interested');
        modal({ title: t('Interested players'), body: r.users.length ? h('div.col', r.users.map((u) => h('div.row', { style: 'gap:8px;align-items:center' }, avatarEl(u, { size: 32 }), h('b.grow', u.displayName || u.username), h('button.btn.sm', { onClick: () => ctx.go('profile', u.username) }, t('Profile')), h('button.btn.sm.primary', { onClick: () => ctx.go('dm', u.id) }, icon('mail', 13), t('Message'))))) : h('p.muted', t('Nobody yet. You will get a notification when someone is interested.')), actions: [{ label: t('Close') }] });
      } catch (e) { toastErr(e); }
    }
    function create() {
      let k = kind === 'scrim' ? 'scrim' : 'team', g = game || 'valorant', plat = 'any', mic = false, age = ''; const picked = new Set();
      const gSel = h('select.input', Object.entries(GAME_NAMES).map(([id, n]) => h('option', { value: id, selected: id === g }, id === 'other' ? t('Other') : n)));
      const gName = h('input.input', { maxlength: 40, placeholder: t('Name of the game') }); const gNameF = field(t('Game name'), gName);
      const title = h('input.input', { maxlength: 80, placeholder: t('e.g. Gold team needs a Sentinel for weekly scrims') });
      const text = h('textarea.input', { rows: 4, maxlength: 800, placeholder: t('Schedule, goals (fun, ranked, tournaments), what you expect…') });
      const rank = h('input.input', { maxlength: 30, placeholder: t('e.g. Gold 2, Diamond, Champion') }); const lang = h('input.input', { maxlength: 20, placeholder: t('Español, English…') });
      const regSel2 = h('select.input', Object.entries(REGIONS()).map(([id, n]) => h('option', { value: id }, n)));
      const rolesBox = h('div.row', { style: 'gap:4px;flex-wrap:wrap' });
      const soon = new Date(Date.now() + 86400000); soon.setMinutes(0, 0, 0); const whenIn = h('input.input', { type: 'datetime-local' }); whenIn.value = new Date(soon - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const whenF = field(t('Scrim date and time'), whenIn, t('Shown in each player’s own time zone. The post closes 3 hours after the start.')); const rolesF = field(t('Roles'), rolesBox);
      const paintRoles = () => { gNameF.style.display = g === 'other' ? '' : 'none'; whenF.style.display = k === 'scrim' ? '' : 'none'; rolesF.style.display = k === 'scrim' ? 'none' : ''; mount(rolesBox, (ROLES[g] || []).map((r) => { const b = h('button.chip' + (picked.has(r) ? '.on' : ''), { type: 'button', onClick: () => { if (picked.has(r)) picked.delete(r); else picked.add(r); b.classList.toggle('on'); } }, t(r)); return b; })); if (!(ROLES[g] || []).length) rolesBox.append(h('span.tiny.muted', t('Write roles in the text.'))); };
      gSel.addEventListener('change', () => { g = gSel.value; picked.clear(); paintRoles(); });
      paintRoles();
      modal({ title: t('New recruitment post'), body: h('div.col',
        field(t('Type'), segEl([['team', t('My team needs players')], ['player', t('I am looking for a team')], ['scrim', t('Scrim: we need an opponent')]], k, (v) => { k = v; paintRoles(); })),
        h('div.grid.cols-2', field(t('Game'), gSel), gNameF), whenF, field(t('Title'), title), rolesF, h('div.grid.cols-2', field(t('Rank (optional)'), rank), field(t('Region'), regSel2)),
        field(t('Platform'), segEl(Object.entries(PLAT()), plat, (v) => { plat = v; })), h('div.grid.cols-2', field(t('Language (optional)'), lang), field(t('Minimum age (optional)'), segEl([['', t('None')], ['13+', '13+'], ['16+', '16+'], ['18+', '18+']], age, (v) => { age = v; }))),
        field(t('Voice chat'), h('div.row', switchEl(false, (v) => { mic = v; }), h('span.small.muted', t('Mic required')))), field(t('Details'), text)),
      actions: [{ label: t('Cancel') }, { label: t('Publish'), kind: 'primary', onClick: async () => { try { await api.post('/api/recruit', { kind: k, game: g, gameName: gName.value, title: title.value, text: text.value, roles: [...picked], rank: rank.value, region: regSel2.value, platform: plat, lang: lang.value, mic, age, when: k === 'scrim' && whenIn.value ? new Date(whenIn.value).getTime() : undefined }); toast(t('Post published'), 'good'); game = g; if (k === 'scrim') { kind = 'scrim'; kindSeg.set('scrim'); } mine = false; mineBtn.classList.remove('on'); load(); } catch (e) { toastErr(e); return false; } } }] });
    }
    await load();
  },
};
