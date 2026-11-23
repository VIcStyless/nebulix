'use strict';
// Discord-style server roles: ordered roles (index 0 = highest), per-role permissions, @everyone defaults,
// a strict hierarchy (you can only manage what sits below your highest role) and role-locked private channels.
const { S, isAdmin } = require('./state');
const { HttpError, rid, now } = require('./util');

const PERMS = ['admin', 'manage_server', 'manage_channels', 'manage_roles', 'kick', 'ban', 'timeout', 'manage_messages', 'mention_everyone', 'post_readonly', 'send', 'attach', 'react', 'invite'];
const ALL = new Set(PERMS);
const DEFAULT_EVERYONE = ['send', 'attach', 'react', 'invite'];
const MOD_PERMS = ['kick', 'ban', 'timeout', 'manage_messages', 'mention_everyone', 'post_readonly'];
const MAX_ROLES = 25;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const EMOJI_RE = /^(?:\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*){1,2}$/u;

// Lazily upgrade servers created before roles existed: legacy "mod" members get a Moderator role.
function ensureRoles(sv) {
  let changed = false;
  if (!Array.isArray(sv.roles)) {
    sv.roles = []; sv.everyone = DEFAULT_EVERYONE.slice(); changed = true;
    const mods = Object.values(sv.members || {}).filter((m) => m.role === 'mod');
    if (mods.length) { const r = mkRole('Moderator', '#22c55e', '', MOD_PERMS, true, true); sv.roles.push(r); mods.forEach((m) => { m.roles = [r.id]; }); }
  }
  if (!Array.isArray(sv.everyone)) { sv.everyone = DEFAULT_EVERYONE.slice(); changed = true; }
  for (const m of Object.values(sv.members || {})) if (!Array.isArray(m.roles)) { m.roles = []; changed = true; }
  if (changed && S.store) S.store.touch('servers');
  return sv;
}
function mkRole(name, color, icon, perms, hoist, mentionable) {
  return { id: 'r' + rid(6), name, color: color || null, icon: icon || '', perms: perms.filter((p) => ALL.has(p)), hoist: !!hoist, mentionable: !!mentionable, created: now() };
}

const isServerOwner = (sv, u) => !!u && (sv.ownerId === u.id || (sv.official && isAdmin(u)));

// Every permission the user has in this server.
function permsOf(sv, u) {
  if (!u) return new Set();
  ensureRoles(sv);
  if (isServerOwner(sv, u)) return new Set(ALL);
  const mem = sv.members[u.id];
  const set = new Set();
  if (sv.official && u.role === 'mod') MOD_PERMS.forEach((p) => set.add(p)); // site moderators keep order in the official server
  if (!mem) return set;
  sv.everyone.forEach((p) => set.add(p));
  for (const id of mem.roles || []) { const r = sv.roles.find((x) => x.id === id); if (r) r.perms.forEach((p) => set.add(p)); }
  if (set.has('admin')) return new Set(ALL);
  return set;
}
const can = (sv, u, perm) => permsOf(sv, u).has(perm);
function need(sv, u, perm, msg) { if (!can(sv, u, perm)) throw new HttpError(403, 'forbidden', msg || 'You do not have permission to do that'); }

// Position of the user's highest role: -2 owner, -1 site staff on the official server, otherwise the role index (Infinity = no roles).
function topPos(sv, u) {
  if (!u) return Infinity;
  ensureRoles(sv);
  if (isServerOwner(sv, u)) return -2;
  if (sv.official && u.role === 'mod') return -1;
  const mem = sv.members[u.id]; if (!mem) return Infinity;
  let best = Infinity;
  for (const id of mem.roles || []) { const i = sv.roles.findIndex((x) => x.id === id); if (i >= 0 && i < best) best = i; }
  return best;
}
// May `actor` moderate or re-role `target`? Strictly above them in the hierarchy, and never the owner.
function outranks(sv, actor, target) {
  if (!actor || !target || actor.id === target.id) return false;
  if (isServerOwner(sv, target)) return false;
  return topPos(sv, actor) < topPos(sv, target);
}
function roleIndex(sv, id) { return sv.roles.findIndex((r) => r.id === id); }
function canManageRole(sv, actor, roleId) {
  if (!can(sv, actor, 'manage_roles')) return false;
  const i = roleIndex(sv, roleId); if (i < 0) return false;
  return topPos(sv, actor) < i;
}

// Display color/icon for a member: first colored role from the top.
function memberStyle(sv, uid) {
  ensureRoles(sv); const mem = sv.members[uid]; if (!mem || !mem.roles || !mem.roles.length) return null;
  const mine = sv.roles.filter((r) => mem.roles.includes(r.id));
  const col = mine.find((r) => r.color); const ic = mine.find((r) => r.icon);
  return { color: col ? col.color : null, icon: ic ? ic.icon : '', top: mine[0] ? mine[0].id : null };
}

