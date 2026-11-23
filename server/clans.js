'use strict';
// Clans: groups of players with a tag, a shared coin bank, a wall, levels and a weekly Clan War.
// Every XP point a member earns also counts for their clan. On Monday (UTC) the three clans with the most points
// that week get coins paid into their bank. Clan coins are virtual like everything else.
const { S, hub, publicUser } = require('./state');
const { now, rid, HttpError } = require('./util');

const COST = 25000; const PRIZES = [100000, 50000, 25000];
const T = () => S.store.table('clans');
const weekKey = (t = now()) => require('./progress').weekKey(t);
const level = (pts) => Math.floor(Math.sqrt((pts || 0) / 800)) + 1;
const cap = (c) => Math.min(50, 12 + level(c.pts) * 3);
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f‪-‮⁦-⁩]/g, '').trim().slice(0, n);
const COLORS = ['#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#64748b'];
const RANK = { leader: 3, officer: 2, member: 1 };

function clanOf(u) { const c = u && u.clan && T()[u.clan]; if (c && c.members[u.id]) return c; if (u && u.clan) { delete u.clan; S.store.touch('users'); } return null; }
function roll(c) { const k = weekKey(); if (!c.week || c.week.key !== k) c.week = { key: k, pts: 0 }; return c.week; }
function mine(c, uid) { const m = c.members[uid]; const k = weekKey(); if (!m.wk || m.wk.key !== k) m.wk = { key: k, pts: 0 }; return m; }
function need(c, u, r) { const m = c.members[u.id]; if (!m || RANK[m.role] < RANK[r]) throw new HttpError(403, 'clan_role', 'Your clan role cannot do that'); return m; }
function log(c, text) { c.log = c.log || []; c.log.unshift({ at: now(), text }); c.log.length = Math.min(c.log.length, 40); }
const save = () => S.store.touch('clans');
const tellAll = (c, text, es) => hub.pushMany(Object.keys(c.members), { t: 'notice', text, es });

function card(c) { roll(c); return { id: c.id, tag: c.tag, name: c.name, emoji: c.emoji, color: c.color, desc: c.desc, open: c.open, members: Object.keys(c.members).length, cap: cap(c), level: level(c.pts), pts: c.pts, week: c.week.pts, bank: c.bank }; }
function full(c, me) {
  const v = card(c); const m = c.members[me.id];
  v.my = m ? { role: m.role, week: mine(c, me.id).wk.pts, total: m.pts || 0 } : null;
  v.requested = !!(c.requests && c.requests[me.id]);
  v.roster = Object.entries(c.members).filter(([id]) => S.users[id]).map(([id, x]) => ({ user: publicUser(S.users[id]), role: x.role, week: x.wk && x.wk.key === weekKey() ? x.wk.pts : 0, total: x.pts || 0, joined: x.joined, online: hub.online(id) }))
    .sort((a, b) => RANK[b.role] - RANK[a.role] || b.week - a.week);
  v.wall = (c.wall || []).slice(0, 60).map((p) => ({ ...p, user: S.users[p.uid] ? publicUser(S.users[p.uid]) : null })).filter((p) => p.user);
  v.log = m ? (c.log || []).slice(0, 25) : [];
  v.requests = m && RANK[m.role] >= 2 ? Object.keys(c.requests || {}).filter((id) => S.users[id] && !S.users[id].clan).map((id) => publicUser(S.users[id])) : [];
  const nextLvl = level(c.pts) * level(c.pts) * 800; v.next = nextLvl; v.prev = (level(c.pts) - 1) ** 2 * 800;
  return v;
}
function warBoard() { const k = weekKey(); return Object.values(T()).map((c) => { roll(c); return c; }).filter((c) => c.week.key === k).sort((a, b) => b.week.pts - a.week.pts).slice(0, 20).map((c, i) => ({ rank: i + 1, ...card(c) })); }

