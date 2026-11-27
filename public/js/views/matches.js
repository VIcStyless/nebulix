// Nebulix 3.0 phase 22 — Match tracker: log your own matches and practice sessions for any game and see your stats
// (win rate, K/D, placements, streaks, per-map and per-character breakdowns, weekly practice goal). Self-reported and
// private: Nebulix does not read official game stats. Server: server/routes/matches.js. #/matches/<game>
import { h, mount, fmt, ls } from '../util.js';
import { t, locale } from '../i18n.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { toast, toastErr, modal, field, segEl, emptyState, loading, confirmBox, promptBox } from '../ui.js';
import { GAME_NAMES } from './recruit.js';

const MODES = () => ({ ranked: t('Ranked'), casual: t('Casual'), scrim: t('Scrim'), tournament: t('Tournament'), practice: t('Practice') });
const RES = () => ({ win: t('Win'), loss: t('Loss'), draw: t('Draw') });
const gname = (e) => (e.game === 'other' ? e.gameName || t('Other') : GAME_NAMES[e.game] || e.game);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '—');
const kd = (k, d) => (k == null ? '—' : (k / Math.max(1, d)).toFixed(2));
const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const localInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

export function stats(list) {
  const games = list.filter((e) => e.mode !== 'practice');
  const s = { n: games.length, win: 0, loss: 0, draw: 0, k: 0, d: 0, a: 0, kdN: 0, place: 0, placeN: 0, top1: 0, mins: 0, streak: 0, streakKind: '' };
  for (const e of games) {
    if (e.result) s[e.result]++;
    if (e.kills != null) { s.k += e.kills; s.d += e.deaths || 0; s.a += e.assists || 0; s.kdN++; }
    if (e.place != null) { s.place += e.place; s.placeN++; if (e.place === 1) s.top1++; }
  }
  for (const e of list) s.mins += e.minutes || 0;
  for (const e of games) { if (!e.result || e.result === 'draw') break; if (!s.streakKind) s.streakKind = e.result; if (e.result !== s.streakKind) break; s.streak++; } // list is newest first
  return s;
}
function breakdown(list, key) {
  const m = new Map();
  for (const e of list) { if (e.mode === 'practice' || !e[key]) continue; const k = e[key].trim(); const r = m.get(k.toLowerCase()) || { name: k, n: 0, w: 0, r: 0, k: 0, d: 0, kdN: 0 }; r.n++; if (e.result) { r.r++; if (e.result === 'win') r.w++; } if (e.kills != null) { r.k += e.kills; r.d += e.deaths || 0; r.kdN++; } m.set(k.toLowerCase(), r); }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 12);
}
function trend(list) { // last 40 matches, oldest → newest: result squares and a K/D line
  const g = list.filter((e) => e.mode !== 'practice').slice(0, 40).reverse(); if (g.length < 2) return null;
  const W = 600, H = 120, step = W / g.length; const kds = g.map((e) => (e.kills == null ? null : e.kills / Math.max(1, e.deaths || 0)));
  const max = Math.max(2, ...kds.filter((x) => x != null)); const pts = kds.map((v, i) => (v == null ? null : [i * step + step / 2, H - 22 - (v / max) * (H - 34)])).filter(Boolean);
  const NS = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'mt-trend'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', t('Results and K/D of your last {n} matches', { n: g.length }));
  const add = (tag, at) => { const el = document.createElementNS(NS, tag); for (const k in at) el.setAttribute(k, at[k]); svg.append(el); return el; };
  const y1 = H - 22 - (1 / max) * (H - 34); add('line', { x1: 0, x2: W, y1, y2: y1, class: 'mt-one' });
  add('text', { x: 4, y: y1 - 4, class: 'mt-lbl' }).textContent = 'K/D 1.0';
  g.forEach((e, i) => { const r = add('rect', { x: i * step + 1, y: H - 14, width: Math.max(2, step - 2), height: 10, rx: 2, class: 'mt-r ' + (e.result || 'none') }); const tt = document.createElementNS(NS, 'title'); tt.textContent = gname(e) + ' · ' + (RES()[e.result] || '—') + (e.kills != null ? ' · ' + e.kills + '/' + (e.deaths || 0) + '/' + (e.assists || 0) : '') + ' · ' + fmt.dt(e.at); r.append(tt); });
  if (pts.length > 1) add('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'mt-kd' });
  for (const p of pts) add('circle', { cx: p[0], cy: p[1], r: 2.6, class: 'mt-dot' });
  return svg;
}
function toCsv(list) {
  const cols = ['at', 'game', 'gameName', 'mode', 'result', 'kills', 'deaths', 'assists', 'score', 'place', 'minutes', 'map', 'hero', 'rank', 'drill', 'notes'];
  const q = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols.join(','), ...list.map((e) => cols.map((c) => q(c === 'at' ? new Date(e.at).toISOString() : e[c])).join(','))].join('\n');
}
const download = (name, text, type) => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

