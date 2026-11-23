'use strict';
// Community tools for servers (Nebulix 9.1): the server bot (slash commands, custom commands, welcome messages,
// auto-role, levels with role rewards, reminders, giveaways), AutoMod, warnings, a moderation log, tickets and
// role buttons. Bot messages are normal channel messages with a: 'bot' plus { b: bot identity, em: embed, bt: buttons }.
const { S, hub, publicUser } = require('./state');
const P = require('./perms');
const { HttpError, now, msgId, rid } = require('./util');

const chat = () => require('./routes/chat').internals;
const DEF = () => ({
  on: true, name: 'Nebubot', icon: '🤖', lang: 'es',
  welcome: { on: false, ch: '', text: '¡Bienvenido/a {user} a **{server}**! 🎉 Eres el miembro #{count}.' },
  goodbye: { on: false, ch: '', text: '{name} ha salido del servidor. 👋' },
  autorole: '', cmds: {},
  levels: { on: true, announce: true, rewards: [] },
  automod: { on: false, words: [], links: false, invites: true, caps: false, spam: true, mentions: 6, action: 'delete', minutes: 10, escalate: true, exempt: [] },
  logCh: '',
  tickets: { staff: [], n: 0, cat: 'ticket' },
});
function cfgOf(sv) {
  const d = DEF(); const c = sv.bot || {};
  const out = Object.assign({}, d, c);
  for (const k of ['welcome', 'goodbye', 'levels', 'automod', 'tickets']) out[k] = Object.assign({}, d[k], c[k] || {});
  if (!out.cmds || typeof out.cmds !== 'object') out.cmds = {};
  sv.bot = out; return out;
}
const T = (sv, en, es) => (cfgOf(sv).lang === 'en' ? en : es);
const botId = (sv) => { const c = cfgOf(sv); return { n: c.name, i: c.icon }; };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, '').trim().slice(0, n);

// ---- posting as the bot ----
function botSay(sv, ch, text, extra = {}) {
  if (!ch || !S.channels[ch.id]) return null;
  const { logOf, pubMsg } = chat();
  const msg = Object.assign({ id: msgId(), a: 'bot', c: clean(text, 2000), t: now(), b: botId(sv) }, extra);
  const log = logOf(ch.id); log.push(msg); if (log.length > 5000) log.splice(0, 500); S.store.touchLog('c_' + ch.id);
  const pm = pubMsg(msg, ch.id);
  hub.pushMany(P.viewersOf(P.ensureRoles(sv), ch), { t: 'msg', ch: ch.id, sv: sv.id, m: pm, u: null });
  return pm;
}
function editMsg(sv, ch, m) { S.store.touchLog('c_' + ch.id); hub.pushMany(P.viewersOf(sv, ch), { t: 'msg_edit', ch: ch.id, id: m.id, c: m.c, e: m.e || 0, em: m.em || null, bt: m.bt || null }); }
const firstTextCh = (sv) => sv.channels.map((id) => S.channels[id]).find((c) => c && !c.readOnly && !P.isPrivate(c) && !c.ticket) || S.channels[sv.channels[0]];
const chIn = (sv, id) => (id && sv.channels.includes(id) && S.channels[id]) || null;
const nameOf = (uid) => { const u = S.users[uid]; return u ? u.displayName || u.username : '?'; };

// ---- moderation log ----
function modlog(sv, by, act, target, reason, extra) {
  sv.modlog = Array.isArray(sv.modlog) ? sv.modlog : [];
  const e = Object.assign({ id: rid(6), t: now(), by, act, target: target || null, reason: clean(reason || '', 300) }, extra || {});
  sv.modlog.unshift(e); if (sv.modlog.length > 300) sv.modlog.length = 300; S.store.touch('servers');
  const c = cfgOf(sv); const ch = chIn(sv, c.logCh);
  if (ch) {
    const ICON = { kick: '👢', ban: '🔨', unban: '♻️', timeout: '⏳', warn: '⚠️', automod: '🛡️', purge: '🧹', clearwarns: '🧽', ticket_open: '🎫', ticket_close: '🔒', slowmode: '🐢', lock: '🔐', unlock: '🔓' };
    botSay(sv, ch, '', { em: { title: (ICON[act] || '📝') + ' ' + act.toUpperCase(), color: act === 'ban' || act === 'automod' ? '#ef4444' : act === 'warn' || act === 'timeout' ? '#f59e0b' : '#5865f2',
      fields: [[T(sv, 'By', 'Por'), by === 'bot' ? c.name : '@' + nameOf(by)], target ? [T(sv, 'Member', 'Miembro'), '@' + nameOf(target)] : null, e.reason ? [T(sv, 'Reason', 'Motivo'), e.reason] : null, extra && extra.minutes ? [T(sv, 'Duration', 'Duración'), extra.minutes + ' min'] : null, extra && extra.n ? [T(sv, 'Messages', 'Mensajes'), String(extra.n)] : null].filter(Boolean) } });
  }
  return e;
}
function warn(sv, by, uid, reason) {
  sv.warns = sv.warns || {}; const list = (sv.warns[uid] = sv.warns[uid] || []); list.push({ t: now(), by, reason: clean(reason || '', 300) }); S.store.touch('servers');
  modlog(sv, by, 'warn', uid, reason);
  hub.push(uid, { t: 'notice', text: `⚠️ You were warned in ${sv.name}${reason ? ': ' + reason : ''}`, es: `⚠️ Has recibido un aviso en ${sv.name}${reason ? ': ' + reason : ''}` });
  const c = cfgOf(sv); const recent = list.filter((w) => now() - w.t < 7 * 864e5).length;
  if (c.automod.escalate && recent >= 3 && sv.members[uid]) { sv.members[uid].mutedUntil = now() + 60 * 60000; modlog(sv, 'bot', 'timeout', uid, T(sv, '3 warnings in 7 days', '3 avisos en 7 días'), { minutes: 60 }); }
  return list.length;
}