function overview(u) {
  catchUp(); const c = clanOf(u); const all = Object.values(T());
  const nxt = new Date(weekKey()); nxt.setUTCDate(nxt.getUTCDate() + 7);
  return { mine: c ? full(c, u) : null, cost: COST, prizes: PRIZES, colors: COLORS, warEnds: nxt.getTime(), war: warBoard(), last: (S.meta.clanWar || null),
    browse: all.filter((x) => x !== c).map(card).sort((a, b) => b.week - a.week || b.pts - a.pts).slice(0, 40) };
}
function create(u, b) {
  if (clanOf(u)) throw new HttpError(409, 'in_clan', 'Leave your clan first');
  const tag = String(b.tag || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); const name = clean(b.name, 30);
  if (tag.length < 2) throw new HttpError(400, 'bad_tag', 'The tag needs 2 to 5 letters or numbers');
  if (name.length < 3) throw new HttpError(400, 'bad_name', 'The name needs at least 3 characters');
  if (Object.values(T()).some((c) => c.tag === tag)) throw new HttpError(409, 'tag_taken', 'That tag is taken');
  if (!require('./economy').adjust(u, -COST, 'clan:create')) throw new HttpError(402, 'no_coins', 'Not enough coins');
  const id = rid(8); const t = now();
  T()[id] = { id, tag, name, emoji: clean(b.emoji, 4) || '🛡️', color: COLORS.includes(b.color) ? b.color : COLORS[0], desc: clean(b.desc, 200), open: b.open !== false, owner: u.id, created: t, bank: 0, pts: 0,
    members: { [u.id]: { role: 'leader', joined: t, pts: 0 } }, requests: {}, wall: [], log: [] };
  u.clan = id; log(T()[id], `@${u.username} founded the clan`); require('./feed').add('clan', '🛡️', [`@${u.username} founded the clan [${tag}] ${name}`, `@${u.username} ha fundado el clan [${tag}] ${name}`], { uid: u.id, link: '#/clans' }); save(); S.store.touch('users');
  return overview(u);
}
function addMember(c, u) { if (Object.keys(c.members).length >= cap(c)) throw new HttpError(409, 'clan_full', 'The clan is full'); c.members[u.id] = { role: 'member', joined: now(), pts: 0 }; u.clan = c.id; if (c.requests) delete c.requests[u.id]; log(c, `@${u.username} joined`); S.store.touch('users'); }
function join(u, id) {
  if (clanOf(u)) throw new HttpError(409, 'in_clan', 'Leave your clan first');
  const c = T()[id]; if (!c) throw new HttpError(404, 'no_clan', 'Clan not found');
  if (c.open) { addMember(c, u); tellAll(c, `🛡️ @${u.username} joined [${c.tag}]`, `🛡️ @${u.username} se ha unido a [${c.tag}]`); }
  else { c.requests = c.requests || {}; c.requests[u.id] = now(); const offs = Object.entries(c.members).filter(([, m]) => RANK[m.role] >= 2).map(([x]) => x); hub.pushMany(offs, { t: 'notice', text: `🛡️ @${u.username} wants to join [${c.tag}]`, es: `🛡️ @${u.username} quiere unirse a [${c.tag}]` }); }
  save(); return overview(u);
}
function leave(u) {
  const c = clanOf(u); if (!c) throw new HttpError(404, 'no_clan', 'You are not in a clan');
  const me = c.members[u.id]; delete c.members[u.id]; delete u.clan; S.store.touch('users');
  const rest = Object.entries(c.members);
  if (!rest.length) { delete T()[c.id]; save(); return overview(u); } // last one out: the clan (and its bank) is gone
  if (me.role === 'leader') { rest.sort((a, b) => RANK[b[1].role] - RANK[a[1].role] || a[1].joined - b[1].joined); rest[0][1].role = 'leader'; c.owner = rest[0][0]; const nu = S.users[rest[0][0]]; log(c, `@${nu ? nu.username : '?'} is the new leader`); }
  log(c, `@${u.username} left`); save(); return overview(u);
}
function manage(u, b) {
  const c = clanOf(u); if (!c) throw new HttpError(404, 'no_clan', 'You are not in a clan');
  const act = String(b.action || ''); const target = S.users[String(b.user || '')]; const tm = target && c.members[target.id];
  const me = c.members[u.id];
  if (act === 'accept' || act === 'decline') {
    need(c, u, 'officer'); if (!target || !(c.requests || {})[target.id]) throw new HttpError(404, 'no_request', 'No such request');
    if (act === 'accept') { if (target.clan && clanOf(target)) { delete c.requests[target.id]; throw new HttpError(409, 'in_clan', 'They already joined another clan'); } addMember(c, target); hub.push(target.id, { t: 'notice', text: `🛡️ You are now in [${c.tag}] ${c.name}`, es: `🛡️ Ya estás en [${c.tag}] ${c.name}` }); }
    else delete c.requests[target.id];
  } else if (act === 'kick') {
    need(c, u, 'officer'); if (!tm || target.id === u.id || RANK[tm.role] >= RANK[me.role]) throw new HttpError(403, 'clan_role', 'You cannot remove that member');
    delete c.members[target.id]; delete target.clan; S.store.touch('users'); log(c, `@${target.username} was removed by @${u.username}`);
  } else if (act === 'promote' || act === 'demote') {
    need(c, u, 'leader'); if (!tm || target.id === u.id) throw new HttpError(400, 'bad_member', 'Pick another member');
    tm.role = act === 'promote' ? 'officer' : 'member'; log(c, `@${target.username} is now ${tm.role}`);
  } else if (act === 'transfer') {
    need(c, u, 'leader'); if (!tm || target.id === u.id) throw new HttpError(400, 'bad_member', 'Pick another member');
    tm.role = 'leader'; me.role = 'officer'; c.owner = target.id; log(c, `@${target.username} is the new leader`);
  } else if (act === 'settings') {
    need(c, u, 'leader'); const name = clean(b.name, 30); if (name.length >= 3) c.name = name; c.desc = clean(b.desc, 200); if (b.emoji) c.emoji = clean(b.emoji, 4); if (COLORS.includes(b.color)) c.color = b.color; c.open = b.open !== false;
  } else if (act === 'deposit') {
    const n = Math.trunc(Number(b.amount)); if (!(n >= 100 && n <= 10000000)) throw new HttpError(400, 'bad_amount', 'Deposit between 100 and 10,000,000 coins');
    if (!require('./economy').adjust(u, -n, 'clan:deposit:' + c.id)) throw new HttpError(402, 'no_coins', 'Not enough coins');
    c.bank += n; log(c, `@${u.username} deposited ${n} coins`);
  } else if (act === 'pay') {
    need(c, u, 'leader'); const n = Math.trunc(Number(b.amount)); if (!tm) throw new HttpError(400, 'bad_member', 'Pick a member');
    if (!(n >= 1 && n <= c.bank)) throw new HttpError(400, 'bad_amount', 'The bank does not have that much');
    c.bank -= n; require('./economy').adjust(target, n, 'clan:pay:' + c.id); log(c, `@${u.username} paid ${n} coins to @${target.username}`);
    hub.push(target.id, { t: 'notice', text: `🛡️ [${c.tag}] paid you ${n} coins from the clan bank`, es: `🛡️ [${c.tag}] te ha pagado ${n} monedas del banco del clan` });
  } else if (act === 'post') {
    if (u.mutedUntil && u.mutedUntil > now()) throw new HttpError(403, 'muted', 'You are muted by the moderators');
    const text = clean(b.text, 300); if (!text) throw new HttpError(400, 'empty', 'Write something');
    c.wall = c.wall || []; c.wall.unshift({ id: rid(6), uid: u.id, text, at: now() }); c.wall.length = Math.min(c.wall.length, 120);
    hub.pushMany(Object.keys(c.members).filter((x) => x !== u.id), { t: 'clan', id: c.id });
  } else if (act === 'unpost') {
    const i = (c.wall || []).findIndex((p) => p.id === b.post); if (i < 0) throw new HttpError(404, 'no_post', 'Not found');
    if (c.wall[i].uid !== u.id) need(c, u, 'officer'); c.wall.splice(i, 1);
  } else throw new HttpError(400, 'bad_action', 'Unknown action');
  save(); return overview(u);
}
function view(u, id) { const c = T()[id]; if (!c) throw new HttpError(404, 'no_clan', 'Clan not found'); return full(c, u); }
// called by progress.award with the XP the member just earned
const catchUp = () => { if (S.meta.clanWeek && S.meta.clanWeek !== weekKey()) settle(); };
function onXp(u, gained) {
  if (!(gained > 0)) return; catchUp(); const c = clanOf(u); if (!c) return;
  roll(c).pts += gained; c.pts = (c.pts || 0) + gained; const m = mine(c, u.id); m.wk.pts += gained; m.pts = (m.pts || 0) + gained; save();
}
// weekly Clan War settlement
function settle() {
  try {
    const k = weekKey(); if (!S.meta.clanWeek) { S.meta.clanWeek = k; S.store.touch('meta'); return; }
    if (S.meta.clanWeek === k) return; const prev = S.meta.clanWeek;
    const ranked = Object.values(T()).filter((c) => c.week && c.week.key === prev && c.week.pts > 0).sort((a, b) => b.week.pts - a.week.pts);
    const results = [];
    if (ranked.length >= 2) ranked.slice(0, 3).forEach((c, i) => { c.bank += PRIZES[i]; log(c, `Clan War: #${i + 1}, +${PRIZES[i]} coins to the bank`); results.push({ id: c.id, tag: c.tag, name: c.name, emoji: c.emoji, color: c.color, rank: i + 1, pts: c.week.pts, prize: PRIZES[i] });
      tellAll(c, `⚔️ Clan War: [${c.tag}] finished #${i + 1}! +${PRIZES[i]} coins in the clan bank`, `⚔️ Guerra de clanes: ¡[${c.tag}] ha quedado #${i + 1}! +${PRIZES[i]} monedas en el banco del clan`); });
    if (results[0]) require('./feed').add('clan', '⚔️', [`[${results[0].tag}] ${results[0].name} won the Clan War (+${results[0].prize} coins)`, `[${results[0].tag}] ${results[0].name} ha ganado la Guerra de clanes (+${results[0].prize} monedas)`], { uid: (T()[results[0].id] || {}).owner || null, link: '#/clans' });
    S.meta.clanWar = { week: prev, results }; S.meta.clanWeek = k; S.store.touch('meta'); save();
  } catch (e) { console.error('[clans]', e); }
}
const tagOf = (u) => { const c = u && u.clan && T()[u.clan]; return c && c.members[u.id] ? { tag: c.tag, color: c.color, id: c.id } : null; };
module.exports = { overview, create, join, leave, manage, view, onXp, settle, tagOf };
