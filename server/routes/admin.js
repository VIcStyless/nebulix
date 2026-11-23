'use strict';
// Operator panel: stats, users, moderation, PRO codes, announcements, domain blocklist, audit log.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const { S, hub, isPro, isAdmin, publicUser, audit } = require('../state');
const econ = require('../economy');
const mail = require('../mail');
const sessions = require('../proxy/sessions');
const engine = require('../proxy/engine');
const { HttpError, now, V, rid } = require('../util');

const started = now();
const ROLES = ['user', 'mod', 'admin'];

function dirSize(dir) {
  let n = 0;
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) n += dirSize(p); else { try { n += fs.statSync(p).size; } catch {} }
    }
  } catch {}
  return n;
}

function adminView(u) {
  return Object.assign(publicUser(u), {
    email: u.email, verified: !!u.verified, coins: u.coins, infinite: !!u.infinite, proUntil: u.proUntil || 0, banned: u.banned || null, mutedUntil: u.mutedUntil && u.mutedUntil > now() ? u.mutedUntil : 0, warnings: (u.warnings || []).length,
    lastSeen: (Object.values(S.sessions).filter((s) => s.uid === u.id).sort((a, b) => b.last - a.last)[0] || {}).last || 0,
    sessions: Object.values(S.sessions).filter((s) => s.uid === u.id).length, themes: u.themesPublished || 0, uploadBytes: u.uploadBytes || 0,
  });
}

function target(c) {
  const u = S.users[c.params.id];
  if (!u || u.deleted) throw new HttpError(404, 'no_user', 'User not found');
  return u;
}
function guardRank(c, t) {
  // staff cannot act on equal or higher roles; the owner is untouchable except by themselves
  const rank = { user: 0, mod: 1, admin: 2, owner: 3 };
  if (t.id !== c.user.id && rank[t.role] >= rank[c.user.role]) throw new HttpError(403, 'forbidden', 'You cannot act on that user');
}

