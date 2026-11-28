// Nebulix 3.0 phase 24 — Community Cups: bracket tournaments organised by players, for any game. Sign-ups, seeding,
// single-elimination bracket with byes, best-of series, score reports from both players, disputes settled by the
// organiser. Results are self-reported; there are no coin prizes. #/cups, #/cups/<id>
import { h, mount, fmt } from '../util.js';
import { t, locale } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { avatarEl } from '../cosmetics.js';
import { toast, toastErr, modal, field, segEl, switchEl, emptyState, loading, confirmBox } from '../ui.js';
import { GAME_NAMES } from './recruit.js';

const GAMES = { ...GAME_NAMES, chess: 'Chess' }; delete GAMES.other; GAMES.other = 'Other';
const REGIONS = () => ({ any: t('Any region'), eu: 'EU', na: 'NA', latam: 'LATAM', br: 'BR', asia: 'Asia', oce: 'OCE', me: t('Middle East') });
const gname = (c) => (c.game === 'other' ? c.gameName || t('Other') : c.game === 'chess' ? t('Chess') : GAMES[c.game]);
const STATUS = () => ({ open: t('Registration open'), live: t('In progress'), done: t('Finished'), cancelled: t('Cancelled') });
const roundLabel = (n) => (n === 'final' ? t('Final') : n === 'semi' ? t('Semi-finals') : n === 'quarter' ? t('Quarter-finals') : t('Round {n}', { n: n.slice(1) }));
const need = (bo) => Math.floor(bo / 2) + 1;
const when = (ts) => new Date(ts).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default {
  title: () => t('Community Cups'),
  async mount(root, ctx) {
    if (ctx.params[0]) return cupPage(root, ctx, ctx.params[0]);
    let tab = 'open'; let game = ''; let q = '';
    const list = h('div.cup-list', loading());
    const gSel = h('select.input', { 'aria-label': t('Game'), onChange: (e) => { game = e.target.value; load(); } }, h('option', { value: '' }, t('All games')), Object.entries(GAMES).map(([k, n]) => h('option', { value: k }, k === 'other' ? t('Other') : k === 'chess' ? t('Chess') : n)));
    const search = h('input.input', { type: 'search', placeholder: t('Search cups'), onInput: () => { clearTimeout(search._t); search._t = setTimeout(() => { q = search.value; load(); }, 300); } });
    mount(root, h('div.inner.cups',
      h('div.page-title', h('div', h('h2', icon('trophy', 22), ' ', t('Community Cups')), h('p', t('Bracket tournaments organised by players for any game: sign up, get your matches and report the scores. The organiser settles any disagreement.'))),
        h('div.row', { style: 'gap:6px' }, h('button.btn', { onClick: () => ctx.go('tournaments') }, icon('zap', 16), t('Arcade tournaments')), h('button.btn.primary', { onClick: () => createCup(ctx) }, icon('plus', 16), t('Organise a cup')))),
      h('div.toolbar', segEl([['open', t('Open')], ['live', t('In progress')], ['done', t('Finished')], ['mine', t('Mine')]], tab, (v) => { tab = v; load(); }), gSel, search), list,
      h('p.tiny.muted', { style: 'margin-top:14px' }, t('Scores are reported by the players; Nebulix does not connect to official game accounts. Cups have no coin prizes.'))));
    async function load() {
      try {
        const r = await api.get('/api/cups?' + new URLSearchParams({ tab, game, q }));
        if (!r.cups.length) return mount(list, emptyState('trophy', t('No cups here yet'), tab === 'open' ? t('Organise one and invite your friends or your community.') : '', tab === 'open' ? h('button.btn.primary', { onClick: () => createCup(ctx) }, t('Organise a cup')) : null));
        mount(list, r.cups.map((c) => cupCard(c, ctx)));
      } catch (e) { toastErr(e); }
    }
    await load();
  },
};

function cupCard(c, ctx) {
  return h('button.card.cup-card.' + c.status, { onClick: () => ctx.go('cups', c.id) },
    h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('span.tag.acc', STATUS()[c.status]), h('span.tag', gname(c)), h('span.tag', t('Best of {n}', { n: c.bo })), h('span.tag', REGIONS()[c.region] || c.region), c.unlisted ? h('span.tag', icon('lock', 11), t('Link only')) : null, c.when && c.status === 'open' ? h('span.tag', icon('calendar', 11), when(c.when)) : null),
    h('h3', c.title),
    c.champion ? h('p.cup-champ', icon('trophy', 14), ' ', t('Champion: {n}', { n: '@' + c.champion.username })) : null,
    h('div.cup-foot', c.by ? avatarEl(c.by, { size: 24 }) : null, h('span.grow.tiny.muted', '@' + (c.by ? c.by.username : '?') + ' · ' + fmt.rel(c.created)),
      h('span.pill', icon('users', 12), ` ${c.players}/${c.size}`), c.joined ? h('span.pill.acc', icon('check', 12), t('Joined')) : null));
}

