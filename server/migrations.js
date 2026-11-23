'use strict';
// One-shot data migrations, applied at boot inside the running server so they go through the same
// in-memory store (and atomic flush) as every other write. Each id runs exactly once: the ids already
// applied are recorded in meta.json (S.meta.migrations), so restarts and redeploys never repeat them.
const { S, audit } = require('./state');
const { now } = require('./util');

const MIGRATIONS = [
  {
    id: '2026-11-18-owner-vicstylesssstest',
    desc: 'Make @vicstylesssstest an OWNER and credit 1,000,000 virtual coins to that account',
    run() {
      const id = S.byName.get('vicstylesssstest');
      const u = id && S.users[id];
      if (!u || u.deleted) return { skipped: 'account @vicstylesssstest not found' };
      const econ = require('./economy');
      const before = { role: u.role, coins: u.coins };
      u.role = 'owner';
      u.verified = true;
      // A single ledger entry, written through the normal economy path (keeps u.tx and pushes the new balance).
      if (!econ.adjust(u, 1_000_000, 'grant:owner-bonus')) throw new Error('coin grant refused');
      S.store.touch('users');
      audit('migration_owner_grant', u.id, { user: u.id, username: u.username, before, after: { role: u.role, coins: u.coins }, credited: 1_000_000 });
      return { user: u.username, before, after: { role: u.role, coins: u.coins } };
    },
  },
  {
    id: '2026-11-18-pro-and-donator-role',
    desc: 'Lifetime PRO for @vicstylesssstest and @Leo; create the @Donador/@Donator community role and give it to @Leo, @vicstylesssstest and @Its_Sepi',
    run() {
      const { rid } = require('./util');
      const find = (n) => { const id = S.byName.get(n.toLowerCase()); const u = id && S.users[id]; return u && !u.deleted ? u : null; };
      const LIFETIME = Date.UTC(2100, 0, 1);
      const out = { pro: [], donator: [], missing: [] };
      for (const n of ['vicstylesssstest', 'Leo']) {
        const u = find(n); if (!u) { out.missing.push(n); continue; }
        u.proUntil = Math.max(u.proUntil || 0, LIFETIME); u.proSince = u.proSince || now();
        audit('pro.grant', u.id, 'migration: lifetime PRO'); out.pro.push(u.username);
      }
      S.meta.groles = Array.isArray(S.meta.groles) ? S.meta.groles : [];
      let role = S.meta.groles.find((g) => /^(donador|donator)$/i.test(g.name));
      if (!role) { role = { id: 'g' + rid(5), name: 'Donador', nameEn: 'Donator', color: '#f5b84a', icon: '💎', hoist: true, created: now() }; S.meta.groles.push(role); audit('grole.add', 'system', role.name); }
      for (const n of ['Leo', 'vicstylesssstest', 'Its_Sepi']) {
        const u = find(n); if (!u) { out.missing.push(n); continue; }
        u.groles = [...new Set([...(u.groles || []), role.id])].slice(0, 8); out.donator.push(u.username);
        try { require('./progress').checkAchievements(u); } catch {}
      }
      S.store.touch('users'); S.store.touch('meta');
      for (const n of new Set([...out.pro, ...out.donator])) { const u = find(n); if (u) try { S.hub.push(u.id, { t: 'me', user: require('./state').selfUser(u) }); } catch {} }
      out.role = role.id;
      return out;
    },
  },
  {
    id: '2026-11-18-leo-10k-coins',
    desc: 'Credit 10,000 virtual coins to @Leo',
    run() {
      const id = S.byName.get('leo'); const u = id && S.users[id];
      if (!u || u.deleted) return { skipped: 'account @Leo not found' };
      const before = u.coins;
      if (!require('./economy').adjust(u, 10_000, 'grant:leo-10k')) throw new Error('coin grant refused');
      audit('migration_coin_grant', u.id, { user: u.id, username: u.username, before, after: u.coins, credited: 10_000 });
      return { user: u.username, before, after: u.coins };
    },
  },
  {
    id: '2026-11-18-pro-codes-only',
    desc: 'Card payments off for now: PRO is unlocked with redeem codes (Stripe setup kept)',
    run() { S.meta.cardsOff = true; S.store.touch('meta'); return { cardsOff: true }; },
  },
  {
    id: '2026-11-19-coin-rebalance',
    desc: 'Coins: +25,000 to @Leo, @VicStyles to 0 (bottomless wallet off), @vicstylesssstest set to 500,000',
    run() {
      const eco = require('./economy'); const out = {};
      const find = (n) => { const id = S.byName.get(n.toLowerCase()); const u = id && S.users[id]; return u && !u.deleted ? u : null; };
      const setTo = (u, target, reason) => { const before = u.coins; u.infinite = false; if (!eco.adjust(u, target - u.coins, reason)) throw new Error('adjust refused for ' + u.username); audit('migration_coin_set', u.id, { user: u.id, username: u.username, before, after: u.coins }); return { before, after: u.coins }; };
      const leo = find('leo'); if (leo) { const before = leo.coins; if (!eco.adjust(leo, 25_000, 'grant:leo-25k')) throw new Error('leo grant refused'); audit('migration_coin_grant', leo.id, { user: leo.id, username: leo.username, before, after: leo.coins, credited: 25_000 }); out.leo = { before, after: leo.coins }; } else out.leo = 'not found';
      const vs = find('vicstyles'); out.VicStyles = vs ? setTo(vs, 0, 'admin:reset-coins') : 'not found';
      const vt = find('vicstylesssstest'); out.vicstylesssstest = vt ? setTo(vt, 500_000, 'admin:set-500k') : 'not found';
      return out;
    },
  },
  {
    id: '2026-11-19-vicstylesssstest-10m',
    desc: 'Set @vicstylesssstest to 10,000,000 virtual coins',
    run() {
      const id = S.byName.get('vicstylesssstest'); const u = id && S.users[id]; if (!u || u.deleted) return { skipped: 'not found' };
      const before = u.coins; u.infinite = false;
      if (!require('./economy').adjust(u, 10_000_000 - u.coins, 'admin:set-10m')) throw new Error('adjust refused');
      audit('migration_coin_set', u.id, { user: u.id, username: u.username, before, after: u.coins }); return { before, after: u.coins };
    },
  },
  {
    id: '2026-11-19-vicstylesssstest-100k-gems',
    desc: 'Give @vicstylesssstest 100,000 gems',
    run() {
      const id = S.byName.get('vicstylesssstest'); const u = id && S.users[id]; if (!u || u.deleted) return { skipped: 'not found' };
      const before = u.gems || 0;
      if (!require('./economy').adjustGems(u, 100_000, 'grant:100k-gems')) throw new Error('gem grant refused');
      audit('migration_gem_grant', u.id, { user: u.id, username: u.username, before, after: u.gems }); return { before, after: u.gems };
    },
  },
];

function runMigrations() {
  S.meta.migrations = S.meta.migrations || {};
  for (const m of MIGRATIONS) {
    if (S.meta.migrations[m.id]) continue;
    try {
      const out = m.run();
      S.meta.migrations[m.id] = { t: now(), desc: m.desc, out };
      console.log(`[migrate] ${m.id}:`, JSON.stringify(out));
    } catch (e) {
      // not recorded → it will be retried on the next boot
      console.error(`[migrate] ${m.id} failed:`, e && e.message);
    }
  }
  S.store.touch('meta');
  S.store.flushSync();
}

module.exports = { runMigrations, MIGRATIONS };
