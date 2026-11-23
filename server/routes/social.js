'use strict';
// Nebulix 3 social & productivity features:
//   Squads  — "looking for group" posts with slots that fill up live
//   Events  — scheduled community events with RSVPs
//   Library — a personal game backlog (backlog / playing / finished / dropped, rating, hours)
//   Notes   — private notes with Markdown and checklists
//   Polls   — quick polls attached to community messages (see chat.js for posting)
const { S, hub, publicUser, isStaff } = require('../state');
const { HttpError, rid, now, Limiter } = require('../util');

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const onlineIds = () => [...hub.conns.keys()];

// ---------------- squads ----------------
const SQUAD_TTL = 6 * 3600 * 1000;
const PLATFORMS = ['pc', 'console', 'mobile', 'any'];
function pruneSquads() {
  let n = 0; const t = now();
  for (const [id, s] of Object.entries(S.squads)) if (s.expires < t || !S.users[s.owner]) { delete S.squads[id]; n++; }
  if (n) S.store.touch('squads');
}
function squadView(s, me) {
  return {
    id: s.id, game: s.game, title: s.title, desc: s.desc, size: s.size, mic: !!s.mic, platform: s.platform, region: s.region, created: s.created, expires: s.expires,
    owner: publicUser(S.users[s.owner]), members: s.members.map((id) => publicUser(S.users[id])).filter(Boolean), full: s.members.length >= s.size,
    mine: s.owner === me.id, joined: s.members.includes(me.id),
  };
}
const squadsChanged = () => { S.store.touch('squads'); hub.pushMany(onlineIds(), { t: 'squads' }); };

// ---------------- events ----------------
function eventView(e, me) {
  return {
    id: e.id, title: e.title, desc: e.desc, game: e.game, at: e.at, dur: e.dur, cap: e.cap, link: e.link || '', created: e.created,
    by: publicUser(S.users[e.by]), going: e.going.length, attendees: e.going.slice(0, 12).map((id) => publicUser(S.users[id])).filter(Boolean),
    me: e.going.includes(me.id), mine: e.by === me.id, full: e.cap > 0 && e.going.length >= e.cap,
  };
}
function pruneEvents() {
  let n = 0; const t = now();
  for (const [id, e] of Object.entries(S.events)) if (e.at + (e.dur || 60) * 60000 + 86400000 < t) { delete S.events[id]; n++; }
  if (n) S.store.touch('events');
}

// Everyone who RSVPd gets a notification ~10 minutes before the start (and once more when it begins).
function remindEvents(at = now()) {
  let touched = false;
  for (const e of Object.values(S.events)) {
    const left = e.at - at;
    if (!e.reminded && left <= 10 * 60000 && left > 0) { e.reminded = true; touched = true; hub.pushMany(e.going, { t: 'notify', kind: 'event', msg: 'ev_soon', vars: { e: e.title, n: Math.max(1, Math.round(left / 60000)) }, text: `"${e.title}" starts in ${Math.max(1, Math.round(left / 60000))} min`, link: 'events', at }); }
    if (!e.started && left <= 0 && left > -15 * 60000) { e.started = true; touched = true; hub.pushMany(e.going, { t: 'notify', kind: 'event', msg: 'ev_now', vars: { e: e.title }, text: `"${e.title}" is starting now`, link: 'events', at }); }
  }
  if (touched) S.store.touch('events');
}

// ---------------- library ----------------
const STATUSES = ['backlog', 'playing', 'done', 'dropped'];
const libOf = (u) => (Array.isArray(u.library) ? u.library : (u.library = []));

// ---------------- notes ----------------
const notesOf = (u) => (Array.isArray(S.notes[u.id]) ? S.notes[u.id] : (S.notes[u.id] = []));
const noteLimiter = new Limiter(240, 60000);

