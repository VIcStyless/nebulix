'use strict';
// Nebulix 3.0 phase 23 — playtime for Nebulix's own games. The client counts seconds only while a game page is open,
// the tab is visible and the player has been active in the last two minutes, and reports them about once a minute.
// The server accepts at most the wall-clock time since the previous report (plus a little slack), so the totals cannot
// be inflated by sending bigger numbers. Private by default; "show on my profile" shares the recently played list.
// Storage: table 'playtime' = { [userId]: { g: { [key]: { title, sec, first, last } }, d: { 'YYYY-MM-DD': sec }, show, at } }
const { S } = require('../state');
const { HttpError, now } = require('../util');

const ROUTES = new Set(['games', 'arena', 'fusion', 'dash', 'retro', 'worlds', 'boss', 'quiz', 'word', 'play', 'music', 'arcade', 'casino', 'casino3d', 'ranked', 'vault', 'gamemaker']);
const KEY = /^([a-z0-9]{2,20})(?:\/([a-z0-9_-]{1,32}))?$/;
const DAYS = 90, MAX_GAMES = 300;
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const tbl = () => S.store.table('playtime');
const mine = (u) => { const t = tbl(); return t[u.id] || (t[u.id] = { g: {}, d: {}, show: false, at: 0 }); };
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const list = (m) => Object.entries(m.g).map(([key, g]) => ({ key, title: g.title, sec: g.sec, first: g.first, last: g.last })).sort((a, b) => b.last - a.last);
const blockedEither = (a, b) => (a.blocked || []).includes(b.id) || (b.blocked || []).includes(a.id);

module.exports = function register(r) {
  r.post('/api/playtime', { auth: true, limit: [30, 600000, 'user'] }, async (c) => {
    const m = mine(c.user); const t = now();
    const items = (Array.isArray(c.body && c.body.items) ? c.body.items : []).slice(0, 10);
    let budget = Math.min(150, Math.max(0, Math.round((t - (m.at || 0)) / 1000) + 10)); // seconds this report may add
    let added = 0;
    for (const it of items) {
      const mm = KEY.exec(String(it && it.key || '')); if (!mm || !ROUTES.has(mm[1])) continue;
      const sec = Math.min(budget, Math.max(0, Math.round(Number(it.sec) || 0))); if (!sec) continue;
      budget -= sec; added += sec;
      let g = m.g[mm[0]];
      if (!g) { if (Object.keys(m.g).length >= MAX_GAMES) continue; g = m.g[mm[0]] = { title: '', sec: 0, first: t, last: t }; }
      g.sec += sec; g.last = t; const ti = clean(it.title, 60); if (ti) g.title = ti;
      const d = day(t); m.d[d] = (m.d[d] || 0) + sec;
    }
    m.at = t;
    const cut = day(t - DAYS * 86400000); for (const d of Object.keys(m.d)) if (d < cut) delete m.d[d];
    S.store.touch('playtime'); // `at` moves on every report
    return { added };
  });
  r.get('/api/playtime', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const m = mine(c.user); const t = now(); const days = [];
    for (let i = 13; i >= 0; i--) { const d = day(t - i * 86400000); days.push({ d, sec: m.d[d] || 0 }); }
    const games = list(m);
    return { games, days, total: games.reduce((a, g) => a + g.sec, 0), show: !!m.show };
  });
  r.patch('/api/playtime', { auth: true, limit: [30, 60000, 'user'] }, async (c) => {
    const m = mine(c.user); m.show = !!(c.body && c.body.show); S.store.touch('playtime'); return { show: m.show };
  });
  r.delete('/api/playtime/:key', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const m = mine(c.user);
    if (c.params.key === 'all') { m.g = {}; m.d = {}; } else { let k = c.params.key; try { k = decodeURIComponent(k); } catch {} delete m.g[k]; }
    S.store.touch('playtime'); return { ok: true };
  });
  // someone's recently played games, only when they chose to show them
  r.get('/api/playtime/u/:id', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const u = S.users[c.params.id]; if (!u || u.banned) throw new HttpError(404, 'not_found', 'Player not found');
    if (u.id !== c.user.id && blockedEither(u, c.user)) return { show: false, games: [] };
    const m = tbl()[u.id];
    if (!m || (!m.show && u.id !== c.user.id)) return { show: false, games: [] };
    return { show: !!m.show, games: list(m).slice(0, 6) };
  });
};