function createCup(ctx, cup) {
  const editing = !!cup; const open = !cup || cup.status === 'open';
  let g = cup ? cup.game : 'valorant', size = cup ? cup.size : 16, bo = cup ? cup.bo : 1, play = false, unlisted = cup ? cup.unlisted : false;
  const gSel = h('select.input', Object.entries(GAMES).map(([id, n]) => h('option', { value: id, selected: id === g }, id === 'other' ? t('Other') : id === 'chess' ? t('Chess') : n)));
  const gName = h('input.input', { maxlength: 40, placeholder: t('Name of the game'), value: cup ? cup.gameName || '' : '' }); const gNameF = field(t('Game name'), gName);
  const title = h('input.input', { maxlength: 70, placeholder: t('e.g. Friday 1v1 Cup'), value: cup ? cup.title : '' });
  const desc = h('textarea.input', { rows: 3, maxlength: 1000, placeholder: t('Who can join, how to contact you, prizes you give yourself…') }); desc.value = cup ? cup.desc || '' : '';
  const rules = h('textarea.input', { rows: 3, maxlength: 1500, placeholder: t('Map pool, game settings, what happens with a no-show…') }); rules.value = cup ? cup.rules || '' : '';
  const regSel = h('select.input', Object.entries(REGIONS()).map(([id, n]) => h('option', { value: id, selected: cup && cup.region === id }, n)));
  const whenIn = h('input.input', { type: 'datetime-local' }); if (cup && cup.when) whenIn.value = new Date(cup.when - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const entry = h('input.input', { maxlength: 30, placeholder: t('Team or in-game name (optional)') });
  const paint = () => { gNameF.style.display = g === 'other' ? '' : 'none'; };
  gSel.addEventListener('change', () => { g = gSel.value; paint(); }); paint();
  const fmtFields = open ? [
    h('div.grid.cols-2', field(t('Game'), gSel), gNameF),
    field(t('Places'), segEl([4, 8, 16, 32, 64].map((n) => [n, String(n)]), size, (v) => { size = v; })),
    field(t('Matches'), segEl([1, 3, 5, 7].map((n) => [n, t('Best of {n}', { n })]), bo, (v) => { bo = v; })),
    h('div.grid.cols-2', field(t('Region'), regSel), field(t('Planned start (optional)'), whenIn)),
    field(t('Visibility'), h('div.row', switchEl(unlisted, (v) => { unlisted = v; }), h('span.small.muted', t('Only people with the link can find it')))),
  ] : [];
  modal({ title: editing ? t('Edit cup') : t('Organise a cup'), body: h('div.col', field(t('Name'), title), ...fmtFields, field(t('Description'), desc), field(t('Rules'), rules),
    editing ? null : field(t('I will play too'), h('div.col', h('div.row', switchEl(false, (v) => { play = v; entry.style.display = v ? '' : 'none'; })), entry))),
  actions: [{ label: t('Cancel') }, { label: editing ? t('Save') : t('Create'), kind: 'primary', onClick: async () => {
    const body = { title: title.value, game: g, gameName: gName.value, desc: desc.value, rules: rules.value, region: regSel.value, size, bo, unlisted, when: whenIn.value ? new Date(whenIn.value).getTime() : null, play, entryName: entry.value };
    try { const r = editing ? await api.put('/api/cups/' + cup.id, body) : await api.post('/api/cups', body); toast(editing ? t('Saved') : t('Cup created. Share the link so people can join.'), 'good'); ctx.go('cups', r.cup.id); } catch (e) { toastErr(e); return false; }
  } }] });
  entry.style.display = 'none';
}

async function cupPage(root, ctx, id) {
  mount(root, h('div.inner', loading()));
  let cup;
  const refresh = async () => { try { cup = (await api.get('/api/cups/' + id)).cup; paint(); } catch (e) { mount(root, h('div.inner', emptyState('trophy', t('Cup not found'), e.message ? t(e.message) : '', h('button.btn', { onClick: () => ctx.go('cups') }, t('All cups'))))); } };
  const act = async (path, body, msg) => { try { cup = (await api.post('/api/cups/' + id + path, body || {})).cup; if (msg) toast(msg, 'good'); paint(); } catch (e) { toastErr(e); } };
  function paint() {
    const c = cup;
    const head = h('div.page-title', h('div',
      h('button.btn.sm.ghost', { onClick: () => ctx.go('cups') }, icon('back', 14), t('All cups')),
      h('h2', icon('trophy', 22), ' ', c.title),
      h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('span.tag.acc', STATUS()[c.status]), h('span.tag', gname(c)), h('span.tag', t('Best of {n}', { n: c.bo })), h('span.tag', REGIONS()[c.region] || c.region), h('span.tag', icon('users', 11), ` ${c.players}/${c.size}`), c.when ? h('span.tag', icon('calendar', 11), when(c.when)) : null, c.by ? h('span.tag', t('Organiser: {n}', { n: '@' + c.by.username })) : null)),
    h('div.row', { style: 'gap:6px;flex-wrap:wrap' },
      h('button.btn.sm', { onClick: async () => { const url = location.origin + '/#/cups/' + c.id; try { await navigator.clipboard.writeText(url); toast(t('Link copied')); } catch { toast(url); } } }, icon('link', 14), t('Copy link')),
      c.status === 'open' && !c.joined ? h('button.btn.primary', { disabled: c.players >= c.size, onClick: () => joinDlg() }, icon('plus', 16), c.players >= c.size ? t('Full') : t('Join')) : null,
      c.status === 'open' && c.joined ? h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Leave this cup?'))) act('/leave', null, t('You left the cup')); } }, t('Leave')) : null,
      c.mine && c.status === 'open' ? h('button.btn.primary', { onClick: startDlg }, icon('play', 16), t('Start the cup')) : null,
      c.mine && c.status !== 'cancelled' ? h('button.btn.sm', { onClick: () => createCup(ctx, c) }, icon('edit', 14), t('Edit')) : null,
      c.canManage && (c.status === 'open' || c.status === 'live') ? h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Cancel this cup? Everyone will be told.'), { danger: true, ok: t('Cancel cup') })) act('/cancel', null, t('Cup cancelled')); } }, t('Cancel cup')) : null,
      c.canManage && c.status !== 'live' ? h('button.btn.sm.ghost', { onClick: async () => { if (await confirmBox(t('Delete this cup for good?'), { danger: true, ok: t('Delete') })) { try { await api.del('/api/cups/' + c.id); ctx.go('cups'); } catch (e) { toastErr(e); } } } }, icon('trash', 14)) : null));
    const champ = c.champion ? h('div.card.cup-winner', icon('trophy', 28), h('div', h('div.tiny.muted', t('Champion')), h('b', c.champion.displayName || c.champion.username)), avatarEl(c.champion, { size: 44 })) : null;
    const mine = myMatch(c);
    const myCard = mine ? h('div.card.cup-mine', h('b', icon('target', 15), ' ', t('Your match')), h('span.grow', `${mine.a.username} vs ${mine.b.username} · ${roundLabel(mine.round)}`),
      mine.st === 'disputed' ? h('span.pill.warn', t('Disputed: the organiser will decide')) : mine.rep && mine.rep[mine.side] ? h('span.pill', t('Waiting for your opponent to confirm')) : null,
      h('button.btn.sm.primary', { onClick: () => reportDlg(mine, false) }, t('Report score'))) : null;
    const info = h('div.grid.cols-2.cup-info',
      c.desc ? h('section.card', h('h3', t('About')), h('p.pre', c.desc)) : null,
      c.rules ? h('section.card', h('h3', t('Rules')), h('p.pre', c.rules)) : null);
    const players = h('section.card', h('h3', icon('users', 16), ' ', t('Players ({n})', { n: c.players })),
      c.list.length ? h('div.cup-players', c.list.map((p) => h('div.cup-player', avatarEl(p, { size: 28 }), h('div.grow', h('b', p.displayName), h('div.tiny.muted', '@' + p.username + (p.name ? ' · ' + p.name : '') + (p.seed ? ' · ' + t('Seed {n}', { n: p.seed }) : ''))),
        c.canManage && c.status === 'open' ? h('button.btn.sm.ghost', { title: t('Remove'), onClick: async () => { if (await confirmBox(t('Remove @{u} from the cup?', { u: p.username }), { danger: true, ok: t('Remove') })) act('/kick', { user: p.id }); } }, icon('x', 14)) : null))) : h('p.muted.small', t('Nobody has joined yet.')));
    const bracket = c.rounds ? h('section.card.cup-bracket-card', h('h3', icon('layers', 16), ' ', t('Bracket')), h('div.cup-bracket', c.rounds.map((rd, r) => h('div.cup-round', h('div.cup-rname', roundLabel(rd.name)), h('div.cup-col', rd.matches.map((m) => matchEl(m, rd.name, r))))))) : null;
    mount(root, h('div.inner.cup-page', head, champ, myCard, bracket, info, players));
  }
  function myMatch(c) { if (!c.rounds || c.status !== 'live') return null; for (const rd of c.rounds) for (const m of rd.matches) if (m.side && (m.st === 'ready' || m.st === 'disputed')) return { ...m, round: rd.name }; return null; }
  function matchEl(m, round, r) {
    const side = (p, s, win) => h('div.cup-side' + (win ? '.win' : '') + (p ? '' : '.empty'), p ? avatarEl(p, { size: 20 }) : null, h('span.grow', p ? p.displayName : m.bye && r === 0 ? t('Bye') : t('TBD')), p && p.seed ? h('span.tiny.muted', '#' + p.seed) : null, h('b.cup-score', s == null ? '' : String(s)));
    const can = cup.canManage && m.a && m.b && !m.locked && (cup.status === 'live' || cup.status === 'done');
    const mineM = m.side && (m.st === 'ready' || m.st === 'disputed') && cup.status === 'live';
    return h('div.cup-match.' + m.st, { dataset: { id: m.id } },
      side(m.a, m.st === 'done' && !m.bye ? m.sa : null, m.w && m.a && m.w === m.a.id), side(m.b, m.st === 'done' && !m.bye ? m.sb : null, m.w && m.b && m.w === m.b.id),
      m.st === 'disputed' ? h('div.cup-flag', icon('alert', 11), t('Disputed')) : m.rep && (m.rep.a || m.rep.b) && m.st === 'ready' ? h('div.cup-flag.soft', t('1 report')) : null,
      (can || mineM) ? h('div.cup-mact', mineM ? h('button.btn.sm.primary', { onClick: () => reportDlg({ ...m, round }, false) }, t('Report score')) : null, can ? h('button.btn.sm', { onClick: () => reportDlg({ ...m, round }, true) }, m.st === 'done' ? t('Correct') : t('Set result')) : null) : null);
  }
  function reportDlg(m, asOrg) {
    const n = need(cup.bo); let sa = m.sa != null ? m.sa : 0; let sb = m.sb != null ? m.sb : 0;
    const other = m.rep ? m.rep[m.side === 'a' ? 'b' : 'a'] : null;
    const reps = asOrg && m.rep ? [['a', m.a], ['b', m.b]].filter(([k]) => m.rep[k]).map(([k, p]) => h('div.small', t('{u} reported {s}', { u: '@' + p.username, s: m.rep[k].sa + '–' + m.rep[k].sb }))) : [];
    const opts = (v, on) => segEl(Array.from({ length: n + 1 }, (_, i) => [i, String(i)]), v, on);
    modal({ title: asOrg ? t('Set the result') : t('Report the score'), body: h('div.col',
      h('p.small.muted', t('Best of {n}: the winner needs {w}.', { n: cup.bo, w: n })),
      field(m.a.displayName + ' (@' + m.a.username + ')', opts(sa, (v) => { sa = v; })),
      field(m.b.displayName + ' (@' + m.b.username + ')', opts(sb, (v) => { sb = v; })),
      other && !asOrg ? h('p.small', t('Your opponent reported {s}.', { s: other.sa + '–' + other.sb })) : null, ...reps,
      asOrg ? null : h('p.tiny.muted', t('When both players report the same score it is confirmed. Different scores go to the organiser.'))),
    actions: [{ label: t('Cancel') }, { label: t('Send'), kind: 'primary', onClick: async () => { try { cup = (await api.post('/api/cups/' + id + (asOrg ? '/result' : '/report'), { match: m.id, sa, sb })).cup; toast(t('Score saved'), 'good'); paint(); } catch (e) { toastErr(e); return false; } } }] });
  }
  function joinDlg() {
    const entry = h('input.input', { maxlength: 30, placeholder: t('Team or in-game name (optional)') });
    modal({ title: t('Join “{n}”', { n: cup.title }), body: h('div.col', field(t('Name in the bracket'), entry, t('Your Nebulix name is always shown; this is extra, e.g. your in-game name.')), cup.rules ? h('div.card', h('b', t('Rules')), h('p.small.pre', cup.rules)) : null),
      actions: [{ label: t('Cancel') }, { label: t('Join'), kind: 'primary', onClick: () => act('/join', { entryName: entry.value }, t('You are in! You will be told when your match is ready.')) }] });
  }
  function startDlg() {
    let seeding = 'random';
    modal({ title: t('Start the cup'), body: h('div.col', h('p', t('{n} players. Registration closes and the bracket is created; empty places become byes.', { n: cup.players })), field(t('Seeding'), segEl([['random', t('Random')], ['order', t('Sign-up order')]], seeding, (v) => { seeding = v; }))),
      actions: [{ label: t('Cancel') }, { label: t('Start'), kind: 'primary', onClick: () => act('/start', { seeding }, t('The cup has started')) }] });
  }
  await refresh();
  // live cups refresh every 20 s (reports from the other players), never while a dialog is open
  const timer = setInterval(() => { if (document.visibilityState === 'visible' && cup && cup.status === 'live' && !document.querySelector('.modal')) refresh(); }, 20000);
  return () => clearInterval(timer);
}
