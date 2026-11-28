'use strict';
// Nebulix 3.0 phase 24 — Community Cups: single-elimination bracket tournaments that any verified player can organise,
// for any game (Fortnite, Valorant, Rocket League, CS2, Minecraft, Nebulix Arena, …).
//  * Registration while the cup is open (4–64 places), then the organiser starts it: the bracket is seeded (random or
//    sign-up order) and padded with byes to the next power of two; byes advance automatically.
//  * Each match is a "best of" 1/3/5/7 series. Both players report the score; matching reports confirm the result,
//    different reports mark the match as disputed and the organiser decides. The organiser can also enter or correct any
//    result while the next match has not been played.
//  * Results are self-reported: Nebulix does not read official game data, and cups have no coin prizes (so they cannot
//    be used to move coins around). Blocks are respected both ways.
// Storage: table 'cups' = { [id]: cup }. Finished or cancelled cups are kept for 60 days.
const { S, hub, publicUser, isStaff } = require('../state');
const { HttpError, now, rid } = require('../util');

const GAMES = ['fortnite', 'valorant', 'rocketleague', 'cs2', 'minecraft', 'lol', 'apex', 'overwatch', 'r6', 'nebulix', 'chess', 'other'];
const REGIONS = ['any', 'eu', 'na', 'latam', 'br', 'asia', 'oce', 'me'];
const SIZES = [4, 8, 16, 32, 64];
const BO = [1, 3, 5, 7];
const KEEP = 60 * 86400000;
const MAX_ACTIVE = 5; // open or live cups per organiser
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const T = () => S.store.table('cups');
const save = () => S.store.touch('cups');
const blockedEither = (a, b) => !!a && !!b && ((a.blocked || []).includes(b.id) || (b.blocked || []).includes(a.id));
const es = (uid) => ((S.users[uid] && S.users[uid].lang) || 'es') === 'es';
function notify(uid, en, esTxt, cup) {
  if (!S.users[uid]) return;
  hub.push(uid, { t: 'notify', kind: 'cup', text: es(uid) ? esTxt : en, link: 'cups/' + cup.id, at: now() });
}