// ---- AutoMod: runs before a message is saved ----
const recent = new Map(); // `${sv}:${uid}` -> [{ c, t }]
const INVITE_RE = /(discord\.(gg|com\/invite)|discordapp\.com\/invite|\/join\/[A-Za-z0-9]{4,}|invite\/[A-Za-z0-9]{4,})/i;
const LINK_RE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]/i;
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[0@]/g, 'o').replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/[5$]/g, 's');
function automod(sv, ch, u, content, mentions) {
  const c = cfgOf(sv); const a = c.automod; if (!a.on || !content) return;
  const perms = P.permsOf(sv, u); if (perms.has('manage_messages') || perms.has('admin')) return;
  const mem = sv.members[u.id]; if ((mem.roles || []).some((r) => a.exempt.includes(r))) return;
  let why = null; const low = fold(content);
  if (a.words.length) { const hit = a.words.find((w) => w && new RegExp('(^|[^\\p{L}\\p{N}])' + fold(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}])', 'u').test(low)); if (hit) why = T(sv, 'Blocked word', 'Palabra prohibida'); }
  if (!why && a.invites && INVITE_RE.test(content)) why = T(sv, 'Invite links are not allowed', 'No se permiten invitaciones');
  if (!why && a.links && LINK_RE.test(content)) why = T(sv, 'Links are not allowed here', 'Aquí no se permiten enlaces');
  if (!why && a.caps) { const letters = content.replace(/[^\p{L}]/gu, ''); if (letters.length >= 12 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.7) why = T(sv, 'Too many capital letters', 'Demasiadas mayúsculas'); }
  if (!why && a.mentions && mentions >= a.mentions) why = T(sv, 'Too many mentions', 'Demasiadas menciones');
  if (!why && a.spam) { const k = sv.id + ':' + u.id; const l = (recent.get(k) || []).filter((x) => now() - x.t < 30000); l.push({ c: low, t: now() }); recent.set(k, l); if (l.filter((x) => x.c === low).length >= 3 || l.filter((x) => now() - x.t < 5000).length >= 5) why = T(sv, 'Spam', 'Spam'); }
  if (!why) return;
  if (a.action === 'warn') warn(sv, 'bot', u.id, 'AutoMod: ' + why);
  else if (a.action === 'timeout') { mem.mutedUntil = now() + Math.max(1, Math.min(10080, a.minutes || 10)) * 60000; S.store.touch('servers'); }
  modlog(sv, 'bot', 'automod', u.id, why + (a.action !== 'delete' ? ' → ' + a.action : ''), { ch: ch.id, text: content.slice(0, 200), minutes: a.action === 'timeout' ? a.minutes : undefined });
  throw new HttpError(403, 'automod', T(sv, 'AutoMod blocked your message: ', 'AutoMod ha bloqueado tu mensaje: ') + why);
}

// ---- levels ----
const needFor = (l) => 5 * l * l + 50 * l + 100;
function levelOf(xp) { let l = 0; let left = xp; while (left >= needFor(l)) { left -= needFor(l); l++; } return { lvl: l, into: left, need: needFor(l) }; }
function giveXp(sv, ch, u) {
  const c = cfgOf(sv); if (!c.levels.on) return;
  sv.xp = sv.xp || {}; const x = (sv.xp[u.id] = sv.xp[u.id] || { xp: 0, last: 0, msgs: 0 }); x.msgs++;
  if (now() - x.last < 60000) return; x.last = now();
  const before = levelOf(x.xp).lvl; x.xp += 15 + Math.floor(Math.random() * 11); const after = levelOf(x.xp).lvl; S.store.touch('servers');
  if (after > before) {
    const reward = (c.levels.rewards || []).find((r) => r.lvl === after && sv.roles.some((ro) => ro.id === r.role));
    const mem = sv.members[u.id]; if (reward && mem && !(mem.roles || []).includes(reward.role)) { mem.roles = [...(mem.roles || []), reward.role]; hub.pushMany([u.id], { t: 'server', id: sv.id }); }
    if (c.levels.announce) botSay(sv, ch, T(sv, `🎉 GG @${u.username}, you reached **level ${after}**!`, `🎉 ¡GG @${u.username}, has llegado al **nivel ${after}**!`) + (reward ? T(sv, ` You earned the role **${(sv.roles.find((r) => r.id === reward.role) || {}).name}**.`, ` Has ganado el rol **${(sv.roles.find((r) => r.id === reward.role) || {}).name}**.`) : ''), { m: [u.id], lv: { lvl: after, role: reward ? (sv.roles.find((r) => r.id === reward.role) || {}).name : null } });
  }
}
function leaderboard(sv, n = 10) { return Object.entries(sv.xp || {}).filter(([id]) => sv.members[id] && S.users[id]).sort((a, b) => b[1].xp - a[1].xp).slice(0, n).map(([id, x], i) => Object.assign({ rank: i + 1, user: publicUser(S.users[id]), xp: x.xp, msgs: x.msgs || 0 }, levelOf(x.xp))); }
function rankOf(sv, uid) { const all = Object.entries(sv.xp || {}).filter(([id]) => sv.members[id]).sort((a, b) => b[1].xp - a[1].xp); const i = all.findIndex(([id]) => id === uid); const x = (sv.xp || {})[uid] || { xp: 0, msgs: 0 }; return Object.assign({ rank: i < 0 ? all.length + 1 : i + 1, xp: x.xp, msgs: x.msgs || 0 }, levelOf(x.xp)); }

// ---- welcome / goodbye / auto-role ----
function onJoin(sv, u) {
  try {
    const c = cfgOf(sv); const mem = sv.members[u.id]; if (!mem) return;
    if (c.autorole && sv.roles.some((r) => r.id === c.autorole) && !(mem.roles || []).includes(c.autorole)) { mem.roles = [...(mem.roles || []), c.autorole]; S.store.touch('servers'); }
    if (c.on && c.welcome.on) { const ch = chIn(sv, c.welcome.ch) || firstTextCh(sv); const txt = c.welcome.text.replace(/\{user\}/g, '@' + u.username).replace(/\{name\}/g, u.displayName || u.username).replace(/\{server\}/g, sv.name).replace(/\{count\}/g, String(Object.keys(sv.members).length)); botSay(sv, ch, txt, { m: [u.id], wel: 1 }); }
  } catch (e) { console.error('[community] join', e); }
}
function onLeave(sv, u) {
  try { const c = cfgOf(sv); if (c.on && c.goodbye.on) { const ch = chIn(sv, c.goodbye.ch) || firstTextCh(sv); botSay(sv, ch, c.goodbye.text.replace(/\{user\}|\{name\}/g, u.displayName || u.username).replace(/\{server\}/g, sv.name)); } } catch {}
}

// ---- timers: reminders and giveaways ----
const meta = (k) => (S.meta[k] = Array.isArray(S.meta[k]) ? S.meta[k] : []);
function parseDur(s) { const m = /^(\d+)\s*(s|m|h|d)?$/i.exec(String(s || '').trim()); if (!m) return 0; return Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[(m[2] || 'm').toLowerCase()]; }
function tick() {
  const t = now();
  const rem = meta('reminders'); const due = rem.filter((r) => r.at <= t);
  if (due.length) { S.meta.reminders = rem.filter((r) => r.at > t); S.store.touch('meta'); for (const r of due) { const sv = S.servers[r.sv]; const ch = sv && chIn(sv, r.ch); const u = S.users[r.uid]; if (sv && ch && u && sv.members[u.id]) botSay(sv, ch, T(sv, `⏰ @${u.username}, reminder: ${r.text}`, `⏰ @${u.username}, recordatorio: ${r.text}`), { m: [u.id] }); else if (u) hub.push(u.id, { t: 'notice', text: '⏰ ' + r.text, es: '⏰ ' + r.text }); } }
  const gws = meta('giveaways'); const ended = gws.filter((g) => g.end <= t);
  if (ended.length) { S.meta.giveaways = gws.filter((g) => g.end > t); S.store.touch('meta'); for (const g of ended) endGiveaway(g); }
}
function endGiveaway(g) {
  const sv = S.servers[g.sv]; const ch = sv && chIn(sv, g.ch); if (!ch) return;
  const m = chat().logOf(ch.id).find((x) => x.id === g.mid); const pool = ((m && m.gw && m.gw.in) || []).filter((id) => sv.members[id]);
  const winners = []; const p = pool.slice(); while (winners.length < g.winners && p.length) winners.push(p.splice(Math.floor(Math.random() * p.length), 1)[0]);
  if (m) { m.gw.done = true; m.gw.won = winners; m.bt = null; m.em = Object.assign({}, m.em, { title: '🎉 ' + g.prize + T(sv, ' — ended', ' — terminado'), color: '#64748b', fields: [[T(sv, 'Winners', 'Ganadores'), winners.length ? winners.map((w) => '@' + nameOf(w)).join(', ') : T(sv, 'Nobody entered', 'Nadie participó')], [T(sv, 'Entries', 'Participantes'), String(pool.length)]] }); editMsg(sv, ch, m); }
  botSay(sv, ch, winners.length ? T(sv, `🎉 Congratulations ${winners.map((w) => '@' + (S.users[w] || {}).username).join(', ')}! You won **${g.prize}**.`, `🎉 ¡Enhorabuena ${winners.map((w) => '@' + (S.users[w] || {}).username).join(', ')}! Has ganado **${g.prize}**.`) : T(sv, `The giveaway for **${g.prize}** ended with no entries.`, `El sorteo de **${g.prize}** ha terminado sin participantes.`), { m: winners });
}
let timer = null; function start() { if (timer) return; timer = setInterval(() => { try { tick(); } catch (e) { console.error('[community] tick', e); } }, 10000); timer.unref && timer.unref(); }

// ---- tickets ----
function openTicket(sv, u, topic) {
  const c = cfgOf(sv); const open = sv.channels.map((id) => S.channels[id]).find((ch) => ch && ch.ticket && ch.ticket.open && ch.ticket.by === u.id);
  if (open) return { channel: open.id, existing: true };
  if (sv.channels.length >= 120) throw new HttpError(400, 'too_many', 'This server has too many channels');
  c.tickets.n = (c.tickets.n || 0) + 1; const n = String(c.tickets.n).padStart(4, '0');
  const staff = (c.tickets.staff || []).filter((id) => sv.roles.some((r) => r.id === id));
  const ch = chat().createChannel(sv, `${c.tickets.cat || 'ticket'}-${n}`, clean(topic || '', 120) || T(sv, `Ticket by @${u.username}`, `Ticket de @${u.username}`), { private: true, roles: staff, users: [u.id], ticket: { by: u.id, n: c.tickets.n, open: true, at: now() } });
  S.store.touch('servers');
  botSay(sv, ch, '', { m: [u.id], em: { title: `🎫 Ticket #${n}`, color: '#5865f2', desc: T(sv, `Hi @${u.username}! Tell us what you need and the team will answer here. Only you and the staff can see this channel.`, `¡Hola @${u.username}! Cuéntanos qué necesitas y el equipo te responderá aquí. Solo tú y el staff podéis ver este canal.`) + (topic ? `\n\n**${T(sv, 'Topic', 'Tema')}:** ${clean(topic, 120)}` : '') }, bt: [{ id: 'ticket_close', label: T(sv, '🔒 Close ticket', '🔒 Cerrar ticket'), style: 'danger' }] });
  modlog(sv, u.id, 'ticket_open', u.id, '#' + ch.name);
  hub.pushMany(P.viewersOf(sv, ch), { t: 'server', id: sv.id });
  return { channel: ch.id };
}
function closeTicket(sv, ch, u) {
  const tk = ch.ticket; if (!tk || !tk.open) throw new HttpError(400, 'closed', 'This ticket is already closed');
  if (tk.by !== u.id && !P.can(sv, u, 'manage_channels') && !P.can(sv, u, 'manage_messages')) throw new HttpError(403, 'forbidden', 'Only the staff or the person who opened it can close it');
  tk.open = false; tk.closed = now(); tk.closedBy = u.id; ch.readOnly = true; ch.name = ch.name.replace(/^[^-]+-/, 'closed-'); S.store.touch('channels');
  botSay(sv, ch, '', { em: { title: T(sv, '🔒 Ticket closed', '🔒 Ticket cerrado'), color: '#64748b', desc: T(sv, `Closed by @${u.username}. The staff can download the transcript or delete the channel.`, `Cerrado por @${u.username}. El staff puede descargar la transcripción o borrar el canal.`) }, bt: [{ id: 'ticket_reopen', label: T(sv, '🔓 Reopen', '🔓 Reabrir'), style: 'ghost' }, { id: 'ticket_delete', label: T(sv, '🗑 Delete channel', '🗑 Borrar canal'), style: 'danger' }] });
  modlog(sv, u.id, 'ticket_close', tk.by, '#' + ch.name);
  hub.pushMany(P.viewersOf(sv, ch), { t: 'server', id: sv.id });
}
function transcript(sv, ch) {
  const log = chat().logOf(ch.id); const lines = [`# ${sv.name} · #${ch.name}`, `# ${new Date().toISOString()}`, ''];
  for (const m of log) { const who = m.a === 'bot' ? (m.b ? m.b.n : 'Bot') + ' [BOT]' : m.a === 'system' ? 'Nebulix' : nameOf(m.a); const text = [m.c, m.em ? [m.em.title, m.em.desc].filter(Boolean).join(' — ') : '', (m.at || []).map((a) => a.url).join(' ')].filter(Boolean).join(' '); lines.push(`[${new Date(m.t).toISOString().replace('T', ' ').slice(0, 16)}] ${who}: ${text}`); }
  return lines.join('\n');
}

// ---- buttons on bot messages ----
const SAFE_ROLE = (r) => r && !r.perms.some((p) => ['admin', 'manage_server', 'manage_channels', 'manage_roles', 'kick', 'ban', 'timeout', 'manage_messages', 'mention_everyone'].includes(p));
function button(sv, ch, m, u, id) {
  if (!m || m.a !== 'bot' || !(m.bt || []).some((b) => b.id === id)) throw new HttpError(404, 'no_button', 'This button is not available');
  if (id === 'ticket_open') return openTicket(sv, u, '');
  if (id === 'ticket_close') { closeTicket(sv, ch, u); return { ok: true }; }
  if (id === 'ticket_reopen') { if (!P.can(sv, u, 'manage_channels') && !P.can(sv, u, 'manage_messages')) throw new HttpError(403, 'forbidden', 'Staff only'); ch.ticket.open = true; ch.readOnly = false; ch.name = ch.name.replace(/^closed-/, (cfgOf(sv).tickets.cat || 'ticket') + '-'); S.store.touch('channels'); botSay(sv, ch, T(sv, `🔓 Ticket reopened by @${u.username}.`, `🔓 Ticket reabierto por @${u.username}.`), { bt: [{ id: 'ticket_close', label: T(sv, '🔒 Close ticket', '🔒 Cerrar ticket'), style: 'danger' }] }); hub.pushMany(P.viewersOf(sv, ch), { t: 'server', id: sv.id }); return { ok: true }; }
  if (id === 'ticket_delete') { P.need(sv, u, 'manage_channels', 'Only staff who can manage channels can delete tickets'); const viewers = P.viewersOf(sv, ch); sv.channels = sv.channels.filter((x) => x !== ch.id); delete S.channels[ch.id]; S.store.touch('channels'); S.store.touch('servers'); hub.pushMany(viewers, { t: 'server', id: sv.id }); return { deleted: true }; }
  if (id === 'gw_join') {
    if (!m.gw || m.gw.done) throw new HttpError(400, 'ended', 'This giveaway has ended');
    m.gw.in = m.gw.in || []; const i = m.gw.in.indexOf(u.id); if (i >= 0) m.gw.in.splice(i, 1); else m.gw.in.push(u.id);
    m.em = Object.assign({}, m.em, { fields: [[T(sv, 'Prize', 'Premio'), m.gw.prize], [T(sv, 'Winners', 'Ganadores'), String(m.gw.winners)], [T(sv, 'Entries', 'Participantes'), String(m.gw.in.length)], [T(sv, 'Ends', 'Termina'), '<t:' + m.gw.end + '>']] }); editMsg(sv, ch, m);
    return { joined: i < 0, entries: m.gw.in.length };
  }
  if (id.startsWith('role:')) {
    const rid2 = id.slice(5); const role = sv.roles.find((r) => r.id === rid2); if (!SAFE_ROLE(role)) throw new HttpError(400, 'bad_role', 'This role cannot be self-assigned');
    const mem = sv.members[u.id]; const has = (mem.roles || []).includes(rid2); mem.roles = has ? mem.roles.filter((x) => x !== rid2) : [...(mem.roles || []), rid2]; S.store.touch('servers');
    hub.pushMany([u.id], { t: 'server', id: sv.id }); return { role: role.name, added: !has };
  }
  throw new HttpError(404, 'no_button', 'Unknown button');
}

// ---- slash commands (run instead of posting the text) ----
const BALL_ES = ['Es seguro.', 'Sin duda.', 'Sí, definitivamente.', 'Muy probablemente.', 'Pinta bien.', 'Todo apunta a que sí.', 'Respuesta confusa, prueba otra vez.', 'Pregunta más tarde.', 'Mejor no te lo digo ahora.', 'No puedo predecirlo ahora.', 'No cuentes con ello.', 'Mi respuesta es no.', 'No pinta bien.', 'Muy dudoso.'];
const BALL = ['It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.', 'Outlook good.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.', 'Cannot predict now.', 'Don’t count on it.', 'My reply is no.', 'Outlook not so good.', 'Very doubtful.'];
const HELP = [['/help', 'All commands'], ['/rank [@user]', 'Level and XP'], ['/top', 'Level leaderboard'], ['/8ball question', 'Ask the magic ball'], ['/choose a | b | c', 'Pick one'], ['/coin', 'Heads or tails'], ['/dice NdM', 'Roll dice (shown to everyone)'], ['/userinfo [@user]', 'About a member'], ['/serverinfo', 'About this server'], ['/remind 10m text', 'Remind you later'], ['/ticket [topic]', 'Open a private ticket with the staff'], ['/commands', 'Custom commands of this server'],
  ['/warn @user reason', 'Warn a member (mods)'], ['/warnings @user', 'See warnings (mods)'], ['/clearwarns @user', 'Clear warnings (mods)'], ['/timeout @user 10 reason', 'Time out (mods)'], ['/purge 20', 'Delete the last messages (mods)'], ['/slowmode 10', 'Slowmode in seconds (mods)'], ['/lock · /unlock', 'Lock this channel (mods)'], ['/say text', 'Speak as the bot (mods)'], ['/embed title | text', 'Post an embed (mods)'], ['/giveaway 1h 1 prize', 'Start a giveaway (mods)']];
const HELP_ES = { 'All commands': 'Todos los comandos', 'Level and XP': 'Nivel y XP', 'Level leaderboard': 'Ranking de niveles', 'Ask the magic ball': 'Pregunta a la bola mágica', 'Pick one': 'Elige una opción', 'Heads or tails': 'Cara o cruz', 'Roll dice (shown to everyone)': 'Tira dados (lo ven todos)', 'About a member': 'Información de un miembro', 'About this server': 'Información del servidor', 'Remind you later': 'Te lo recuerda más tarde', 'Open a private ticket with the staff': 'Abre un ticket privado con el staff', 'Custom commands of this server': 'Comandos personalizados del servidor', 'Warn a member (mods)': 'Avisa a un miembro (mods)', 'See warnings (mods)': 'Ver avisos (mods)', 'Clear warnings (mods)': 'Borrar avisos (mods)', 'Time out (mods)': 'Aislar (mods)', 'Delete the last messages (mods)': 'Borra los últimos mensajes (mods)', 'Slowmode in seconds (mods)': 'Modo lento en segundos (mods)', 'Lock this channel (mods)': 'Bloquea este canal (mods)', 'Speak as the bot (mods)': 'Habla como el bot (mods)', 'Post an embed (mods)': 'Publica una tarjeta (mods)', 'Start a giveaway (mods)': 'Empieza un sorteo (mods)' };
const BUILTIN = new Set(['help', 'rank', 'level', 'top', 'leaderboard', '8ball', 'choose', 'coin', 'dice', 'userinfo', 'serverinfo', 'remind', 'ticket', 'commands', 'warn', 'warnings', 'clearwarns', 'timeout', 'purge', 'clear', 'slowmode', 'lock', 'unlock', 'say', 'embed', 'giveaway']);
function userArg(s) { const m = /@?([A-Za-z0-9_]{3,20})/.exec(s || ''); if (!m) return null; const id = S.byName.get(m[1].toLowerCase()); return id ? S.users[id] : null; }
const reply = (sv, ch, u, name, text, extra = {}) => botSay(sv, ch, text, Object.assign({ cmd: { by: u.id, n: name } }, extra));
const eph = (text) => ({ command: true, ephemeral: text });
const modOnly = (sv, u, perm) => { if (!P.can(sv, u, perm)) throw new HttpError(403, 'forbidden', T(sv, 'This command is for moderators', 'Este comando es solo para moderadores')); };
function isCommand(sv, content) { if (!/^[/!][A-Za-z0-9_-]{1,32}(\s|$)/.test(content)) return false; const name = content.slice(1).split(/\s/)[0].toLowerCase(); const c = cfgOf(sv); return (content[0] === '/' && BUILTIN.has(name)) || !!c.cmds[name]; }
function command(sv, ch, u, content) {
  const c = cfgOf(sv); const [head, ...rest] = content.slice(1).split(/\s+/); const name = head.toLowerCase(); const arg = content.slice(1 + head.length).trim();
  if (c.cmds[name] && !(content[0] === '/' && BUILTIN.has(name))) { const cc = c.cmds[name]; const text = cc.text.replace(/\{user\}/g, '@' + u.username).replace(/\{server\}/g, sv.name).replace(/\{args\}/g, arg); return { command: true, message: reply(sv, ch, u, (content[0]) + name, text, cc.embed ? { c: '', em: { title: cc.title || '', desc: text, color: cc.color || '#5865f2' } } : {}) }; }
  if (!c.on) return eph(T(sv, 'The server bot is turned off.', 'El bot del servidor está desactivado.'));
  void rest;
  switch (name) {
    case 'help': return { command: true, message: reply(sv, ch, u, '/help', '', { em: { title: `${c.icon} ${c.name} — ${T(sv, 'commands', 'comandos')}`, color: '#5865f2', fields: HELP.map(([k, v]) => [k, T(sv, v, HELP_ES[v] || v)]).concat(Object.keys(c.cmds).length ? [[T(sv, 'Custom', 'Personalizados'), Object.keys(c.cmds).map((k) => '!' + k).join(' ')]] : []) } }) };
    case 'commands': return eph(Object.keys(c.cmds).length ? T(sv, 'Custom commands: ', 'Comandos personalizados: ') + Object.keys(c.cmds).map((k) => '!' + k).join(', ') : T(sv, 'This server has no custom commands yet.', 'Este servidor aún no tiene comandos personalizados.'));
    case 'rank': case 'level': { if (!c.levels.on) return eph(T(sv, 'Levels are turned off in this server.', 'Los niveles están desactivados en este servidor.')); const who = userArg(arg) || u; if (!sv.members[who.id]) return eph(T(sv, 'That user is not in this server.', 'Esa persona no está en este servidor.')); const r = rankOf(sv, who.id); return { command: true, message: reply(sv, ch, u, '/rank', '', { rank: { uid: who.id, name: who.displayName || who.username, lvl: r.lvl, into: r.into, need: r.need, rank: r.rank, xp: r.xp, msgs: r.msgs } }) }; }
    case 'top': case 'leaderboard': { const lb = leaderboard(sv, 10); return { command: true, message: reply(sv, ch, u, '/top', '', { em: { title: T(sv, '🏆 Top members', '🏆 Mejores miembros'), color: '#f59e0b', desc: lb.length ? lb.map((x) => `**#${x.rank}** ${x.user.displayName} — ${T(sv, 'level', 'nivel')} ${x.lvl} · ${x.xp} XP`).join('\n') : T(sv, 'Nobody has XP yet. Start chatting!', 'Nadie tiene XP todavía. ¡Empezad a hablar!') } }) }; }
    case '8ball': if (!arg) return eph(T(sv, 'Ask a question: /8ball will it rain?', 'Haz una pregunta: /8ball ¿lloverá mañana?')); return { command: true, message: reply(sv, ch, u, '/8ball', '', { em: { title: '🎱 ' + clean(arg, 200), desc: (cfgOf(sv).lang === 'en' ? BALL : BALL_ES)[Math.floor(Math.random() * BALL.length)], color: '#111827' } }) };
    case 'choose': { const opts = arg.split('|').map((x) => x.trim()).filter(Boolean); if (opts.length < 2) return eph(T(sv, 'Use: /choose pizza | burger | sushi', 'Usa: /choose pizza | hamburguesa | sushi')); return { command: true, message: reply(sv, ch, u, '/choose', T(sv, '🤔 I choose: **', '🤔 Elijo: **') + clean(opts[Math.floor(Math.random() * opts.length)], 100) + '**') }; }
    case 'coin': return { command: true, message: reply(sv, ch, u, '/coin', Math.random() < 0.5 ? T(sv, '🪙 **Heads!**', '🪙 **¡Cara!**') : T(sv, '🪙 **Tails!**', '🪙 **¡Cruz!**')) };
    case 'dice': { const d = /(\d*)d(\d+)/i.exec(arg) || [0, 1, 6]; const n = Math.max(1, Math.min(20, +(d[1] || 1))); const s = Math.max(2, Math.min(1000, +d[2])); const r = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * s)); return { command: true, message: reply(sv, ch, u, '/dice', `🎲 ${n}d${s}: ${r.join(', ')} → **${r.reduce((a, b) => a + b, 0)}**`) }; }
    case 'userinfo': { const who = userArg(arg) || u; const mem = sv.members[who.id]; if (!mem) return eph(T(sv, 'That user is not in this server.', 'Esa persona no está en este servidor.')); const roles = sv.roles.filter((r) => (mem.roles || []).includes(r.id)).map((r) => r.name); const r = rankOf(sv, who.id); const w = ((sv.warns || {})[who.id] || []).length;
      return { command: true, message: reply(sv, ch, u, '/userinfo', '', { em: { title: '👤 ' + (who.displayName || who.username), color: '#5865f2', thumb: who.id, fields: [[T(sv, 'Username', 'Usuario'), '@' + who.username], [T(sv, 'Joined server', 'Entró al servidor'), '<t:' + (mem.joined || 0) + '>'], [T(sv, 'Account created', 'Cuenta creada'), '<t:' + (who.created || 0) + '>'], [T(sv, 'Roles', 'Roles'), roles.length ? roles.join(', ') : '—'], [T(sv, 'Level', 'Nivel'), String(r.lvl) + ' · ' + r.xp + ' XP'], P.can(sv, u, 'timeout') ? [T(sv, 'Warnings', 'Avisos'), String(w)] : null].filter(Boolean) } }) }; }
    case 'serverinfo': { const owner = S.users[sv.ownerId]; return { command: true, message: reply(sv, ch, u, '/serverinfo', '', { em: { title: (sv.icon || '') + ' ' + sv.name, color: '#5865f2', desc: sv.desc || '', fields: [[T(sv, 'Owner', 'Dueño'), owner ? '@' + owner.username : 'Nebulix'], [T(sv, 'Members', 'Miembros'), String(Object.keys(sv.members).length)], [T(sv, 'Channels', 'Canales'), String(sv.channels.length)], [T(sv, 'Roles', 'Roles'), String(sv.roles.length)], [T(sv, 'Created', 'Creado'), '<t:' + (sv.created || 0) + '>']] } }) }; }
    case 'remind': { const m = /^(\S+)\s+([\s\S]+)$/.exec(arg); const ms = m ? parseDur(m[1]) : 0; if (!ms || ms > 30 * 864e5) return eph(T(sv, 'Use: /remind 10m drink water (s, m, h or d, up to 30 days)', 'Usa: /remind 10m beber agua (s, m, h o d, hasta 30 días)')); if (meta('reminders').filter((r) => r.uid === u.id).length >= 10) return eph(T(sv, 'You can have up to 10 reminders.', 'Puedes tener hasta 10 recordatorios.')); meta('reminders').push({ uid: u.id, sv: sv.id, ch: ch.id, at: now() + ms, text: clean(m[2], 200) }); S.store.touch('meta'); return eph(T(sv, `⏰ OK! I will remind you in ${m[1]}.`, `⏰ ¡Vale! Te lo recordaré dentro de ${m[1]}.`)); }
    case 'ticket': { const r = openTicket(sv, u, arg); return Object.assign({ command: true, ephemeral: r.existing ? T(sv, 'You already have an open ticket.', 'Ya tienes un ticket abierto.') : T(sv, '🎫 Ticket created.', '🎫 Ticket creado.') }, r); }
    case 'warn': { modOnly(sv, u, 'timeout'); const who = userArg(arg); if (!who || !sv.members[who.id]) return eph(T(sv, 'Use: /warn @user reason', 'Usa: /warn @usuario motivo')); if (!P.outranks(sv, u, who)) return eph(T(sv, 'You can only warn members below your highest role.', 'Solo puedes avisar a miembros por debajo de tu rol más alto.')); const reason = arg.replace(/^@?\S+\s*/, ''); const n = warn(sv, u.id, who.id, reason); return { command: true, message: reply(sv, ch, u, '/warn', T(sv, `⚠️ @${who.username} was warned${reason ? ': ' + clean(reason, 200) : ''} (warning #${n}).`, `⚠️ @${who.username} ha recibido un aviso${reason ? ': ' + clean(reason, 200) : ''} (aviso n.º ${n}).`), { m: [who.id] }) }; }
    case 'warnings': { modOnly(sv, u, 'timeout'); const who = userArg(arg); if (!who) return eph(T(sv, 'Use: /warnings @user', 'Usa: /warnings @usuario')); const l = (sv.warns || {})[who.id] || []; return eph(l.length ? T(sv, `Warnings for @${who.username}:\n`, `Avisos de @${who.username}:\n`) + l.slice(-10).map((w, i) => `${i + 1}. ${new Date(w.t).toISOString().slice(0, 10)} — ${w.reason || 'no reason'} (by ${w.by === 'bot' ? 'AutoMod' : '@' + nameOf(w.by)})`).join('\n') : T(sv, `@${who.username} has no warnings.`, `@${who.username} no tiene avisos.`)); }
    case 'clearwarns': { modOnly(sv, u, 'timeout'); const who = userArg(arg); if (!who) return eph(T(sv, 'Use: /clearwarns @user', 'Usa: /clearwarns @usuario')); if (sv.warns) delete sv.warns[who.id]; S.store.touch('servers'); modlog(sv, u.id, 'clearwarns', who.id, ''); return eph(T(sv, `Warnings cleared for @${who.username}.`, `Avisos borrados para @${who.username}.`)); }
    case 'timeout': { modOnly(sv, u, 'timeout'); const m = /^@?(\S+)\s+(\d+)\s*([\s\S]*)$/.exec(arg); const who = m && userArg(m[1]); if (!who || !sv.members[who.id]) return eph(T(sv, 'Use: /timeout @user 10 reason', 'Usa: /timeout @usuario 10 motivo')); if (!P.outranks(sv, u, who)) return eph(T(sv, 'You can only moderate members below your highest role.', 'Solo puedes moderar a miembros por debajo de tu rol más alto.')); const min = Math.max(1, Math.min(10080, +m[2])); sv.members[who.id].mutedUntil = now() + min * 60000; S.store.touch('servers'); modlog(sv, u.id, 'timeout', who.id, m[3], { minutes: min }); return { command: true, message: reply(sv, ch, u, '/timeout', T(sv, `⏳ @${who.username} is timed out for ${min} min.${m[3] ? ' Reason: ' + clean(m[3], 200) : ''}`, `⏳ @${who.username} está aislado ${min} min.${m[3] ? ' Motivo: ' + clean(m[3], 200) : ''}`)) }; }
    case 'purge': case 'clear': { modOnly(sv, u, 'manage_messages'); const n = Math.max(1, Math.min(100, parseInt(arg, 10) || 0)); if (!n) return eph(T(sv, 'Use: /purge 20', 'Usa: /purge 20')); const log = chat().logOf(ch.id); const gone = log.splice(Math.max(0, log.length - n), n); S.store.touchLog('c_' + ch.id); const viewers = P.viewersOf(sv, ch); for (const m of gone) hub.pushMany(viewers, { t: 'msg_del', ch: ch.id, id: m.id }); modlog(sv, u.id, 'purge', null, '#' + ch.name, { n: gone.length }); return eph(T(sv, `🧹 Deleted ${gone.length} messages.`, `🧹 ${gone.length} mensajes borrados.`)); }
    case 'slowmode': { modOnly(sv, u, 'manage_messages'); const s = Math.max(0, Math.min(21600, parseInt(arg, 10) || 0)); ch.slow = s; S.store.touch('channels'); hub.pushMany(P.viewersOf(sv, ch), { t: 'server', id: sv.id }); modlog(sv, u.id, 'slowmode', null, '#' + ch.name + ' → ' + s + 's'); return { command: true, message: reply(sv, ch, u, '/slowmode', s ? T(sv, `🐢 Slowmode is on: ${s}s between messages.`, `🐢 Modo lento activado: ${s} s entre mensajes.`) : T(sv, '🐇 Slowmode is off.', '🐇 Modo lento desactivado.')) }; }
    case 'lock': case 'unlock': { modOnly(sv, u, 'manage_messages'); ch.readOnly = name === 'lock'; S.store.touch('channels'); hub.pushMany(P.viewersOf(sv, ch), { t: 'server', id: sv.id }); modlog(sv, u.id, name, null, '#' + ch.name); return { command: true, message: reply(sv, ch, u, '/' + name, name === 'lock' ? T(sv, '🔐 This channel is locked. Only moderators can post.', '🔐 Este canal está bloqueado. Solo los moderadores pueden escribir.') : T(sv, '🔓 This channel is open again.', '🔓 Este canal vuelve a estar abierto.')) }; }
    case 'say': modOnly(sv, u, 'manage_messages'); if (!arg) return eph(T(sv, 'Use: /say text', 'Usa: /say texto')); return { command: true, message: botSay(sv, ch, arg) };
    case 'embed': { modOnly(sv, u, 'manage_messages'); const [title, ...body] = arg.split('|'); if (!title.trim()) return eph(T(sv, 'Use: /embed Title | text', 'Usa: /embed Título | texto')); return { command: true, message: botSay(sv, ch, '', { em: { title: clean(title, 120), desc: clean(body.join('|'), 1500), color: '#5865f2' } }) }; }
    case 'giveaway': {
      modOnly(sv, u, 'manage_messages'); const m = /^(\S+)\s+(\d+)\s+([\s\S]+)$/.exec(arg); const ms = m ? parseDur(m[1]) : 0; if (!ms || ms > 14 * 864e5) return eph(T(sv, 'Use: /giveaway 1h 1 Nitro-style prize (duration, number of winners, prize)', 'Usa: /giveaway 1h 1 premio (duración, número de ganadores, premio)'));
      const winners = Math.max(1, Math.min(10, +m[2])); const prize = clean(m[3], 100); const end = now() + ms;
      const msg = botSay(sv, ch, '', { gw: { prize, winners, end, in: [] }, em: { title: T(sv, '🎉 Giveaway: ', '🎉 Sorteo: ') + prize, color: '#ec4899', desc: T(sv, 'Press the button to enter!', '¡Pulsa el botón para participar!'), fields: [[T(sv, 'Prize', 'Premio'), prize], [T(sv, 'Winners', 'Ganadores'), String(winners)], [T(sv, 'Entries', 'Participantes'), '0'], [T(sv, 'Ends', 'Termina'), '<t:' + end + '>']] }, bt: [{ id: 'gw_join', label: T(sv, '🎉 Enter', '🎉 Participar'), style: 'primary' }] });
      meta('giveaways').push({ sv: sv.id, ch: ch.id, mid: msg.id, end, prize, winners }); S.store.touch('meta'); return { command: true, message: msg };
    }
    default: return eph(T(sv, 'Unknown command. Try /help', 'Comando desconocido. Prueba /help'));
  }
}