export default {
  title: () => t('Match tracker'),
  async mount(root, ctx) {
    let all = []; let game = ctx.params[0] && GAME_NAMES[ctx.params[0]] ? ctx.params[0] : ''; let period = ls('mt.period') || '30'; let mode = '';
    const chips = h('div.rc-games'); const body = h('div.col', { style: 'gap:14px' }, loading());
    const file = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onChange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) doImport(f); } });
    const periodSeg = segEl([['7', t('7 days')], ['30', t('30 days')], ['90', t('90 days')], ['all', t('All time')]], period, (v) => { period = v; ls('mt.period', v); paint(); });
    const modeSel = h('select.input', { 'aria-label': t('Mode'), onChange: (e) => { mode = e.target.value; paint(); } }, h('option', { value: '' }, t('All modes')), Object.entries(MODES()).map(([k, n]) => h('option', { value: k }, n)));
    mount(root, h('div.inner.mt',
      h('div.page-title', h('div', h('h2', icon('chart', 22), ' ', t('Match tracker')), h('p', t('Log your matches and practice for any game and see how you are improving. Only you can see your log.'))),
        h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, h('button.btn', { onClick: () => edit({ mode: 'practice' }) }, icon('target', 16), t('Log practice')), h('button.btn.primary', { onClick: () => edit({}) }, icon('plus', 16), t('Log a match')))),
      chips, h('div.toolbar', periodSeg, modeSel), body,
      h('div.row', { style: 'gap:6px;flex-wrap:wrap;margin-top:14px' },
        h('button.btn.sm.ghost', { onClick: () => download('nebulix-matches.csv', toCsv(all), 'text/csv') }, icon('download', 14), t('Export CSV')),
        h('button.btn.sm.ghost', { onClick: () => download('nebulix-matches.json', JSON.stringify({ app: 'nebulix', kind: 'matches', v: 1, entries: all }), 'application/json') }, icon('download', 14), t('Export JSON')),
        h('button.btn.sm.ghost', { onClick: () => file.click() }, icon('upload', 14), t('Import JSON')), file,
        h('span.grow'), h('span.tiny.muted', t('Self-reported: these are the numbers you enter, not official game statistics.')))));

    async function load() { try { all = (await api.get('/api/matches')).entries; } catch (e) { toastErr(e); all = []; } paint(); }
    function filtered() { const from = period === 'all' ? 0 : Date.now() - Number(period) * 86400000; return all.filter((e) => (!game || e.game === game) && (!mode || e.mode === mode) && e.at >= from); }
    function paint() {
      history.replaceState(null, '', '#/matches' + (game ? '/' + game : ''));
      const used = new Map(); for (const e of all) used.set(e.game, (used.get(e.game) || 0) + 1);
      mount(chips, h('button.rc-game' + (!game ? '.on' : ''), { onClick: () => { game = ''; paint(); } }, h('b', t('All games')), h('span.tiny', String(all.length))),
        [...used.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => h('button.rc-game' + (game === k ? '.on' : ''), { onClick: () => { game = k; paint(); } }, h('b', k === 'other' ? t('Other') : GAME_NAMES[k] || k), h('span.tiny', String(n)))));
      if (!all.length) return mount(body, emptyState('chart', t('Your match log is empty'), t('After a match, log the result, your K/D/A or placement, the map and notes. Your stats and trends appear here.'), h('button.btn.primary', { onClick: () => edit({}) }, t('Log a match'))));
      const list = filtered(); const s = stats(list);
      const goal = Number(ls('mt.goal')) || 300; const wk = all.filter((e) => e.mode === 'practice' && e.at >= weekStart() && (!game || e.game === game)).reduce((a, e) => a + (e.minutes || 0), 0);
      const tile = (label, value, sub) => h('div.mt-tile', h('div.tiny.muted', label), h('b', value), sub ? h('div.tiny.muted', sub) : null);
      const decided = s.win + s.loss + s.draw;
      const tiles = h('div.mt-tiles',
        tile(t('Matches'), fmt.num(s.n), t('{w} W · {l} L · {d} D', { w: s.win, l: s.loss, d: s.draw })),
        tile(t('Win rate'), pct(s.win, decided), decided ? t('of {n} with a result', { n: decided }) : t('no results logged')),
        tile('K/D', s.kdN ? kd(s.k, s.d) : '—', s.kdN ? t('{k} kills · {d} deaths · {a} assists', { k: s.k, d: s.d, a: s.a }) : t('no K/D logged')),
        tile(t('Avg. placement'), s.placeN ? '#' + (s.place / s.placeN).toFixed(1) : '—', s.placeN ? t('{n} wins (#1)', { n: s.top1 }) : t('for battle royale games')),
        tile(t('Streak'), s.streak ? s.streak + ' ' + (s.streakKind === 'win' ? t('wins') : t('losses')) : '—', t('most recent matches')),
        tile(t('Time logged'), fmt.dur(s.mins * 60), t('matches and practice')));
      const pc = Math.min(100, Math.round((wk / goal) * 100));
      const practice = h('section.card.mt-goal', h('div.row', { style: 'gap:8px;align-items:center;flex-wrap:wrap' }, icon('target', 18), h('b.grow', t('Practice this week: {m} of {g} min', { m: wk, g: goal })),
        h('button.btn.sm.ghost', { onClick: async () => { const v = await promptBox(t('Weekly practice goal'), { label: t('Minutes per week'), value: String(goal), type: 'number', validate: (x) => (Number(x) >= 10 && Number(x) <= 10080 ? '' : t('Between 10 and 10080 minutes')) }); if (v != null) { ls('mt.goal', Math.round(Number(v))); paint(); } } }, icon('edit', 13), t('Goal'))),
        h('div.mt-bar', h('i', { style: 'width:' + pc + '%' })), h('div.tiny.muted', pc >= 100 ? t('Goal reached. Nice work!') : t('Weeks start on Monday. Log practice with “Log practice”.')));
      const tr = trend(list);
      const bd = (title, key, colTitle) => { const rows = breakdown(list, key); if (!rows.length) return null; return h('section.card', h('h3', title), h('div.mt-table', h('div.mt-row.head', h('span', colTitle), h('span', t('Matches')), h('span', t('Win rate')), h('span', 'K/D')), rows.map((r) => h('div.mt-row', h('span', r.name), h('span', String(r.n)), h('span', pct(r.w, r.r)), h('span', r.kdN ? kd(r.k, r.d) : '—'))))); };
      mount(body, tiles, practice,
        tr ? h('section.card', h('h3', t('Last matches')), tr, h('div.tiny.muted.row', { style: 'gap:10px;flex-wrap:wrap' }, h('span', h('i.mt-key.win'), t('Win')), h('span', h('i.mt-key.loss'), t('Loss')), h('span', h('i.mt-key.draw'), t('Draw')), h('span', h('i.mt-key.kd'), t('K/D (line)')))) : null,
        h('div.grid.cols-2', bd(t('By map'), 'map', t('Map')), bd(t('By character'), 'hero', t('Character'))),
        h('section.card', h('h3', t('Log ({n})', { n: list.length })), list.length ? h('div.mt-log', list.slice(0, 200).map(rowEl)) : h('p.muted', t('Nothing in this period.')), list.length > 200 ? h('p.tiny.muted', t('Showing the latest 200. Export to see everything.')) : null));
    }
    function rowEl(e) {
      const bits = [];
      if (e.mode === 'practice') bits.push(e.drill || t('Practice'), fmt.dur((e.minutes || 0) * 60));
      else { if (e.kills != null) bits.push(e.kills + '/' + (e.deaths || 0) + '/' + (e.assists || 0)); if (e.place != null) bits.push('#' + e.place); if (e.score != null) bits.push(t('Score {n}', { n: fmt.num(e.score) })); if (e.map) bits.push(e.map); if (e.hero) bits.push(e.hero); if (e.rank) bits.push(e.rank); if (e.minutes) bits.push(fmt.dur(e.minutes * 60)); }
      return h('div.mt-item.' + (e.mode === 'practice' ? 'practice' : e.result || 'none'),
        h('span.mt-res', e.mode === 'practice' ? icon('target', 14) : (RES()[e.result] || '—')),
        h('div.grow', h('div', h('b', gname(e)), ' · ', h('span.small', MODES()[e.mode] || e.mode), ' · ', h('span.small.muted', new Date(e.at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }))), h('div.small', bits.join(' · ')), e.notes ? h('div.tiny.muted', e.notes) : null),
        h('button.btn.sm.ghost', { 'aria-label': t('Edit'), onClick: () => edit(e) }, icon('edit', 14)),
        h('button.btn.sm.ghost', { 'aria-label': t('Delete'), onClick: async () => { if (!(await confirmBox(t('Delete this entry?'), { danger: true, ok: t('Delete') }))) return; try { await api.del('/api/matches/' + e.id); all = all.filter((x) => x.id !== e.id); paint(); } catch (er) { toastErr(er); } } }, icon('trash', 14)));
    }
    function edit(e) {
      const isNew = !e.id; let m = e.mode || ls('mt.lastMode') || 'ranked'; let res = e.result || (isNew ? 'win' : '');
      const g0 = e.game || game || ls('mt.lastGame') || 'valorant';
      const inp = (v, attrs = {}) => { const x = h('input.input', attrs); if (v != null) x.value = v; return x; };
      const gSel = h('select.input', Object.entries(GAME_NAMES).map(([id, n]) => h('option', { value: id, selected: id === g0 }, id === 'other' ? t('Other') : n)));
      const gName = inp(e.gameName, { maxlength: 40, placeholder: t('Name of the game') }); const gNameF = field(t('Game name'), gName);
      const num = (v, ph) => inp(v, { type: 'number', inputmode: 'numeric', min: 0, placeholder: ph || '' });
      const k = num(e.kills, '0'), d = num(e.deaths, '0'), a = num(e.assists, '0'), score = inp(e.score, { type: 'number', inputmode: 'numeric' }), place = inp(e.place, { type: 'number', min: 1, max: 200, inputmode: 'numeric', placeholder: '1–200' }), mins = num(e.minutes, t('min'));
      const map = inp(e.map, { maxlength: 40, placeholder: t('e.g. Ascent, DFH Stadium') }), hero = inp(e.hero, { maxlength: 40, placeholder: t('e.g. Jett, Octane, Sova') }), rank = inp(e.rank, { maxlength: 30, placeholder: t('e.g. Gold 2') });
      const drill = inp(e.drill, { maxlength: 60, placeholder: t('e.g. Aim trainer, Edits, Aerials') }); const notes = h('textarea.input', { rows: 2, maxlength: 400, placeholder: t('What went well, what to improve…') }); notes.value = e.notes || '';
      const at = inp(localInput(e.at || Date.now()), { type: 'datetime-local' });
      const resF = field(t('Result'), segEl([['win', t('Win')], ['loss', t('Loss')], ['draw', t('Draw')], ['', t('None')]], res, (v) => { res = v; }));
      const matchBox = h('div.col', resF, h('div.grid.cols-3', field(t('Kills'), k), field(t('Deaths'), d), field(t('Assists'), a)), h('div.grid.cols-2', field(t('Placement (optional)'), place), field(t('Score (optional)'), score)), h('div.grid.cols-2', field(t('Map (optional)'), map), field(t('Character (optional)'), hero)), field(t('Rank (optional)'), rank));
      const practiceBox = field(t('What did you practise?'), drill);
      const sync = () => { gNameF.style.display = gSel.value === 'other' ? '' : 'none'; matchBox.style.display = m === 'practice' ? 'none' : ''; practiceBox.style.display = m === 'practice' ? '' : 'none'; };
      gSel.addEventListener('change', sync);
      const modeSeg = segEl(Object.entries(MODES()), m, (v) => { m = v; sync(); }); sync();
      modal({ title: isNew ? (m === 'practice' ? t('Log practice') : t('Log a match')) : t('Edit entry'), body: h('div.col', h('div.grid.cols-2', field(t('Game'), gSel), gNameF), field(t('Mode'), modeSeg), matchBox, practiceBox, h('div.grid.cols-2', field(t('Duration (minutes)'), mins), field(t('Date and time'), at)), field(t('Notes (optional)'), notes)),
        actions: [{ label: t('Cancel') }, { label: isNew ? t('Save') : t('Save changes'), kind: 'primary', onClick: async () => {
          const body = { game: gSel.value, gameName: gName.value, mode: m, result: res, kills: k.value, deaths: d.value, assists: a.value, score: score.value, place: place.value, minutes: mins.value, map: map.value, hero: hero.value, rank: rank.value, drill: drill.value, notes: notes.value, at: at.value ? new Date(at.value).getTime() : Date.now() };
          try {
            const r = isNew ? await api.post('/api/matches', body) : await api.put('/api/matches/' + e.id, body);
            all = [r.entry, ...all.filter((x) => x.id !== r.entry.id)].sort((x, y) => y.at - x.at); ls('mt.lastGame', body.game); ls('mt.lastMode', m === 'practice' ? ls('mt.lastMode') || 'ranked' : m);
            toast(isNew ? t('Saved to your log') : t('Saved'), 'good'); paint();
          } catch (er) { toastErr(er); return false; }
        } }] });
    }
    async function doImport(f) {
      let d; try { d = JSON.parse(await f.text()); } catch { return toast(t('That is not a valid JSON file'), 'error'); }
      const rows = d && d.app === 'nebulix' && d.kind === 'matches' && Array.isArray(d.entries) ? d.entries : null;
      if (!rows) return toast(t('That is not a Nebulix match export'), 'error');
      if (!(await confirmBox(t('Add {n} entries from this file to your log?', { n: rows.length })))) return;
      try { const r = await api.post('/api/matches/import', { entries: rows }); toast(t('{a} added, {s} skipped', { a: r.added, s: r.skipped }), 'good'); load(); } catch (e) { toastErr(e); }
    }
    await load();
  },
};