// ---------- bracket ----------
const nextPow2 = (n) => { let p = 2; while (p < n) p *= 2; return p; };
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// standard seed order so seeds 1 and 2 can only meet in the final: [1, 8, 4, 5, 2, 7, 3, 6] for 8
function seedOrder(n) { let o = [1]; while (o.length < n) { const m = o.length * 2 + 1; o = o.flatMap((s) => [s, m - s]); } return o; }
// players: array of uids in seed order. Returns rounds: [[match, …], …]; a match is { a, b, sa, sb, w, rep, st }
function buildBracket(players) {
  const size = nextPow2(players.length); const order = seedOrder(size);
  const slots = order.map((s) => players[s - 1] || null); // null = bye
  const rounds = []; let n = size / 2; let r = 0;
  while (n >= 1) { rounds.push(Array.from({ length: n }, (_, i) => ({ id: r + '-' + i, a: null, b: null, sa: null, sb: null, w: null, rep: {}, st: 'wait' }))); n /= 2; r++; }
  rounds[0].forEach((m, i) => { m.a = slots[i * 2]; m.b = slots[i * 2 + 1]; });
  return rounds;
}
// fill in every match whose two sides are known; walk byes forward. Called after any change.
function advance(cup) {
  const R = cup.rounds;
  for (let r = 0; r < R.length; r++) {
    for (let i = 0; i < R[r].length; i++) {
      const m = R[r][i];
      if (r > 0) { // sides come from the two feeder matches
        const fa = R[r - 1][i * 2]; const fb = R[r - 1][i * 2 + 1];
        m.a = fa.st === 'done' ? fa.w : null; m.b = fb.st === 'done' ? fb.w : null;
        const aDead = fa.st === 'done' && !fa.w; const bDead = fb.st === 'done' && !fb.w; // a bye vs bye feeder → empty slot
        if (m.st === 'done' && ((m.w && m.w !== m.a && m.w !== m.b))) { m.w = null; m.sa = m.sb = null; m.st = 'wait'; m.rep = {}; }
        if ((m.a && m.b) || m.st === 'done') { if (m.st === 'wait') m.st = 'ready'; continue; }
        if ((m.a && bDead) || (m.b && aDead)) { m.w = m.a || m.b; m.st = 'done'; m.bye = true; continue; }
        if (aDead && bDead) { m.w = null; m.st = 'done'; m.bye = true; continue; }
        m.st = 'wait'; continue;
      }
      if (m.st === 'done') continue;
      if (m.a && m.b) { if (m.st === 'wait') m.st = 'ready'; } else { m.w = m.a || m.b; m.st = 'done'; m.bye = true; }
    }
  }
  const fin = R[R.length - 1][0];
  if (fin.st === 'done' && cup.status === 'live') {
    cup.status = 'done'; cup.ended = now(); cup.champion = fin.w;
    for (const p of cup.players) notify(p.uid, `🏆 ${S.users[fin.w] ? '@' + S.users[fin.w].username : '?'} won the cup “${cup.title}”`, `🏆 ${S.users[fin.w] ? '@' + S.users[fin.w].username : '?'} ha ganado la copa «${cup.title}»`, cup);
  }
}
const winsNeeded = (bo) => Math.floor(bo / 2) + 1;
const BO_MSG = { 1: 'In a best of 1 the winner needs 1 win', 3: 'In a best of 3 the winner needs 2 wins', 5: 'In a best of 5 the winner needs 3 wins', 7: 'In a best of 7 the winner needs 4 wins' }; // fixed strings so the client can translate them
function validScore(cup, sa, sb) {
  const need = winsNeeded(cup.bo);
  if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0) return false;
  return (sa === need && sb < need) || (sb === need && sa < need);
}
function matchOf(cup, mid) { for (const rd of cup.rounds || []) for (const m of rd) if (m.id === mid) return m; throw new HttpError(404, 'no_match', 'Match not found'); }
function nextOf(cup, m) { const [r, i] = m.id.split('-').map(Number); const R = cup.rounds; return r + 1 < R.length ? R[r + 1][Math.floor(i / 2)] : null; }
function setResult(cup, m, sa, sb, by) {
  m.sa = sa; m.sb = sb; m.w = sa > sb ? m.a : m.b; m.st = 'done'; m.by = by; m.at = now(); delete m.bye;
  advance(cup);
  const nx = nextOf(cup, m);
  if (nx && nx.st === 'ready') for (const uid of [nx.a, nx.b]) { const opp = S.users[uid === nx.a ? nx.b : nx.a]; notify(uid, `⚔️ Your next match in “${cup.title}” is ready: vs @${opp ? opp.username : '?'}`, `⚔️ Tu siguiente partida en «${cup.title}» está lista: contra @${opp ? opp.username : '?'}`, cup); }
}

