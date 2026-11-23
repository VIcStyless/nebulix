'use strict';
// Community servers/channels, friends, E2EE direct messages (ciphertext only) and the realtime hub.
const crypto = require('crypto');
const { S, hub, publicUser, isStaff, isAdmin } = require('../state');
const uploads = require('../uploads');
const P = require('../perms');
const prog = require('../progress');
const { HttpError, rid, sha256, now, msgId, V, Limiter } = require('../util');

const msgLimiter = new Limiter(6, 6000);
const dmLimiter = new Limiter(10, 8000);
const MAX_LOG = 5000;
const EMOJI_RE = /^\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic}|\ufe0f|\p{Emoji_Modifier})*$/u;

// ---------------- helpers ----------------
const logOf = (chId) => S.store.log('c_' + chId);
const dmLog = (convId) => S.store.log('d_' + convId);
const convIdOf = (a, b) => sha256([a, b].sort().join('|')).slice(0, 24);
const cleanText = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\r\n?/g, '\n');

function serverOf(id) { const s = S.servers[id]; if (!s) throw new HttpError(404, 'no_server', 'Server not found'); return P.ensureRoles(s); }
function channelOf(id) { const ch = S.channels[id]; if (!ch) throw new HttpError(404, 'no_channel', 'Channel not found'); return ch; }
function needMember(sv, u) { if (!sv.members[u.id]) throw new HttpError(403, 'not_member', 'Join this server first'); }
function roleIn(sv, u) { const m = sv.members[u.id]; return m ? m.role : null; }
const MODISH = ['kick', 'ban', 'timeout', 'manage_messages'];
function isMod(sv, u) { const p = P.permsOf(sv, u); return MODISH.some((x) => p.has(x)); }
function isOwner(sv, u) { return P.isServerOwner(sv, u); }
// Legacy role label kept for older clients: owner / mod / member, derived from real permissions.
function legacyRole(sv, uid) { if (sv.ownerId === uid) return 'owner'; const u = S.users[uid]; return u && isMod(sv, u) ? 'mod' : 'member'; }
const allMembers = (sv) => Object.keys(sv.members);

function pubMsg(m, chId, uid) {
  const o = { id: m.id, ch: chId, a: m.a, c: m.c, t: m.t, e: m.e || 0, r: m.r || null, at: m.at || [], rx: m.rx || {}, m: m.m || [] };
  if (m.v) o.v = m.v; // voice note { url, dur }
  if (m.b) { o.b = m.b; if (m.em) o.em = m.em; if (m.bt) o.bt = m.bt; if (m.cmd) o.cmd = m.cmd; if (m.rank) o.rank = m.rank; if (m.lv) o.lv = m.lv; if (m.gw) o.gw = { done: !!m.gw.done, n: (m.gw.in || []).length, me: uid ? (m.gw.in || []).includes(uid) : false }; }
  const ch = S.channels[chId]; if (ch && Array.isArray(ch.pins) && ch.pins.includes(m.id)) o.pin = true;
  if (m.p && S.polls && S.polls[m.p]) o.pl = require('./social').pollResults(S.polls[m.p], uid || null);
  return o;
}
function authorsOf(msgs) {
  const out = {};
  for (const m of msgs) { if (!out[m.a] && S.users[m.a]) out[m.a] = publicUser(S.users[m.a]); }
  return out;
}

function createChannel(sv, name, topic, extra) {
  const ch = Object.assign({ id: rid(6), serverId: sv.id, name, topic: topic || '', readOnly: false, slow: 0, created: now() }, extra || {});
  S.channels[ch.id] = ch; sv.channels.push(ch.id); S.store.touch('channels'); S.store.touch('servers');
  return ch;
}

function ensureOfficial() {
  let sv = S.servers[S.meta.officialId];
  if (sv) return sv;
  sv = { id: 's' + rid(6), name: 'Nebulix HQ', icon: '🌌', desc: 'The official community for Nebulix players. Created by VicStyles.', ownerId: 'system', official: true, public: true, created: now(), members: {}, channels: [], bans: {} };
  S.servers[sv.id] = sv; S.meta.officialId = sv.id;
  const wel = createChannel(sv, 'welcome', 'Start here!', { readOnly: true });
  createChannel(sv, 'rules', 'Be kind. Play fair. No spam, hate or NSFW.', { readOnly: true });
  createChannel(sv, 'announcements', 'News and updates from the team', { readOnly: true });
  createChannel(sv, 'general', 'Chat about anything');
  createChannel(sv, 'gaming', 'What are you playing?');
  createChannel(sv, 'looking-for-group', 'Find teammates');
  createChannel(sv, 'memes', 'Keep it fun and safe-for-work');
  createChannel(sv, 'help', 'Questions about the proxy, themes, coins…');
  createChannel(sv, 'theme-showcase', 'Share the themes you create');
  createChannel(sv, 'casino-lounge', 'Brag about your wins (virtual coins only!)');
  const log = logOf(wel.id);
  log.push({ id: msgId(), a: 'system', c: 'Welcome to Nebulix HQ. Read #rules, say hi in #general, and try the Browser, Casino and Marketplace. Created by VicStyles.', t: now() });
  S.store.touchLog('c_' + wel.id); S.store.touch('meta');
  return sv;
}

function joinOfficial(u) {
  const sv = ensureOfficial();
  if (!sv.members[u.id]) { sv.members[u.id] = { role: 'member', joined: now(), roles: [] }; S.store.touch('servers'); }
}

function visibleServers(u) { return Object.values(S.servers).filter((s) => s.members[u.id]); }
function serverView(sv, u) {
  P.ensureRoles(sv);
  const perms = P.permsOf(sv, u); const top = P.topPos(sv, u);
  return {
    id: sv.id, name: sv.name, icon: sv.icon, desc: sv.desc, official: !!sv.official, public: !!sv.public, ownerId: sv.ownerId,
    myRole: sv.members[u.id] ? legacyRole(sv, u.id) : null, myRoles: (sv.members[u.id] || {}).roles || [], myPerms: [...perms], myTop: Number.isFinite(top) ? top : null,
    canManage: perms.has('manage_server') || perms.has('manage_channels') || perms.has('manage_roles'), canMod: MODISH.some((p) => perms.has(p)),
    roles: P.rolesView(sv), everyone: sv.everyone.slice(), members: allMembers(sv).length,
    channels: sv.channels.map((id) => S.channels[id]).filter((ch) => ch && P.canView(sv, ch, u)).map((ch) => {
      const log = logOf(ch.id); const last = log.length ? log[log.length - 1].id : null;
      return { id: ch.id, name: ch.name, topic: ch.topic, readOnly: !!ch.readOnly, slow: ch.slow || 0, last, private: P.isPrivate(ch), roles: P.isPrivate(ch) ? (ch.roles || []) : [] };
    }),
  };
}

function peers(u) { // users who should see my presence
  const set = new Set(u.friends || []);
  for (const sv of visibleServers(u)) { const ids = Object.keys(sv.members); if (ids.length <= 200) ids.forEach((i) => set.add(i)); }
  set.delete(u.id);
  return set;
}

function canDm(from, to) {
  if ((to.blocked || []).includes(from.id) || (from.blocked || []).includes(to.id)) return false;
  const pol = (to.settings || {}).dm || 'everyone';
  if (pol === 'none') return false;
  if (pol === 'friends') return (to.friends || []).includes(from.id);
  return true;
}

function fingerprint(pub) { return sha256(`${pub.x}.${pub.y}`); }