// ---- private channels ----
// A private channel is visible only to the owner, members with "admin", and members holding one of ch.roles.
// An empty ch.roles on a private channel means "admins only" — never "everyone".
const isPrivate = (ch) => !!(ch && ch.private);
function canView(sv, ch, u) {
  if (!u || !ch) return false;
  if (!sv.members[u.id] && !(sv.official && isAdmin(u))) return false;
  if (!isPrivate(ch)) return true;
  if (isServerOwner(sv, u) || permsOf(sv, u).has('admin')) return true;
  if (Array.isArray(ch.users) && ch.users.includes(u.id)) return true; // tickets: the person who opened it
  const mem = sv.members[u.id]; return !!mem && (mem.roles || []).some((r) => (ch.roles || []).includes(r));
}
function viewersOf(sv, ch) {
  const ids = Object.keys(sv.members);
  if (!isPrivate(ch)) return ids;
  return ids.filter((id) => canView(sv, ch, S.users[id]));
}
function needView(sv, ch, u) { if (!canView(sv, ch, u)) throw new HttpError(404, 'no_channel', 'Channel not found'); }
function cleanChannelRoles(sv, list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String))].filter((id) => sv.roles.some((r) => r.id === id)).slice(0, MAX_ROLES);
}

// ---- input cleaning ----
function cleanPerms(list, actorPerms, { allowAdmin = true } = {}) {
  if (!Array.isArray(list)) throw new HttpError(400, 'bad_perms', 'Permissions must be a list');
  const out = [...new Set(list.map(String))].filter((p) => ALL.has(p));
  if (!allowAdmin && out.includes('admin')) throw new HttpError(400, 'bad_perms', 'This permission cannot be given here');
  for (const p of out) if (!actorPerms.has(p)) throw new HttpError(403, 'perm_escalation', 'You cannot grant a permission you do not have');
  return out;
}
function cleanRoleFields(b, actorPerms, base = {}) {
  const r = Object.assign({}, base);
  if (b.name !== undefined) { const n = String(b.name).replace(/[\u0000-\u001f‪-‮⁦-⁩]/g, '').trim(); if (n.length < 1 || n.length > 32) throw new HttpError(400, 'bad_name', 'Role names are 1-32 characters'); if (/^@?everyone$/i.test(n)) throw new HttpError(400, 'bad_name', 'That name is reserved'); r.name = n; }
  if (b.color !== undefined) { if (b.color === null || b.color === '') r.color = null; else if (COLOR_RE.test(String(b.color))) r.color = String(b.color).toLowerCase(); else throw new HttpError(400, 'bad_color', 'Use a #rrggbb colour'); }
  if (b.icon !== undefined) { const ic = String(b.icon || ''); if (ic && (ic.length > 16 || !EMOJI_RE.test(ic))) throw new HttpError(400, 'bad_icon', 'Use one emoji as the icon'); r.icon = ic; }
  if (b.perms !== undefined) r.perms = cleanPerms(b.perms, actorPerms);
  if (b.hoist !== undefined) r.hoist = !!b.hoist;
  if (b.mentionable !== undefined) r.mentionable = !!b.mentionable;
  return r;
}

// For edits: the actor may toggle only permissions they hold; anything else already on the role is preserved untouched.
function mergePerms(current, requested, actorPerms, { allowAdmin = true } = {}) {
  if (!Array.isArray(requested)) throw new HttpError(400, 'bad_perms', 'Permissions must be a list');
  const want = new Set(requested.map(String).filter((p) => ALL.has(p)));
  if (!allowAdmin && want.has('admin')) throw new HttpError(400, 'bad_perms', 'This permission cannot be given here');
  for (const p of want) if (!actorPerms.has(p) && !current.includes(p)) throw new HttpError(403, 'perm_escalation', 'You cannot grant a permission you do not have');
  const out = []; for (const p of PERMS) { if (actorPerms.has(p) ? want.has(p) : current.includes(p)) out.push(p); }
  return out;
}

function rolesView(sv) { ensureRoles(sv); return sv.roles.map((r, i) => ({ id: r.id, name: r.name, color: r.color, icon: r.icon, perms: r.perms, hoist: r.hoist, mentionable: r.mentionable, position: i })); }

module.exports = {
  PERMS, DEFAULT_EVERYONE, MOD_PERMS, MAX_ROLES, ensureRoles, mkRole, permsOf, can, need, topPos, outranks, roleIndex, canManageRole,
  memberStyle, isPrivate, canView, viewersOf, needView, cleanChannelRoles, cleanPerms, mergePerms, cleanRoleFields, rolesView, isServerOwner,
};
