#!/usr/bin/env node
'use strict';
// Promote an account to owner/admin/mod (or back to user), straight on the data store — the server does NOT need to be running.
// Usage:
//   node scripts/make-admin.js                       → list accounts
//   node scripts/make-admin.js <username|email>       → make that account the OWNER
//   node scripts/make-admin.js <username|email> admin  (or: mod / owner / user)
const path = require('path');
const ROOT = path.join(__dirname, '..');
const cfg = require(path.join(ROOT, 'server/config'));
const Store = require(path.join(ROOT, 'server/store'));

const ROLES = ['user', 'mod', 'admin', 'owner'];
const arg = (process.argv[2] || '').trim();
const role = (process.argv[3] || 'owner').trim().toLowerCase();

const store = new Store(cfg.dataDir);
const users = store.table('users');
const list = Object.values(users).filter((u) => u && !u.deleted);

if (!arg) {
  if (!list.length) { console.log('\nNo accounts yet. Start Nebulix, create an account (and verify it), then run this again.\n'); process.exit(0); }
  console.log('\nAccounts in ' + cfg.dataDir + ':\n');
  for (const u of list.sort((a, b) => (a.created || 0) - (b.created || 0))) {
    console.log(`  ${(u.role || 'user').padEnd(6)}  @${(u.username || '?').padEnd(20)} ${u.email || ''}${u.verified ? '' : '  (unverified)'}`);
  }
  console.log('\nMake someone the owner:  node scripts/make-admin.js <username-or-email>');
  console.log('Set a specific role:     node scripts/make-admin.js <username-or-email> admin|mod|owner|user\n');
  process.exit(0);
}
if (!ROLES.includes(role)) { console.error(`Unknown role "${role}". Use one of: ${ROLES.join(', ')}`); process.exit(1); }

const q = arg.toLowerCase();
const u = list.find((x) => (x.username || '').toLowerCase() === q || (x.email || '').toLowerCase() === q || x.id === arg);
if (!u) { console.error(`\nNo account matches "${arg}". Run with no arguments to list accounts.\n`); process.exit(1); }

if (role === 'owner') {
  for (const o of list) if (o.role === 'owner' && o.id !== u.id) { o.role = 'admin'; console.log(`  (demoted previous owner @${o.username} to admin)`); }
}
u.role = role;
u.verified = true; // an admin should be able to sign in and act immediately

store.touch('users');
store.flushSync();
console.log(`\n✓ @${u.username} is now ${role}. Restart Nebulix if it is running.\n`);
