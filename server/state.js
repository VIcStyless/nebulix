'use strict';
// Shared in-memory state, indexes and helpers used by all route modules.
const cfg = require('./config');
const Store = require('./store');
const { now } = require('./util');

const S = {
  store: null, users: null, sessions: null, servers: null, channels: null, invites: null, themes: null,
  reports: null, meta: null, codes: null, dms: null,
  byName: new Map(), byEmail: new Map(),
};

// ---- WebSocket hub (presence + push) ----
const hub = {
  conns: new Map(),
  act: new Map(), // uid -> { kind, label, t } live activity (never persisted)
  add(uid, conn) {
    let s = this.conns.get(uid); const first = !s || s.size === 0;
    if (!s) this.conns.set(uid, (s = new Set()));
    s.add(conn); return first;
  },
  remove(uid, conn) {
    const s = this.conns.get(uid); if (!s) return false;
    s.delete(conn); if (s.size === 0) { this.conns.delete(uid); this.act.delete(uid); return true; }
    return false;
  },
  online(uid) { return this.conns.has(uid); },
  count() { return this.conns.size; },
  push(uid, msg) {
    const s = this.conns.get(uid); if (!s) { offlinePush(uid, msg); return; }
    const str = JSON.stringify(msg);
    for (const c of s) c.send(str);
  },
  pushMany(uids, msg) {
    const str = JSON.stringify(msg);
    for (const uid of uids) { const s = this.conns.get(uid); if (s) for (const c of s) c.send(str); else offlinePush(uid, msg); }
  },
};
S.hub = hub;
// 13.8: whoever is offline gets the important ones as a Web Push notification (if they turned it on)
function offlinePush(uid, msg) { try { if (msg && ['notice', 'notify', 'ar_invite', 'dm'].includes(msg.t) && S.users[uid] && S.users[uid].push && S.users[uid].push.length) require('./webpush').maybe(uid, msg); } catch (e) { console.error('[push]', e.message); } }

function init() {
  S.store = new Store(cfg.dataDir);
  S.users = S.store.table('users');
  S.sessions = S.store.table('sessions');
  S.servers = S.store.table('servers');
  S.channels = S.store.table('channels');
  S.invites = S.store.table('invites');
  S.themes = S.store.table('themes');
  S.reports = S.store.table('reports', []);
  S.codes = S.store.table('codes');
  S.dms = S.store.table('dms');
  S.meta = S.store.table('meta', {});
  S.meta.audit = S.meta.audit || [];
  S.meta.announcements = S.meta.announcements || [];
  S.meta.blocklist = S.meta.blocklist || [];
  S.meta.verifiedCount = S.meta.verifiedCount || 0;
  S.meta.groles = Array.isArray(S.meta.groles) ? S.meta.groles : [];
  S.byName.clear(); S.byEmail.clear();
  for (const u of Object.values(S.users)) {
    if (u.deleted) continue;
    S.byName.set(u.usernameLower, u.id); if (u.emailLower) S.byEmail.set(u.emailLower, u.id);
  }
  // purge stale unverified signups (frees usernames)
  let purged = 0;
  for (const u of Object.values(S.users)) {
    if (!u.verified && !u.deleted && now() - u.created > 24 * 3600 * 1000) {
      S.byName.delete(u.usernameLower); if (u.emailLower) S.byEmail.delete(u.emailLower); delete S.users[u.id]; purged++;
    }
  }
  if (purged) S.store.touch('users');
  // drop expired sessions
  let dropped = 0;
  for (const [h, s] of Object.entries(S.sessions)) if (now() - s.created > 30 * 86400000 || !S.users[s.uid]) { delete S.sessions[h]; dropped++; }
  if (dropped) S.store.touch('sessions');
}

const isPro = (u) => !!u && (u.proUntil > now() || u.role === 'owner');
const isStaff = (u) => !!u && (u.role === 'owner' || u.role === 'admin' || u.role === 'mod');
const isAdmin = (u) => !!u && (u.role === 'owner' || u.role === 'admin');

function badgesOf(u) {
  const b = [];
  if (u.role === 'owner') b.push('founder'); else if (u.role === 'admin') b.push('admin'); else if (u.role === 'mod') b.push('mod');
  if (u.verified && !u.noEmail) b.push('verified'); // the badge is for a confirmed email; accounts created without one are active but unbadged
  if (isPro(u)) b.push('pro');
  if (u.early) b.push('early');
  if (u.themesPublished > 0) b.push('creator');
  return b;
}