// ---------- views ----------
const roundName = (r, total) => (r === total - 1 ? 'final' : r === total - 2 ? 'semi' : r === total - 3 ? 'quarter' : 'r' + (r + 1));
function cupView(cup, me, full) {
  const v = {
    id: cup.id, title: cup.title, game: cup.game, gameName: cup.gameName, desc: cup.desc, region: cup.region, size: cup.size, bo: cup.bo,
    rules: cup.rules, when: cup.when, status: cup.status, created: cup.created, started: cup.started || null, ended: cup.ended || null,
    unlisted: !!cup.unlisted, by: publicUser(S.users[cup.owner]), players: cup.players.length, mine: !!me && cup.owner === me.id,
    joined: !!me && cup.players.some((p) => p.uid === me.id), champion: cup.champion ? publicUser(S.users[cup.champion]) : null,
  };
  if (!full) return v;
  const pu = (uid) => { if (!uid) return null; const p = cup.players.find((x) => x.uid === uid); const u = S.users[uid]; return { id: uid, username: u ? u.username : '?', displayName: u ? u.displayName || u.username : '?', avatar: u ? publicUser(u).avatar : null, name: p ? p.name : '', seed: p ? p.seed : null }; };
  v.list = cup.players.map((p) => ({ ...pu(p.uid), joined: p.at }));
  const mod = me && (cup.owner === me.id || isStaff(me));
  v.canManage = !!mod;
  if (cup.rounds) {
    v.rounds = cup.rounds.map((rd, r) => ({ name: roundName(r, cup.rounds.length), matches: rd.map((m) => {
      const side = me ? (m.a === me.id ? 'a' : m.b === me.id ? 'b' : null) : null;
      const o = { id: m.id, a: pu(m.a), b: pu(m.b), sa: m.sa, sb: m.sb, w: m.w, st: m.st, bye: !!m.bye, at: m.at || null, side };
      if (side || mod) o.rep = { a: m.rep.a || null, b: m.rep.b || null };
      const nx = nextOf(cup, m); o.locked = !!(nx && nx.st === 'done' && !nx.bye);
      return o;
    }) }));
  }
  return v;
}
function cupOf(id) { const c = T()[id]; if (!c) throw new HttpError(404, 'not_found', 'This cup does not exist'); return c; }
function canSee(cup, me) { const o = S.users[cup.owner]; return !!o && (!o.banned || isStaff(me)) && !blockedEither(o, me); }

function cleanCup(b) {
  if (!GAMES.includes(b.game)) throw new HttpError(400, 'bad_game', 'Pick a game');
  const title = clean(b.title, 70); if (title.length < 4) throw new HttpError(400, 'bad_title', 'Give your cup a name (4-70 characters)');
  const c = {
    title, game: b.game, gameName: b.game === 'other' ? clean(b.gameName, 40) : '', desc: clean(b.desc, 1000), rules: clean(b.rules, 1500),
    region: REGIONS.includes(b.region) ? b.region : 'any', size: SIZES.includes(Number(b.size)) ? Number(b.size) : 16, bo: BO.includes(Number(b.bo)) ? Number(b.bo) : 1,
    unlisted: !!b.unlisted, when: null,
  };
  if (c.game === 'other' && c.gameName.length < 2) throw new HttpError(400, 'bad_game', 'Write the name of the game');
  if (b.when != null && b.when !== '') {
    const w = Math.round(Number(b.when));
    if (!Number.isFinite(w) || w < now() - 60000 || w > now() + 90 * 86400000) throw new HttpError(400, 'bad_when', 'Pick a start time within the next 90 days');
    c.when = w;
  }
  return c;
}

