'use strict';
// Nebulix 3.0 phase 22 — Match tracker: players log their own matches and practice sessions (any game) and see their
// stats. Everything is self-reported and private to the player; Nebulix does not read official game stats.
// Storage: table 'matches' = { [userId]: { [entryId]: entry } }, up to MAX entries per player.
const { S } = require('../state');
const { HttpError, now, rid } = require('../util');

const GAMES = ['fortnite', 'valorant', 'rocketleague', 'cs2', 'minecraft', 'lol', 'apex', 'overwatch', 'r6', 'nebulix', 'other'];
const MODES = ['ranked', 'casual', 'scrim', 'tournament', 'practice'];
const RESULTS = ['win', 'loss', 'draw', ''];
const MAX = 3000;
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').trim().slice(0, max);
const int = (v, a, b) => { if (v === '' || v == null) return null; const n = Math.round(Number(v)); if (!Number.isFinite(n)) return null; return Math.max(a, Math.min(b, n)); };
const tbl = () => S.store.table('matches');
const mine = (u) => { const t = tbl(); return t[u.id] || (t[u.id] = {}); };

function cleanEntry(b, prev) {
  if (!GAMES.includes(b.game)) throw new HttpError(400, 'bad_game', 'Pick a game');
  const mode = MODES.includes(b.mode) ? b.mode : 'casual';
  const e = {
    game: b.game, gameName: b.game === 'other' ? clean(b.gameName, 40) : '', mode,
    result: mode === 'practice' ? '' : RESULTS.includes(b.result) ? b.result : '',
    kills: int(b.kills, 0, 9999), deaths: int(b.deaths, 0, 9999), assists: int(b.assists, 0, 9999),
    score: int(b.score, -999999, 9999999), place: int(b.place, 1, 200), minutes: int(b.minutes, 0, 1440),
    map: clean(b.map, 40), hero: clean(b.hero, 40), rank: clean(b.rank, 30), drill: mode === 'practice' ? clean(b.drill, 60) : '', notes: clean(b.notes, 400),
  };
  if (e.game === 'other' && e.gameName.length < 2) throw new HttpError(400, 'bad_game', 'Write the name of the game');
  if (mode === 'practice' && !e.minutes) throw new HttpError(400, 'bad_minutes', 'How many minutes did you practise?');
  const at = Math.round(Number(b.at));
  e.at = Number.isFinite(at) && at > 0 ? Math.min(at, now() + 60000) : prev ? prev.at : now();
  if (e.at < Date.UTC(2000, 0, 1)) throw new HttpError(400, 'bad_date', 'That date is too old');
  return e;
}

module.exports = function register(r) {
  r.get('/api/matches', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const m = mine(c.user);
    return { entries: Object.values(m).sort((a, b) => b.at - a.at), max: MAX, games: GAMES, modes: MODES };
  });
  r.post('/api/matches', { auth: true, limit: [240, 3600000, 'user'] }, async (c) => {
    const m = mine(c.user);
    if (Object.keys(m).length >= MAX) throw new HttpError(400, 'too_many', 'Your match log is full (3000 entries). Delete old ones first.');
    const e = Object.assign({ id: rid(8) }, cleanEntry(c.body || {}), { created: now() });
    m[e.id] = e; S.store.touch('matches');
    return { entry: e };
  });
  r.put('/api/matches/:id', { auth: true, limit: [240, 3600000, 'user'] }, async (c) => {
    const m = mine(c.user); const prev = m[c.params.id];
    if (!prev) throw new HttpError(404, 'not_found', 'That match is not in your log');
    const e = Object.assign({ id: prev.id, created: prev.created }, cleanEntry(c.body || {}, prev), { edited: now() });
    m[e.id] = e; S.store.touch('matches');
    return { entry: e };
  });
  r.delete('/api/matches/:id', { auth: true, limit: [240, 3600000, 'user'] }, async (c) => {
    const m = mine(c.user);
    if (c.params.id === 'all') { const t = tbl(); delete t[c.user.id]; S.store.touch('matches'); return { ok: true }; }
    if (m[c.params.id]) { delete m[c.params.id]; S.store.touch('matches'); }
    return { ok: true };
  });
  // Import from a CSV/JSON export made by this page (the client parses the file and sends rows).
  r.post('/api/matches/import', { auth: true, bodyLimit: 2 << 20, limit: [10, 3600000, 'user'] }, async (c) => {
    const rows = Array.isArray(c.body && c.body.entries) ? c.body.entries : [];
    const m = mine(c.user); let added = 0, skipped = 0;
    for (const row of rows.slice(0, MAX)) {
      if (Object.keys(m).length >= MAX) { skipped++; continue; }
      try { const e = Object.assign({ id: rid(8) }, cleanEntry(row || {}), { created: now() }); m[e.id] = e; added++; } catch { skipped++; }
    }
    if (added) S.store.touch('matches');
    return { added, skipped };
  });
};