function cleanEq(eq) {
  eq = eq || {};
  return { frame: eq.frame || null, banner: eq.banner || null, nameFx: eq.nameFx || null, effect: eq.effect || null, bubble: eq.bubble || null, title: eq.title || null, badges: Array.isArray(eq.badges) ? eq.badges.slice(0, 3) : [],
    outfit: eq.outfit || null, backpack: eq.backpack || null, pickaxe: eq.pickaxe || null, glider: eq.glider || null, wrap: eq.wrap || null, trail: eq.trail || null, elim: eq.elim || null, emotes: Array.isArray(eq.emotes) ? eq.emotes.slice(0, 4) : [] };
}

function statusOf(u) { const s = u.status; if (!s || (s.until && s.until < now())) return null; return { text: s.text || '', emoji: s.emoji || '' }; }
function activityOf(u) { if (!hub.online(u.id) || (u.settings && u.settings.showActivity === false)) return null; return hub.act.get(u.id) || null; }
function globalRolesOf(u) {
  const list = (S.meta && S.meta.groles) || []; if (!u.groles || !u.groles.length || !list.length) return [];
  return list.filter((r) => u.groles.includes(r.id)).map((r) => ({ id: r.id, name: r.name, nameEn: r.nameEn || null, hoist: r.hoist !== false, color: r.color, icon: r.icon }));
}

function publicUser(u) {
  if (!u) return null;
  if (u.deleted) return { id: u.id, username: 'deleted', displayName: 'Deleted User', avatar: null, badges: [], eq: cleanEq(), online: false, deleted: true };
  return {
    id: u.id, username: u.username, displayName: u.displayName || u.username,
    avatar: u.avatar || null, banner: u.banner || null, bannerColor: u.bannerColor || null, bio: u.bio || '',
    badges: badgesOf(u), eq: cleanEq(u.eq), created: u.created, online: hub.online(u.id), pro: isPro(u), role: u.role,
    lvl: u.prog ? require('./progress').levelOf(u.prog.xp || 0) : 1, status: statusOf(u), act: activityOf(u), groles: globalRolesOf(u),
    showcase: u.prog && Array.isArray(u.prog.showcase) ? u.prog.showcase.slice(0, 3) : [],
    av3: u.av3 || null,
    clan: u.clan ? require('./clans').tagOf(u) : null,
    league: u.league ? (u.league.tier || 0) : 0,
    rk: require('./ranked').badgeOf(u),
  };
}

// 13.8 membership tiers: Premium (the old PRO), Premium Pro and Premium Ultimate. All of them count as PRO.
const TIERS = ['premium', 'pro', 'ultimate'];
const tierOf = (u) => (u && isPro(u) ? (u.role === 'owner' ? 'ultimate' : TIERS.includes(u.tier) ? u.tier : 'premium') : null);
const tierRank = (u) => TIERS.indexOf(tierOf(u)) + 1; // 0 free · 1 premium · 2 pro · 3 ultimate
function selfUser(u) {
  return Object.assign(publicUser(u), {
    email: u.email, verified: !!u.verified, noEmail: !!u.noEmail, pendingEmail: u.pendEmail ? u.pendEmail.email : null, coins: u.coins, infinite: !!u.infinite, gems: u.gems || 0, inv: u.inv, lang: u.lang || 'en',
    proUntil: u.proUntil || 0, tier: tierOf(u), settings: u.settings || {}, hasKey: !!u.pub, hasBackup: !!u.keyBackup, tfa: !!(u.tfa && u.tfa.on),
    stats: u.stats || {}, bookmarks: u.bookmarks || [], uploadBytes: u.uploadBytes || 0, lock: u.lock ? { on: true, idle: u.lock.idle || 0, start: !!u.lock.start } : null,
  });
}

function audit(action, actorId, detail) {
  S.meta.audit.unshift({ t: now(), a: action, by: actorId, d: detail });
  if (S.meta.audit.length > 500) S.meta.audit.length = 500;
  S.store.touch('meta');
}

function hasOwner() { return Object.values(S.users).some((u) => u.role === 'owner' && !u.deleted); }

module.exports = { TIERS, tierOf, tierRank, S, hub, init, isPro, isStaff, isAdmin, publicUser, selfUser, badgesOf, cleanEq, audit, hasOwner, statusOf, activityOf };
