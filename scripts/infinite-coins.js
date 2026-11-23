#!/usr/bin/env node
'use strict';
// Give one account a bottomless wallet (or take it away), straight on the data store.
// Stop Nebulix first — a running server would overwrite the change.
// Usage:
//   node scripts/infinite-coins.js <username|email>        → turn it ON for that account
//   node scripts/infinite-coins.js <username|email> off    → turn it OFF (balance stays as it is)
const path = require('path');
const ROOT = path.join(__dirname, '..');
const cfg = require(path.join(ROOT, 'server/config'));
const Store = require(path.join(ROOT, 'server/store'));
const { MAX_COINS } = { MAX_COINS: 1_000_000_000 };

const arg = (process.argv[2] || '').trim(); const off = (process.argv[3] || '').toLowerCase() === 'off';
if (!arg) { console.error('\nUsage: node scripts/infinite-coins.js <username|email> [off]\n'); process.exit(1); }
const store = new Store(cfg.dataDir); const users = store.table('users');
const q = arg.toLowerCase();
const u = Object.values(users).find((x) => x && !x.deleted && ((x.username || '').toLowerCase() === q || (x.email || '').toLowerCase() === q));
if (!u) { console.error(`\nNo account matches "${arg}".\n`); process.exit(1); }
if (off) delete u.infinite; else { u.infinite = true; u.coins = MAX_COINS; }
store.touch('users'); store.flushSync();
const others = Object.values(users).filter((x) => x && x.infinite && x.id !== u.id).map((x) => '@' + x.username);
console.log(`\n✓ @${u.username}: infinite coins ${off ? 'OFF' : 'ON'}.` + (others.length ? `  Also ON for: ${others.join(', ')}` : '  Nobody else has it.') + '\n');
