'use strict';
// Nebulix 3.0 phase 21 — Gaming Tools (crosshair gallery), Recruitment and Reference data. Network tests for Gaming
// Tools are the Nerd Lab ones (/api/nerd/*).
//  * Crosshair gallery: users publish crosshair designs (a small validated config), like them and copy them.
//  * Recruitment: longer-lived "team looking for players / player looking for team" posts per game (30 days), with
//    self-declared rank and roles. Contact goes through the existing DMs.
//  * Reference: weather and place search through Open-Meteo (keyless, CC BY 4.0) and exchange rates through
//    Frankfurter (keyless, European Central Bank reference rates). The server calls them, caches the answers and passes
//    on only known fields.
const https = require('https');
const { S, hub, publicUser, isStaff } = require('../state');
const { HttpError, now, rid } = require('../util');

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);

// ---------- crosshairs ----------
const XH_TTL_LIMIT = 30; // published designs per user
const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : d);
const num = (v, a, b, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(a, Math.min(b, Math.round(n * 10) / 10)) : d; };
function cleanXh(c) {
  c = c && typeof c === 'object' ? c : {};
  return {
    color: hex(c.color, '#00ff88'), outline: !!c.outline, outlineColor: hex(c.outlineColor, '#000000'), outlineW: num(c.outlineW, 0.5, 3, 1),
    length: num(c.length, 0, 30, 6), thick: num(c.thick, 0.5, 10, 2), gap: num(c.gap, -5, 30, 3), dot: !!c.dot, dotSize: num(c.dotSize, 1, 12, 2),
    tstyle: !!c.tstyle, alpha: num(c.alpha, 0.1, 1, 1), circle: num(c.circle, 0, 40, 0),
  };
}
const xhView = (x, me) => ({ id: x.id, name: x.name, game: x.game, cfg: x.cfg, likes: (x.likes || []).length, liked: !!me && (x.likes || []).includes(me.id), mine: !!me && x.owner === me.id, by: publicUser(S.users[x.owner]), created: x.created });

// ---------- recruitment ----------
const GAMES = ['fortnite', 'valorant', 'rocketleague', 'cs2', 'minecraft', 'lol', 'apex', 'overwatch', 'r6', 'nebulix', 'other'];
const KINDS = ['team', 'player', 'scrim']; // scrim: a team looking for an opponent at a set time
const SCRIM_AFTER = 3 * 3600000; // a scrim post closes 3 h after its start time
const REGIONS = ['eu', 'na', 'latam', 'br', 'asia', 'oce', 'me', 'any'];
const PLAT = ['pc', 'console', 'mobile', 'any'];
const REC_TTL = 30 * 86400000;
const recView = (p, me) => ({ id: p.id, kind: p.kind, game: p.game, gameName: p.gameName || '', title: p.title, text: p.text, roles: p.roles, rank: p.rank, region: p.region, platform: p.platform, lang: p.lang, mic: !!p.mic, age: p.age || '', when: p.when || 0, created: p.created, expires: p.expires, mine: !!me && p.owner === me.id, by: publicUser(S.users[p.owner]), interested: (p.interested || []).length, imIn: !!me && (p.interested || []).includes(me.id) });

// ---------- external reference APIs ----------
const UA = 'Nebulix/16.9 (+https://nebulix.fly.dev)';
const cache = new Map();
function getJson(url, ttl) {
  const hit = cache.get(url); if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data);
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'user-agent': UA, accept: 'application/json' }, timeout: 10000 }, (r) => {
      const parts = []; let n = 0;
      r.on('data', (c) => { n += c.length; if (n > 2 << 20) { req.destroy(); return; } parts.push(c); });
      r.on('end', () => {
        if (r.statusCode !== 200) return hit ? res(hit.data) : rej(new HttpError(502, 'upstream', 'The data service answered ' + r.statusCode));
        try { const data = JSON.parse(Buffer.concat(parts).toString()); cache.set(url, { at: Date.now(), data }); if (cache.size > 500) cache.delete(cache.keys().next().value); res(data); } catch { rej(new HttpError(502, 'upstream', 'The data service sent something unexpected')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => (hit ? res(hit.data) : rej(new HttpError(502, 'upstream', 'The data service is not reachable right now'))));
  });
}
const coord = (v, m) => { const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > m) throw new HttpError(400, 'bad_coord', 'Invalid coordinates'); return Math.round(n * 100) / 100; };
const CUR = /^[A-Z]{3}$/;