module.exports = function register(r) {
  const sweep = () => { const all = T(); let n = 0; for (const [id, c] of Object.entries(all)) if (!S.users[c.owner] || ((c.status === 'done' || c.status === 'cancelled') && now() - (c.ended || c.created) > KEEP)) { delete all[id]; n++; } if (n) save(); };
  setInterval(sweep, 3600000).unref(); setTimeout(sweep, 8000).unref();

  r.get('/api/cups', { auth: true, limit: [120, 60000, 'user'] }, async (c) => {
    const me = c.user; const tab = ['open', 'live', 'done', 'mine'].includes(c.query.tab) ? c.query.tab : 'open';
    const game = GAMES.includes(c.query.game) ? c.query.game : ''; const q = clean(c.query.q, 40).toLowerCase();
    let list = Object.values(T()).filter((x) => canSee(x, me));
    if (tab === 'mine') list = list.filter((x) => x.owner === me.id || x.players.some((p) => p.uid === me.id));
    else list = list.filter((x) => x.status === tab && (!x.unlisted || x.owner === me.id || x.players.some((p) => p.uid === me.id)));
    if (game) list = list.filter((x) => x.game === game);
    if (q) list = list.filter((x) => (x.title + ' ' + x.desc + ' ' + x.gameName).toLowerCase().includes(q));
    list.sort(tab === 'open' ? (a, b) => (a.when || Infinity) - (b.when || Infinity) || b.created - a.created : tab === 'done' ? (a, b) => (b.ended || 0) - (a.ended || 0) : (a, b) => (b.started || b.created) - (a.started || a.created));
    return { cups: list.slice(0, 100).map((x) => cupView(x, me)), total: list.length, games: GAMES, sizes: SIZES, bo: BO, regions: REGIONS };
  });
  r.get('/api/cups/:id', { auth: true, limit: [240, 60000, 'user'] }, async (c) => {
    const cup = cupOf(c.params.id); if (!canSee(cup, c.user)) throw new HttpError(404, 'not_found', 'This cup does not exist');
    return { cup: cupView(cup, c.user, true) };
  });
  r.post('/api/cups', { auth: true, verified: true, limit: [10, 3600000, 'user'] }, async (c) => {
    const u = c.user; // muted users are stopped by the router (MUTED_PATHS)
    const active = Object.values(T()).filter((x) => x.owner === u.id && (x.status === 'open' || x.status === 'live')).length;
    if (active >= MAX_ACTIVE) throw new HttpError(400, 'too_many', 'You can run up to 5 cups at once. Finish or cancel one first.');
    const cup = { id: rid(6), owner: u.id, ...cleanCup(c.body || {}), status: 'open', players: [], created: now() };
    if (c.body && c.body.play) cup.players.push({ uid: u.id, name: clean(c.body.entryName, 30), at: now() });
    T()[cup.id] = cup; save();
    return { cup: cupView(cup, u, true) };
  });
  r.put('/api/cups/:id', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const cup = cupOf(c.params.id); if (cup.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the organiser can edit this cup');
    const b = c.body || {};
    if (cup.status !== 'open') { // the format is fixed once the cup starts; only the texts can change
      const title = clean(b.title != null ? b.title : cup.title, 70); if (title.length < 4) throw new HttpError(400, 'bad_title', 'Give your cup a name (4-70 characters)');
      cup.title = title; if (b.desc != null) cup.desc = clean(b.desc, 1000); if (b.rules != null) cup.rules = clean(b.rules, 1500);
    } else {
      const nc = cleanCup({ ...cup, ...b, when: b.when !== undefined ? b.when : cup.when && cup.when > now() ? cup.when : null });
      if (nc.size < cup.players.length) throw new HttpError(400, 'too_small', 'More players have already joined than that size'); Object.assign(cup, nc);
    }
    save(); return { cup: cupView(cup, c.user, true) };
  });
  r.post('/api/cups/:id/join', { auth: true, verified: true, limit: [30, 600000, 'user'] }, async (c) => {
    const u = c.user; const cup = cupOf(c.params.id);
    if (!canSee(cup, u)) throw new HttpError(404, 'not_found', 'This cup does not exist');
    if (cup.status !== 'open') throw new HttpError(400, 'closed', 'Registration is closed');
    if (cup.players.some((p) => p.uid === u.id)) return { cup: cupView(cup, u, true) };
    if (cup.players.length >= cup.size) throw new HttpError(400, 'full', 'This cup is full');
    if ((cup.kicked || []).includes(u.id)) throw new HttpError(403, 'removed', 'The organiser removed you from this cup');
    cup.players.push({ uid: u.id, name: clean(c.body && c.body.entryName, 30), at: now() }); save();
    if (cup.owner !== u.id) notify(cup.owner, `@${u.username} joined your cup “${cup.title}” (${cup.players.length}/${cup.size})`, `@${u.username} se ha apuntado a tu copa «${cup.title}» (${cup.players.length}/${cup.size})`, cup);
    return { cup: cupView(cup, u, true) };
  });
  r.post('/api/cups/:id/leave', { auth: true, limit: [30, 600000, 'user'] }, async (c) => {
    const cup = cupOf(c.params.id); if (cup.status !== 'open') throw new HttpError(400, 'started', 'The cup has started; ask the organiser if you cannot play');
    cup.players = cup.players.filter((p) => p.uid !== c.user.id); save(); return { cup: cupView(cup, c.user, true) };
  });
  r.post('/api/cups/:id/kick', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const cup = cupOf(c.params.id); if (cup.owner !== c.user.id && !isStaff(c.user)) throw new HttpError(403, 'forbidden', 'Only the organiser can do that');
    if (cup.status !== 'open') throw new HttpError(400, 'started', 'Players can only be removed before the cup starts');
    const uid = String(c.body.user || ''); if (!cup.players.some((p) => p.uid === uid)) throw new HttpError(404, 'not_in', 'That player is not in this cup');
    cup.players = cup.players.filter((p) => p.uid !== uid); if (uid !== cup.owner) (cup.kicked = cup.kicked || []).push(uid); save();
    return { cup: cupView(cup, c.user, true) };
  });
  r.post('/api/cups/:id/start', { auth: true, verified: true, limit: [20, 600000, 'user'] }, async (c) => {
    const cup = cupOf(c.params.id); if (cup.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the organiser can start the cup');
    if (cup.status !== 'open') throw new HttpError(400, 'started', 'This cup has already started');
    const ids = cup.players.filter((p) => S.users[p.uid] && !S.users[p.uid].banned).map((p) => p.uid);
    if (ids.length < 2) throw new HttpError(400, 'too_few', 'You need at least 2 players to start');
    const seeding = c.body && c.body.seeding === 'order' ? 'order' : 'random';
    const order = seeding === 'order' ? ids : shuffle(ids.slice());
    cup.players = order.map((uid, i) => ({ ...cup.players.find((p) => p.uid === uid), seed: i + 1 }));
    cup.seeding = seeding; cup.rounds = buildBracket(order); cup.status = 'live'; cup.started = now();
    advance(cup); save();
    for (const m of cup.rounds[0]) if (m.st === 'ready') for (const uid of [m.a, m.b]) { const opp = S.users[uid === m.a ? m.b : m.a]; notify(uid, `⚔️ “${cup.title}” has started: your first match is vs @${opp ? opp.username : '?'}`, `⚔️ «${cup.title}» ha empezado: tu primera partida es contra @${opp ? opp.username : '?'}`, cup); }
    for (const m of cup.rounds[0]) if (m.bye && m.w) notify(m.w, `“${cup.title}” has started: you have a bye in the first round`, `«${cup.title}» ha empezado: pasas directamente la primera ronda`, cup);
    return { cup: cupView(cup, c.user, true) };
  });
  // a player reports the score of their own match (sa = side a's wins, sb = side b's wins)
  r.post('/api/cups/:id/report', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const u = c.user; const cup = cupOf(c.params.id); if (cup.status !== 'live') throw new HttpError(400, 'not_live', 'This cup is not being played');
    const m = matchOf(cup, String(c.body.match || '')); const side = m.a === u.id ? 'a' : m.b === u.id ? 'b' : null;
    if (!side) throw new HttpError(403, 'not_yours', 'You are not playing this match');
    if (m.st !== 'ready' && m.st !== 'disputed') throw new HttpError(400, 'not_ready', m.st === 'done' ? 'This match already has a result' : 'This match is not ready yet');
    const sa = Number(c.body.sa); const sb = Number(c.body.sb);
    if (!validScore(cup, sa, sb)) throw new HttpError(400, 'bad_score', BO_MSG[cup.bo]);
    m.rep[side] = { sa, sb, at: now() };
    const o = m.rep[side === 'a' ? 'b' : 'a']; const opp = side === 'a' ? m.b : m.a;
    if (o && o.sa === sa && o.sb === sb) setResult(cup, m, sa, sb, 'players');
    else if (o) {
      m.st = 'disputed';
      notify(cup.owner, `⚠️ The players of a match in “${cup.title}” reported different scores. Please decide.`, `⚠️ Los jugadores de una partida de «${cup.title}» han dado resultados distintos. Decide tú.`, cup);
      notify(opp, `⚠️ Your opponent reported a different score in “${cup.title}”. The organiser will decide.`, `⚠️ Tu rival ha dado otro resultado en «${cup.title}». Lo decidirá el organizador.`, cup);
    } else notify(opp, `@${u.username} reported ${sa}–${sb} for your match in “${cup.title}”. Confirm it on the cup page.`, `@${u.username} ha dado ${sa}–${sb} en vuestra partida de «${cup.title}». Confírmalo en la página de la copa.`, cup);
    save(); return { cup: cupView(cup, u, true) };
  });
  // the organiser (or staff) sets or corrects a result; also used to settle disputes and no-shows
  r.post('/api/cups/:id/result', { auth: true, verified: true, limit: [120, 600000, 'user'] }, async (c) => {
    const u = c.user; const cup = cupOf(c.params.id); if (cup.owner !== u.id && !isStaff(u)) throw new HttpError(403, 'forbidden', 'Only the organiser can set results');
    if (cup.status !== 'live' && cup.status !== 'done') throw new HttpError(400, 'not_live', 'This cup is not being played');
    const m = matchOf(cup, String(c.body.match || '')); if (!m.a || !m.b) throw new HttpError(400, 'not_ready', 'This match is not ready yet');
    const nx = nextOf(cup, m); if (nx && nx.st === 'done' && !nx.bye) throw new HttpError(400, 'locked', 'The next match has already been played, so this result cannot change');
    const sa = Number(c.body.sa); const sb = Number(c.body.sb);
    if (!validScore(cup, sa, sb)) throw new HttpError(400, 'bad_score', BO_MSG[cup.bo]);
    if (cup.status === 'done') { cup.status = 'live'; cup.champion = null; cup.ended = null; } // correcting the final
    if (nx && nx.st !== 'done') { nx.rep = {}; if (nx.st === 'disputed') nx.st = 'ready'; } // the opponent there may change
    setResult(cup, m, sa, sb, 'organiser'); save();
    return { cup: cupView(cup, u, true) };
  });
  r.post('/api/cups/:id/cancel', { auth: true, verified: true, limit: [20, 600000, 'user'] }, async (c) => {
    const cup = cupOf(c.params.id); if (cup.owner !== c.user.id && !isStaff(c.user)) throw new HttpError(403, 'forbidden', 'Only the organiser can cancel this cup');
    if (cup.status === 'done' || cup.status === 'cancelled') throw new HttpError(400, 'over', 'This cup is already over');
    cup.status = 'cancelled'; cup.ended = now(); save();
    for (const p of cup.players) if (p.uid !== cup.owner) notify(p.uid, `The cup “${cup.title}” was cancelled by the organiser`, `El organizador ha cancelado la copa «${cup.title}»`, cup);
    return { cup: cupView(cup, c.user, true) };
  });
  r.delete('/api/cups/:id', { auth: true, limit: [30, 600000, 'user'] }, async (c) => {
    const cup = T()[c.params.id]; if (!cup) return { ok: true };
    if (cup.owner !== c.user.id && !isStaff(c.user)) throw new HttpError(403, 'forbidden', 'Not yours');
    if (cup.status === 'live' && !isStaff(c.user)) throw new HttpError(400, 'live', 'Cancel the cup before deleting it');
    delete T()[cup.id]; save(); return { ok: true };
  });
};
module.exports._test = { buildBracket, seedOrder, advance, validScore };