// ---- settings (for the server settings UI) ----
function publicCfg(sv) { const c = cfgOf(sv); return JSON.parse(JSON.stringify(c)); }
function setCfg(sv, b) {
  const c = cfgOf(sv); const roleOk = (id) => !id || sv.roles.some((r) => r.id === id); const chOk = (id) => !id || sv.channels.includes(id);
  if (b.on !== undefined) c.on = !!b.on;
  if (b.lang !== undefined) c.lang = b.lang === 'en' ? 'en' : 'es';
  if (b.name !== undefined) { const n = clean(b.name, 24); if (n.length < 2) throw new HttpError(400, 'bad_name', 'Bot name: 2-24 characters'); c.name = n; }
  if (b.icon !== undefined) { const i = clean(b.icon, 8); if (i) c.icon = i; }
  for (const k of ['welcome', 'goodbye']) if (b[k]) { const x = b[k]; if (x.on !== undefined) c[k].on = !!x.on; if (x.ch !== undefined) { if (!chOk(x.ch)) throw new HttpError(400, 'bad_channel', 'Unknown channel'); c[k].ch = x.ch; } if (x.text !== undefined) c[k].text = clean(x.text, 500) || DEF()[k].text; }
  if (b.autorole !== undefined) { if (!roleOk(b.autorole) || (b.autorole && !SAFE_ROLE(sv.roles.find((r) => r.id === b.autorole)))) throw new HttpError(400, 'bad_role', 'The auto-role cannot have moderator permissions'); c.autorole = b.autorole || ''; }
  if (b.logCh !== undefined) { if (!chOk(b.logCh)) throw new HttpError(400, 'bad_channel', 'Unknown channel'); c.logCh = b.logCh || ''; }
  if (b.levels) { const x = b.levels; if (x.on !== undefined) c.levels.on = !!x.on; if (x.announce !== undefined) c.levels.announce = !!x.announce; if (Array.isArray(x.rewards)) c.levels.rewards = x.rewards.slice(0, 20).map((r) => ({ lvl: Math.max(1, Math.min(200, Math.trunc(r.lvl) || 1)), role: String(r.role || '') })).filter((r) => roleOk(r.role) && r.role && SAFE_ROLE(sv.roles.find((ro) => ro.id === r.role))); }
  if (b.automod) { const x = b.automod; const a = c.automod; for (const k of ['on', 'links', 'invites', 'caps', 'spam', 'escalate']) if (x[k] !== undefined) a[k] = !!x[k];
    if (Array.isArray(x.words)) a.words = [...new Set(x.words.map((w) => clean(w, 40).toLowerCase()).filter(Boolean))].slice(0, 200);
    if (x.mentions !== undefined) a.mentions = Math.max(0, Math.min(50, Math.trunc(x.mentions) || 0)); if (x.action !== undefined) { if (!['delete', 'warn', 'timeout'].includes(x.action)) throw new HttpError(400, 'bad_action', 'Action: delete, warn or timeout'); a.action = x.action; }
    if (x.minutes !== undefined) a.minutes = Math.max(1, Math.min(10080, Math.trunc(x.minutes) || 10)); if (Array.isArray(x.exempt)) a.exempt = x.exempt.filter(roleOk).slice(0, 20); }
  if (b.tickets) { const x = b.tickets; if (Array.isArray(x.staff)) c.tickets.staff = x.staff.filter(roleOk).slice(0, 10); if (x.cat !== undefined) c.tickets.cat = clean(x.cat, 16).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'ticket'; }
  if (b.cmds && typeof b.cmds === 'object') { const out = {}; for (const [k, v] of Object.entries(b.cmds).slice(0, 50)) { const name = clean(k, 32).toLowerCase().replace(/[^a-z0-9_-]/g, ''); if (!name || !v || !clean(v.text, 1500)) continue; out[name] = { text: clean(v.text, 1500), embed: !!v.embed, title: clean(v.title || '', 100), color: /^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color : '#5865f2' }; } c.cmds = out; }
  S.store.touch('servers'); return publicCfg(sv);
}

module.exports = { cfgOf, publicCfg, setCfg, botSay, automod, giveXp, leaderboard, rankOf, levelOf, onJoin, onLeave, isCommand, command, button, openTicket, transcript, modlog, warn, start, SAFE_ROLE, HELP };