// ---------------- realtime ----------------
const RTC_KINDS = ['ring', 'accept', 'decline', 'offer', 'answer', 'ice', 'end'];
const rtcLimiter = new Limiter(120, 10000);
const ACT_KINDS = ['music', 'dj', 'arcade', 'duel', 'browse', 'casino', 'nerd', 'os', 'voice'];
function announcePresence(u) {
  if (!u) return;
  const showAct = !(u.settings && u.settings.showActivity === false);
  const st = require('../state');
  hub.pushMany([...peers(u), u.id], { t: 'presence', id: u.id, online: hub.online(u.id), act: showAct ? st.activityOf(u) : null, status: st.statusOf(u) });
}
function attachWs(conn, u) {
  const first = hub.add(u.id, conn);
  conn.send({ t: 'ready', me: u.id });
  if (first) hub.pushMany(peers(u), { t: 'presence', id: u.id, online: true });
  let actAt = 0;
  conn.on('message', (txt) => {
    let m; try { m = JSON.parse(txt); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') conn.send(Number.isFinite(m.n) ? { t: 'pong', n: m.n } : { t: 'pong' });
    else if (typeof m.t === 'string' && m.t.startsWith('c3d_')) require('../c3d').onMessage(conn, u, m);
    else if (typeof m.t === 'string' && m.t.startsWith('w3_')) require('../worlds').onMessage(conn, u, m);
    else if (typeof m.t === 'string' && m.t.startsWith('ar_')) require('../arena').onMessage(conn, u, m);
    else if (typeof m.t === 'string' && m.t.startsWith('st_')) { if (m.t === 'st_rehost') { const g = require('../study').rejoinHost(conn, u); if (g) conn.send({ t: 'st_room', pin: g.pin, title: g.title, n: g.qs.length, host: true, phase: g.phase, players: [...g.players.values()].map((p) => p.name) }); } else require('../study').onMessage(conn, u, m); }
    else if (m.t === 'boss_hit') require('../boss').onMessage(conn, u, m);
    else if (m.t === 'act') { // live activity: "Listening to …", "Playing Nebula Snake", …
      const t = Date.now(); if (t - actAt < 1500) return; actAt = t;
      const kind = ACT_KINDS.includes(m.kind) ? m.kind : null;
      const label = kind ? cleanText(String(m.label || '')).trim().slice(0, 80) : '';
      const prev = hub.act.get(u.id);
      if (!kind) hub.act.delete(u.id); else hub.act.set(u.id, { kind, label, t });
      if (!prev && !kind) return;
      if (prev && kind && prev.kind === kind && prev.label === label) return;
      announcePresence(S.users[u.id] || u);
    } else if (m.t === 'rtc') { // WebRTC signalling for screen sharing between people who may DM each other
      if (!rtcLimiter.hit(u.id)) return;
      const me = S.users[u.id]; const to = S.users[String(m.to || '')];
      if (!me || !to || to.id === me.id || !me.verified || !to.verified || !canDm(me, to) || !canDm(to, me)) return conn.send({ t: 'rtc_err', to: m.to, error: 'not_allowed' });
      const d = m.d && typeof m.d === 'object' ? m.d : null; if (!d || !RTC_KINDS.includes(d.kind) || JSON.stringify(d).length > 24000) return;
      if (!hub.online(to.id)) return conn.send({ t: 'rtc_err', to: to.id, error: 'offline', call: d.call });
      hub.push(to.id, { t: 'rtc', from: me.id, d, u: d.kind === 'ring' ? publicUser(me) : undefined });
    } else if (m.t === 'vc_join') vcJoin(conn, u, String(m.ch || ''));
    else if (m.t === 'vc_leave') vcLeave(conn, u);
    else if (m.t === 'vc_mute') { const room = vc.rooms.get(conn.data.vc); const me = room && room.get(u.id); if (me && me.conn === conn) { me.muted = !!m.muted; if (m.deaf !== undefined) me.deaf = !!m.deaf; if (m.cam !== undefined) me.cam = !!m.cam; if (m.screen !== undefined) me.screen = !!m.screen; vcBroadcast(conn.data.vc); } }
    else if (m.t === 'vc_sound') { // soundboard: everyone in the room plays the same short sound
      const room = vc.rooms.get(conn.data.vc); const me = room && room.get(u.id); const k = String(m.k || ''); if (!me || me.smute || !/^[a-z]{2,12}$/.test(k)) return;
      const t0 = Date.now(); if (t0 - (me.soundAt || 0) < 2500) return; me.soundAt = t0; for (const x of room.values()) x.conn.send({ t: 'vc_sound', from: u.id, k });
    }
    else if (m.t === 'vc_sig') { // WebRTC signalling between two people in the same voice room
      if (!rtcLimiter.hit(u.id)) return;
      const room = vc.rooms.get(conn.data.vc); const to = String(m.to || '');
      if (!room || !room.has(u.id) || !room.has(to) || to === u.id) return;
      const d = m.d && typeof m.d === 'object' ? m.d : null; if (!d || !['offer', 'answer', 'ice'].includes(d.kind) || JSON.stringify(d).length > 24000) return;
      room.get(to).conn.send({ t: 'vc_sig', from: u.id, d });
    }
  });
  conn.on('close', () => {
    if (conn.data.vc) vcLeave(conn, u);
    if (conn.data.c3d) require('../c3d').leave(conn, u);
    if (conn.data.w3) require('../worlds').leave(conn, u);
    if (conn.data.arena) require('../arena').onClose(conn, u);
    if (conn.data.study) require('../study').onClose(conn, u);
    const last = hub.remove(u.id, conn);
    if (last) hub.pushMany(peers(u), { t: 'presence', id: u.id, online: false });
  });
}

// ---------------- voice rooms ----------------
// Every channel has a voice room. Audio goes peer-to-peer (WebRTC mesh); the server only tracks who is in
// which room and relays the handshake between members of the same room. Rooms live in memory only.
const VC_MAX = 10;
const vc = { rooms: new Map() }; // chId -> Map(uid -> { conn, muted, since })
function vcState(chId) { const room = vc.rooms.get(chId); return room ? [...room.entries()].map(([id, x]) => ({ id, muted: x.muted || !!x.smute, deaf: !!x.deaf, smute: !!x.smute, cam: !!x.cam, screen: !!x.screen, since: x.since })) : []; }
// a moderator (or a ban/kick/timeout) removes someone from the voice rooms of a server
function vcKick(uid, svId, why) { for (const [id, room] of vc.rooms) { const ch = S.channels[id]; if (!ch || ch.serverId !== svId) continue; const x = room.get(uid); if (!x) continue; x.conn.data.vc = null; room.delete(uid); if (!room.size) vc.rooms.delete(id); x.conn.send({ t: 'vc_kicked', ch: id, why }); for (const y of room.values()) y.conn.send({ t: 'vc_peer_left', ch: id, id: uid }); vcBroadcast(id); } }
function vcBroadcast(chId) {
  const ch = S.channels[chId]; if (!ch) return; const sv = S.servers[ch.serverId]; if (!sv) return;
  hub.pushMany(P.viewersOf(P.ensureRoles(sv), ch), { t: 'vc_state', sv: sv.id, ch: chId, users: vcState(chId) });
}
function vcLeave(conn, u) {
  const chId = conn.data.vc; if (!chId) return; conn.data.vc = null;
  const room = vc.rooms.get(chId); if (!room) return;
  const me = room.get(u.id); if (!me || me.conn !== conn) return;
  room.delete(u.id); if (!room.size) vc.rooms.delete(chId);
  for (const x of room.values()) x.conn.send({ t: 'vc_peer_left', ch: chId, id: u.id });
  vcBroadcast(chId);
}
function vcJoin(conn, u, chId) {
  const ch = S.channels[chId]; const sv = ch && S.servers[ch.serverId]; const me = S.users[u.id];
  if (!ch || !sv || !me || !sv.members[u.id]) return conn.send({ t: 'vc_err', error: 'not_member' });
  P.ensureRoles(sv);
  if (!P.canView(sv, ch, me)) return conn.send({ t: 'vc_err', error: 'no_access' });
  const mem = sv.members[u.id]; if (mem.mutedUntil && mem.mutedUntil > now()) return conn.send({ t: 'vc_err', error: 'timed_out' });
  if (conn.data.vc === chId) return;
  if (conn.data.vc) vcLeave(conn, u);
  // one room per account: leaving from another tab/device
  for (const [id, room] of vc.rooms) { const x = room.get(u.id); if (x) { x.conn.data.vc = null; room.delete(u.id); x.conn.send({ t: 'vc_kicked', ch: id, why: 'elsewhere' }); for (const y of room.values()) y.conn.send({ t: 'vc_peer_left', ch: id, id: u.id }); if (!room.size) vc.rooms.delete(id); vcBroadcast(id); } }
  let room = vc.rooms.get(chId); if (!room) vc.rooms.set(chId, (room = new Map()));
  if (room.size >= VC_MAX) return conn.send({ t: 'vc_err', error: 'full' });
  const peersIn = [...room.keys()];
  room.set(u.id, { conn, muted: false, since: now() }); conn.data.vc = chId;
  conn.send({ t: 'vc_joined', ch: chId, sv: sv.id, peers: peersIn, users: vcState(chId) });
  vcBroadcast(chId);
}

// ---------------- routes ----------------
module.exports = function register(r) {
  require('./community-routes')(r, { serverOf, channelOf, needMember, serverView, allMembers, isMod, vc, vcBroadcast, vcKick });
  r.get('/api/servers/:id/voice', { auth: true, verified: true }, async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user);
    const rooms = {}; for (const id of sv.channels) { const ch = S.channels[id]; if (ch && P.canView(sv, ch, c.user) && vc.rooms.has(id)) rooms[id] = vcState(id); }
    return { rooms, users: Object.fromEntries(Object.values(rooms).flat().map((x) => [x.id, publicUser(S.users[x.id])])) };
  });
  ensureOfficial();

  // ----- servers -----
  r.get('/api/servers', { auth: true, verified: true }, async (c) => {
    const list = visibleServers(c.user);
    if (!list.some((s) => s.official)) { joinOfficial(c.user); return { servers: visibleServers(c.user).map((s) => serverView(P.ensureRoles(s), c.user)) }; }
    return { servers: list.map((s) => serverView(P.ensureRoles(s), c.user)) };
  });

  r.get('/api/servers/discover', { auth: true, verified: true }, async (c) => ({
    servers: Object.values(S.servers).filter((s) => s.public && !s.members[c.user.id]).slice(0, 30).map((s) => ({ id: s.id, name: s.name, icon: s.icon, desc: s.desc, members: Object.keys(s.members).length })),
  }));

  r.post('/api/servers', { auth: true, verified: true, limit: [5, 3600000, 'user'] }, async (c) => {
    const { name, icon, desc } = c.body;
    if (!V.str(name, 2, 32)) throw new HttpError(400, 'bad_name', 'Server name must be 2-32 characters');
    if (Object.values(S.servers).filter((s) => s.ownerId === c.user.id).length >= 5) throw new HttpError(400, 'too_many', 'You can own up to 5 servers');
    const sv = { id: 's' + rid(6), name: cleanText(name).trim(), icon: typeof icon === 'string' && icon.length <= 8 ? icon : '🎮', desc: V.str(desc || '', 0, 200) ? cleanText(desc || '') : '', ownerId: c.user.id, official: false, public: false, created: now(), members: { [c.user.id]: { role: 'owner', joined: now(), roles: [] } }, channels: [], bans: {}, roles: [], everyone: P.DEFAULT_EVERYONE.slice() };
    S.servers[sv.id] = sv;
    createChannel(sv, 'general', 'Say hi!'); createChannel(sv, 'gaming', 'What are you playing?');
    S.store.touch('servers');
    return { server: serverView(sv, c.user) };
  });

  r.patch('/api/servers/:id', { auth: true, verified: true }, async (c) => {
    const sv = serverOf(c.params.id);
    P.need(sv, c.user, 'manage_server', 'You cannot edit this server');
    const b = c.body;
    if (b.name !== undefined) { if (!V.str(b.name, 2, 32)) throw new HttpError(400, 'bad_name', 'Server name must be 2-32 characters'); sv.name = cleanText(b.name).trim(); }
    if (b.desc !== undefined) { if (!V.str(b.desc, 0, 200)) throw new HttpError(400, 'bad_desc', 'Description up to 200 characters'); sv.desc = cleanText(b.desc); }
    if (b.icon !== undefined) { if (typeof b.icon !== 'string' || b.icon.length > 8) throw new HttpError(400, 'bad_icon', 'Use a short emoji'); sv.icon = b.icon; }
    if (b.public !== undefined && !sv.official) sv.public = !!b.public;
    S.store.touch('servers');
    hub.pushMany(allMembers(sv), { t: 'server', id: sv.id });
    return { server: serverView(sv, c.user) };
  });

  r.delete('/api/servers/:id', { auth: true, verified: true }, async (c) => {
    const sv = serverOf(c.params.id);
    if (sv.official) throw new HttpError(403, 'forbidden', 'The official server cannot be deleted');
    if (sv.ownerId !== c.user.id) throw new HttpError(403, 'forbidden', 'Only the owner can delete the server');
    const members = allMembers(sv);
    for (const id of sv.channels) delete S.channels[id];
    delete S.servers[sv.id]; S.store.touch('servers'); S.store.touch('channels');
    hub.pushMany(members, { t: 'server', id: sv.id, gone: true });
    return { ok: true };
  });

  r.post('/api/servers/join', { auth: true, verified: true, limit: [20, 600000, 'user'] }, async (c) => {
    const code = String(c.body.code || '').trim();
    const inv = S.invites[code];
    if (!inv || (inv.exp && inv.exp < now()) || (inv.max && inv.uses >= inv.max)) throw new HttpError(404, 'bad_invite', 'This invite is invalid or expired');
    const sv = serverOf(inv.serverId);
    if (sv.bans[c.user.id]) throw new HttpError(403, 'banned', 'You are banned from this server');
    if (!sv.members[c.user.id]) { sv.members[c.user.id] = { role: 'member', joined: now(), roles: [] }; inv.uses++; S.store.touch('invites'); S.store.touch('servers'); require('../community').onJoin(sv, c.user); }
    hub.pushMany(allMembers(sv), { t: 'server', id: sv.id });
    return { server: serverView(sv, c.user) };
  });

  r.post('/api/servers/:id/join', { auth: true, verified: true, limit: [20, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id);
    if (!sv.public) throw new HttpError(403, 'private', 'This server needs an invite');
    if (sv.bans[c.user.id]) throw new HttpError(403, 'banned', 'You are banned from this server');
    if (!sv.members[c.user.id]) { sv.members[c.user.id] = { role: 'member', joined: now(), roles: [] }; S.store.touch('servers'); require('../community').onJoin(sv, c.user); hub.pushMany(allMembers(sv), { t: 'server', id: sv.id }); }
    return { server: serverView(sv, c.user) };
  });

  r.post('/api/servers/:id/leave', { auth: true, verified: true }, async (c) => {
    const sv = serverOf(c.params.id);
    if (sv.ownerId === c.user.id) throw new HttpError(400, 'owner', 'Owners cannot leave. Delete the server instead.');
    if (sv.official) throw new HttpError(400, 'official', 'You cannot leave the official server');
    delete sv.members[c.user.id]; S.store.touch('servers'); require('../community').onLeave(sv, c.user);
    return { ok: true };
  });

  r.post('/api/servers/:id/invites', { auth: true, verified: true, limit: [20, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user);
    P.need(sv, c.user, 'invite', 'You cannot create invites here');
    const code = rid(5);
    S.invites[code] = { code, serverId: sv.id, by: c.user.id, uses: 0, max: 50, exp: now() + 7 * 86400000 };
    S.store.touch('invites');
    return { code, exp: S.invites[code].exp };
  });

  r.get('/api/servers/:id/members', { auth: true, verified: true }, async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user);
    const list = Object.entries(sv.members).map(([id, m]) => ({ user: publicUser(S.users[id]), role: legacyRole(sv, id), roles: m.roles || [], style: P.memberStyle(sv, id), muted: !!(m.mutedUntil && m.mutedUntil > now()) })).filter((x) => x.user);
    list.sort((a, b) => (b.user.online - a.user.online) || a.user.displayName.localeCompare(b.user.displayName));
    return { members: list.slice(0, 300), total: list.length };
  });

  const modAction = (action) => async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user);
    P.need(sv, c.user, action, 'Moderators only');
    const target = S.users[c.params.uid]; const mem = sv.members[c.params.uid];
    if (!target) throw new HttpError(404, 'no_user', 'User not found');
    if (target.id === c.user.id) throw new HttpError(400, 'self', 'You cannot do that to yourself');
    if (sv.official && isStaff(target) && !isAdmin(c.user)) throw new HttpError(403, 'forbidden', 'You cannot moderate this user');
    if (!P.outranks(sv, c.user, target)) throw new HttpError(403, 'forbidden', 'You can only moderate members below your highest role');
    if (action === 'kick') { delete sv.members[target.id]; }
    else if (action === 'ban') { delete sv.members[target.id]; sv.bans[target.id] = now(); }
    else if (action === 'timeout' && mem) { mem.mutedUntil = now() + Math.min(Math.max(Number(c.body.minutes) || 10, 1), 10080) * 60000; }
    S.store.touch('servers');
    require('../community').modlog(sv, c.user.id, action, target.id, String(c.body.reason || ''), action === 'timeout' ? { minutes: Math.min(Math.max(Number(c.body.minutes) || 10, 1), 10080) } : undefined);
    vcKick(target.id, sv.id, action === 'timeout' ? 'timed_out' : 'removed');
    hub.pushMany([target.id], { t: 'server', id: sv.id, gone: action !== 'timeout' });
    return { ok: true };
  };
  r.post('/api/servers/:id/members/:uid/kick', { auth: true, verified: true }, modAction('kick'));
  r.post('/api/servers/:id/members/:uid/ban', { auth: true, verified: true }, modAction('ban'));
  r.post('/api/servers/:id/members/:uid/timeout', { auth: true, verified: true }, modAction('timeout'));

  // Legacy "make moderator" toggle → adds/removes the server's Moderator role.
  r.post('/api/servers/:id/members/:uid/role', { auth: true, verified: true }, async (c) => {
    const sv = serverOf(c.params.id);
    P.need(sv, c.user, 'manage_roles', 'You cannot manage roles');
    const m = sv.members[c.params.uid]; const target = S.users[c.params.uid];
    if (!m || !target || P.isServerOwner(sv, target)) throw new HttpError(400, 'bad_target', 'Cannot change this member');
    let mod = sv.roles.find((x) => x.name === 'Moderator');
    if (!mod) { if (sv.roles.length >= P.MAX_ROLES) throw new HttpError(400, 'too_many', 'This server has too many roles'); mod = P.mkRole('Moderator', '#22c55e', '', P.MOD_PERMS, true, true); sv.roles.push(mod); }
    if (!P.canManageRole(sv, c.user, mod.id) || (target.id !== c.user.id && !P.outranks(sv, c.user, target))) throw new HttpError(403, 'forbidden', 'You can only manage roles below your highest role');
    m.roles = (m.roles || []).filter((x) => x !== mod.id); if (c.body.role === 'mod') m.roles.push(mod.id);
    m.role = 'member'; S.store.touch('servers');
    hub.pushMany(allMembers(sv), { t: 'server', id: sv.id });
    return { ok: true };
  });

  // ----- roles -----
  const rolesPayload = (sv, u) => ({ roles: P.rolesView(sv), everyone: sv.everyone.slice(), myPerms: [...P.permsOf(sv, u)], myTop: Number.isFinite(P.topPos(sv, u)) ? P.topPos(sv, u) : null, perms: P.PERMS, max: P.MAX_ROLES });
  const rolesChanged = (sv) => { S.store.touch('servers'); S.store.touch('channels'); hub.pushMany(allMembers(sv), { t: 'server', id: sv.id, roles: true }); };

  r.get('/api/servers/:id/roles', { auth: true, verified: true }, async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user);
    return rolesPayload(sv, c.user);
  });

  r.post('/api/servers/:id/roles', { auth: true, verified: true, limit: [40, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id); P.need(sv, c.user, 'manage_roles', 'You cannot manage roles');
    if (sv.roles.length >= P.MAX_ROLES) throw new HttpError(400, 'too_many', `Up to ${P.MAX_ROLES} roles per server`);
    const actor = P.permsOf(sv, c.user);
    const f = P.cleanRoleFields(Object.assign({ name: 'New role' }, c.body || {}), actor);
    const role = P.mkRole(f.name, f.color, f.icon, f.perms || [], f.hoist, f.mentionable);
    sv.roles.push(role); rolesChanged(sv);
    return Object.assign({ role: P.rolesView(sv).find((x) => x.id === role.id) }, rolesPayload(sv, c.user));
  });

  r.patch('/api/servers/:id/roles/:rid', { auth: true, verified: true, limit: [120, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id); P.need(sv, c.user, 'manage_roles', 'You cannot manage roles');
    const role = sv.roles.find((x) => x.id === c.params.rid); if (!role) throw new HttpError(404, 'no_role', 'Role not found');
    if (!P.canManageRole(sv, c.user, role.id)) throw new HttpError(403, 'forbidden', 'You can only edit roles below your highest role');
    const actor = P.permsOf(sv, c.user); const b = Object.assign({}, c.body || {});
    const perms = b.perms !== undefined ? P.mergePerms(role.perms, b.perms, actor) : role.perms; delete b.perms;
    Object.assign(role, P.cleanRoleFields(b, actor), { perms });
    rolesChanged(sv);
    return Object.assign({ role: P.rolesView(sv).find((x) => x.id === role.id) }, rolesPayload(sv, c.user));
  });

  r.delete('/api/servers/:id/roles/:rid', { auth: true, verified: true }, async (c) => {
    const sv = serverOf(c.params.id); P.need(sv, c.user, 'manage_roles', 'You cannot manage roles');
    const i = P.roleIndex(sv, c.params.rid); if (i < 0) throw new HttpError(404, 'no_role', 'Role not found');
    if (!P.canManageRole(sv, c.user, c.params.rid)) throw new HttpError(403, 'forbidden', 'You can only delete roles below your highest role');
    sv.roles.splice(i, 1);
    for (const m of Object.values(sv.members)) m.roles = (m.roles || []).filter((x) => x !== c.params.rid);
    for (const id of sv.channels) { const ch = S.channels[id]; if (ch && Array.isArray(ch.roles)) ch.roles = ch.roles.filter((x) => x !== c.params.rid); } // a private channel stays private (admins only) if it loses its last role
    rolesChanged(sv);
    return rolesPayload(sv, c.user);
  });

  r.put('/api/servers/:id/roles/order', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id); P.need(sv, c.user, 'manage_roles', 'You cannot manage roles');
    const ids = Array.isArray(c.body.ids) ? c.body.ids.map(String) : null;
    const cur = sv.roles.map((x) => x.id);
    if (!ids || ids.length !== cur.length || new Set(ids).size !== ids.length || !ids.every((x) => cur.includes(x))) throw new HttpError(400, 'bad_order', 'Send every role id exactly once');
    const top = P.topPos(sv, c.user);
    const locked = top < 0 ? 0 : (Number.isFinite(top) ? top + 1 : cur.length);
    for (let i = 0; i < locked; i++) if (ids[i] !== cur[i]) throw new HttpError(403, 'forbidden', 'You can only reorder roles below your highest role');
    sv.roles = ids.map((x) => sv.roles.find((r) => r.id === x));
    rolesChanged(sv);
    return rolesPayload(sv, c.user);
  });

  r.patch('/api/servers/:id/everyone', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id); P.need(sv, c.user, 'manage_roles', 'You cannot manage roles');
    sv.everyone = P.mergePerms(sv.everyone, c.body.perms, P.permsOf(sv, c.user), { allowAdmin: false });
    rolesChanged(sv);
    return rolesPayload(sv, c.user);
  });

  r.put('/api/servers/:id/members/:uid/roles', { auth: true, verified: true, limit: [120, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id); P.need(sv, c.user, 'manage_roles', 'You cannot manage roles');
    const target = S.users[c.params.uid]; const m = sv.members[c.params.uid];
    if (!target || !m) throw new HttpError(404, 'no_member', 'Member not found');
    if (target.id !== c.user.id && !P.outranks(sv, c.user, target)) throw new HttpError(403, 'forbidden', 'You can only change roles of members below you');
    const want = Array.isArray(c.body.roles) ? [...new Set(c.body.roles.map(String))] : null;
    if (!want) throw new HttpError(400, 'bad_roles', 'Send a list of role ids');
    for (const id of want) if (P.roleIndex(sv, id) < 0) throw new HttpError(400, 'bad_roles', 'Unknown role');
    const have = m.roles || [];
    for (const id of new Set([...want.filter((x) => !have.includes(x)), ...have.filter((x) => !want.includes(x))])) {
      if (!P.canManageRole(sv, c.user, id)) throw new HttpError(403, 'forbidden', 'You can only give or remove roles below your highest role');
    }
    m.roles = sv.roles.map((x) => x.id).filter((id) => want.includes(id)); // keep hierarchy order
    rolesChanged(sv);
    return { ok: true, roles: m.roles, style: P.memberStyle(sv, target.id) };
  });

  // ----- channels -----
  r.post('/api/servers/:id/channels', { auth: true, verified: true, limit: [20, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id);
    P.need(sv, c.user, 'manage_channels', 'You cannot create channels');
    const name = String(c.body.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
    if (name.length < 2) throw new HttpError(400, 'bad_name', 'Channel name needs 2+ letters/numbers');
    if (sv.channels.length >= 30) throw new HttpError(400, 'too_many', 'Up to 30 channels');
    const extra = { readOnly: !!c.body.readOnly };
    if (c.body.private) { extra.private = true; extra.roles = P.cleanChannelRoles(sv, c.body.roles); }
    const ch = createChannel(sv, name, V.str(c.body.topic || '', 0, 120) ? cleanText(c.body.topic || '') : '', extra);
    hub.pushMany(allMembers(sv), { t: 'server', id: sv.id });
    return { channel: ch };
  });

  r.patch('/api/channels/:id', { auth: true, verified: true }, async (c) => {
    const ch = channelOf(c.params.id); const sv = serverOf(ch.serverId);
    P.need(sv, c.user, 'manage_channels', 'You cannot edit channels');
    const b = c.body;
    if (b.topic !== undefined && V.str(b.topic, 0, 120)) ch.topic = cleanText(b.topic);
    if (b.readOnly !== undefined) ch.readOnly = !!b.readOnly;
    if (b.slow !== undefined) ch.slow = Math.max(0, Math.min(3600, parseInt(b.slow, 10) || 0));
    if (b.private !== undefined) ch.private = !!b.private;
    if (b.roles !== undefined) ch.roles = P.cleanChannelRoles(sv, b.roles);
    if (!ch.private) ch.roles = [];
    S.store.touch('channels'); hub.pushMany(allMembers(sv), { t: 'server', id: sv.id });
    return { ok: true };
  });

  r.delete('/api/channels/:id', { auth: true, verified: true }, async (c) => {
    const ch = channelOf(c.params.id); const sv = serverOf(ch.serverId);
    P.need(sv, c.user, 'manage_channels', 'You cannot delete channels');
    if (sv.channels.length <= 1) throw new HttpError(400, 'last', 'A server needs at least one channel');
    sv.channels = sv.channels.filter((i) => i !== ch.id); delete S.channels[ch.id];
    S.store.touch('servers'); S.store.touch('channels');
    hub.pushMany(allMembers(sv), { t: 'server', id: sv.id });
    return { ok: true };
  });

  // ----- messages -----
  const stylesOf = (sv, msgs) => { const out = {}; for (const m of msgs) if (!(m.a in out) && m.a !== 'system') { const st = P.memberStyle(sv, m.a); if (st) out[m.a] = st; } return out; };

  r.get('/api/channels/:id/messages', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const ch = channelOf(c.params.id); const sv = serverOf(ch.serverId); needMember(sv, c.user); P.needView(sv, ch, c.user);
    const log = logOf(ch.id); const limit = Math.min(Math.max(parseInt(c.query.limit, 10) || 50, 1), 100);
    let end = log.length;
    if (c.query.before) { end = log.findIndex((m) => m.id >= c.query.before); if (end < 0) end = log.length; }
    const slice = log.slice(Math.max(0, end - limit), end);
    return { messages: slice.map((m) => pubMsg(m, ch.id, c.user.id)), users: authorsOf(slice), styles: stylesOf(sv, slice), more: end - limit > 0 };
  });

  r.post('/api/channels/:id/messages', { auth: true, verified: true, limit: [200, 60000, 'user'] }, async (c) => {
    const u = c.user; const ch = channelOf(c.params.id); const sv = serverOf(ch.serverId); needMember(sv, u); P.needView(sv, ch, u);
    const mem = sv.members[u.id]; const perms = P.permsOf(sv, u);
    if (mem.mutedUntil && mem.mutedUntil > now()) throw new HttpError(403, 'muted', 'You are timed out in this server');
    if (!perms.has('send')) throw new HttpError(403, 'no_send', 'You cannot send messages in this server');
    if (ch.readOnly && !perms.has('post_readonly')) throw new HttpError(403, 'read_only', 'Only moderators can post here');
    if (!msgLimiter.hit(u.id)) throw new HttpError(429, 'rate_limited', 'You are sending messages too fast');
    let content = cleanText(c.body.content || '').trim();
    const at = [];
    for (const a of Array.isArray(c.body.attachments) ? c.body.attachments.slice(0, 4) : []) if (uploads.URL_RE.test(String(a))) at.push({ url: a });
    if (at.length && !perms.has('attach')) throw new HttpError(403, 'no_attach', 'You cannot attach images in this server');
    let voice = null;
    if (c.body.voice && typeof c.body.voice === 'object') {
      if (!uploads.VOICE_RE.test(String(c.body.voice.url))) throw new HttpError(400, 'bad_voice', 'Invalid voice message');
      if (!perms.has('attach')) throw new HttpError(403, 'no_attach', 'You cannot send voice messages in this server');
      voice = { url: String(c.body.voice.url), dur: Math.max(0, Math.min(600, Math.round(Number(c.body.voice.dur) || 0))) };
    }
    let poll = null;
    if (c.body.poll && typeof c.body.poll === 'object') {
      const opts = Array.isArray(c.body.poll.options) ? c.body.poll.options.map((o) => cleanText(o || '').trim()).filter(Boolean) : [];
      const q = cleanText(c.body.poll.q || '').trim();
      if (q.length < 2 || q.length > 140 || opts.length < 2 || opts.length > 6 || opts.some((o) => o.length > 60)) throw new HttpError(400, 'bad_poll', 'A poll needs a question and 2-6 short options');
      poll = { q, opts };
    }
    if (!content && !at.length && !voice && !poll) throw new HttpError(400, 'empty', 'Message is empty');
    if (content.length > 2000) throw new HttpError(400, 'too_long', 'Messages can be up to 2000 characters');
    if (ch.slow && !perms.has('manage_messages')) {
      const log = logOf(ch.id);
      for (let i = log.length - 1; i >= 0 && i > log.length - 40; i--) if (log[i].a === u.id) { if (now() - log[i].t < ch.slow * 1000) throw new HttpError(429, 'slowmode', `Slowmode: wait ${ch.slow}s between messages`); break; }
    }
    const viewers = new Set(P.viewersOf(sv, ch));
    const mentions = new Set();
    for (const m of content.matchAll(/@([A-Za-z0-9_]{3,20})/g)) {
      const id = S.byName.get(m[1].toLowerCase());
      if (id && viewers.has(id)) mentions.add(id);
    }
    if (content.includes('@')) { // @Role mentions (mentionable roles, or any role with mention_everyone); names may contain spaces
      const low = content.toLowerCase();
      for (const role of sv.roles) {
        if (!(role.mentionable || perms.has('mention_everyone'))) continue;
        const needle = '@' + role.name.toLowerCase(); let i = low.indexOf(needle); let hit = false;
        while (i >= 0 && !hit) { const nx = low[i + needle.length]; hit = !nx || !/[\p{L}\p{N}_]/u.test(nx); i = low.indexOf(needle, i + 1); }
        if (hit) for (const id of viewers) { const mm = sv.members[id]; if (mm && (mm.roles || []).includes(role.id)) mentions.add(id); }
      }
    }
    // @CommunityRole (site-wide roles like @Donador/@Donator): pings holders, for staff or members allowed to mention everyone
    if (content.includes('@') && (perms.has('mention_everyone') || isStaff(u)) && (S.meta.groles || []).length) {
      const low = content.toLowerCase();
      for (const g of S.meta.groles) {
        const hit = [g.name, g.nameEn].filter(Boolean).some((n) => { const nd = '@' + n.toLowerCase(); let i = low.indexOf(nd); while (i >= 0) { const nx = low[i + nd.length]; if (!nx || !/[\p{L}\p{N}_]/u.test(nx)) return true; i = low.indexOf(nd, i + 1); } return false; });
        if (hit) for (const id of viewers) { const x = S.users[id]; if (x && (x.groles || []).includes(g.id)) mentions.add(id); }
      }
    }
    if (/@(everyone|here)\b/.test(content) && perms.has('mention_everyone')) viewers.forEach((i) => { if (/@everyone\b/.test(content) || hub.online(i)) mentions.add(i); });
    const CM = require('../community');
    if (content && !at.length && !voice && !poll && CM.isCommand(sv, content)) return CM.command(sv, ch, u, content);
    CM.automod(sv, ch, u, content, mentions.size);
    const msg = { id: msgId(), a: u.id, c: content, t: now() };
    if (at.length) msg.at = at;
    if (voice) msg.v = voice;
    if (poll) msg.p = require('./social').createPoll(ch.id, u.id, poll.q, poll.opts).id;
    if (mentions.size) msg.m = [...mentions].slice(0, 50);
    if (c.body.reply && typeof c.body.reply === 'string') { const log = logOf(ch.id); if (log.some((x) => x.id === c.body.reply)) msg.r = c.body.reply; }
    const log = logOf(ch.id); log.push(msg);
    if (log.length > MAX_LOG) log.splice(0, 500);
    S.store.touchLog('c_' + ch.id);
    u.stats = u.stats || {}; u.stats.messages = (u.stats.messages || 0) + 1;
    const pm = pubMsg(msg, ch.id);
    hub.pushMany([...viewers], { t: 'msg', ch: ch.id, sv: sv.id, m: pm, u: publicUser(u), st: P.memberStyle(sv, u.id) });
    prog.award(u, 'msg');
    try { CM.giveXp(sv, ch, u); } catch (e) { console.error('[community] xp', e); }
    return { message: pm };
  });

  r.patch('/api/channels/:cid/messages/:mid', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const ch = channelOf(c.params.cid); const sv = serverOf(ch.serverId); needMember(sv, c.user); P.needView(sv, ch, c.user);
    const m = logOf(ch.id).find((x) => x.id === c.params.mid);
    if (!m) throw new HttpError(404, 'no_message', 'Message not found');
    if (m.a !== c.user.id) throw new HttpError(403, 'forbidden', 'You can only edit your own messages');
    const content = cleanText(c.body.content || '').trim();
    if (!content || content.length > 2000) throw new HttpError(400, 'bad_content', 'Messages can be 1-2000 characters');
    m.c = content; m.e = now(); S.store.touchLog('c_' + ch.id);
    hub.pushMany(P.viewersOf(sv, ch), { t: 'msg_edit', ch: ch.id, id: m.id, c: m.c, e: m.e });
    return { ok: true };
  });

  r.delete('/api/channels/:cid/messages/:mid', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const ch = channelOf(c.params.cid); const sv = serverOf(ch.serverId); needMember(sv, c.user); P.needView(sv, ch, c.user);
    const log = logOf(ch.id); const i = log.findIndex((x) => x.id === c.params.mid);
    if (i < 0) throw new HttpError(404, 'no_message', 'Message not found');
    if (log[i].a !== c.user.id && !P.can(sv, c.user, 'manage_messages')) throw new HttpError(403, 'forbidden', 'You cannot delete this message');
    log.splice(i, 1); S.store.touchLog('c_' + ch.id);
    if (ch.pins && ch.pins.includes(c.params.mid)) { ch.pins = ch.pins.filter((x) => x !== c.params.mid); S.store.touch('channels'); }
    hub.pushMany(P.viewersOf(sv, ch), { t: 'msg_del', ch: ch.id, id: c.params.mid });
    return { ok: true };
  });

  const react = (add) => async (c) => {
    const ch = channelOf(c.params.cid); const sv = serverOf(ch.serverId); needMember(sv, c.user); P.needView(sv, ch, c.user);
    if (add && !P.can(sv, c.user, 'react')) throw new HttpError(403, 'no_react', 'You cannot add reactions in this server');
    const emoji = c.params.emoji;
    if (emoji.length > 16 || !EMOJI_RE.test(emoji)) throw new HttpError(400, 'bad_emoji', 'Use a single emoji');
    const m = logOf(ch.id).find((x) => x.id === c.params.mid);
    if (!m) throw new HttpError(404, 'no_message', 'Message not found');
    m.rx = m.rx || {};
    const arr = m.rx[emoji] || [];
    const i = arr.indexOf(c.user.id);
    if (add && i < 0) { if (!m.rx[emoji] && Object.keys(m.rx).length >= 20) throw new HttpError(400, 'too_many', 'Too many reactions'); arr.push(c.user.id); m.rx[emoji] = arr; prog.award(c.user, 'react'); }
    if (!add && i >= 0) { arr.splice(i, 1); if (!arr.length) delete m.rx[emoji]; }
    S.store.touchLog('c_' + ch.id);
    hub.pushMany(P.viewersOf(sv, ch), { t: 'react', ch: ch.id, id: m.id, rx: m.rx });
    return { rx: m.rx };
  };
  r.put('/api/channels/:cid/messages/:mid/reactions/:emoji', { auth: true, verified: true, limit: [120, 60000, 'user'] }, react(true));
  r.delete('/api/channels/:cid/messages/:mid/reactions/:emoji', { auth: true, verified: true, limit: [120, 60000, 'user'] }, react(false));

  // ----- search & pins -----
  r.get('/api/channels/:id/search', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const ch = channelOf(c.params.id); const sv = serverOf(ch.serverId); needMember(sv, c.user); P.needView(sv, ch, c.user);
    const q = cleanText(c.query.q || '').trim().toLowerCase().slice(0, 80);
    if (q.length < 2) return { messages: [], users: {} };
    const from = c.query.from ? S.byName.get(String(c.query.from).toLowerCase().replace(/^@/, '')) : null;
    const log = logOf(ch.id); const out = [];
    for (let i = log.length - 1; i >= 0 && out.length < 40; i--) {
      const m = log[i]; if (m.a === 'system') continue;
      if (from && m.a !== from) continue;
      if ((m.c || '').toLowerCase().includes(q) || (m.p && S.polls[m.p] && S.polls[m.p].q.toLowerCase().includes(q))) out.push(m);
    }
    return { messages: out.map((m) => pubMsg(m, ch.id, c.user.id)), users: authorsOf(out) };
  });
  r.get('/api/channels/:id/pins', { auth: true, verified: true }, async (c) => {
    const ch = channelOf(c.params.id); const sv = serverOf(ch.serverId); needMember(sv, c.user); P.needView(sv, ch, c.user);
    const log = logOf(ch.id); const ids = (ch.pins || []).slice().reverse();
    const msgs = ids.map((id) => log.find((m) => m.id === id)).filter(Boolean);
    return { messages: msgs.map((m) => pubMsg(m, ch.id, c.user.id)), users: authorsOf(msgs) };
  });
  r.put('/api/channels/:cid/pins/:mid', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const ch = channelOf(c.params.cid); const sv = serverOf(ch.serverId); needMember(sv, c.user); P.needView(sv, ch, c.user);
    P.need(sv, c.user, 'manage_messages', 'Only moderators can pin messages');
    if (!logOf(ch.id).some((m) => m.id === c.params.mid)) throw new HttpError(404, 'no_message', 'Message not found');
    const rest = (ch.pins || []).filter((x) => x !== c.params.mid);
    if (c.body.pinned !== false && rest.length >= 25) throw new HttpError(400, 'too_many', 'A channel can have up to 25 pinned messages');
    ch.pins = c.body.pinned !== false ? rest.concat([c.params.mid]) : rest;
    S.store.touch('channels');
    hub.pushMany(P.viewersOf(sv, ch), { t: 'pins', ch: ch.id, pins: ch.pins.slice() });
    return { pins: ch.pins };
  });

  const typingLim = new Limiter(1, 2000);
  r.post('/api/channels/:id/typing', { auth: true, verified: true }, async (c) => {
    const ch = channelOf(c.params.id); const sv = serverOf(ch.serverId); needMember(sv, c.user); P.needView(sv, ch, c.user);
    if (typingLim.hit(c.user.id + ch.id)) hub.pushMany(P.viewersOf(sv, ch).filter((i) => i !== c.user.id), { t: 'typing', ch: ch.id, u: c.user.id, n: c.user.displayName || c.user.username });
    return { ok: true };
  });

  // ----- friends & blocking -----
  const listOf = (u, k) => (u[k] || []).map((id) => publicUser(S.users[id])).filter(Boolean);
  r.get('/api/friends', { auth: true, verified: true }, async (c) => ({
    friends: listOf(c.user, 'friends'), incoming: listOf(c.user, 'incoming'), outgoing: listOf(c.user, 'outgoing'), blocked: listOf(c.user, 'blocked'),
  }));
  const pull = (arr, id) => { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); };
  r.post('/api/friends/request', { auth: true, verified: true, limit: [20, 3600000, 'user'] }, async (c) => {
    const me = c.user; const id = S.byName.get(String(c.body.username || '').toLowerCase());
    const to = id && S.users[id];
    if (!to || !to.verified) throw new HttpError(404, 'no_user', 'No user with that name');
    if (to.id === me.id) throw new HttpError(400, 'self', 'You cannot add yourself');
    if ((to.blocked || []).includes(me.id) || (me.blocked || []).includes(to.id)) throw new HttpError(403, 'blocked', 'You cannot send a request to this user');
    if (me.friends.includes(to.id)) throw new HttpError(409, 'already', 'You are already friends');
    if (me.incoming.includes(to.id)) { // they already asked me: accept
      pull(me.incoming, to.id); pull(to.outgoing, me.id); me.friends.push(to.id); to.friends.push(me.id);
      S.store.touch('users'); hub.pushMany([me.id, to.id], { t: 'friend' }); prog.award(me, 'friend'); prog.award(to, 'friend');
      return { ok: true, accepted: true };
    }
    if (!me.outgoing.includes(to.id)) { me.outgoing.push(to.id); to.incoming.push(me.id); }
    S.store.touch('users'); hub.pushMany([me.id, to.id], { t: 'friend', from: me.id });
    return { ok: true };
  });
  r.post('/api/friends/accept', { auth: true, verified: true }, async (c) => {
    const me = c.user; const to = S.users[c.body.id];
    if (!to || !me.incoming.includes(to.id)) throw new HttpError(404, 'no_request', 'No such request');
    pull(me.incoming, to.id); pull(to.outgoing, me.id);
    if (!me.friends.includes(to.id)) me.friends.push(to.id);
    if (!to.friends.includes(me.id)) to.friends.push(me.id);
    S.store.touch('users'); hub.pushMany([me.id, to.id], { t: 'friend' }); prog.award(me, 'friend'); prog.award(to, 'friend');
    return { ok: true };
  });
  r.post('/api/friends/decline', { auth: true, verified: true }, async (c) => {
    const me = c.user; const to = S.users[c.body.id]; if (!to) return { ok: true };
    pull(me.incoming, to.id); pull(to.outgoing, me.id); pull(me.outgoing, to.id); pull(to.incoming, me.id);
    S.store.touch('users'); hub.pushMany([me.id, to.id], { t: 'friend' });
    return { ok: true };
  });
  r.delete('/api/friends/:id', { auth: true, verified: true }, async (c) => {
    const me = c.user; const to = S.users[c.params.id]; if (!to) return { ok: true };
    pull(me.friends, to.id); pull(to.friends, me.id);
    S.store.touch('users'); hub.pushMany([me.id, to.id], { t: 'friend' });
    return { ok: true };
  });
  r.post('/api/block/:id', { auth: true, verified: true }, async (c) => {
    const me = c.user; const to = S.users[c.params.id];
    if (!to || to.id === me.id) throw new HttpError(400, 'bad_target', 'Cannot block this user');
    if (!me.blocked.includes(to.id)) me.blocked.push(to.id);
    for (const k of ['friends', 'incoming', 'outgoing']) { pull(me[k], to.id); pull(to[k], me.id); }
    S.store.touch('users'); hub.pushMany([me.id, to.id], { t: 'friend' });
    return { ok: true };
  });
  r.delete('/api/block/:id', { auth: true, verified: true }, async (c) => { pull(c.user.blocked, c.params.id); S.store.touch('users'); return { ok: true }; });

  // ----- end-to-end encryption keys -----
  r.put('/api/e2ee/key', { auth: true, verified: true, limit: [10, 3600000, 'user'] }, async (c) => {
    const p = c.body.pub;
    if (!p || p.kty !== 'EC' || p.crv !== 'P-256' || typeof p.x !== 'string' || typeof p.y !== 'string' || p.x.length > 60 || p.y.length > 60 || !/^[\w-]+$/.test(p.x + p.y)) throw new HttpError(400, 'bad_key', 'Invalid public key');
    const pub = { kty: 'EC', crv: 'P-256', x: p.x, y: p.y };
    const changed = c.user.pub && fingerprint(c.user.pub) !== fingerprint(pub);
    c.user.pub = pub; if (changed) c.user.keyChangedAt = now();
    S.store.touch('users');
    if (changed) hub.pushMany(c.user.friends || [], { t: 'key', id: c.user.id });
    return { ok: true, fp: fingerprint(pub) };
  });
  r.get('/api/users/:id/key', { auth: true, verified: true, limit: [200, 60000, 'user'] }, async (c) => {
    const u = S.users[c.params.id];
    if (!u || !u.pub) throw new HttpError(404, 'no_key', 'This user has not set up encryption yet');
    return { pub: u.pub, fp: fingerprint(u.pub), changedAt: u.keyChangedAt || 0 };
  });
  r.put('/api/e2ee/backup', { auth: true, verified: true, limit: [10, 3600000, 'user'] }, async (c) => {
    const b = c.body.blob;
    if (!b || typeof b !== 'object' || JSON.stringify(b).length > 8192 || ![b.salt, b.iv, b.ct].every((x) => typeof x === 'string')) throw new HttpError(400, 'bad_backup', 'Invalid backup');
    c.user.keyBackup = { v: 1, salt: b.salt, iv: b.iv, ct: b.ct, iter: Math.min(Math.max(parseInt(b.iter, 10) || 600000, 100000), 2000000) };
    S.store.touch('users'); return { ok: true };
  });
  r.get('/api/e2ee/backup', { auth: true, verified: true, limit: [20, 600000, 'user'] }, async (c) => {
    if (!c.user.keyBackup) throw new HttpError(404, 'no_backup', 'No backup found');
    return { blob: c.user.keyBackup, pub: c.user.pub };
  });
  r.delete('/api/e2ee/backup', { auth: true, verified: true }, async (c) => { c.user.keyBackup = null; S.store.touch('users'); return { ok: true }; });

  // ----- direct messages (ciphertext only) -----
  r.get('/api/dm', { auth: true, verified: true }, async (c) => {
    const me = c.user; const out = [];
    for (const conv of Object.values(S.dms)) {
      if (conv.a !== me.id && conv.b !== me.id) continue;
      const peerId = conv.a === me.id ? conv.b : conv.a; const peer = S.users[peerId];
      if (!peer) continue;
      const log = dmLog(conv.id); const read = (conv.reads || {})[me.id] || '';
      out.push({ id: conv.id, peer: publicUser(peer), last: log.length ? { f: log[log.length - 1].f, t: log[log.length - 1].t } : null, lastId: log.length ? log[log.length - 1].id : null, unread: log.filter((m) => m.f !== me.id && m.id > read).length, updated: conv.last });
    }
    out.sort((a, b) => b.updated - a.updated);
    return { conversations: out };
  });

  r.get('/api/dm/:peer/messages', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const me = c.user; const peer = S.users[c.params.peer];
    if (!peer) throw new HttpError(404, 'no_user', 'User not found');
    const id = convIdOf(me.id, peer.id); const conv = S.dms[id];
    if (!conv) return { id, messages: [], more: false, peer: publicUser(peer), key: peer.pub ? { pub: peer.pub, fp: fingerprint(peer.pub) } : null };
    const log = dmLog(id); const limit = Math.min(Math.max(parseInt(c.query.limit, 10) || 50, 1), 100);
    let end = log.length;
    if (c.query.before) { end = log.findIndex((m) => m.id >= c.query.before); if (end < 0) end = log.length; }
    const seen = (peer.settings || {}).readReceipts === false || (me.settings || {}).readReceipts === false ? null : (conv.reads || {})[peer.id] || null;
    return { id, messages: log.slice(Math.max(0, end - limit), end), more: end - limit > 0, peer: publicUser(peer), key: peer.pub ? { pub: peer.pub, fp: fingerprint(peer.pub) } : null, peerRead: seen };
  });

  r.post('/api/dm/:peer/messages', { auth: true, verified: true, limit: [120, 60000, 'user'] }, async (c) => {
    const me = c.user; const peer = S.users[c.params.peer];
    if (!peer || !peer.verified) throw new HttpError(404, 'no_user', 'User not found');
    if (peer.id === me.id) throw new HttpError(400, 'self', 'You cannot message yourself');
    if (!canDm(me, peer)) throw new HttpError(403, 'dm_blocked', 'This user is not accepting messages from you');
    if (!peer.pub) throw new HttpError(409, 'peer_no_key', 'This user has not enabled encryption yet. Ask them to open Direct Messages once.');
    if (!dmLimiter.hit(me.id)) throw new HttpError(429, 'rate_limited', 'You are sending messages too fast');
    const { iv, ct } = c.body;
    if (typeof iv !== 'string' || typeof ct !== 'string' || iv.length > 32 || ct.length > 24000 || !/^[\w+/=-]+$/.test(iv + ct)) throw new HttpError(400, 'bad_message', 'Invalid encrypted payload');
    const id = convIdOf(me.id, peer.id);
    let conv = S.dms[id];
    if (!conv) { conv = S.dms[id] = { id, a: me.id, b: peer.id, last: now(), reads: {} }; }
    const msg = { id: msgId(), f: me.id, iv, ct, t: now() };
    const log = dmLog(id); log.push(msg); if (log.length > MAX_LOG) log.splice(0, 500);
    conv.last = now(); conv.reads[me.id] = msg.id;
    S.store.touch('dms'); S.store.touchLog('d_' + id);
    hub.pushMany([me.id, peer.id], { t: 'dm', conv: id, from: me.id, to: peer.id, m: msg, u: publicUser(me) });
    prog.award(me, 'dm');
    return { message: msg, conv: id };
  });

  const dmTyping = new Limiter(1, 2500);
  r.post('/api/dm/:peer/typing', { auth: true, verified: true }, async (c) => {
    const peer = S.users[c.params.peer]; if (!peer || peer.id === c.user.id || !canDm(c.user, peer)) return { ok: true };
    if (dmTyping.hit(c.user.id + peer.id)) hub.push(peer.id, { t: 'dm_typing', from: c.user.id });
    return { ok: true };
  });

  r.post('/api/dm/:peer/read', { auth: true, verified: true }, async (c) => {
    const id = convIdOf(c.user.id, c.params.peer); const conv = S.dms[id];
    if (conv) {
      const log = dmLog(id); const last = log.length ? log[log.length - 1].id : ''; const prev = conv.reads[c.user.id];
      conv.reads[c.user.id] = last; S.store.touch('dms');
      const peer = S.users[c.params.peer];
      if (last && last !== prev && peer && (c.user.settings || {}).readReceipts !== false && (peer.settings || {}).readReceipts !== false) hub.push(peer.id, { t: 'dm_read', conv: id, by: c.user.id, id: last });
    }
    return { ok: true };
  });

  r.delete('/api/dm/:peer/messages/:mid', { auth: true, verified: true }, async (c) => {
    const id = convIdOf(c.user.id, c.params.peer); const conv = S.dms[id];
    if (!conv) throw new HttpError(404, 'no_conv', 'Conversation not found');
    const log = dmLog(id); const i = log.findIndex((m) => m.id === c.params.mid);
    if (i < 0) throw new HttpError(404, 'no_message', 'Message not found');
    if (log[i].f !== c.user.id) throw new HttpError(403, 'forbidden', 'You can only delete your own messages');
    log.splice(i, 1); S.store.touchLog('d_' + id);
    hub.pushMany([conv.a, conv.b], { t: 'dm_del', conv: id, id: c.params.mid });
    return { ok: true };
  });

  // ----- reports -----
  r.post('/api/reports', { auth: true, verified: true, limit: [10, 3600000, 'user'] }, async (c) => {
    const { type, target, ref, reason } = c.body;
    if (!['message', 'user', 'theme', 'server', 'hub', 'world'].includes(type) || !V.str(String(target || ''), 1, 60) || !V.str(reason, 3, 300)) throw new HttpError(400, 'bad_report', 'Tell us briefly what happened');
    const rep = { id: rid(6), type, target: String(target), ref: ref ? String(ref).slice(0, 60) : null, reason: cleanText(reason), by: c.user.id, t: now(), open: true };
    if (type === 'message' && ref) { const m = logOf(String(ref)).find((x) => x.id === target); if (m) rep.snapshot = { a: m.a, c: m.c.slice(0, 500) }; }
    S.reports.unshift(rep); if (S.reports.length > 1000) S.reports.length = 1000;
    S.store.touch('reports');
    return { ok: true };
  });
};

module.exports.attachWs = attachWs;
module.exports.announcePresence = announcePresence;
module.exports.peers = peers;
module.exports.joinOfficial = joinOfficial;
module.exports.ensureOfficial = ensureOfficial;
module.exports.internals = { logOf, pubMsg, createChannel, serverView, allMembers };