module.exports = function register(r) {
  r.get('/api/announcements', { auth: true }, async () => ({ announcements: S.meta.announcements.slice(0, 5) }));

  r.get('/api/admin/stats', { auth: true, role: 'staff' }, async () => {
    const users = Object.values(S.users).filter((u) => !u.deleted);
    const mem = process.memoryUsage();
    return {
      users: users.length, verified: users.filter((u) => u.verified).length, pro: users.filter(isPro).length, online: hub.count(),
      banned: users.filter((u) => u.banned && (!u.banned.until || u.banned.until > now())).length,
      servers: Object.keys(S.servers).length, channels: Object.keys(S.channels).length, themes: Object.keys(S.themes).length,
      openReports: S.reports.filter((x) => x.open).length, coinsInCirculation: users.reduce((n, u) => n + (u.coins || 0), 0),
      proxy: Object.assign({ sessions: sessions.count(), cache: engine.cacheStats() }, engine.stats),
      uptime: Math.floor((now() - started) / 1000), memMB: Math.round(mem.rss / 1048576), dataMB: Math.round(dirSize(cfg.dataDir) / 10485.76) / 100,
      mail: mail.mode(), node: process.version, version: cfg.VERSION, public: cfg.isPublic, appOrigin: cfg.appOrigin, proxyOrigin: cfg.proxyOrigin,
    };
  });

  r.get('/api/admin/users', { auth: true, role: 'staff', limit: [120, 60000, 'user'] }, async (c) => {
    const q = String(c.query.q || '').toLowerCase().slice(0, 60);
    let list = Object.values(S.users).filter((u) => !u.deleted);
    if (q) list = list.filter((u) => u.usernameLower.includes(q) || u.emailLower.includes(q) || u.id === q);
    list.sort((a, b) => b.created - a.created);
    return { total: list.length, users: list.slice(0, 50).map(adminView) };
  });

  // 13.6: donations up to a trillion coins at once; the person gets a notice
  const GIFT_MAX = 1_000_000_000_000;
  const giftNotice = (u, d, by) => hub.push(u.id, { t: 'notice', text: `You received ${d.toLocaleString('en')} coins from @${by.username}`, es: `Has recibido ${d.toLocaleString('es')} monedas de @${by.username}` });
  r.post('/api/admin/users/:id/coins', { auth: true, role: 'admin', limit: [60, 60000, 'user'] }, async (c) => {
    const t = target(c); const d = c.body.delta;
    if (!Number.isSafeInteger(d) || d === 0 || Math.abs(d) > GIFT_MAX) throw new HttpError(400, 'bad_amount', 'Enter a whole number of coins (up to 1,000,000,000,000)');
    if (!econ.adjust(t, d, 'admin')) throw new HttpError(400, 'insufficient', 'The user does not have that many coins');
    audit('coins', c.user.id, `${t.username} ${d > 0 ? '+' : ''}${d} ${String(c.body.reason || '').slice(0, 80)}`);
    if (d > 0 && t.id !== c.user.id) giftNotice(t, d, c.user);
    return { user: adminView(t) };
  });
  // unlimited wallet (owner only): every purchase succeeds and the balance stays full. Turning it off restores the old balance.
  r.post('/api/admin/users/:id/infinite', { auth: true, role: 'admin', limit: [30, 60000, 'user'] }, async (c) => {
    if (c.user.role !== 'owner') throw new HttpError(403, 'owner_only', 'Only the owner can give unlimited coins');
    const t = target(c); const on = !!c.body.on;
    if (on && !t.infinite) { t.coinsBefore = t.coins; t.infinite = true; econ.adjust(t, 0, 'admin:infinite'); }
    else if (!on && t.infinite) { delete t.infinite; t.coins = Math.max(0, Math.min(econ.MAX_COINS, Number(t.coinsBefore) || 0)); delete t.coinsBefore; econ.adjust(t, 0, 'admin:infinite-off'); }
    audit('coins', c.user.id, `${t.username} infinite ${on ? 'ON' : 'OFF'}`);
    if (on && t.id !== c.user.id) hub.push(t.id, { t: 'notice', text: 'You now have unlimited coins', es: 'Ahora tienes monedas infinitas' });
    return { user: adminView(t) };
  });
  // 13.8 lockdown: every open Nebulix (except staff) switches to a study page until it is lifted
  r.get('/api/admin/lockdown', { auth: true, role: 'admin' }, async () => ({ lockdown: S.meta.lockdown || { on: false }, online: hub.count() }));
  // who is online right now and what they are doing (the same activity their friends can see; private activity stays hidden)
  r.get('/api/admin/online', { auth: true, role: 'staff' }, async () => ({ users: [...hub.conns.keys()].map((id) => S.users[id]).filter(Boolean).map((u) => { const a = hub.act.get(u.id); return Object.assign(adminView(u), { tabs: (hub.conns.get(u.id) || { size: 0 }).size, activity: a && !(u.settings && u.settings.showActivity === false) ? { kind: a.kind, label: a.label, t: a.t } : null }); }).slice(0, 300) }));
  r.post('/api/admin/lockdown', { auth: true, role: 'admin', limit: [20, 60000, 'user'] }, async (c) => {
    const on = !!c.body.on; S.meta.lockdown = { on, by: c.user.id, at: now() }; S.store.touch('meta');
    const str = JSON.stringify({ t: 'lockdown', on }); for (const set of hub.conns.values()) for (const conn of set) conn.send(str);
    audit('lockdown', c.user.id, on ? 'ON' : 'OFF'); return { lockdown: S.meta.lockdown, online: hub.count() };
  });
  // give coins to everyone online, or to every account
  r.post('/api/admin/coins/bulk', { auth: true, role: 'admin', limit: [6, 600000, 'user'] }, async (c) => {
    const amount = c.body.amount; const scope = c.body.scope === 'all' ? 'all' : 'online';
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000) throw new HttpError(400, 'bad_amount', 'Enter between 1 and 1,000,000,000 coins');
    const list = Object.values(S.users).filter((u) => !u.deleted && !(u.banned && (!u.banned.until || u.banned.until > now())) && (scope === 'all' || hub.online(u.id)));
    for (const u of list) { econ.adjust(u, amount, 'admin:bulk'); if (u.id !== c.user.id) giftNotice(u, amount, c.user); }
    audit('coins', c.user.id, `bulk +${amount} to ${list.length} (${scope})`);
    return { count: list.length, amount, scope };
  });

  r.post('/api/admin/users/:id/pro', { auth: true, role: 'admin', limit: [60, 60000, 'user'] }, async (c) => {
    const t = target(c); const days = c.body.days;
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw new HttpError(400, 'bad_days', 'Days must be 0-3650');
    t.proUntil = days === 0 ? 0 : Math.max(now(), t.proUntil || 0) + days * 86400000;
    if (['premium', 'pro', 'ultimate'].includes(c.body.tier)) t.tier = c.body.tier;
    S.store.touch('users'); audit('pro', c.user.id, `${t.username} ${days}d`);
    hub.push(t.id, { t: 'me', user: require('../state').selfUser(t) });
    return { user: adminView(t) };
  });

  r.post('/api/admin/users/:id/ban', { auth: true, role: 'staff', limit: [60, 60000, 'user'] }, async (c) => {
    const t = target(c); guardRank(c, t);
    if (t.id === c.user.id) throw new HttpError(400, 'self', 'You cannot ban yourself');
    const hours = c.body.hours === undefined || c.body.hours === null ? 0 : c.body.hours;
    if (!Number.isInteger(hours) || hours < 0 || hours > 24 * 365) throw new HttpError(400, 'bad_hours', 'Hours must be 0 (permanent) to 8760');
    t.banned = { until: hours ? now() + hours * 3600000 : 0, reason: V.str(c.body.reason || '', 0, 120) ? String(c.body.reason || '') : '', by: c.user.id, t: now() };
    for (const [h, s] of Object.entries(S.sessions)) if (s.uid === t.id) delete S.sessions[h];
    S.store.touch('users'); S.store.touch('sessions');
    for (const s of hub.conns.get(t.id) || []) { try { s.close(4003, 'banned'); } catch {} }
    audit('ban', c.user.id, `${t.username} ${hours || 'perm'} ${t.banned.reason}`);
    return { user: adminView(t) };
  });

  // ----- moderation: warnings and mutes (a muted user can still read, use DMs and send reports) -----
  r.post('/api/admin/users/:id/warn', { auth: true, role: 'staff', limit: [60, 60000, 'user'] }, async (c) => {
    const t = target(c); guardRank(c, t); if (t.id === c.user.id) throw new HttpError(400, 'self', 'Pick someone else');
    const reason = String(c.body.reason || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200); if (reason.length < 3) throw new HttpError(400, 'bad_reason', 'Write the reason');
    t.warnings = (t.warnings || []).concat({ t: now(), by: c.user.id, reason }).slice(-30); S.store.touch('users');
    hub.push(t.id, { t: 'notice', text: `⚠️ Warning from the moderators: ${reason}`, es: `⚠️ Aviso de los moderadores: ${reason}` });
    audit('warn', c.user.id, `${t.username} — ${reason}`);
    return { user: adminView(t) };
  });
  r.post('/api/admin/users/:id/mute', { auth: true, role: 'staff', limit: [60, 60000, 'user'] }, async (c) => {
    const t = target(c); guardRank(c, t); if (t.id === c.user.id) throw new HttpError(400, 'self', 'Pick someone else');
    const mins = Math.trunc(Number(c.body.minutes)); if (!(mins >= 0 && mins <= 60 * 24 * 30)) throw new HttpError(400, 'bad_minutes', 'From 0 to 43200 minutes (30 days)');
    const reason = String(c.body.reason || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    t.mutedUntil = mins ? now() + mins * 60000 : 0; S.store.touch('users');
    if (mins) hub.push(t.id, { t: 'notice', text: `🔇 You are muted for ${mins} min${reason ? ': ' + reason : ''}. You can still read, use private messages and send reports.`, es: `🔇 Estás silenciado durante ${mins} min${reason ? ': ' + reason : ''}. Puedes seguir leyendo, usar los mensajes privados y enviar denuncias.` });
    audit(mins ? 'mute' : 'unmute', c.user.id, `${t.username}${mins ? ' ' + mins + 'min' : ''}${reason ? ' — ' + reason : ''}`);
    return { user: adminView(t) };
  });
  r.get('/api/admin/users/:id/warnings', { auth: true, role: 'staff' }, async (c) => {
    const t = target(c); return { warnings: (t.warnings || []).slice().reverse().map((w) => Object.assign({}, w, { byName: (S.users[w.by] || {}).username || '?' })) };
  });
  // ----- content moderation: Hub uploads and community worlds -----
  r.get('/api/admin/content', { auth: true, role: 'staff', limit: [120, 60000, 'user'] }, async (c) => {
    const kind = c.query.kind === 'worlds' ? 'worlds' : 'hub'; const q = String(c.query.q || '').toLowerCase().slice(0, 60);
    const own = (id) => { const u = S.users[id]; return u ? publicUser(u) : null; };
    let list;
    if (kind === 'hub') list = Object.values(S.store.table('hubitems')).map((x) => ({ id: x.id, kind: x.kind, title: x.title, owner: own(x.owner), created: x.created, views: x.views || 0, public: x.public !== false, hidden: !!x.hidden, link: '#/hub/' + x.id }));
    else list = Object.values(S.store.table('ugcworlds')).map((x) => ({ id: x.id, kind: x.kind, title: x.name, owner: own(x.owner), created: x.created, views: Object.keys(x.played || {}).length, public: !!x.pub, hidden: false, link: '#/worlds' }));
    if (q) list = list.filter((x) => x.title.toLowerCase().includes(q) || (x.owner && x.owner.username.toLowerCase().includes(q)));
    return { items: list.sort((a, b) => b.created - a.created).slice(0, 150) };
  });
  r.delete('/api/admin/content/:kind/:id', { auth: true, role: 'staff', limit: [60, 60000, 'user'] }, async (c) => {
    const reason = String((c.query && c.query.reason) || '').slice(0, 200);
    if (c.params.kind === 'hub') {
      const T = S.store.table('hubitems'); const it = T[c.params.id]; if (!it) throw new HttpError(404, 'no_item', 'Not found');
      const o = S.users[it.owner]; if (o) { require('../blobs').charge(o, -(it.size || 0)); hub.push(o.id, { t: 'notice', text: `🛡️ The moderators removed “${it.title}” from the Hub${reason ? ': ' + reason : ''}`, es: `🛡️ Los moderadores han retirado «${it.title}» del Hub${reason ? ': ' + reason : ''}` }); }
      delete T[it.id]; S.store.touch('hubitems'); audit('remove.hub', c.user.id, `${it.title} (@${o ? o.username : '?'})${reason ? ' — ' + reason : ''}`);
    } else if (c.params.kind === 'worlds') {
      const T = S.store.table('ugcworlds'); const w = T[c.params.id]; if (!w) throw new HttpError(404, 'no_item', 'Not found'); const o = S.users[w.owner];
      if (o) hub.push(o.id, { t: 'notice', text: `🛡️ The moderators removed your world “${w.name}”${reason ? ': ' + reason : ''}`, es: `🛡️ Los moderadores han retirado tu mundo «${w.name}»${reason ? ': ' + reason : ''}` });
      delete T[w.id]; S.store.touch('ugcworlds'); audit('remove.world', c.user.id, `${w.name} (@${o ? o.username : '?'})${reason ? ' — ' + reason : ''}`);
    } else throw new HttpError(400, 'bad_kind', 'Unknown content type');
    return { ok: true };
  });
  // moderation log, visible to every staff member
  const MOD_ACTIONS = /^(ban|unban|warn|mute|unmute|remove\.|report|theme)/;
  r.get('/api/admin/modlog', { auth: true, role: 'staff' }, async () => ({ log: S.meta.audit.filter((a) => MOD_ACTIONS.test(a.a)).slice(0, 200).map((a) => Object.assign({}, a, { byName: (S.users[a.by] || {}).username || a.by })) }));

  r.post('/api/admin/users/:id/unban', { auth: true, role: 'staff' }, async (c) => {
    const t = target(c); t.banned = null; S.store.touch('users'); audit('unban', c.user.id, t.username);
    return { user: adminView(t) };
  });

  r.post('/api/admin/users/:id/role', { auth: true, role: 'owner' }, async (c) => {
    const t = target(c);
    if (t.role === 'owner') throw new HttpError(400, 'owner', 'The owner role cannot be changed');
    if (!ROLES.includes(c.body.role)) throw new HttpError(400, 'bad_role', 'Unknown role');
    t.role = c.body.role; S.store.touch('users'); audit('role', c.user.id, `${t.username} -> ${t.role}`);
    hub.push(t.id, { t: 'me', user: require('../state').selfUser(t) });
    return { user: adminView(t) };
  });

  r.post('/api/admin/users/:id/verify', { auth: true, role: 'admin' }, async (c) => {
    const t = target(c);
    if (!t.verified) {
      t.verified = true;
      if (!t.welcomed) { t.welcomed = true; econ.adjust(t, 50, 'welcome'); }
      S.store.touch('users');
      try { require('./chat').joinOfficial(t); } catch {}
    }
    audit('verify', c.user.id, t.username);
    return { user: adminView(t) };
  });

  // ----- community roles (site-wide tags shown on profiles: "Beta tester", "Event winner"…) -----
  const GR_MAX = 30;
  const EMOJI1 = /^(?:\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*)$/u;
  function cleanGrole(b, cur = {}) {
    const o = Object.assign({}, cur);
    if (b.name !== undefined || !cur.name) { const n = String(b.name || '').trim(); if (!V.str(n, 1, 24) || /[\u0000-\u001f‪-‮⁦-⁩]/.test(n)) throw new HttpError(400, 'bad_name', 'Role name must be 1-24 characters'); o.name = n; }
    if (b.color !== undefined) { if (b.color !== null && !/^#[0-9a-fA-F]{6}$/.test(String(b.color))) throw new HttpError(400, 'bad_color', 'Color must look like #8b5cf6'); o.color = b.color || null; }
    if (b.icon !== undefined) { const i = String(b.icon || ''); if (i && !EMOJI1.test(i)) throw new HttpError(400, 'bad_icon', 'Icon must be a single emoji'); o.icon = i; }
    // optional English name (the main name is shown to Spanish speakers, nameEn to everyone else) and member-list grouping
    if (b.nameEn !== undefined) { const n = String(b.nameEn || '').trim(); if (n && (!V.str(n, 1, 24) || /[\u0000-\u001f‪-‮⁦-⁩]/.test(n))) throw new HttpError(400, 'bad_name', 'Role name must be 1-24 characters'); o.nameEn = n || null; }
    if (b.hoist !== undefined) o.hoist = !!b.hoist;
    if (o.hoist === undefined) o.hoist = true;
    return o;
  }
  const pushGroles = (ids) => { for (const id of ids) { const u = S.users[id]; if (u) hub.push(u.id, { t: 'me', user: require('../state').selfUser(u) }); } };
  r.get('/api/community/roles', { auth: true }, async () => ({ roles: S.meta.groles.map((g) => ({ id: g.id, name: g.name, nameEn: g.nameEn || null, hoist: g.hoist !== false, color: g.color, icon: g.icon, count: Object.values(S.users).filter((u) => !u.deleted && (u.groles || []).includes(g.id)).length })) }));
  r.post('/api/admin/groles', { auth: true, role: 'admin', limit: [30, 60000, 'user'] }, async (c) => {
    if (S.meta.groles.length >= GR_MAX) throw new HttpError(400, 'too_many_roles', `Up to ${GR_MAX} community roles`);
    const g = Object.assign({ id: 'g' + rid(5), color: null, icon: '', created: now() }, cleanGrole(c.body));
    if (S.meta.groles.some((x) => x.name.toLowerCase() === g.name.toLowerCase())) throw new HttpError(409, 'role_exists', 'A role with that name already exists');
    S.meta.groles.push(g); S.store.touch('meta'); audit('grole.add', c.user.id, g.name);
    return { role: g };
  });
  r.patch('/api/admin/groles/:rid', { auth: true, role: 'admin', limit: [60, 60000, 'user'] }, async (c) => {
    const i = S.meta.groles.findIndex((x) => x.id === c.params.rid); if (i < 0) throw new HttpError(404, 'no_role', 'Role not found');
    const g = cleanGrole(c.body, S.meta.groles[i]);
    if (S.meta.groles.some((x, j) => j !== i && x.name.toLowerCase() === g.name.toLowerCase())) throw new HttpError(409, 'role_exists', 'A role with that name already exists');
    S.meta.groles[i] = g; S.store.touch('meta'); audit('grole.edit', c.user.id, g.name);
    return { role: g };
  });
  r.delete('/api/admin/groles/:rid', { auth: true, role: 'admin' }, async (c) => {
    const i = S.meta.groles.findIndex((x) => x.id === c.params.rid); if (i < 0) throw new HttpError(404, 'no_role', 'Role not found');
    const [g] = S.meta.groles.splice(i, 1); const hit = [];
    for (const u of Object.values(S.users)) if (u.groles && u.groles.includes(g.id)) { u.groles = u.groles.filter((x) => x !== g.id); hit.push(u.id); }
    S.store.touch('meta'); if (hit.length) S.store.touch('users'); audit('grole.del', c.user.id, g.name); pushGroles(hit);
    return { ok: true };
  });
  r.put('/api/admin/users/:id/groles', { auth: true, role: 'admin', limit: [60, 60000, 'user'] }, async (c) => {
    const t = target(c); const want = Array.isArray(c.body.roles) ? c.body.roles.map(String) : null;
    if (!want) throw new HttpError(400, 'bad_roles', 'Send a list of role ids');
    const valid = new Set(S.meta.groles.map((g) => g.id)); if (want.some((x) => !valid.has(x))) throw new HttpError(400, 'bad_roles', 'Unknown role');
    t.groles = [...new Set(want)].slice(0, 8); S.store.touch('users'); audit('grole.set', c.user.id, `${t.username}: ${t.groles.length}`); pushGroles([t.id]);
    return { user: adminView(t) };
  });

  // ----- reports -----
  r.get('/api/admin/reports', { auth: true, role: 'staff' }, async (c) => {
    const all = c.query.all === '1';
    return { reports: S.reports.filter((x) => all || x.open).slice(0, 100).map((x) => Object.assign({}, x, { byName: (S.users[x.by] || {}).username || '?' })) };
  });
  r.post('/api/admin/reports/:id/resolve', { auth: true, role: 'staff' }, async (c) => {
    const rep = S.reports.find((x) => x.id === c.params.id);
    if (!rep) throw new HttpError(404, 'no_report', 'Report not found');
    rep.open = false; rep.by2 = c.user.id; rep.note = String(c.body.note || '').slice(0, 200); rep.t2 = now();
    S.store.touch('reports'); audit('report', c.user.id, `${rep.id} ${rep.type}`);
    return { ok: true };
  });

  // ----- PRO codes -----
  r.get('/api/admin/codes', { auth: true, role: 'admin' }, async () => ({
    codes: Object.entries(S.codes).map(([k, v]) => Object.assign({ code: require('./pay').fmtCode(k) }, { days: v.days, max: v.max, used: (v.used || []).length, disabled: !!v.disabled, expires: v.expires || 0, created: v.created, note: v.note || '' })).sort((a, b) => b.created - a.created).slice(0, 200),
  }));
  r.post('/api/admin/codes', { auth: true, role: 'admin', limit: [30, 60000, 'user'] }, async (c) => {
    const days = c.body.days; const max = c.body.max === undefined ? 1 : c.body.max; const count = c.body.count === undefined ? 1 : c.body.count;
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new HttpError(400, 'bad_days', 'Days must be 1-3650');
    if (!Number.isInteger(max) || max < 1 || max > 100000) throw new HttpError(400, 'bad_max', 'Max uses must be 1-100000');
    if (!Number.isInteger(count) || count < 1 || count > 50) throw new HttpError(400, 'bad_count', 'Create 1-50 codes at a time');
    const made = [];
    for (let i = 0; i < count; i++) {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code = '';
      for (const b of crypto.randomBytes(12)) code += alphabet[b % alphabet.length];
      S.codes[code] = { days, max, used: [], created: now(), by: c.user.id, note: String(c.body.note || '').slice(0, 60), tier: ['premium', 'pro', 'ultimate'].includes(c.body.tier) ? c.body.tier : 'premium' };
      made.push(require('./pay').fmtCode(code));
    }
    S.store.touch('codes'); audit('codes', c.user.id, `${count}x ${days}d`);
    return { codes: made };
  });
  r.delete('/api/admin/codes/:code', { auth: true, role: 'admin' }, async (c) => {
    const k = require('./pay').normCode(c.params.code);
    if (!S.codes[k]) throw new HttpError(404, 'no_code', 'Code not found');
    S.codes[k].disabled = true; S.store.touch('codes'); audit('code.off', c.user.id, k.slice(0, 4));
    return { ok: true };
  });

  // ----- announcements -----
  r.post('/api/admin/announce', { auth: true, role: 'admin', limit: [10, 3600000, 'user'] }, async (c) => {
    const title = String(c.body.title || '').trim(); const body = String(c.body.body || '').trim();
    if (!V.str(title, 2, 80) || !V.str(body, 2, 500)) throw new HttpError(400, 'bad_text', 'Title 2-80 chars, message 2-500 chars');
    const a = { id: rid(5), title, body, t: now(), by: c.user.username };
    S.meta.announcements.unshift(a); if (S.meta.announcements.length > 20) S.meta.announcements.length = 20;
    S.store.touch('meta'); audit('announce', c.user.id, title);
    for (const uid of hub.conns.keys()) hub.push(uid, { t: 'announce', a });
    return { announcement: a };
  });

  // ----- blocklist (applies to the proxy) -----
  r.get('/api/admin/blocklist', { auth: true, role: 'staff' }, async () => ({ hosts: S.meta.blocklist }));
  r.put('/api/admin/blocklist', { auth: true, role: 'admin', limit: [20, 60000, 'user'] }, async (c) => {
    const hosts = (Array.isArray(c.body.hosts) ? c.body.hosts : []).map((h) => String(h).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''))
      .filter((h) => /^[a-z0-9.-]{3,253}$/.test(h) && h.includes('.')).slice(0, 2000);
    S.meta.blocklist = [...new Set(hosts)]; S.store.touch('meta'); audit('blocklist', c.user.id, `${S.meta.blocklist.length} hosts`);
    return { hosts: S.meta.blocklist };
  });

  r.get('/api/admin/audit', { auth: true, role: 'admin' }, async () => ({
    audit: S.meta.audit.slice(0, 200).map((a) => Object.assign({}, a, { byName: (S.users[a.by] || {}).username || a.by })),
  }));

  r.post('/api/admin/themes/:id/hide', { auth: true, role: 'staff' }, async (c) => {
    const t = S.themes[c.params.id];
    if (!t) throw new HttpError(404, 'no_theme', 'Theme not found');
    t.hidden = c.body.hidden !== false; S.store.touch('themes'); audit('theme.hide', c.user.id, `${t.name} ${t.hidden}`);
    return { ok: true, hidden: t.hidden };
  });

  r.post('/api/admin/mail/test', { auth: true, role: 'admin', limit: [5, 600000, 'user'] }, async (c) => {
    try { await mail.sendCode(c.user.email, 'verify', c.user.lang || 'en', '000000'); } catch (e) { throw new HttpError(502, 'mail_failed', 'Mail failed: ' + String(e.message).slice(0, 160)); }
    return { ok: true, mode: mail.mode() };
  });
};

module.exports.adminView = adminView;
module.exports.isAdmin = isAdmin;
