'use strict';
// Routes for the community tools (server bot, levels, AutoMod, moderation log, bans, warnings, tickets, role
// buttons and voice moderation). Registered from routes/chat.js, which passes its helpers in.
const { S, hub, publicUser } = require('../state');
const P = require('../perms');
const CM = require('../community');
const { HttpError, now } = require('../util');

module.exports = function register(r, H) {
  const { serverOf, channelOf, needMember, vc, vcBroadcast, vcKick } = H;
  const users = (ids) => Object.fromEntries([...new Set(ids.filter((x) => x && x !== 'bot'))].map((id) => [id, S.users[id] ? publicUser(S.users[id]) : null]).filter((x) => x[1]));
  const manager = (sv, u) => { if (!P.can(sv, u, 'manage_server')) throw new HttpError(403, 'forbidden', 'You need the Manage server permission'); };
  const anyMod = (sv, u) => { const p = P.permsOf(sv, u); if (!['kick', 'ban', 'timeout', 'manage_messages', 'manage_server'].some((x) => p.has(x))) throw new HttpError(403, 'forbidden', 'Moderators only'); };
  CM.start();

  // ---- bot settings ----
  r.get('/api/servers/:id/bot', { auth: true, verified: true }, async (c) => { const sv = serverOf(c.params.id); needMember(sv, c.user); manager(sv, c.user); return { bot: CM.publicCfg(sv), help: CM.HELP }; });
  r.patch('/api/servers/:id/bot', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => { const sv = serverOf(c.params.id); needMember(sv, c.user); manager(sv, c.user); return { bot: CM.setCfg(sv, c.body || {}) }; });
  r.get('/api/servers/:id/commands', { auth: true, verified: true }, async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user); const cfg = CM.cfgOf(sv); const p = P.permsOf(sv, c.user); const mod = ['timeout', 'manage_messages'].some((x) => p.has(x));
    return { on: cfg.on, bot: { n: cfg.name, i: cfg.icon }, builtin: CM.HELP.filter(([, d]) => mod || !/\(mods\)/.test(d)), custom: Object.keys(cfg.cmds) };
  });

  // ---- levels ----
  r.get('/api/servers/:id/levels', { auth: true, verified: true }, async (c) => { const sv = serverOf(c.params.id); needMember(sv, c.user); return { on: CM.cfgOf(sv).levels.on, top: CM.leaderboard(sv, 50), me: CM.rankOf(sv, c.user.id), rewards: CM.cfgOf(sv).levels.rewards }; });

  // ---- moderation log, bans, warnings ----
  r.get('/api/servers/:id/modlog', { auth: true, verified: true }, async (c) => { const sv = serverOf(c.params.id); needMember(sv, c.user); anyMod(sv, c.user); const list = (sv.modlog || []).slice(0, 200); return { log: list, users: users(list.flatMap((e) => [e.by, e.target])) }; });
  r.get('/api/servers/:id/bans', { auth: true, verified: true }, async (c) => { const sv = serverOf(c.params.id); needMember(sv, c.user); P.need(sv, c.user, 'ban', 'Moderators only'); const ids = Object.keys(sv.bans || {}); return { bans: ids.map((id) => ({ user: S.users[id] ? publicUser(S.users[id]) : { id, username: '?', displayName: '?' }, at: sv.bans[id] })) }; });
  r.post('/api/servers/:id/bans/:uid/unban', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => { const sv = serverOf(c.params.id); needMember(sv, c.user); P.need(sv, c.user, 'ban', 'Moderators only'); if (!sv.bans[c.params.uid]) throw new HttpError(404, 'not_banned', 'This user is not banned'); delete sv.bans[c.params.uid]; S.store.touch('servers'); CM.modlog(sv, c.user.id, 'unban', c.params.uid, String(c.body.reason || '')); return { ok: true }; });
  r.get('/api/servers/:id/members/:uid/warns', { auth: true, verified: true }, async (c) => { const sv = serverOf(c.params.id); needMember(sv, c.user); P.need(sv, c.user, 'timeout', 'Moderators only'); const l = (sv.warns || {})[c.params.uid] || []; return { warns: l, users: users(l.map((w) => w.by)) }; });
  r.post('/api/servers/:id/members/:uid/warn', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user); P.need(sv, c.user, 'timeout', 'Moderators only'); const t = S.users[c.params.uid];
    if (!t || !sv.members[t.id]) throw new HttpError(404, 'no_user', 'Member not found'); if (t.id === c.user.id || !P.outranks(sv, c.user, t)) throw new HttpError(403, 'forbidden', 'You can only warn members below your highest role');
    return { count: CM.warn(sv, c.user.id, t.id, String(c.body.reason || '')) };
  });
  r.delete('/api/servers/:id/members/:uid/warns', { auth: true, verified: true }, async (c) => { const sv = serverOf(c.params.id); needMember(sv, c.user); P.need(sv, c.user, 'timeout', 'Moderators only'); if (sv.warns) delete sv.warns[c.params.uid]; S.store.touch('servers'); CM.modlog(sv, c.user.id, 'clearwarns', c.params.uid, ''); return { ok: true }; });

  // ---- panels: tickets and role buttons ----
  r.post('/api/servers/:id/panels', { auth: true, verified: true, limit: [30, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user); const b = c.body || {}; const ch = S.channels[b.ch];
    if (!ch || ch.serverId !== sv.id) throw new HttpError(400, 'bad_channel', 'Pick a channel of this server');
    const title = String(b.title || '').slice(0, 100).trim(); const text = String(b.text || '').slice(0, 1000).trim();
    const es = CM.cfgOf(sv).lang !== 'en';
    if (b.kind === 'ticket') {
      manager(sv, c.user);
      return { message: CM.botSay(sv, ch, '', { em: { title: title || (es ? '🎫 Soporte' : '🎫 Support'), desc: text || (es ? '¿Necesitas ayuda del staff? Pulsa el botón para abrir un ticket privado.' : 'Need help from the staff? Press the button to open a private ticket.'), color: '#5865f2' }, bt: [{ id: 'ticket_open', label: '🎫 ' + (String(b.button || '').slice(0, 30) || (es ? 'Abrir un ticket' : 'Open a ticket')), style: 'primary' }] }) };
    }
    if (b.kind === 'roles') {
      P.need(sv, c.user, 'manage_roles', 'You need the Manage roles permission');
      const roles = (Array.isArray(b.roles) ? b.roles : []).map((id) => sv.roles.find((x) => x.id === id)).filter(Boolean).slice(0, 10);
      if (!roles.length) throw new HttpError(400, 'no_roles', 'Pick at least one role');
      for (const ro of roles) { if (!CM.SAFE_ROLE(ro)) throw new HttpError(400, 'bad_role', `“${ro.name}” has moderator permissions and cannot be self-assigned`); if (!P.canManageRole(sv, c.user, ro.id)) throw new HttpError(403, 'forbidden', 'You can only use roles below your highest role'); }
      return { message: CM.botSay(sv, ch, '', { em: { title: title || (es ? '🎭 Elige tus roles' : '🎭 Pick your roles'), desc: text || (es ? 'Pulsa un botón para ponerte o quitarte un rol.' : 'Press a button to get or remove a role.'), color: '#22c55e' }, bt: roles.map((ro) => ({ id: 'role:' + ro.id, label: (ro.icon ? ro.icon + ' ' : '') + ro.name, style: 'ghost', color: ro.color || null })) }) };
    }
    throw new HttpError(400, 'bad_kind', 'Unknown panel');
  });
  r.post('/api/channels/:cid/messages/:mid/button', { auth: true, verified: true, limit: [60, 60000, 'user'] }, async (c) => {
    const ch = channelOf(c.params.cid); const sv = serverOf(ch.serverId); needMember(sv, c.user); P.needView(sv, ch, c.user);
    const m = require('./chat').internals.logOf(ch.id).find((x) => x.id === c.params.mid);
    return CM.button(sv, ch, m, c.user, String((c.body || {}).id || ''));
  });
  r.get('/api/servers/:id/tickets', { auth: true, verified: true }, async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user); const staff = P.can(sv, c.user, 'manage_channels') || P.can(sv, c.user, 'manage_messages');
    const list = sv.channels.map((id) => S.channels[id]).filter((ch) => ch && ch.ticket && (staff || ch.ticket.by === c.user.id)).map((ch) => ({ id: ch.id, name: ch.name, topic: ch.topic, by: ch.ticket.by, open: ch.ticket.open, at: ch.ticket.at, closed: ch.ticket.closed || 0 }));
    return { tickets: list, users: users(list.map((x) => x.by)), staff };
  });
  r.get('/api/channels/:id/transcript', { auth: true, verified: true, limit: [20, 60000, 'user'] }, async (c) => {
    const ch = channelOf(c.params.id); const sv = serverOf(ch.serverId); needMember(sv, c.user); P.needView(sv, ch, c.user);
    if (!(ch.ticket && ch.ticket.by === c.user.id) && !P.can(sv, c.user, 'manage_messages')) throw new HttpError(403, 'forbidden', 'Moderators only');
    return { name: ch.name, text: CM.transcript(sv, ch) };
  });

  // ---- voice moderation ----
  const findVc = (sv, uid) => { for (const [id, room] of vc.rooms) { const ch = S.channels[id]; if (ch && ch.serverId === sv.id && room.has(uid)) return { id, x: room.get(uid) }; } return null; };
  r.post('/api/servers/:id/voice/:uid/disconnect', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user); P.need(sv, c.user, 'kick', 'Moderators only'); const t = S.users[c.params.uid];
    if (!t || (t.id !== c.user.id && !P.outranks(sv, c.user, t))) throw new HttpError(403, 'forbidden', 'You can only moderate members below your highest role');
    if (!findVc(sv, t.id)) throw new HttpError(404, 'not_in_voice', 'This member is not in voice'); vcKick(t.id, sv.id, 'disconnected'); CM.modlog(sv, c.user.id, 'voice_disconnect', t.id, ''); return { ok: true };
  });
  r.post('/api/servers/:id/voice/:uid/mute', { auth: true, verified: true, limit: [60, 600000, 'user'] }, async (c) => {
    const sv = serverOf(c.params.id); needMember(sv, c.user); P.need(sv, c.user, 'timeout', 'Moderators only'); const t = S.users[c.params.uid];
    if (!t || (t.id !== c.user.id && !P.outranks(sv, c.user, t))) throw new HttpError(403, 'forbidden', 'You can only moderate members below your highest role');
    const f = findVc(sv, t.id); if (!f) throw new HttpError(404, 'not_in_voice', 'This member is not in voice');
    f.x.smute = !!(c.body || {}).on; f.x.conn.send({ t: 'vc_smute', on: f.x.smute }); vcBroadcast(f.id); CM.modlog(sv, c.user.id, f.x.smute ? 'voice_mute' : 'voice_unmute', t.id, ''); return { ok: true, on: f.x.smute };
  });
  void now; void hub;
};