module.exports = function register(r) {
  S.crosshairs = S.store.table('crosshairs');
  S.recruit = S.store.table('recruit');
  const sweep = () => { let n = 0; for (const [id, p] of Object.entries(S.recruit)) if (p.expires < now() || !S.users[p.owner]) { delete S.recruit[id]; n++; } if (n) S.store.touch('recruit'); };
  setInterval(sweep, 3600000).unref(); sweep();

  // ===== crosshair gallery =====
  r.get('/api/crosshairs', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const sort = c.query.sort === 'top' ? 'top' : c.query.sort === 'mine' ? 'mine' : 'new';
    const q = clean(c.query.q, 40).toLowerCase();
    let list = Object.values(S.crosshairs).filter((x) => S.users[x.owner] && !S.users[x.owner].banned);
    if (sort === 'mine') list = list.filter((x) => x.owner === c.user.id);
    if (q) list = list.filter((x) => (x.name + ' ' + x.game).toLowerCase().includes(q));
    list.sort(sort === 'top' ? (a, b) => (b.likes || []).length - (a.likes || []).length || b.created - a.created : (a, b) => b.created - a.created);
    return { items: list.slice(0, 120).map((x) => xhView(x, c.user)), total: list.length };
  });
  r.post('/api/crosshairs', { auth: true, verified: true, limit: [20, 3600000, 'user'] }, async (c) => {
    const name = clean(c.body.name, 40); if (name.length < 2) throw new HttpError(400, 'bad_name', 'Give it a name (2-40 characters)');
    if (Object.values(S.crosshairs).filter((x) => x.owner === c.user.id).length >= XH_TTL_LIMIT) throw new HttpError(400, 'too_many', 'You can publish up to 30 crosshairs. Delete one first.');
    const x = { id: rid(6), owner: c.user.id, name, game: clean(c.body.game, 30), cfg: cleanXh(c.body.cfg), likes: [], created: now() };
    S.crosshairs[x.id] = x; S.store.touch('crosshairs');
    return { item: xhView(x, c.user) };
  });
  const xhOf = (id) => { const x = S.crosshairs[id]; if (!x) throw new HttpError(404, 'not_found', 'This crosshair is gone'); return x; };
  r.post('/api/crosshairs/:id/like', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const x = xhOf(c.params.id); x.likes = x.likes || []; const i = x.likes.indexOf(c.user.id);
    if (i >= 0) x.likes.splice(i, 1); else x.likes.push(c.user.id);
    S.store.touch('crosshairs'); return { item: xhView(x, c.user) };
  });
  r.delete('/api/crosshairs/:id', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const x = xhOf(c.params.id); if (x.owner !== c.user.id && !isStaff(c.user)) throw new HttpError(403, 'forbidden', 'Not yours');
    delete S.crosshairs[x.id]; S.store.touch('crosshairs'); return { ok: true };
  });

  // ===== recruitment =====
  r.get('/api/recruit', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const me = c.user; const blocked = new Set(me.blocked || []);
    const game = GAMES.includes(c.query.game) ? c.query.game : ''; const kind = KINDS.includes(c.query.kind) ? c.query.kind : '';
    const region = REGIONS.includes(c.query.region) && c.query.region !== 'any' ? c.query.region : '';
    const q = clean(c.query.q, 40).toLowerCase();
    const list = Object.values(S.recruit).filter((p) => p.expires > now() && S.users[p.owner] && !S.users[p.owner].banned && !blocked.has(p.owner) && !(S.users[p.owner].blocked || []).includes(me.id)
      && (!game || p.game === game) && (!kind || p.kind === kind) && (!region || p.region === region || p.region === 'any')
      && (c.query.mine !== '1' || p.owner === me.id)
      && (!q || (p.title + ' ' + p.text + ' ' + p.rank + ' ' + p.roles.join(' ') + ' ' + (p.gameName || '')).toLowerCase().includes(q)))
      .sort((a, b) => (kind === 'scrim' ? a.when - b.when : b.created - a.created));
    const counts = {}; for (const p of Object.values(S.recruit)) if (p.expires > now()) counts[p.game] = (counts[p.game] || 0) + 1;
    return { posts: list.slice(0, 100).map((p) => recView(p, me)), total: list.length, counts, games: GAMES, regions: REGIONS };
  });
  r.post('/api/recruit', { auth: true, verified: true, limit: [10, 3600000, 'user'] }, async (c) => {
    const b = c.body; const u = c.user;
    if (!GAMES.includes(b.game)) throw new HttpError(400, 'bad_game', 'Pick a game');
    if (!KINDS.includes(b.kind)) throw new HttpError(400, 'bad_kind', 'Is this a team looking for players, a player looking for a team or a scrim?');
    const title = clean(b.title, 80); if (title.length < 4) throw new HttpError(400, 'bad_title', 'Give your post a title (4-80 characters)');
    const text = clean(b.text, 800);
    const roles = (Array.isArray(b.roles) ? b.roles : []).map((x) => clean(x, 24)).filter(Boolean).slice(0, 6);
    if (Object.values(S.recruit).filter((p) => p.owner === u.id && p.expires > now()).length >= 3) throw new HttpError(400, 'too_many', 'You can have up to 3 recruitment posts. Close one first.');
    const p = { id: rid(6), owner: u.id, kind: b.kind, game: b.game, gameName: b.game === 'other' ? clean(b.gameName, 40) : '', title, text, roles, rank: clean(b.rank, 30), region: REGIONS.includes(b.region) ? b.region : 'any', platform: PLAT.includes(b.platform) ? b.platform : 'any', lang: clean(b.lang, 20), mic: !!b.mic, age: ['13+', '16+', '18+'].includes(b.age) ? b.age : '', interested: [], created: now(), expires: now() + REC_TTL };
    if (p.game === 'other' && p.gameName.length < 2) throw new HttpError(400, 'bad_game', 'Write the name of the game');
    if (p.kind === 'scrim') {
      const when = Math.round(Number(b.when));
      if (!Number.isFinite(when) || when < now() + 10 * 60000 || when > now() + 60 * 86400000) throw new HttpError(400, 'bad_when', 'Pick a scrim time between 10 minutes and 60 days from now');
      p.when = when; p.expires = when + SCRIM_AFTER;
    }
    S.recruit[p.id] = p; S.store.touch('recruit');
    return { post: recView(p, u) };
  });
  const recOf = (id) => { const p = S.recruit[id]; if (!p || p.expires < now()) throw new HttpError(404, 'not_found', 'This post is closed'); return p; };
  r.post('/api/recruit/:id/interest', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const p = recOf(c.params.id); const u = c.user;
    if (p.owner === u.id) throw new HttpError(400, 'own_post', 'This is your post');
    if ((S.users[p.owner].blocked || []).includes(u.id)) throw new HttpError(403, 'blocked', 'You cannot contact this player');
    p.interested = p.interested || []; const i = p.interested.indexOf(u.id);
    if (i >= 0) p.interested.splice(i, 1);
    else { p.interested.push(u.id); if (p.interested.length > 200) p.interested.shift(); const es = (S.users[p.owner].lang || 'es') === 'es'; hub.push(p.owner, { t: 'notify', kind: 'recruit', text: p.kind === 'scrim' ? (es ? `@${u.username} quiere jugar tu scrim “${p.title}”` : `@${u.username} wants to play your scrim “${p.title}”`) : es ? `@${u.username} está interesado en “${p.title}”` : `@${u.username} is interested in “${p.title}”`, link: 'recruit', at: now() }); }
    S.store.touch('recruit'); return { post: recView(p, u) };
  });
  r.get('/api/recruit/:id/interested', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const p = recOf(c.params.id); if (p.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the author sees who is interested');
    return { users: (p.interested || []).map((id) => publicUser(S.users[id])).filter(Boolean) };
  });
  r.post('/api/recruit/:id/renew', { auth: true, verified: true, limit: [20, 3600000, 'user'] }, async (c) => {
    const p = recOf(c.params.id); if (p.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Not yours');
    if (p.kind === 'scrim') throw new HttpError(400, 'scrim_renew', 'A scrim closes after its start time. Post a new one for another date.');
    p.expires = now() + REC_TTL; S.store.touch('recruit'); return { post: recView(p, c.user) };
  });
  r.delete('/api/recruit/:id', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const p = S.recruit[c.params.id]; if (!p) return { ok: true };
    if (p.owner !== c.user.id && !isStaff(c.user)) throw new HttpError(403, 'forbidden', 'Not yours');
    delete S.recruit[p.id]; S.store.touch('recruit'); return { ok: true };
  });

  // ===== reference data =====
  r.get('/api/ref/geocode', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const q = clean(c.query.q, 60); if (q.length < 2) return { places: [] };
    const lang = /^[a-z]{2}$/.test(c.query.lang || '') ? c.query.lang : 'es';
    const d = await getJson('https://geocoding-api.open-meteo.com/v1/search?count=8&format=json&language=' + lang + '&name=' + encodeURIComponent(q), 86400000);
    return { places: (d.results || []).slice(0, 8).map((p) => ({ name: clean(p.name, 80), admin: clean(p.admin1, 80), country: clean(p.country, 60), cc: clean(p.country_code, 2), lat: Number(p.latitude), lon: Number(p.longitude), tz: clean(p.timezone, 60) })) };
  });
  r.get('/api/ref/weather', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const lat = coord(c.query.lat, 90), lon = coord(c.query.lon, 180);
    const d = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=7&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&hourly=temperature_2m,precipitation_probability,weather_code`, 15 * 60000);
    const cur = d.current || {}; const dl = d.daily || {}; const hr = d.hourly || {};
    const nowIdx = Math.max(0, (hr.time || []).findIndex((x) => x >= (cur.time || '')));
    return {
      tz: clean(d.timezone, 60), current: { temp: cur.temperature_2m, feels: cur.apparent_temperature, humidity: cur.relative_humidity_2m, wind: cur.wind_speed_10m, code: cur.weather_code, day: cur.is_day === 1, rain: cur.precipitation, time: cur.time },
      daily: (dl.time || []).map((t, i) => ({ date: t, code: dl.weather_code[i], max: dl.temperature_2m_max[i], min: dl.temperature_2m_min[i], rain: dl.precipitation_probability_max[i], sunrise: dl.sunrise[i], sunset: dl.sunset[i] })),
      hourly: (hr.time || []).slice(nowIdx, nowIdx + 24).map((t, i) => ({ time: t, temp: hr.temperature_2m[nowIdx + i], rain: hr.precipitation_probability[nowIdx + i], code: hr.weather_code[nowIdx + i] })),
      source: 'Open-Meteo.com (CC BY 4.0)',
    };
  });
  r.get('/api/ref/fx', { auth: true, limit: [60, 60000, 'user'] }, async (c) => {
    const base = CUR.test(c.query.base || '') ? c.query.base : 'EUR';
    const [rates, names] = await Promise.all([getJson('https://api.frankfurter.dev/v1/latest?base=' + base, 3 * 3600000), getJson('https://api.frankfurter.dev/v1/currencies', 7 * 86400000)]);
    const out = {}; for (const [k, v] of Object.entries(rates.rates || {})) if (CUR.test(k) && Number.isFinite(v)) out[k] = v;
    const nm = {}; for (const [k, v] of Object.entries(names || {})) if (CUR.test(k)) nm[k] = clean(v, 60);
    return { base, date: clean(rates.date, 10), rates: out, names: nm, source: 'Frankfurter (European Central Bank reference rates)' };
  });
};
module.exports.cleanXh = cleanXh;