module.exports = function register(r) {
  S.squads = S.store.table('squads');
  S.events = S.store.table('events');
  S.notes = S.store.table('notes');
  S.polls = S.store.table('polls');
  setInterval(() => { pruneSquads(); pruneEvents(); remindEvents(); }, 30000).unref();

  // ===== squads =====
  r.get('/api/squads', { auth: true, verified: true }, async (c) => {
    pruneSquads();
    const list = Object.values(S.squads).sort((a, b) => b.created - a.created).map((s) => squadView(s, c.user));
    return { squads: list.slice(0, 100) };
  });
  r.post('/api/squads', { auth: true, verified: true, limit: [12, 3600000, 'user'] }, async (c) => {
    const b = c.body; const u = c.user;
    const game = clean(b.game, 40); const title = clean(b.title, 80); const desc = clean(b.desc, 300);
    if (game.length < 2) throw new HttpError(400, 'bad_game', 'Which game? (2-40 characters)');
    if (title.length < 3) throw new HttpError(400, 'bad_title', 'Give your squad a short title (3-80 characters)');
    const size = Math.max(2, Math.min(10, parseInt(b.size, 10) || 4));
    if (Object.values(S.squads).filter((s) => s.owner === u.id).length >= 3) throw new HttpError(400, 'too_many', 'You can have up to 3 open squads');
    const s = { id: rid(6), owner: u.id, game, title, desc, size, mic: !!b.mic, platform: PLATFORMS.includes(b.platform) ? b.platform : 'any', region: clean(b.region, 20), members: [u.id], created: now(), expires: now() + SQUAD_TTL };
    S.squads[s.id] = s; squadsChanged();
    return { squad: squadView(s, u) };
  });
  const squadOf = (id) => { const s = S.squads[id]; if (!s) throw new HttpError(404, 'no_squad', 'This squad is gone'); return s; };
  r.post('/api/squads/:id/join', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const s = squadOf(c.params.id); const u = c.user;
    if (s.members.includes(u.id)) return { squad: squadView(s, u) };
    if ((S.users[s.owner].blocked || []).includes(u.id)) throw new HttpError(403, 'blocked', 'You cannot join this squad');
    if (s.members.length >= s.size) throw new HttpError(409, 'full', 'This squad is full');
    s.members.push(u.id); squadsChanged();
    hub.push(s.owner, { t: 'notify', kind: 'squad', msg: 'sq_join', vars: { n: u.displayName || u.username, s: s.title }, text: `${u.displayName || u.username} joined your squad "${s.title}"`, link: 'squads', at: now() });
    return { squad: squadView(s, u) };
  });
  r.post('/api/squads/:id/leave', { auth: true, verified: true }, async (c) => {
    const s = squadOf(c.params.id); const u = c.user;
    if (s.owner === u.id) { delete S.squads[s.id]; squadsChanged(); return { ok: true, closed: true }; }
    s.members = s.members.filter((x) => x !== u.id); squadsChanged();
    return { squad: squadView(s, u) };
  });
  r.post('/api/squads/:id/kick/:uid', { auth: true, verified: true }, async (c) => {
    const s = squadOf(c.params.id);
    if (s.owner !== c.user.id && !isStaff(c.user)) throw new HttpError(403, 'forbidden', 'Only the squad leader can do that');
    if (c.params.uid === s.owner) throw new HttpError(400, 'bad_target', 'The leader cannot be removed');
    s.members = s.members.filter((x) => x !== c.params.uid); squadsChanged();
    return { squad: squadView(s, c.user) };
  });
  r.delete('/api/squads/:id', { auth: true, verified: true }, async (c) => {
    const s = squadOf(c.params.id);
    if (s.owner !== c.user.id && !isStaff(c.user)) throw new HttpError(403, 'forbidden', 'Only the squad leader can close it');
    delete S.squads[s.id]; squadsChanged(); return { ok: true };
  });
  r.post('/api/squads/:id/bump', { auth: true, verified: true, limit: [6, 3600000, 'user'] }, async (c) => {
    const s = squadOf(c.params.id);
    if (s.owner !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the squad leader can bump it');
    s.created = now(); s.expires = now() + SQUAD_TTL; squadsChanged(); return { squad: squadView(s, c.user) };
  });

  // ===== events =====
  r.get('/api/events', { auth: true, verified: true }, async (c) => {
    pruneEvents(); const t = now();
    const list = Object.values(S.events).filter((e) => e.at + (e.dur || 60) * 60000 > t).sort((a, b) => a.at - b.at).map((e) => eventView(e, c.user));
    return { events: list.slice(0, 100) };
  });
  r.post('/api/events', { auth: true, verified: true, limit: [10, 3600000, 'user'] }, async (c) => {
    const b = c.body; const u = c.user;
    const title = clean(b.title, 80); const desc = clean(b.desc, 600); const game = clean(b.game, 40);
    const at = Number(b.at); const dur = Math.max(15, Math.min(720, parseInt(b.dur, 10) || 60)); const cap = Math.max(0, Math.min(500, parseInt(b.cap, 10) || 0));
    if (title.length < 3) throw new HttpError(400, 'bad_title', 'Event title must be 3-80 characters');
    if (!Number.isFinite(at) || at < now() - 60000 || at > now() + 120 * 86400000) throw new HttpError(400, 'bad_date', 'Pick a date within the next 120 days');
    let link = clean(b.link, 200); if (link && !/^https?:\/\/[^\s]+$/i.test(link)) throw new HttpError(400, 'bad_link', 'Links must start with http:// or https://');
    if (!isStaff(u) && Object.values(S.events).filter((e) => e.by === u.id && e.at > now()).length >= 3) throw new HttpError(400, 'too_many', 'You can host up to 3 upcoming events');
    const e = { id: rid(6), by: u.id, title, desc, game, at, dur, cap, link, going: [u.id], created: now() };
    S.events[e.id] = e; S.store.touch('events'); hub.pushMany(onlineIds(), { t: 'events' });
    return { event: eventView(e, u) };
  });
  const eventOf = (id) => { const e = S.events[id]; if (!e) throw new HttpError(404, 'no_event', 'Event not found'); return e; };
  r.post('/api/events/:id/rsvp', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const e = eventOf(c.params.id); const u = c.user; const want = c.body.going !== false;
    const i = e.going.indexOf(u.id);
    if (want && i < 0) { if (e.cap > 0 && e.going.length >= e.cap) throw new HttpError(409, 'full', 'This event is full'); e.going.push(u.id); }
    if (!want && i >= 0 && e.by !== u.id) e.going.splice(i, 1);
    S.store.touch('events'); hub.pushMany(onlineIds(), { t: 'events' });
    return { event: eventView(e, u) };
  });
  r.delete('/api/events/:id', { auth: true, verified: true }, async (c) => {
    const e = eventOf(c.params.id);
    if (e.by !== c.user.id && !isStaff(c.user)) throw new HttpError(403, 'forbidden', 'Only the host can cancel this event');
    hub.pushMany(e.going.filter((x) => x !== c.user.id), { t: 'notify', kind: 'event', msg: 'ev_cancel', vars: { e: e.title }, text: `"${e.title}" was cancelled`, link: 'events', at: now() });
    delete S.events[e.id]; S.store.touch('events'); hub.pushMany(onlineIds(), { t: 'events' });
    return { ok: true };
  });

  // ===== library =====
  r.get('/api/library', { auth: true, verified: true }, async (c) => ({ games: libOf(c.user), statuses: STATUSES }));
  r.post('/api/library', { auth: true, verified: true, limit: [120, 600000, 'user'] }, async (c) => {
    const lib = libOf(c.user); const name = clean(c.body.name, 60);
    if (name.length < 1) throw new HttpError(400, 'bad_name', 'Enter the game name');
    if (lib.length >= 300) throw new HttpError(400, 'too_many', 'Your library is full (300 games)');
    if (lib.some((g) => g.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'exists', 'That game is already in your library');
    const g = { id: rid(5), name, status: STATUSES.includes(c.body.status) ? c.body.status : 'backlog', rating: 0, hours: 0, note: '', platform: clean(c.body.platform, 20), added: now(), updated: now() };
    lib.unshift(g); S.store.touch('users'); return { game: g };
  });
  r.patch('/api/library/:id', { auth: true, verified: true, limit: [300, 600000, 'user'] }, async (c) => {
    const g = libOf(c.user).find((x) => x.id === c.params.id); if (!g) throw new HttpError(404, 'no_game', 'Game not found');
    const b = c.body;
    if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw new HttpError(400, 'bad_status', 'Unknown status'); if (b.status === 'done' && g.status !== 'done') g.finished = now(); g.status = b.status; }
    if (b.rating !== undefined) g.rating = Math.max(0, Math.min(5, parseInt(b.rating, 10) || 0));
    if (b.hours !== undefined) g.hours = Math.max(0, Math.min(99999, Math.round((Number(b.hours) || 0) * 10) / 10));
    if (b.note !== undefined) g.note = clean(b.note, 300);
    if (b.name !== undefined) { const n = clean(b.name, 60); if (n) g.name = n; }
    g.updated = now(); S.store.touch('users'); return { game: g };
  });
  r.delete('/api/library/:id', { auth: true, verified: true }, async (c) => {
    const lib = libOf(c.user); const i = lib.findIndex((x) => x.id === c.params.id); if (i < 0) throw new HttpError(404, 'no_game', 'Game not found');
    lib.splice(i, 1); S.store.touch('users'); return { ok: true };
  });

  // ===== notes =====
  const noteMeta = (n) => ({ id: n.id, title: n.title, preview: n.body.slice(0, 120), pinned: !!n.pinned, updated: n.updated, created: n.created });
  r.get('/api/notes', { auth: true, verified: true }, async (c) => ({ notes: notesOf(c.user).map(noteMeta) }));
  r.get('/api/notes/:id', { auth: true, verified: true }, async (c) => {
    const n = notesOf(c.user).find((x) => x.id === c.params.id); if (!n) throw new HttpError(404, 'no_note', 'Note not found');
    return { note: n };
  });
  r.post('/api/notes', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const list = notesOf(c.user); if (list.length >= 200) throw new HttpError(400, 'too_many', 'You can keep up to 200 notes');
    const n = { id: rid(6), title: clean(c.body.title, 120) || '', body: String(c.body.body || '').slice(0, 20000), pinned: false, created: now(), updated: now() };
    list.unshift(n); S.store.touch('notes'); return { note: n };
  });
  r.patch('/api/notes/:id', { auth: true, verified: true, bodyLimit: 128 * 1024 }, async (c) => {
    if (!noteLimiter.hit(c.user.id)) throw new HttpError(429, 'rate_limited', 'Saving too often');
    const n = notesOf(c.user).find((x) => x.id === c.params.id); if (!n) throw new HttpError(404, 'no_note', 'Note not found');
    if (c.body.title !== undefined) n.title = clean(c.body.title, 120);
    if (c.body.body !== undefined) { const b = String(c.body.body); if (b.length > 20000) throw new HttpError(400, 'too_long', 'Notes can be up to 20,000 characters'); n.body = b; }
    if (c.body.pinned !== undefined) n.pinned = !!c.body.pinned;
    n.updated = now(); S.store.touch('notes'); return { note: noteMeta(n) };
  });
  r.delete('/api/notes/:id', { auth: true, verified: true }, async (c) => {
    const list = notesOf(c.user); const i = list.findIndex((x) => x.id === c.params.id); if (i < 0) throw new HttpError(404, 'no_note', 'Note not found');
    list.splice(i, 1); S.store.touch('notes'); return { ok: true };
  });

  // ===== polls (live results; created together with a community message) =====
  r.post('/api/polls/:id/vote', { auth: true, verified: true, limit: [120, 600000, 'user'] }, async (c) => {
    const p = S.polls[c.params.id]; if (!p) throw new HttpError(404, 'no_poll', 'Poll not found');
    const ch = S.channels[p.ch]; const sv = ch && S.servers[ch.serverId];
    if (!sv || !sv.members[c.user.id]) throw new HttpError(403, 'not_member', 'Join this server first');
    if (p.closes && p.closes < now()) throw new HttpError(409, 'closed', 'This poll is closed');
    const i = parseInt(c.body.option, 10); if (!(i >= 0 && i < p.options.length)) throw new HttpError(400, 'bad_option', 'Pick an option');
    p.votes[c.user.id] = i; S.store.touch('polls');
    const res = pollResults(p, c.user.id);
    hub.pushMany(Object.keys(sv.members), { t: 'poll', id: p.id, ch: p.ch, counts: res.counts, total: res.total });
    return { poll: res };
  });
};

function pollResults(p, uid) {
  const counts = p.options.map(() => 0); for (const v of Object.values(p.votes)) if (counts[v] !== undefined) counts[v]++;
  return { id: p.id, q: p.q, options: p.options, counts, total: Object.keys(p.votes).length, mine: uid in p.votes ? p.votes[uid] : null, closes: p.closes || 0 };
}
module.exports.pollResults = pollResults;
module.exports.remindEvents = remindEvents;
module.exports.createPoll = function createPoll(chId, author, q, options) {
  const id = rid(6);
  S.polls[id] = { id, ch: chId, by: author, q: clean(q, 140), options: options.map((o) => clean(o, 60)).filter(Boolean).slice(0, 6), votes: {}, created: now(), closes: now() + 7 * 86400000 };
  S.store.touch('polls'); return S.polls[id];
};
